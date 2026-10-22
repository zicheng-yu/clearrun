/**
 * The no-tools baseline: the agent's question, asked of the same model with today's date and the same answer
 * format, but no tools and no live data. The model lists the releases it relied on, and each date is checked
 * against the live slate; the audience's biggest rivals (from the agent's plan) that it never mentions are
 * counted as missed. One model call per run, stored with the run, so replays and share links cost nothing.
 */
import { parseDay } from "../engine/agent/text.ts";
import { checkClaims, splitAnswer } from "../engine/baseline/check.ts";
import { analyze } from "../engine/score/analyze.ts";
import { fmtDay } from "../engine/score/narrate.ts";
import { isoDay, releaseWeek } from "../shared/dates.ts";
import { GAMES } from "../shared/games.ts";
import type { AgentPlan, BaselineResult } from "../shared/types.ts";
import { chat, type LlmConfig } from "./openrouter.ts";
import { planStep, SlateNotReadyError } from "./plan.ts";
import type { QlooClient } from "./qloo.ts";
import { latestSnapshot, loadAgentRun, saveAgentRun } from "./store.ts";

// Haiku 5.5 reasons before it answers, even at low effort (about 900 tokens on a release question).
const MAX_TOKENS = 3000;

const SYSTEM = `You are a release-planning assistant for film distributors. You help choose a US theatrical release week when the audience isn't already spoken for. Answer from your own knowledge.

Answer format: one sentence with the recommendation (hold the date, move to a named week, or the best weeks). Then 2-4 bullets starting with "- ", one or two sentences each, that give the evidence, with dates. End with one short line naming the main caveat. Keep the whole answer under 150 words. Plain text, no headings or tables.

After the answer, add a JSON code block with the opening date you recommend and every film or game release you mentioned or relied on, with its US release date. Write dates as YYYY-MM-DD and use null for anything you don't know:
\`\`\`json
{"recommended": "YYYY-MM-DD", "releases": [{"title": "Title", "date": "YYYY-MM-DD"}]}
\`\`\``;

export class BaselineInputError extends Error {}
export class BaselineEmptyError extends Error {}

/** The parts of an agent run the baseline reads; the rest of the run is kept as it is. */
type RunView = { question: string; plan?: AgentPlan; baseline?: BaselineResult } & Record<string, unknown>;

const aliasesOf = (title: string) => GAMES.find((g) => g.title === title)?.aliases;

export async function runBaseline(ctx: { db: D1Database; qloo?: QlooClient; llm: LlmConfig }, runId: unknown): Promise<BaselineResult> {
	const run = typeof runId === "string" ? await loadAgentRun<RunView>(ctx.db, runId) : undefined;
	if (!run) throw new BaselineInputError("That run doesn't exist");
	if (run.status !== "done") throw new BaselineInputError("Wait for the agent to finish first");
	if (run.state.baseline?.answer) return run.state.baseline;
	const snapshot = await latestSnapshot(ctx.db);
	if (!snapshot) throw new SlateNotReadyError("The release slate is still being built");

	const date = fmtDay(isoDay(new Date()), { weekday: "short", month: "short", day: "numeric", year: "numeric" });
	const result = await chat(ctx.db, ctx.llm, {
		messages: [
			{ role: "system", content: SYSTEM },
			{ role: "user", content: `Today is ${date}.\n\nQuestion: ${run.state.question}` },
		],
		maxTokens: MAX_TOKENS,
	});
	const text = result.message.content?.trim() ?? "";
	// Never store a cut-off answer: the next request asks again.
	if (!text || result.finishReason === "length") throw new BaselineEmptyError("The model ran out of room before answering. Try again.");
	const { answer, claims, recommended } = splitAnswer(text);

	// The agent's audience on today's calendar (cached scores only, so no Qloo calls): its biggest rivals,
	// and how the model's own pick rates for that audience.
	let top: { title: string; date: string; aliases?: string[] }[] = [];
	let pick: BaselineResult["pick"];
	const plan = run.state.plan;
	if (plan) {
		const scored = await planStep({ db: ctx.db, qloo: ctx.qloo }, { comps: plan.comps.map((c) => c.id), you: plan.you }, { maxCalls: 0, snapshot });
		if (scored.status === "ready") {
			const window = { start: snapshot.windowStart, end: snapshot.windowEnd };
			const said = recommended ? parseDay(recommended, window) : undefined;
			const week = said ? releaseWeek(said) : undefined;
			const analysis = analyze({ rivals: scored.rivals, windowStart: window.start, windowEnd: window.end, from: plan.from, yourWeek: week });
			top = analysis.threats.map((r) => ({ title: r.title, date: r.date, aliases: aliasesOf(r.title) }));
			const w = week ? analysis.calendar.find((x) => x.week === week) : undefined;
			if (said && week && w && analysis.verdict) {
				pick = { said, week, pressure: Math.round(w.p * 1000) / 1000, rank: analysis.verdict.rank, of: analysis.verdict.of, ...(w.season.label ? { season: w.season.label } : {}) };
			}
		}
	}
	const checked = checkClaims({
		claims: claims ?? [],
		slate: snapshot.titles.map((t) => ({ title: t.title, date: t.date, aliases: aliasesOf(t.title) })),
		window: { start: snapshot.windowStart, end: snapshot.windowEnd },
		answer,
		top,
	});
	const baseline: BaselineResult = {
		answer: answer || text,
		claims: claims ? checked.claims : null,
		counts: checked.counts,
		missed: checked.missed,
		topChecked: checked.topChecked,
		...(pick ? { pick } : {}),
		costUsd: Math.round(result.usage.costUsd * 1e6) / 1e6,
		model: result.model,
		at: Date.now(),
	};
	run.state = { ...run.state, baseline };
	await saveAgentRun(ctx.db, run);
	return baseline;
}

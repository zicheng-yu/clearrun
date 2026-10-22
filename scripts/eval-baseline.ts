/**
 * How well does the model alone know the release calendar? Two tests against the live slate, with the same
 * model and settings as the agent (Claude Haiku 5.5 over OpenRouter, low reasoning effort) and no tools:
 *   1. Dates: the US release dates of the 20 most-watched titles on the slate (by Wikipedia pageviews).
 *   2. Listing: "the 15 biggest US releases from Nov through Mar", checked against the slate, and how many
 *      of the slate's 15 most-watched films in that span it names.
 * Run: node --env-file=.dev.vars scripts/eval-baseline.ts [trials=3]   (about $0.0015 per trial)
 * Writes docs/eval-baseline.md. The slate comes from the public API; no Qloo data is involved.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { checkClaims, findOnSlate, splitAnswer, type Claim } from "../src/engine/baseline/check.ts";
import { fmtDay } from "../src/engine/score/narrate.ts";
import { isoDay, releaseWeek } from "../src/shared/dates.ts";
import { GAMES } from "../src/shared/games.ts";
import type { SlateSnapshot } from "../src/shared/types.ts";

const SITE = "https://clearrun.zichengyu.com";
const MODEL = "anthropic/claude-haiku-5.5";
const trials = Number(process.argv[2] ?? 3);
const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error("Set OPENROUTER_API_KEY (node --env-file=.dev.vars ...)");

let spent = 0;
const raw: string[] = [];
async function ask(prompt: string): Promise<string> {
	const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
		method: "POST",
		headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Clear Run eval" },
		body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], max_tokens: 4000, reasoning: { effort: "low" }, usage: { include: true } }),
	});
	if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${(await response.text()).slice(0, 200)}`);
	const data = (await response.json()) as { choices?: { message?: { content?: string } }[]; usage?: { cost?: number } };
	spent += data.usage?.cost ?? 0;
	const reply = data.choices?.[0]?.message?.content ?? "";
	raw.push(reply);
	return reply;
}

/** A JSON array from a reply that may wrap it in a code fence; undefined when there's none to read. */
function claimsOf(reply: string): Claim[] | undefined {
	return splitAnswer(reply.trim().startsWith("[") ? `\n${reply.trim()}` : reply).claims;
}

const slate = (await (await fetch(`${SITE}/api/slate`)).json()) as SlateSnapshot;
const today = isoDay(new Date());
const todayText = fmtDay(today, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const entries = slate.titles.map((t) => ({ title: t.title, date: t.date, kind: t.kind, views: t.views30d ?? 0, aliases: GAMES.find((g) => g.title === t.title)?.aliases }));
const top20 = [...entries].sort((a, b) => b.views - a.views).slice(0, 20);
const span = { start: "2026-11-01", end: "2027-03-31" };
const topFilms = entries.filter((t) => t.kind === "film" && t.date >= span.start && t.date <= span.end).sort((a, b) => b.views - a.views);
const top15 = topFilms.slice(0, 15);

type Verdict = "right-date" | "right-week" | "wrong-date" | "no-date";
const datesRows = top20.map((t) => ({ ...t, answers: [] as (string | null)[], verdicts: [] as Verdict[] }));
const listing: { named: number; onSlate: number; right: number; week: number; wrong: number; notOnSlate: number; found: number }[] = [];
let unreadable = 0;

for (let trial = 0; trial < trials; trial++) {
	const datesPrompt = `Today is ${todayText}. For each title below, give its US release date (theatrical release for films, launch for games) as YYYY-MM-DD, or null if you don't know it. Reply with only a JSON array of {"title": ..., "date": ...} objects in the same order.\n\n${top20.map((t) => `- ${t.title}${t.kind === "game" ? " (video game)" : ""}`).join("\n")}`;
	const answers = claimsOf(await ask(datesPrompt)) ?? [];
	for (const row of datesRows) {
		const a = answers.find((c) => findOnSlate(c.title, [row]).length > 0);
		const date = a?.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : null;
		row.answers.push(date);
		row.verdicts.push(!date ? "no-date" : date === row.date ? "right-date" : releaseWeek(date) === releaseWeek(row.date) ? "right-week" : "wrong-date");
	}

	const listPrompt = `Today is ${todayText}. List the 15 biggest US theatrical film releases scheduled between ${fmtDay(span.start, { month: "short", day: "numeric", year: "numeric" })} and ${fmtDay(span.end, { month: "short", day: "numeric", year: "numeric" })}, with their US release dates. Reply with only a JSON array of {"title": ..., "date": "YYYY-MM-DD"} objects.`;
	const listed = claimsOf(await ask(listPrompt));
	if (!listed) {
		unreadable += 1;
		console.log(`trial ${trial + 1}: the listing reply had no readable list`);
		continue;
	}
	const checked = checkClaims({ claims: listed, slate: entries, window: { start: slate.windowStart, end: slate.windowEnd }, answer: "", top: top15 });
	listing.push({
		named: listed.length,
		onSlate: checked.claims.filter((c) => c.slate).length,
		right: checked.counts["right-date"],
		week: checked.counts["right-week"],
		wrong: checked.counts["wrong-date"],
		notOnSlate: checked.counts["not-on-slate"],
		found: top15.length - checked.missed.length,
	});
	console.log(`trial ${trial + 1}: dates ${datesRows.filter((r) => r.verdicts[trial] === "right-date").length}/20 exact · listing ${JSON.stringify(listing.at(-1))}`);
}

const share = (n: number, d: number) => `${n}/${d} (${Math.round((100 * n) / d)}%)`;
const total = (v: Verdict) => datesRows.reduce((sum, r) => sum + r.verdicts.filter((x) => x === v).length, 0);
const answered = trials * datesRows.length;
const mean = (f: (x: (typeof listing)[number]) => number) => (listing.length ? listing.reduce((s, x) => s + f(x), 0) / listing.length : 0).toFixed(1);
const lines = [
	"# Baseline evaluation: the model alone vs. the live slate",
	"",
	`Run ${today} against the live slate of ${fmtDay(new Date(slate.createdAt).toISOString().slice(0, 10), { month: "short", day: "numeric", year: "numeric" })} (${slate.titles.length} titles, ${slate.windowStart} to ${slate.windowEnd}).`,
	`Model: \`${MODEL}\` over OpenRouter, low reasoning effort, no tools: the same model and settings as the Clear Run agent, with today's date in the prompt. ${trials} trials; total cost $${spent.toFixed(4)}.`,
	"",
	"Release dates come from Wikipedia's \"List of American films\" tables (CC BY-SA 4.0) and each game's article. The agent never states a date it didn't get from its tools, and every answer is checked (the date check under each answer).",
	"",
	"## 1. Dates of the 20 most-watched titles",
	"",
	`- Right date: ${share(total("right-date"), answered)}`,
	`- Right week, wrong day: ${share(total("right-week"), answered)}`,
	`- Wrong date: ${share(total("wrong-date"), answered)}`,
	`- No date given: ${share(total("no-date"), answered)}`,
	"",
	`| Title | Slate date | ${Array.from({ length: trials }, (_, i) => `Trial ${i + 1}`).join(" | ")} |`,
	`|---|---|${"---|".repeat(trials)}`,
	...datesRows.map((r) => `| ${r.title}${r.kind === "game" ? " (game)" : ""} | ${r.date} | ${r.answers.map((a, i) => `${a ?? "—"} ${r.verdicts[i] === "right-date" ? "✓" : r.verdicts[i] === "right-week" ? "≈" : r.verdicts[i] === "wrong-date" ? "✗" : ""}`.trim()).join(" | ")} |`),
	"",
	"✓ right date · ≈ right release week · ✗ wrong date · — no date given",
	"",
	`## 2. "The 15 biggest US releases, ${fmtDay(span.start)} – ${fmtDay(span.end, { month: "short", day: "numeric", year: "numeric" })}"`,
	"",
	unreadable ? `${unreadable} of ${trials} trials returned no readable list; the averages cover the other ${listing.length}.` : `All ${trials} trials returned a readable list.`,
	"",
	`Average per trial: ${mean((x) => x.named)} titles named, ${mean((x) => x.onSlate)} of them on the slate. Of those, ${mean((x) => x.right)} had the right date, ${mean((x) => x.week)} the right week and ${mean((x) => x.wrong)} a wrong date. ${mean((x) => x.notOnSlate)} weren't on the current US slate under that name.`,
	`It named ${mean((x) => x.found)} of the slate's ${top15.length} most-watched films in that span on average. Those films: ${top15.map((t) => `${t.title} (${fmtDay(t.date)})`).join(", ")}.`,
	"",
];
// Raw replies stay outside the repo, for debugging.
mkdirSync("/tmp/clearrun-eval", { recursive: true });
writeFileSync(`/tmp/clearrun-eval/replies-${today}.json`, JSON.stringify(raw, null, 2));
mkdirSync("docs", { recursive: true });
writeFileSync("docs/eval-baseline.md", lines.join("\n"));
console.log(lines.slice(0, 16).join("\n"));
console.log(`\nWrote docs/eval-baseline.md · spent $${spent.toFixed(4)}`);

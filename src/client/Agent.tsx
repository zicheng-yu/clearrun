import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { fmtDay } from "../engine/score/narrate.ts";
import type { AgentEvent, AgentPlan, AgentStepResponse, BaselineResult, CheckedClaim, ClaimStatus } from "../shared/types.ts";
import { agentStep, fetchAgentRun, fetchBaseline } from "./api.ts";

const EXAMPLES = [
	"Should Dune: Part Three keep its Dec 18 date?",
	"How exposed is The Hunger Games: Sunrise on the Reaping to GTA VI?",
	"When should an original horror film like Hereditary open in early 2027?",
	"Find a clear winter week for a family film like Paddington 2.",
];

type Run =
	| { status: "idle" }
	| { status: "running" | "done" | "error"; question: string; runId?: string; events: AgentEvent[]; replay?: boolean; error?: string; baseline?: BaselineResult };

const card = "rounded-[18px] border border-line bg-stage";
const field = "h-11 w-full rounded-[10px] border border-line bg-house px-3 text-sm text-ink placeholder:text-muted focus:border-marquee focus:outline-none";

const STATUS: Record<ClaimStatus, { label: string; dot: string }> = {
	"right-date": { label: "Right date", dot: "bg-clear" },
	"right-week": { label: "Right week", dot: "bg-counter" },
	"wrong-date": { label: "Wrong date", dot: "bg-hot" },
	"no-date": { label: "No date given", dot: "bg-muted" },
	"not-on-slate": { label: "Not on the current US slate", dot: "bg-muted" },
	"outside-window": { label: "Outside the slate window, not checked", dot: "bg-line" },
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "It named 5 releases: 3 with the right date, 1 with a wrong date and 1 that isn't on the current US slate." */
function claimSummary(b: BaselineResult): string {
	if (!b.claims) return "Its list of releases couldn't be read, so nothing was checked.";
	const checked = b.claims.filter((c) => c.status !== "outside-window");
	if (checked.length === 0) return "It didn't name any release inside the slate window.";
	if (b.counts["right-date"] === checked.length) {
		const n = checked.length;
		return `It named ${plural(n, "upcoming release")}, ${n === 1 ? "with the right date" : n === 2 ? "both with the right date" : `all with the right date`}.`;
	}
	const parts = [
		b.counts["right-date"] ? `${b.counts["right-date"]} with the right date` : "",
		b.counts["right-week"] ? `${b.counts["right-week"]} in the right week` : "",
		b.counts["wrong-date"] ? `${b.counts["wrong-date"]} with a wrong date` : "",
		b.counts["no-date"] ? `${b.counts["no-date"]} with no date` : "",
		b.counts["not-on-slate"] ? `${b.counts["not-on-slate"]} that ${b.counts["not-on-slate"] === 1 ? "isn't" : "aren't"} on the current US slate` : "",
	].filter(Boolean);
	const list = parts.length <= 2 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
	return `It named ${plural(checked.length, "upcoming release")}: ${list}.`;
}

function ClaimRow({ c }: { c: CheckedClaim }) {
	const s = STATUS[c.status];
	const said = c.said ? fmtDay(c.said, { month: "short", day: "numeric", year: "numeric" }) : (c.saidText ?? "no date");
	return (
		<li className="grid grid-cols-[auto_1fr] gap-x-2.5 py-2">
			<span aria-hidden className={`mt-1.5 size-2 rounded-full ${s.dot}`} />
			<span className="min-w-0">
				<span className="block text-sm text-ink">{c.title}</span>
				<span className="block text-xs text-muted">
					{s.label} · said {said}
					{c.slate && c.status !== "right-date"
						? ` · slate: ${c.slate.title !== c.title ? `${c.slate.title}, ` : ""}${fmtDay(c.slate.date, { month: "short", day: "numeric", year: "numeric" })}`
						: ""}
				</span>
			</span>
		</li>
	);
}

/** The same question, the same model, no tools: its answer beside the agent's, and its dates checked against the live slate. */
function Baseline({ runId, initial }: { runId: string; initial?: BaselineResult }) {
	const [state, setState] = useState<{ data?: BaselineResult; busy?: boolean; error?: string }>({ data: initial });
	useEffect(() => setState({ data: initial }), [runId, initial]);
	const ask = () => {
		setState({ busy: true });
		fetchBaseline(runId)
			.then((data) => setState({ data }))
			.catch((e: unknown) => setState({ error: e instanceof Error ? e.message : String(e) }));
	};
	const b = state.data;
	if (!b) {
		return (
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-dashed border-line pt-5">
				<button
					type="button"
					onClick={ask}
					disabled={state.busy}
					className="min-h-11 rounded-[10px] border border-line px-4 text-sm font-medium text-ink hover:border-marquee disabled:opacity-50"
				>
					{state.busy ? "Asking the model alone…" : "Compare: the same model without tools"}
				</button>
				<span className="max-w-xl text-xs text-muted">
					One call to Claude Haiku 5.5 with today's date and the same answer format, but no live slate and no Qloo. Every date it gives is checked against the slate.
				</span>
				{state.error && <p className="w-full text-sm text-hot">{state.error}</p>}
			</div>
		);
	}
	const missed = b.missed.map((m) => `${m.title} (${fmtDay(m.date)})`);
	return (
		<div className="flex flex-col gap-4 border-t border-dashed border-line pt-5">
			<div className="flex flex-col gap-1.5">
				<p className="font-mono text-[11px] tracking-[0.16em] text-counter uppercase">Same model, no tools</p>
				<h3 className="font-display text-3xl leading-none tracking-wide">What the model says from memory</h3>
				<p className="max-w-3xl text-sm text-pretty text-ink-2">
					{claimSummary(b)}
					{b.topChecked > 0 &&
						(missed.length
							? ` It never mentions ${missed.length} of this audience's ${b.topChecked} biggest rivals: ${missed.join(", ")}.`
							: ` It mentions all ${b.topChecked} of this audience's biggest rivals.`)}
					{b.pick &&
						` Its pick, ${fmtDay(b.pick.said)}, rates pressure ${Math.round(b.pick.pressure * 100)} for this audience on the live calendar: #${b.pick.rank} of ${b.pick.of} weeks by clear score.`}
				</p>
			</div>
			<div className="grid gap-x-8 gap-y-4 lg:grid-cols-[1.3fr_1fr]">
				<div className="rounded-xl border border-line bg-house p-4">
					<AnswerText text={b.answer} />
				</div>
				<div>
					<p className="mb-1 font-mono text-[11px] tracking-[0.16em] text-muted uppercase">Its dates, checked against the live slate</p>
					{b.claims && b.claims.length > 0 ? (
						<ul className="divide-y divide-line">
							{b.claims.map((c) => (
								<ClaimRow key={`${c.title}-${c.said ?? c.saidText ?? ""}`} c={c} />
							))}
						</ul>
					) : (
						<p className="text-sm text-muted">{b.claims ? "It didn't list any releases." : "Its list of releases couldn't be read."}</p>
					)}
				</div>
			</div>
			<p className="text-xs text-muted">
				{b.model ?? "Claude Haiku 5.5"} · ${b.costUsd.toFixed(4)} · asked once per run, so replays and share links cost nothing. "Not on the slate" can also mean a different title;
				releases outside the slate window aren't checked.
			</p>
		</div>
	);
}

/** Plain-text answer: "- " lines become a list, other lines paragraphs. */
function AnswerText({ text }: { text: string }) {
	const blocks: { list: boolean; lines: string[] }[] = [];
	for (const line of text.split("\n").map((l) => l.trim())) {
		if (!line) continue;
		const list = line.startsWith("- ") || line.startsWith("• ");
		const last = blocks.at(-1);
		if (last && last.list === list) last.lines.push(list ? line.slice(2) : line);
		else blocks.push({ list, lines: [list ? line.slice(2) : line] });
	}
	return (
		<div className="space-y-2 text-ink">
			{blocks.map((b, i) =>
				b.list ? (
					<ul key={i} className="list-disc space-y-1 pl-5 text-ink-2">
						{b.lines.map((l) => (
							<li key={l}>{l}</li>
						))}
					</ul>
				) : (
					b.lines.map((l) => <p key={`${i}-${l}`}>{l}</p>)
				),
			)}
		</div>
	);
}

function Trace({ events, running }: { events: AgentEvent[]; running: boolean }) {
	const steps = events.filter((e) => e.type !== "answer");
	if (steps.length === 0 && !running) return null;
	return (
		<ol className="space-y-1.5 text-sm" aria-live="polite">
			{steps.map((e, i) => {
				switch (e.type) {
					case "call":
						return (
							<li key={i} className="flex gap-2">
								<span className="shrink-0 font-mono text-xs leading-5 text-marquee">{e.tool}</span>
								<span className="text-ink-2">{e.label}</span>
							</li>
						);
					case "result":
						return (
							<li key={i} className={`pl-4 text-xs ${e.error ? "text-hot" : "text-muted"}`}>
								↳ {e.summary}
							</li>
						);
					case "progress":
						return (
							<li key={i} className="pl-4 text-xs text-muted italic">
								{e.text}
							</li>
						);
					case "thought":
						return (
							<li key={i} className="text-xs text-ink-2">
								{e.text}
							</li>
						);
					case "error":
						return (
							<li key={i} className="text-sm text-hot">
								{e.text}
							</li>
						);
					default:
						return null;
				}
			})}
			{running && <li className="animate-pulse pl-4 text-xs text-muted">working…</li>}
		</ol>
	);
}

/** The scripted planner answers when there's no language model (the offline demo, or the model budget spent). */
const SCRIPTED = "scripted planner";

export function AgentPanel({ mode, onPlan }: { mode?: "llm" | "scripted"; onPlan: (plan: AgentPlan, runId: string) => void }) {
	const [question, setQuestion] = useState("");
	const [run, setRun] = useState<Run>({ status: "idle" });
	const abort = useRef<AbortController | undefined>(undefined);
	const lastPlan = useRef("");

	const apply = useCallback(
		(res: AgentStepResponse, reset: boolean) => {
			setRun((r) => ({
				status: res.done ? "done" : "running",
				question: res.question,
				runId: res.runId,
				events: reset || r.status === "idle" ? res.events : [...r.events, ...res.events],
				replay: res.replay,
				baseline: res.baseline ?? (reset || r.status === "idle" ? undefined : r.baseline),
			}));
			const key = res.plan ? `${res.plan.comps.map((c) => c.id).join()}|${res.plan.you ?? ""}|${res.plan.from}` : "";
			if (res.plan && key !== lastPlan.current) {
				lastPlan.current = key;
				onPlan(res.plan, res.runId);
			}
		},
		[onPlan],
	);

	const drive = useCallback(
		async (first: Promise<AgentStepResponse>, controller: AbortController) => {
			try {
				let res = await first;
				apply(res, true);
				for (let i = 0; !res.done && i < 16 && !controller.signal.aborted; i++) {
					res = await agentStep({ runId: res.runId, after: res.total }, controller.signal);
					apply(res, false);
				}
				if (!controller.signal.aborted) {
					const url = new URL(location.href);
					url.searchParams.set("run", res.runId);
					for (const other of ["scenario", "watch", "plan"]) url.searchParams.delete(other);
					history.replaceState(null, "", url);
				}
			} catch (e) {
				if (controller.signal.aborted) return;
				setRun((r) => ({ ...(r.status === "idle" ? { question: "", events: [] } : r), status: "error", error: e instanceof Error ? e.message : String(e) }));
			}
		},
		[apply],
	);

	const ask = (text: string) => {
		const q = text.trim();
		if (q.length < 8) return;
		abort.current?.abort();
		const controller = new AbortController();
		abort.current = controller;
		lastPlan.current = "";
		setQuestion(q);
		setRun({ status: "running", question: q, events: [] });
		void drive(agentStep({ question: q }, controller.signal), controller);
	};

	// Share links: ?run=<id> shows a stored run (no model calls).
	const loaded = useRef(false);
	useEffect(() => {
		if (loaded.current) return;
		loaded.current = true;
		const id = new URLSearchParams(location.search).get("run");
		if (!id) return;
		const controller = new AbortController();
		abort.current = controller;
		setRun({ status: "running", question: "", events: [] });
		void drive(fetchAgentRun(id, controller.signal), controller);
	}, [drive]);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		ask(question);
	};
	const answer = run.status !== "idle" ? run.events.find((e): e is Extract<AgentEvent, { type: "answer" }> => e.type === "answer") : undefined;

	return (
		<section aria-labelledby="agent" className={`${card} flex flex-col gap-4 px-5 py-6 sm:px-8`}>
			<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
				<div className="flex flex-col gap-1.5">
					<p className="font-mono text-[11px] tracking-[0.18em] text-marquee uppercase">Release agent</p>
					<h2 id="agent" className="font-display text-4xl leading-none tracking-wide">
						Ask about a release date
					</h2>
				</div>
				{mode && (
					<span className="font-mono text-xs text-muted">
						{mode === "llm" ? "Claude Haiku 5.5 · tools over the live slate and Qloo" : "Scripted planner · no language model · the same tools"}
					</span>
				)}
			</div>
			<form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
				<input
					value={question}
					onChange={(e) => setQuestion(e.target.value)}
					maxLength={500}
					placeholder="e.g. When should my Hereditary-style horror film open?"
					aria-label="Question for the release agent"
					className={`${field} min-w-0 sm:flex-1`}
				/>
				<button
					type="submit"
					disabled={run.status === "running" || question.trim().length < 8}
					className="h-11 shrink-0 rounded-[10px] bg-marquee px-5 text-[15px] font-semibold text-marquee-ink hover:brightness-110 disabled:opacity-40"
				>
					{run.status === "running" ? "Working…" : "Ask"}
				</button>
			</form>
			<div className="flex flex-wrap gap-1.5">
				{EXAMPLES.map((q) => (
					<button
						key={q}
						type="button"
						disabled={run.status === "running"}
						onClick={() => ask(q)}
						className="min-h-9 rounded-full border border-line px-3 text-left text-xs text-ink-2 hover:border-marquee disabled:opacity-40"
					>
						{q}
					</button>
				))}
			</div>

			{run.status !== "idle" && (
				<div className="grid gap-x-8 gap-y-5 border-t border-dashed border-line pt-5 lg:grid-cols-[1fr_1.3fr]">
					<div>
						<p className="mb-2 font-mono text-[11px] tracking-[0.16em] text-muted uppercase">Trace</p>
						{run.question && <p className="mb-2 text-sm text-ink">“{run.question}”</p>}
						<Trace events={run.events} running={run.status === "running"} />
						{run.status === "error" && <p className="mt-2 text-sm text-hot">{run.error}</p>}
					</div>
					<div>
						<p className="mb-2 font-mono text-[11px] tracking-[0.16em] text-marquee uppercase">Answer</p>
						{answer ? (
							<div className="rounded-xl border border-line bg-house p-4">
								<AnswerText text={answer.text} />
								<div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-muted">
									<span className={answer.check.unverified.length ? "text-hot" : "text-clear"}>
										{answer.check.dates === 0
											? "No dates to check"
											: answer.check.unverified.length
												? `${answer.check.unverified.length} of ${answer.check.dates} dates not found in this run's data: ${answer.check.unverified.join(", ")}`
												: `All ${answer.check.dates} dates match this run's slate and Qloo results`}
									</span>
									<span>
										{answer.model === SCRIPTED
											? `Scripted planner: fixed rules and a template, no model calls${answer.modelCalls > 0 ? ` (after ${answer.modelCalls} model calls · $${answer.costUsd.toFixed(4)})` : ""}`
											: `${run.replay ? "Replayed from an earlier run (no model cost)" : `${answer.modelCalls} model calls · $${answer.costUsd.toFixed(4)}`}${answer.model ? ` · ${answer.model}` : ""}`}
									</span>
								</div>
							</div>
						) : (
							<p className="text-sm text-muted">{run.status === "running" ? "The agent is looking things up…" : "No answer yet."}</p>
						)}
					</div>
				</div>
			)}
			{/* The no-tools comparison needs the model; a scripted answer has none to compare. */}
			{run.status === "done" && run.runId && answer && (run.baseline || (mode === "llm" && answer.model !== SCRIPTED)) && <Baseline runId={run.runId} initial={run.baseline} />}
		</section>
	);
}

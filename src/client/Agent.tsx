import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { AgentEvent, AgentPlan, AgentStepResponse } from "../shared/types.ts";
import { agentStep, fetchAgentRun } from "./api.ts";

const EXAMPLES = [
	"Should Dune: Part Three keep its Dec 18 date?",
	"How exposed is The Hunger Games: Sunrise on the Reaping to GTA VI?",
	"When should an original horror film like Hereditary open in early 2027?",
	"Find a clear winter week for a family film like Paddington 2.",
];

type Run = { status: "idle" } | { status: "running" | "done" | "error"; question: string; runId?: string; events: AgentEvent[]; replay?: boolean; error?: string };

const card = "rounded-[18px] border border-line bg-stage";
const field = "h-11 w-full rounded-[10px] border border-line bg-house px-3 text-sm text-ink placeholder:text-muted focus:border-marquee focus:outline-none";

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

export function AgentPanel({ enabled, onPlan }: { enabled: boolean; onPlan: (plan: AgentPlan) => void }) {
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
			}));
			const key = res.plan ? `${res.plan.comps.map((c) => c.id).join()}|${res.plan.you ?? ""}|${res.plan.from}` : "";
			if (res.plan && key !== lastPlan.current) {
				lastPlan.current = key;
				onPlan(res.plan);
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
					url.searchParams.delete("scenario");
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
				<span className="font-mono text-xs text-muted">Claude Haiku 5.5 · tools over the live slate and Qloo</span>
			</div>
			{!enabled ? (
				<p className="text-sm text-muted">The AI agent is off right now. The scenarios and the planner work without it.</p>
			) : (
				<>
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
				</>
			)}

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
										{run.replay ? "Replayed from an earlier run (no model cost)" : `${answer.modelCalls} model calls · $${answer.costUsd.toFixed(4)}`}
										{answer.model ? ` · ${answer.model}` : ""}
									</span>
								</div>
							</div>
						) : (
							<p className="text-sm text-muted">{run.status === "running" ? "The agent is looking things up…" : "No answer yet."}</p>
						)}
					</div>
				</div>
			)}
		</section>
	);
}

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { listWeeks } from "../engine/score/calendar.ts";
import { fmtDay } from "../engine/score/narrate.ts";
import { addDays, isoDay } from "../shared/dates.ts";
import { SCENARIOS, type Scenario } from "../shared/scenarios.ts";
import type { Comp, PlanProgress, PlanResult, SlateSnapshot } from "../shared/types.ts";
import { runPlan, searchFilms } from "./api.ts";
import { PlanView } from "./PlanView.tsx";

export interface Setup {
	comps: Comp[];
	/** Slate ID of your dated title, if any. */
	you?: string;
	/** Earliest week you could open. */
	from: string;
	scenario?: string;
}

type Run = { status: "idle" } | { status: "running"; progress?: PlanProgress } | { status: "ready"; result: PlanResult } | { status: "error"; message: string };

const panel = "rounded-xl border border-line bg-stage";

function ScenarioCard({ scenario, slate, active, onPick }: { scenario: Scenario; slate?: SlateSnapshot; active: boolean; onPick: () => void }) {
	const you = scenario.you ? slate?.titles.find((t) => t.id === scenario.you) : undefined;
	return (
		<button
			type="button"
			onClick={onPick}
			disabled={!slate}
			aria-pressed={active}
			className={`group flex h-full flex-col rounded-xl border p-4 text-left transition-colors disabled:opacity-50 ${active ? "border-marquee bg-marquee/10" : "border-line bg-stage hover:border-marquee/60"}`}
		>
			<span className="font-display text-3xl leading-none tracking-wide text-marquee">{scenario.name}</span>
			<span className="mt-2 text-sm text-ink-2">{scenario.question}</span>
			<span className="mt-auto pt-3 text-xs text-muted">
				{you ? `${you.title} · now ${fmtDay(you.date, { month: "short", day: "numeric" })} · ` : ""}
				Audience: fans of {scenario.comps.map((c) => c.short ?? c.name).join(", ")}
			</span>
		</button>
	);
}

function CompSearch({ comps, onChange }: { comps: Comp[]; onChange: (comps: Comp[]) => void }) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<Comp[]>();
	const [state, setState] = useState<{ busy?: boolean; error?: string }>({});
	const search = async (event: FormEvent) => {
		event.preventDefault();
		if (query.trim().length < 2) return;
		setState({ busy: true });
		try {
			setResults(await searchFilms(query.trim()));
			setState({});
		} catch (e) {
			setState({ error: e instanceof Error ? e.message : String(e) });
		}
	};
	return (
		<div>
			<form onSubmit={search} className="flex gap-2">
				<input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="A released film, e.g. Arrival"
					aria-label="Search released films"
					className="min-w-0 flex-1 rounded-lg border border-line bg-house px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-marquee focus:outline-none"
				/>
				<button
					type="submit"
					disabled={state.busy || query.trim().length < 2}
					className="rounded-lg border border-line px-3 py-2 text-sm text-ink-2 hover:border-marquee disabled:opacity-50"
				>
					{state.busy ? "Searching…" : "Search"}
				</button>
			</form>
			{state.error && <p className="mt-2 text-xs text-hot">{state.error}</p>}
			{results && (
				<ul className="mt-2 max-h-56 overflow-auto rounded-lg border border-line bg-house">
					{results.length === 0 && <li className="px-3 py-2 text-sm text-muted">No films found.</li>}
					{results.map((r) => {
						const picked = comps.some((c) => c.id === r.id);
						return (
							<li key={r.id}>
								<button
									type="button"
									disabled={picked || comps.length >= 5}
									onClick={() => onChange([...comps, r])}
									className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-stage disabled:opacity-40"
								>
									<span className="text-ink">{r.name}</span>
									<span className="text-xs text-muted">{picked ? "added" : (r.year ?? "")}</span>
								</button>
							</li>
						);
					})}
				</ul>
			)}
			{comps.length > 0 && (
				<ul className="mt-3 flex flex-wrap gap-2">
					{comps.map((c) => (
						<li key={c.id} className="flex items-center gap-1 rounded-full border border-marquee/50 bg-marquee/10 py-1 pr-1 pl-3 text-sm">
							{c.name}
							{c.year ? <span className="text-xs text-muted"> ({c.year})</span> : null}
							<button
								type="button"
								onClick={() => onChange(comps.filter((x) => x.id !== c.id))}
								aria-label={`Remove ${c.name}`}
								className="rounded-full px-2 text-muted hover:text-ink"
							>
								×
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

export function Planner({ slate }: { slate?: SlateSnapshot }) {
	const weeks = useMemo(() => (slate ? listWeeks(slate.windowStart, slate.windowEnd) : []), [slate]);
	const defaultFrom = useMemo(() => weeks.find((w) => w >= addDays(isoDay(new Date()), 28)) ?? weeks[0] ?? "", [weeks]);
	const films = useMemo(() => (slate?.titles ?? []).filter((t) => t.kind === "film"), [slate]);
	const [setup, setSetup] = useState<Setup>();
	const [run, setRun] = useState<Run>({ status: "idle" });
	const [draft, setDraft] = useState<{ comps: Comp[]; you?: string; from?: string }>({ comps: [] });
	const abort = useRef<AbortController | undefined>(undefined);
	const results = useRef<HTMLDivElement>(null);

	const start = useCallback((next: Setup) => {
		abort.current?.abort();
		const controller = new AbortController();
		abort.current = controller;
		setSetup(next);
		setRun({ status: "running" });
		const url = new URL(location.href);
		if (next.scenario) url.searchParams.set("scenario", next.scenario);
		else url.searchParams.delete("scenario");
		history.replaceState(null, "", url);
		requestAnimationFrame(() => results.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
		runPlan({ comps: next.comps.map((c) => c.id), you: next.you }, (progress) => !controller.signal.aborted && setRun({ status: "running", progress }), controller.signal)
			.then((result) => !controller.signal.aborted && setRun({ status: "ready", result }))
			.catch((e: unknown) => !controller.signal.aborted && setRun({ status: "error", message: e instanceof Error ? e.message : String(e) }));
	}, []);

	const pickScenario = useCallback(
		(s: Scenario) => start({ comps: s.comps, you: s.you, from: s.from && weeks.includes(s.from) ? s.from : defaultFrom, scenario: s.id }),
		[start, weeks, defaultFrom],
	);

	// Share links: ?scenario=dunesday runs that scenario on load.
	const autoRan = useRef(false);
	useEffect(() => {
		if (!slate || autoRan.current) return;
		autoRan.current = true;
		const scenario = SCENARIOS.find((s) => s.id === new URLSearchParams(location.search).get("scenario"));
		if (scenario) pickScenario(scenario);
	}, [slate, pickScenario]);

	return (
		<section>
			<h2 className="mb-3 font-display text-3xl tracking-wide">Try a real release decision</h2>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{SCENARIOS.map((s) => (
					<ScenarioCard key={s.id} scenario={s} slate={slate} active={setup?.scenario === s.id} onPick={() => pickScenario(s)} />
				))}
			</div>

			<details className={`${panel} mt-4 p-4`}>
				<summary className="font-display text-2xl tracking-wide">Or plan your own title</summary>
				<div className="mt-4 grid gap-5 md:grid-cols-[1.4fr_1fr]">
					<div>
						<p className="mb-2 text-sm text-ink-2">Describe your audience with 2–5 released films whose fans you want (your comps).</p>
						<CompSearch comps={draft.comps} onChange={(comps) => setDraft({ ...draft, comps })} />
					</div>
					<div className="space-y-4">
						<label className="block text-sm text-ink-2">
							Your title, if it's already dated (optional)
							<select
								value={draft.you ?? ""}
								onChange={(e) => setDraft({ ...draft, you: e.target.value || undefined })}
								className="mt-1 w-full rounded-lg border border-line bg-house px-3 py-2 text-sm text-ink"
							>
								<option value="">Not on the calendar yet</option>
								{films.map((t) => (
									<option key={`${t.id}@${t.date}`} value={t.id}>
										{t.title} · {fmtDay(t.date)}
									</option>
								))}
							</select>
						</label>
						<label className="block text-sm text-ink-2">
							Earliest week you could open
							<select
								value={draft.from ?? defaultFrom}
								onChange={(e) => setDraft({ ...draft, from: e.target.value })}
								className="mt-1 w-full rounded-lg border border-line bg-house px-3 py-2 text-sm text-ink"
							>
								{weeks.map((w) => (
									<option key={w} value={w}>
										Week of {fmtDay(w, { month: "short", day: "numeric", year: "numeric" })}
									</option>
								))}
							</select>
						</label>
						<button
							type="button"
							disabled={draft.comps.length === 0 || !slate}
							onClick={() => start({ comps: draft.comps, you: draft.you, from: draft.from ?? defaultFrom })}
							className="w-full rounded-lg bg-marquee px-4 py-2.5 font-semibold text-marquee-ink hover:brightness-110 disabled:opacity-40"
						>
							Find my week
						</button>
					</div>
				</div>
			</details>

			<div ref={results} className="mt-8">
				{run.status === "running" && (
					<div className={`${panel} p-5`} role="status" aria-live="polite">
						<p className="font-display text-2xl tracking-wide text-marquee">Scoring rivals against your audience…</p>
						<p className="mt-1 text-sm text-ink-2">
							{run.progress
								? `Qloo has scored ${run.progress.scored} of ${run.progress.total} titles (${run.progress.qlooCalls} Qloo call${run.progress.qlooCalls === 1 ? "" : "s"} so far).`
								: "Reading the live calendar and the score cache."}
						</p>
						<div className="mt-3 h-1.5 overflow-hidden rounded bg-line">
							<div className="h-full rounded bg-marquee transition-all" style={{ width: `${run.progress ? Math.max(8, (run.progress.scored / run.progress.total) * 100) : 8}%` }} />
						</div>
					</div>
				)}
				{run.status === "error" && (
					<div className={`${panel} border-hot/60 p-5`} role="alert">
						<p className="text-ink">{run.message}</p>
						{setup && (
							<button type="button" onClick={() => start(setup)} className="mt-3 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-marquee">
								Try again
							</button>
						)}
					</div>
				)}
				{run.status === "ready" && setup && (
					<PlanView key={`${setup.scenario ?? "custom"}-${run.result.comps.join()}-${setup.you ?? ""}-${setup.from}`} result={run.result} setup={setup} weeks={weeks} />
				)}
			</div>
		</section>
	);
}

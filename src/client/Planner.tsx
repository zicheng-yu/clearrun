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

const card = "rounded-[18px] border border-line bg-stage";
const field = "h-11 w-full rounded-[10px] border border-line bg-house px-3 text-sm text-ink placeholder:text-muted focus:border-marquee focus:outline-none";

function ScenarioCard({ scenario, slate, active, onPick }: { scenario: Scenario; slate?: SlateSnapshot; active: boolean; onPick: () => void }) {
	const you = scenario.you ? slate?.titles.find((t) => t.id === scenario.you) : undefined;
	return (
		<button
			type="button"
			onClick={onPick}
			disabled={!slate}
			aria-pressed={active}
			className={`flex w-full flex-col gap-1 rounded-xl border p-3.5 text-left transition-colors disabled:opacity-50 ${active ? "border-marquee bg-marquee/10" : "border-line bg-house/60 hover:border-marquee/60"}`}
		>
			<span className="font-display text-2xl leading-none tracking-wide text-marquee">{scenario.name}</span>
			<span className="text-sm text-ink-2">{scenario.question}</span>
			<span className="text-xs text-muted">
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
		<div className="flex flex-col gap-3">
			{comps.length > 0 && (
				<ul className="flex flex-wrap gap-2">
					{comps.map((c) => (
						<li key={c.id} className="flex min-h-10 items-center gap-1 rounded-full border border-marquee/50 bg-marquee/10 py-0.5 pr-0.5 pl-3.5 text-sm">
							{c.name}
							{c.year ? <span className="text-xs text-muted"> ({c.year})</span> : null}
							<button
								type="button"
								onClick={() => onChange(comps.filter((x) => x.id !== c.id))}
								aria-label={`Remove ${c.name}`}
								className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-line/60 hover:text-ink"
							>
								<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
									<path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
								</svg>
							</button>
						</li>
					))}
				</ul>
			)}
			<form onSubmit={search} className="flex gap-2">
				<input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="A released film, e.g. Arrival"
					aria-label="Search released films"
					className={`${field} min-w-0 flex-1`}
				/>
				<button
					type="submit"
					disabled={state.busy || query.trim().length < 2}
					className="h-11 shrink-0 rounded-[10px] border border-line px-4 text-sm font-medium text-ink hover:border-marquee disabled:opacity-50"
				>
					{state.busy ? "Searching…" : "Search"}
				</button>
			</form>
			{state.error && <p className="text-xs text-hot">{state.error}</p>}
			{results && (
				<ul className="max-h-56 overflow-auto rounded-[10px] border border-line bg-house">
					{results.length === 0 && <li className="px-3 py-2.5 text-sm text-muted">No films found.</li>}
					{results.map((r) => {
						const picked = comps.some((c) => c.id === r.id);
						return (
							<li key={r.id}>
								<button
									type="button"
									disabled={picked || comps.length >= 5}
									onClick={() => onChange([...comps, r])}
									className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-stage disabled:opacity-40"
								>
									<span className="text-ink">{r.name}</span>
									<span className="text-xs text-muted">{picked ? "added" : (r.year ?? "")}</span>
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

function Intro({ slate }: { slate?: SlateSnapshot }) {
	return (
		<section aria-labelledby="intro" className={`${card} overflow-hidden`}>
			<div aria-hidden className="marquee-bulbs h-[18px] border-b border-line bg-marquee/5" />
			<div className="flex flex-col gap-4 px-5 py-8 sm:px-9">
				<p className="font-mono text-xs tracking-[0.16em] text-marquee uppercase">Qloo Agentic Hackathon</p>
				<h1
					id="intro"
					className="font-display text-[clamp(52px,7vw,112px)] leading-[0.88] tracking-[0.01em] text-marquee [text-shadow:0_0_32px_rgb(242_182_50/0.3)]"
				>
					Find the week your audience is free
				</h1>
				<p className="max-w-2xl text-pretty text-ink-2">
					Pick a release week your audience isn't already spoken for. Clear Run builds the live US release calendar from open data, asks Qloo's taste graph how strongly fans of
					your comps care about every rival (games included), and turns that into week-by-week audience pressure, with clear weeks, danger weeks and counter-programming openings.
				</p>
				{slate && (
					<p className="font-mono text-xs text-muted">
						Live slate: {fmtDay(slate.windowStart)} – {fmtDay(slate.windowEnd, { month: "short", day: "numeric", year: "numeric" })}
					</p>
				)}
				<p className="text-sm text-ink">Start with a real release decision, or describe your own audience.</p>
			</div>
		</section>
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
		<div className="flex flex-wrap items-start gap-7">
			<aside aria-label="Your release" className={`${card} flex min-w-0 flex-[1_1_340px] flex-col gap-6 p-5 sm:p-6`}>
				<div className="flex flex-col gap-1.5">
					<p className="font-mono text-[11px] tracking-[0.18em] text-marquee uppercase">Your release</p>
					<h2 className="font-display text-4xl leading-none tracking-wide">Plan a release week</h2>
				</div>

				<section aria-labelledby="scenarios" className="flex flex-col gap-2.5">
					<h3 id="scenarios" className="text-[13px] font-semibold">
						Try a real release decision
					</h3>
					<ul className="flex flex-col gap-2">
						{SCENARIOS.map((s) => (
							<li key={s.id}>
								<ScenarioCard scenario={s} slate={slate} active={setup?.scenario === s.id} onPick={() => pickScenario(s)} />
							</li>
						))}
					</ul>
				</section>

				<section aria-labelledby="own" className="flex flex-col gap-4 border-t border-dashed border-line pt-5">
					<h3 id="own" className="text-[13px] font-semibold">
						Or plan your own title
					</h3>
					<div className="flex flex-col gap-2">
						<p className="text-[13px] text-muted">Describe your audience with 2–5 released films whose fans you want (your comps).</p>
						<CompSearch comps={draft.comps} onChange={(comps) => setDraft({ ...draft, comps })} />
					</div>
					<label className="flex flex-col gap-1.5 text-[13px] text-ink-2">
						Your title, if it's already dated (optional)
						<select value={draft.you ?? ""} onChange={(e) => setDraft({ ...draft, you: e.target.value || undefined })} className={field}>
							<option value="">Not on the calendar yet</option>
							{films.map((t) => (
								<option key={`${t.id}@${t.date}`} value={t.id}>
									{t.title} · {fmtDay(t.date)}
								</option>
							))}
						</select>
					</label>
					<label className="flex flex-col gap-1.5 text-[13px] text-ink-2">
						Earliest week you could open
						<select value={draft.from ?? defaultFrom} onChange={(e) => setDraft({ ...draft, from: e.target.value })} className={field}>
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
						className="h-12 w-full rounded-[10px] bg-marquee px-4 text-[15px] font-semibold text-marquee-ink hover:brightness-110 disabled:opacity-40"
					>
						Find my week
					</button>
				</section>
			</aside>

			<div ref={results} className="flex min-w-0 flex-[999_1_640px] flex-col gap-7">
				{run.status === "idle" && <Intro slate={slate} />}
				{run.status === "running" && (
					<div className={`${card} flex flex-col gap-3 p-6`} role="status" aria-live="polite">
						<p className="font-display text-3xl tracking-wide text-marquee">Scoring rivals against your audience…</p>
						<p className="text-sm text-ink-2">
							{run.progress
								? `Qloo has scored ${run.progress.scored} of ${run.progress.total} titles (${run.progress.qlooCalls} Qloo call${run.progress.qlooCalls === 1 ? "" : "s"} so far).`
								: "Reading the live calendar and the score cache."}
						</p>
						<div className="h-1.5 overflow-hidden rounded bg-line">
							<div className="h-full rounded bg-marquee transition-all" style={{ width: `${run.progress ? Math.max(8, (run.progress.scored / run.progress.total) * 100) : 8}%` }} />
						</div>
					</div>
				)}
				{run.status === "error" && (
					<div className={`${card} border-hot/60 p-6`} role="alert">
						<p className="text-ink">{run.message}</p>
						{setup && (
							<button type="button" onClick={() => start(setup)} className="mt-3 min-h-11 rounded-[10px] border border-line px-4 text-sm hover:border-marquee">
								Try again
							</button>
						)}
					</div>
				)}
				{run.status === "ready" && setup && (
					<PlanView key={`${setup.scenario ?? "custom"}-${run.result.comps.join()}-${setup.you ?? ""}-${setup.from}`} result={run.result} setup={setup} weeks={weeks} />
				)}
			</div>
		</div>
	);
}

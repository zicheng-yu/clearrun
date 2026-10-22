import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { fmtDay, runPhrase, threat } from "../engine/score/narrate.ts";
import { changePhrase } from "../engine/watch/replan.ts";
import { addDays } from "../shared/dates.ts";
import type { AgentNote, RivalScore, WatchEvent, WatchState, WatchView } from "../shared/types.ts";
import { fetchWatch, simulateWatch, startWatch } from "./api.ts";
import type { Setup } from "./Planner.tsx";

const card = "rounded-[18px] border border-line bg-stage";
const field = "h-11 w-full rounded-[10px] border border-line bg-house px-3 text-sm text-ink focus:border-marquee focus:outline-none";
const index = (x: number) => Math.round(x * 100);
const when = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const slateDay = (ms: number) => fmtDay(new Date(ms).toISOString().slice(0, 10));
const verdictOf = (s: WatchState) => (s.rank === 0 ? "Not ranked" : s.hold ? "Hold" : "Move?");
const mainOf = (s: WatchState) => (s.felt[0] ? `${s.felt[0].title} (${runPhrase(s.felt[0].k)})` : "Nobody");

const KINDS: Record<WatchEvent["kind"], { label: string; tone: string }> = {
	created: { label: "Watching started", tone: "border-line text-muted" },
	slate: { label: "Slate change", tone: "border-marquee/50 bg-marquee/10 text-marquee" },
	simulation: { label: "Simulation", tone: "border-counter/50 bg-counter/15 text-counter" },
	ended: { label: "Watch ended", tone: "border-line text-muted" },
};

function Tag({ tone, children }: { tone: string; children: ReactNode }) {
	return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase ${tone}`}>{children}</span>;
}

export function NoteBlock({ note, by = "Release agent" }: { note: AgentNote; by?: string }) {
	const ok = note.check.unverified.length === 0;
	return (
		<div className="flex flex-col gap-2 border-l-2 border-marquee/60 pl-3">
			<p className="text-sm text-pretty text-ink">{note.text}</p>
			<p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
				<span>{by}</span>
				<span className="flex items-center gap-1.5">
					<span aria-hidden className={`size-1.5 rounded-full ${ok ? "bg-clear" : "bg-hot"}`} />
					{note.check.dates === 0
						? "No dates to check"
						: ok
							? `All ${note.check.dates} dates match the check`
							: `${note.check.unverified.length} of ${note.check.dates} dates not in the check: ${note.check.unverified.join(", ")}`}
				</span>
				<span>{note.replay ? "Replayed (no model cost)" : `$${note.costUsd.toFixed(5)}`}</span>
			</p>
		</div>
	);
}

/** Before → after, with changed values in full ink. */
function Compare({ before, after }: { before: WatchState; after: WatchState }) {
	const rows: [string, string, string][] = [
		["Pressure", String(index(before.pressure)), String(index(after.pressure))],
		["Verdict", verdictOf(before), verdictOf(after)],
		["Clearest alternative", before.best ? fmtDay(before.best) : "None", after.best ? fmtDay(after.best) : "None"],
		["Main pressure", mainOf(before), mainOf(after)],
	];
	return (
		<dl className="grid max-w-3xl grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(9rem,auto)_1fr_auto_1fr]">
			{rows.map(([label, a, b]) => (
				<div key={label} className="contents">
					<dt className="text-xs text-muted sm:text-sm">{label}</dt>
					<dd className="flex flex-wrap items-baseline gap-x-2 sm:contents">
						<span className={`font-mono ${a === b ? "text-ink-2" : "text-muted line-through decoration-muted/60"}`}>{a}</span>
						<span aria-hidden className="text-muted">
							→
						</span>
						<span className={`font-mono ${a === b ? "text-ink-2" : "font-semibold text-ink"}`}>{b}</span>
					</dd>
				</div>
			))}
		</dl>
	);
}

export function EventCard({ event }: { event: WatchEvent }) {
	const kind = KINDS[event.kind];
	return (
		<div className="flex flex-col gap-3 rounded-xl border border-line bg-house p-4">
			<div className="flex flex-wrap items-center gap-2">
				<Tag tone={kind.tone}>{kind.label}</Tag>
				{event.severity === "action" && event.kind !== "created" && <Tag tone="border-hot/50 bg-hot/15 text-hot">Verdict changed</Tag>}
				<span className="font-mono text-xs text-muted">
					{when(event.at)} · slate of {slateDay(event.slateAt)}
				</span>
			</div>
			{event.changes.length > 0 && (
				<ul className="list-disc space-y-0.5 pl-5 text-sm text-ink">
					{event.changes.map((c) => (
						<li key={`${c.kind}-${c.title}-${c.from ?? ""}-${c.to ?? ""}`}>{changePhrase(c)}</li>
					))}
				</ul>
			)}
			{event.before ? (
				<Compare before={event.before} after={event.after} />
			) : (
				<p className="font-mono text-sm text-ink-2">
					Week of {fmtDay(event.after.week)} · pressure {index(event.after.pressure)} · {verdictOf(event.after)}
					{!event.after.hold && event.after.best ? ` → ${fmtDay(event.after.best)}` : ""}
				</p>
			)}
			{event.agentNote ? <NoteBlock note={event.agentNote} /> : event.kind !== "created" && <p className="text-sm text-pretty text-ink-2">{event.note}</p>}
		</div>
	);
}

function CopyLink({ link }: { link: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			onClick={() =>
				navigator.clipboard
					.writeText(link)
					.then(() => setCopied(true))
					.catch(() => setCopied(false))
			}
			className="min-h-10 shrink-0 rounded-[10px] border border-line px-3 text-xs text-ink-2 hover:border-marquee"
		>
			{copied ? "Link copied" : "Copy watch link"}
		</button>
	);
}

function Simulate({ watch, rivals, weeks }: { watch: WatchView; rivals: RivalScore[]; weeks: string[] }) {
	const week = watch.current.week;
	// Rivals worth moving: the biggest threats, and anything opening within a few weeks of the watched week.
	const options = useMemo(() => {
		const near = rivals.filter((r) => r.week >= addDays(week, -42) && r.week <= addDays(week, 70));
		const top = [...rivals].sort((a, b) => threat(b) - threat(a)).slice(0, 6);
		const pool = [...new Map([...top, ...[...near].sort((a, b) => threat(b) - threat(a)).slice(0, 10)].map((r) => [r.id, r])).values()];
		return pool.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
	}, [rivals, week]);
	const main = watch.current.felt[0];
	const first = (main && options.find((r) => r.title === main.title && r.date === main.date)) ?? options[0];
	const [rival, setRival] = useState(first?.id ?? "");
	const chosen = options.find((r) => r.id === rival);
	// Default: move a rival onto your week, or off the calendar when it already opens there.
	const [to, setTo] = useState(first && first.week !== week ? week : "");
	const [state, setState] = useState<{ event?: WatchEvent; error?: string; busy?: boolean }>({});

	const run = (event: FormEvent) => {
		event.preventDefault();
		if (!chosen) return;
		setState({ busy: true });
		simulateWatch({ id: watch.id, rival: chosen.id, to: to || null })
			.then((e) => setState({ event: e }))
			.catch((e: unknown) => setState({ error: e instanceof Error ? e.message : String(e) }));
	};
	if (options.length === 0) return null;
	return (
		<form onSubmit={run} className="flex flex-col gap-3 rounded-xl border border-dashed border-counter/50 bg-house/60 p-4">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
				<Tag tone={KINDS.simulation.tone}>Simulation</Tag>
				<span className="text-[13px] text-pretty text-ink-2">
					What would the daily check do if a rival's date changed? Simulate runs the same re-plan against a copy of today's calendar. Nothing real changes, and it isn't logged.
				</span>
			</div>
			<div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
				<label className="flex flex-col gap-1.5 text-[13px] text-ink-2">
					What if
					<select
						value={rival}
						onChange={(e) => {
							setRival(e.target.value);
							// The new date can't be the rival's current week.
							if (options.find((r) => r.id === e.target.value)?.week === to) setTo("");
						}}
						className={field}
					>
						{options.map((r) => (
							<option key={r.id} value={r.id}>
								{r.title} · {fmtDay(r.date)}
							</option>
						))}
					</select>
				</label>
				<label className="flex flex-col gap-1.5 text-[13px] text-ink-2">
					moved to
					<select value={to} onChange={(e) => setTo(e.target.value)} className={field}>
						<option value="">Off the calendar (delayed indefinitely)</option>
						{weeks
							.filter((w) => w !== chosen?.week)
							.map((w) => (
								<option key={w} value={w}>
									Fri, {fmtDay(w, { month: "short", day: "numeric", year: "numeric" })}
									{w === week ? " (your week)" : ""}
								</option>
							))}
					</select>
				</label>
				<button
					type="submit"
					disabled={state.busy || !chosen}
					className="h-11 rounded-[10px] bg-counter px-5 text-[15px] font-semibold text-house hover:brightness-110 disabled:opacity-40"
				>
					{state.busy ? "Re-planning…" : "Simulate"}
				</button>
			</div>
			{state.error && <p className="text-sm text-hot">{state.error}</p>}
			{state.event && <EventCard event={state.event} />}
		</form>
	);
}

function Panel({ watch, rivals, weeks }: { watch: WatchView; rivals: RivalScore[]; weeks: string[] }) {
	const names = watch.comps.map((c) => c.short ?? c.name).join(" + ");
	const link = `${location.origin}/?watch=${encodeURIComponent(watch.id)}`;
	const c = watch.current;
	const logged = watch.events.filter((e) => e.kind !== "created");
	const [all, setAll] = useState(false);
	const started = watch.events.find((e) => e.kind === "created");
	return (
		<section aria-labelledby="watch" className={`${card} flex flex-col gap-5 px-5 py-6 sm:px-8`}>
			<div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
				<div className="flex min-w-0 flex-col gap-1.5">
					<p className="font-mono text-[11px] tracking-[0.18em] text-marquee uppercase">{watch.featured ? "Featured watch" : "Watching"} · re-planned after every daily refresh</p>
					<h2 id="watch" className="font-display text-4xl leading-none tracking-wide">
						{watch.label} · week of {fmtDay(c.week)}
					</h2>
					<p className="text-sm text-pretty text-ink-2">
						Fans of {names}. Watching since {when(watch.createdAt)}; last checked {when(watch.checkedAt)} against the slate of {slateDay(watch.slateAt)}.
						{watch.stale && " A newer slate is out, and the next check reaches this watch within minutes."}
						{watch.status === "ended" && " This watch has ended."}
					</p>
				</div>
				<CopyLink link={link} />
			</div>

			<dl className="flex flex-wrap gap-x-8 gap-y-3 font-mono text-sm">
				<div>
					<dt className="text-[11px] tracking-[0.08em] text-muted uppercase">Pressure now</dt>
					<dd className="text-2xl text-ink">{index(c.pressure)}</dd>
				</div>
				<div>
					<dt className="text-[11px] tracking-[0.08em] text-muted uppercase">Verdict</dt>
					<dd className={`text-2xl ${c.hold ? "text-clear" : "text-marquee"}`}>
						{verdictOf(c)}
						{!c.hold && c.best ? ` → ${fmtDay(c.best)}` : ""}
					</dd>
				</div>
				<div className="min-w-0">
					<dt className="text-[11px] tracking-[0.08em] text-muted uppercase">Main pressure</dt>
					<dd className="truncate pt-1.5 text-ink-2">{mainOf(c)}</dd>
				</div>
			</dl>

			{watch.status === "active" && <Simulate watch={watch} rivals={rivals} weeks={weeks} />}

			<div className="flex flex-col gap-3">
				<h3 className="text-[13px] font-semibold tracking-[0.04em]">Change log</h3>
				{logged.length === 0 ? (
					<p className="text-sm text-muted">
						No changes near this week yet. Each daily refresh re-plans this watch; changes near your week, or to its verdict, show up here with a note from the agent.
					</p>
				) : (
					<ol className="flex flex-col gap-3">
						{(all ? logged : logged.slice(0, 3)).map((e) => (
							<li key={`${e.at}-${e.kind}`}>
								<EventCard event={e} />
							</li>
						))}
					</ol>
				)}
				{logged.length > 3 && (
					<button type="button" onClick={() => setAll(!all)} className="min-h-9 self-start text-xs text-muted underline decoration-dotted underline-offset-2 hover:text-ink">
						{all ? "Show the latest 3" : `Show all ${logged.length} changes`}
					</button>
				)}
				{started && <p className="text-xs text-muted">{started.note}</p>}
			</div>
		</section>
	);
}

/** Watch this plan: a call to action, or the watch itself (featured scenarios come with one). */
export function WatchSection(props: { setup: Setup; week?: string; weeks: string[]; rivals: RivalScore[]; whatIf: boolean; hasYou: boolean; youTitle?: string }) {
	const { setup } = props;
	const [watch, setWatch] = useState<WatchView>();
	const [state, setState] = useState<{ loading: boolean; busy?: boolean; error?: string }>({ loading: Boolean(setup.watchId) });
	useEffect(() => {
		if (!setup.watchId) return;
		const controller = new AbortController();
		fetchWatch(setup.watchId, controller.signal)
			.then((w) => {
				setWatch(w);
				setState({ loading: false });
			})
			.catch((e: unknown) => !controller.signal.aborted && setState({ loading: false, error: e instanceof Error ? e.message : String(e) }));
		return () => controller.abort();
	}, [setup.watchId]);

	const start = () => {
		if (!props.week) return;
		setState({ loading: false, busy: true });
		startWatch({ comps: setup.comps, you: setup.you, from: setup.from, week: props.week, label: props.youTitle })
			.then((w) => {
				setWatch(w);
				setState({ loading: false });
				const url = new URL(location.href);
				url.searchParams.set("watch", w.id);
				url.searchParams.delete("scenario");
				url.searchParams.delete("run");
				history.replaceState(null, "", url);
			})
			.catch((e: unknown) => setState({ loading: false, error: e instanceof Error ? e.message : String(e) }));
	};

	if (state.loading) return null;
	if (watch) return <Panel watch={watch} rivals={props.rivals} weeks={props.weeks} />;
	return (
		<section aria-labelledby="watch-cta" className={`${card} flex flex-wrap items-center justify-between gap-x-8 gap-y-4 px-5 py-6 sm:px-8`}>
			<div className="flex max-w-2xl min-w-0 flex-col gap-1.5">
				<p className="font-mono text-[11px] tracking-[0.18em] text-marquee uppercase">Watch and re-plan</p>
				<h2 id="watch-cta" className="font-display text-4xl leading-none tracking-wide">
					Re-plan when a rival moves
				</h2>
				<p className="text-sm text-pretty text-ink-2">
					Clear Run re-checks the live calendar after every daily refresh. When a rival near your week moves, a new film is dated, or the verdict changes, it re-plans and logs what
					changed, with a note from the agent.
					{props.whatIf && " Watches use the real calendar, so your what-if moves to rivals aren't saved."}
				</p>
				{state.error && <p className="text-sm text-hot">{state.error}</p>}
			</div>
			<button
				type="button"
				onClick={start}
				disabled={!props.week || state.busy}
				className="min-h-12 shrink-0 rounded-[10px] bg-marquee px-5 text-[15px] font-semibold text-marquee-ink hover:brightness-110 disabled:opacity-40"
			>
				{state.busy ? "Starting…" : props.week ? `Watch the week of ${fmtDay(props.week)}` : "Pick a week to watch"}
			</button>
		</section>
	);
}

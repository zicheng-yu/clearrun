import { useMemo, useState, type ReactNode } from "react";
import { DECAY, lastFullRun, planCalendar, recommend, verdict, YOUR_RUN, type Recommendation, type Verdict, type WeekScore } from "../engine/score/calendar.ts";
import { fmtDay, narrate, percentLabel, runPhrase, threat, topThreats } from "../engine/score/narrate.ts";
import { addDays } from "../shared/dates.ts";
import { ANCHOR_GAMES } from "../shared/games.ts";
import type { PlanResult, RivalScore } from "../shared/types.ts";
import type { Setup } from "./Planner.tsx";
import { wikiUrl } from "./SlateList.tsx";

interface WhatIf {
	/** Rival ID → the week it was moved to. */
	moves: Record<string, string>;
	removed: string[];
	/** Where your title opens in this what-if. */
	yourWeek?: string;
}

const panel = "rounded-xl border border-line bg-stage";
const index = (x: number) => Math.round(x * 100);
const amber = (alpha: number) => `rgba(242, 182, 50, ${alpha.toFixed(3)})`;
const pressureColor = (p: number) => (p >= 0.5 ? "#ff6a4d" : "#f2b632");
const scrollToWeek = (week: string) => document.getElementById(`w-${week}`)?.scrollIntoView({ behavior: "smooth", block: "center" });

type Tone = "clear" | "danger" | "counter" | "you" | "muted";
const TONES: Record<Tone, string> = {
	clear: "border-clear/40 bg-clear/15 text-clear",
	danger: "border-hot/40 bg-hot/15 text-hot",
	counter: "border-counter/40 bg-counter/15 text-counter",
	you: "border-ink bg-ink text-house",
	muted: "border-line text-muted",
};

function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
	return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase ${TONES[tone]}`}>{children}</span>;
}

function Meter({ label, value, pressure }: { label: string; value: number; pressure?: boolean }) {
	return (
		<div className="flex items-center gap-2 text-[11px]">
			<span className="w-14 text-muted">{label}</span>
			<div className="h-2 flex-1 overflow-hidden rounded bg-line">
				<div className="h-full rounded" style={{ width: `${value > 0 ? Math.max(2, value * 100) : 0}%`, backgroundColor: pressure ? pressureColor(value) : "#6b675f" }} />
			</div>
			<span className="w-7 text-right text-ink-2 tabular-nums">{index(value)}</span>
		</div>
	);
}

function scoreNote(r: RivalScore): string {
	if (r.kind === "game") {
		if (!r.proxy) return "Not scored.";
		const anchors = ANCHOR_GAMES.filter((g) => g.id.toUpperCase() !== r.proxy?.id.toUpperCase()).length;
		return `Proxy score: unreleased games have no Qloo scores, so ${r.title} is scored as ${r.proxy.name}, placed among ${anchors} well-known games.`;
	}
	if (r.overlap === undefined) {
		return r.qlooId
			? "Qloo knows this title but returned no score for this audience. It counts toward buzz, not pressure."
			: "Not matched to Qloo. It counts toward buzz, not pressure.";
	}
	return "Content-based score: an unreleased film is scored from its metadata (genre, keywords, talent), not from viewing behavior. The percentile ranks it among every scored film on the slate.";
}

function RivalChip({ rival, active, onClick }: { rival: RivalScore; active: boolean; onClick: () => void }) {
	const o = rival.overlap;
	const alpha = o === undefined ? 0 : 0.1 + 0.8 * o * o;
	const border = rival.kind === "game" ? "border-dashed border-marquee" : o === undefined ? "border-dashed border-line" : "border-transparent";
	const text = alpha > 0.5 ? "text-marquee-ink" : o === undefined ? "text-muted" : "text-ink";
	return (
		<button
			type="button"
			onClick={onClick}
			aria-expanded={active}
			style={o === undefined ? undefined : { backgroundColor: amber(alpha) }}
			className={`rounded-md border px-2 py-1 text-left text-xs leading-tight ${border} ${text} ${active ? "ring-2 ring-ink" : "hover:ring-1 hover:ring-ink/50"}`}
		>
			<span className="font-medium">{rival.title}</span>
			<span className="ml-1.5 opacity-75">
				{o === undefined ? "no data" : percentLabel(o)}
				{rival.kind === "game" ? " · game" : ""}
			</span>
		</button>
	);
}

function RivalDetail(props: { rival: RivalScore; movedFrom?: string; onShift: (weeks: number) => void; onRemove: () => void; onUndo: () => void; onClose: () => void }) {
	const { rival } = props;
	const button = "rounded-lg border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-marquee";
	return (
		<div className="mt-3 rounded-lg border border-line bg-house p-4 text-sm">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<a href={wikiUrl(rival.page)} target="_blank" rel="noreferrer" className="font-medium text-ink hover:underline">
					{rival.title}
				</a>
				<span className="text-xs text-muted">
					{rival.kind === "game" ? "Game" : "Film"} · opens {fmtDay(rival.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
					{props.movedFrom ? ` · what-if: week of ${fmtDay(rival.week)}` : ""}
				</span>
			</div>
			<dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
				<div>
					<dt className="text-xs text-muted">Overlap with your audience</dt>
					<dd className="text-ink">{rival.overlap === undefined ? "Not scored" : `${percentLabel(rival.overlap)} (Qloo affinity ${rival.affinity?.toFixed(3)})`}</dd>
				</div>
				<div>
					<dt className="text-xs text-muted">Attention</dt>
					<dd className="text-ink">
						{typeof rival.views30d === "number" ? `${rival.views30d.toLocaleString("en-US")} Wikipedia views in 30 days` : "Not measured"} (size {rival.size.toFixed(2)})
					</dd>
				</div>
			</dl>
			<p className="mt-3 text-xs text-muted">{scoreNote(rival)}</p>
			<div className="mt-3 flex flex-wrap gap-2">
				<span className="self-center text-xs text-muted">What if it moved?</span>
				<button type="button" className={button} onClick={() => props.onShift(-1)}>
					← 1 week earlier
				</button>
				<button type="button" className={button} onClick={() => props.onShift(1)}>
					1 week later →
				</button>
				<button type="button" className={button} onClick={props.onRemove}>
					Remove it
				</button>
				{props.movedFrom && (
					<button type="button" className={button} onClick={props.onUndo}>
						Back to {fmtDay(props.movedFrom)}
					</button>
				)}
				<button type="button" className={`${button} ml-auto`} onClick={props.onClose}>
					Close
				</button>
			</div>
		</div>
	);
}

function HeatStrip({ calendar, rec, from, latest, yourWeek }: { calendar: WeekScore[]; rec: Recommendation; from: string; latest?: string; yourWeek?: string }) {
	const tone = (week: string) => (rec.clear.includes(week) ? "bg-clear" : rec.danger.includes(week) ? "bg-hot" : rec.counter.includes(week) ? "bg-counter" : "bg-transparent");
	return (
		<div className={`${panel} p-4`}>
			<div className="flex items-baseline justify-between gap-3">
				<h3 className="font-display text-2xl tracking-wide">Audience pressure, week by week</h3>
				<span className="hidden text-xs text-muted sm:block">Taller and redder = more of your audience spoken for during your first four weeks</span>
			</div>
			<div className="mt-3 flex gap-[3px]">
				{calendar.map((w, i) => {
					const month = w.week.slice(5, 7);
					const newMonth = i === 0 || calendar[i - 1]?.week.slice(5, 7) !== month;
					return (
						<button
							key={w.week}
							type="button"
							onClick={() => scrollToWeek(w.week)}
							title={`Week of ${fmtDay(w.week)}: pressure ${index(w.p)}, buzz ${index(w.b)}${w.season.label ? `, ${w.season.label}` : ""}`}
							className={`min-w-0 flex-1 ${w.week < from || (latest && w.week > latest) ? "opacity-40" : ""}`}
						>
							<div className="relative h-20 overflow-hidden rounded-sm bg-line/50">
								<div className="absolute inset-x-0 bottom-0" style={{ height: `${w.p * 100}%`, backgroundColor: pressureColor(w.p) }} />
								{w.week === yourWeek && <div className="absolute inset-x-0 top-0 h-1 bg-ink" />}
							</div>
							<div className={`mt-1 h-1 rounded-full ${tone(w.week)}`} />
							<div className="mt-1 h-3 overflow-visible text-left text-[10px] whitespace-nowrap text-muted">{newMonth ? fmtDay(w.week, { month: "short" }) : ""}</div>
						</button>
					);
				})}
			</div>
			<div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
				<span className="flex items-center gap-1.5">
					<span className="h-1 w-4 rounded-full bg-clear" /> Clear pick
				</span>
				<span className="flex items-center gap-1.5">
					<span className="h-1 w-4 rounded-full bg-hot" /> Danger
				</span>
				<span className="flex items-center gap-1.5">
					<span className="h-1 w-4 rounded-full bg-counter" /> Counter-programming
				</span>
				{yourWeek && (
					<span className="flex items-center gap-1.5">
						<span className="h-1 w-4 bg-ink" /> Your week
					</span>
				)}
				<span>Faded: before your earliest week, or too late in the slate to judge a full run</span>
			</div>
		</div>
	);
}

function PickCard(props: { tone: Tone; title: string; weeks: string[]; empty: string; detail: (w: string) => string; onTry?: (w: string) => void; tryLabel: string }) {
	return (
		<div className={`${panel} p-4`}>
			<Badge tone={props.tone}>{props.title}</Badge>
			{props.weeks.length === 0 ? (
				<p className="mt-3 text-sm text-muted">{props.empty}</p>
			) : (
				<ol className="mt-3 space-y-3">
					{props.weeks.map((w) => (
						<li key={w} className="flex items-start justify-between gap-3">
							<button type="button" onClick={() => scrollToWeek(w)} className="text-left">
								<span className="font-display text-xl leading-none tracking-wide">Week of {fmtDay(w)}</span>
								<span className="mt-0.5 block text-xs text-muted">{props.detail(w)}</span>
							</button>
							{props.onTry && (
								<button type="button" onClick={() => props.onTry?.(w)} className="shrink-0 rounded-lg border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-marquee">
									{props.tryLabel}
								</button>
							)}
						</li>
					))}
				</ol>
			)}
		</div>
	);
}

function VerdictCard(props: { v: Verdict; title: string; original?: string; week: WeekScore; best?: WeekScore; lead?: string; onTry: (w: string) => void }) {
	const { v, week, best } = props;
	const moved = props.original && props.original !== v.week;
	const row = (label: string, w: WeekScore) => (
		<tr>
			<td className="py-1 pr-3 text-muted">{label}</td>
			<td className="py-1 pr-3 text-right text-ink tabular-nums">{index(w.p)}</td>
			<td className="py-1 pr-3 text-right text-ink-2 tabular-nums">{index(w.b)}</td>
			<td className="py-1 text-right text-ink-2 tabular-nums">{w.clear.toFixed(2)}</td>
		</tr>
	);
	return (
		<div className={`${panel} flex h-full flex-col p-5 ${v.hold ? "border-clear/50" : "border-hot/50"}`}>
			<p className="text-[11px] tracking-[0.3em] text-muted">{moved ? "WHAT-IF DATE" : "YOUR DATE"}</p>
			<p className="mt-1 text-sm text-ink-2">
				{props.title} · week of {fmtDay(v.week, { month: "short", day: "numeric", year: "numeric" })}
			</p>
			<p className={`mt-2 font-display text-6xl leading-none tracking-wide ${v.hold ? "text-clear" : "text-hot"}`}>{v.hold ? "Hold" : "Move?"}</p>
			<p className="mt-2 text-sm text-ink-2">
				#{v.rank} of {v.of} weeks by clear score{week.season.label ? ` · ${week.season.label}` : ""}
			</p>
			{props.lead && <p className="mt-1 text-xs text-muted">Main pressure: {props.lead}</p>}
			{best && (
				<table className="mt-4 w-full text-xs">
					<thead>
						<tr className="text-[10px] tracking-wider text-muted uppercase">
							<th className="pb-1 text-left font-normal">Week</th>
							<th className="pb-1 text-right font-normal">Pressure</th>
							<th className="pb-1 text-right font-normal">Buzz</th>
							<th className="pb-1 text-right font-normal">Clear</th>
						</tr>
					</thead>
					<tbody>
						{row(`Yours, ${fmtDay(v.week)}`, week)}
						{row(`Best other, ${fmtDay(best.week)}`, best)}
					</tbody>
				</table>
			)}
			<div className="mt-auto flex flex-wrap gap-2 pt-4">
				<button type="button" onClick={() => props.onTry(v.best)} className="rounded-lg bg-marquee px-3 py-1.5 text-sm font-semibold text-marquee-ink hover:brightness-110">
					Try {fmtDay(v.best)}
				</button>
				{moved && props.original && (
					<button type="button" onClick={() => props.onTry(props.original as string)} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:border-marquee">
						Back to {fmtDay(props.original)}
					</button>
				)}
			</div>
		</div>
	);
}

function TopRivals({ rivals, from, onOpen }: { rivals: RivalScore[]; from: string; onOpen: (r: RivalScore) => void }) {
	const top = topThreats(rivals, from, 8);
	return (
		<div className={`${panel} p-4`}>
			<h3 className="font-display text-2xl tracking-wide">Who competes for your audience</h3>
			<p className="mt-1 text-xs text-muted">
				Ranked by overlap² × attention: how much of your audience's attention a rival takes in its opening week. Rivals that open well before your earliest week are left out.
			</p>
			<ol className="mt-3 divide-y divide-line">
				{top.map((r, i) => (
					<li key={r.id}>
						<button
							type="button"
							onClick={() => onOpen(r)}
							className="grid w-full grid-cols-[1.5rem_1fr_auto] items-center gap-3 py-2 text-left hover:bg-house/60 sm:grid-cols-[1.5rem_1fr_6rem_8rem_8rem]"
						>
							<span className="text-xs text-muted tabular-nums">{i + 1}</span>
							<span className="min-w-0">
								<span className="block truncate text-sm text-ink">{r.title}</span>
								<span className="block text-xs text-muted">{r.kind === "game" ? `Game · proxy ${r.proxy?.name ?? ""}` : "Film · content-based"}</span>
							</span>
							<span className="text-right text-xs text-ink-2 sm:text-left sm:text-sm">
								{fmtDay(r.date)}
								<span className="block text-muted sm:hidden">{percentLabel(r.overlap ?? 0)}</span>
							</span>
							<span className="hidden items-center gap-2 sm:flex">
								<span className="h-1.5 flex-1 overflow-hidden rounded bg-line">
									<span className="block h-full rounded bg-marquee" style={{ width: `${(r.overlap ?? 0) * 100}%` }} />
								</span>
								<span className="w-9 text-right text-xs text-ink-2 tabular-nums">{percentLabel(r.overlap ?? 0)}</span>
							</span>
							<span className="hidden items-center gap-2 sm:flex">
								<span className="h-1.5 flex-1 overflow-hidden rounded bg-line">
									<span className="block h-full rounded bg-ink-2" style={{ width: `${r.size * 100}%` }} />
								</span>
								<span className="w-9 text-right text-xs text-muted tabular-nums">{index(r.size)}</span>
							</span>
						</button>
					</li>
				))}
			</ol>
			<p className="mt-2 hidden text-[11px] text-muted sm:block">Bars: overlap percentile (amber) and attention size (grey).</p>
		</div>
	);
}

function Method({ result }: { result: PlanResult }) {
	const c = result.coverage;
	const row = (decay: readonly number[]) => decay.map((d) => d.toFixed(2)).join(" · ");
	return (
		<details className={`${panel} p-4 text-sm text-ink-2`}>
			<summary className="font-display text-2xl tracking-wide text-ink">How this is scored</summary>
			<ul className="mt-3 list-disc space-y-2 pl-5">
				<li>
					<b className="text-ink">Overlap.</b> One Qloo <code>/v2/insights</code> call per batch of rivals: your comps are the signal, the rivals go in{" "}
					<code>filter.results.entities</code>, and <code>bias.content_based=1</code> lets Qloo score films that aren't out yet. Raw affinities are compressed (about 0.77–0.97), so
					each rival's overlap is its percentile among the scored films on this slate.
				</li>
				<li>
					<b className="text-ink">Games.</b> Unreleased games have no Qloo scores, so each game is scored through a released predecessor (proxy) and placed among{" "}
					{ANCHOR_GAMES.length} well-known games, which makes it comparable to a film percentile.
				</li>
				<li>
					<b className="text-ink">Attention size</b> (assumption): the square root of a title's share of the top title's Wikipedia pageviews over the last 30 days, with a floor of
					0.05.
				</li>
				<li>
					<b className="text-ink">Decay</b> (assumption), for the week before opening through five weeks after: films {row(DECAY.film)}; games {row(DECAY.game)}.
				</li>
				<li>
					<b className="text-ink">Pressure</b> = Σ overlap² × size × decay over scored rivals. <b className="text-ink">Buzz</b> = Σ size × decay over all rivals. Each week is
					scored as your opening week across your own first four weeks (weights {YOUR_RUN.map((x) => x.toFixed(2)).join(" · ")}), so a big rival opening two weeks after you still
					counts. Both are shown from 0 to 100, relative to the busiest week you could open in.
				</li>
				<li>
					<b className="text-ink">Season</b> (assumption): Thanksgiving and Christmas–New Year ×1.3; MLK, Presidents' Day, spring break and summer holiday weekends ×1.15.{" "}
					<b className="text-ink">Clear</b> = season × (1 − pressure). Clear picks need at least half their buzz scored by Qloo, and they skip the opening weeks of your five
					biggest rivals: a head-to-head opening is a risk even in a quiet month. <b className="text-ink">Counter-programming</b>: buzz ≥ 60 with pressure under 50 and well below
					buzz.
				</li>
				<li>
					<b className="text-ink">Coverage.</b> {c.films} films on the slate, {c.mapped} matched to Qloo, {c.scored} scored for this audience; {c.gamesScored} of {c.games} games
					scored through proxies. Unscored titles add buzz, not pressure. This plan made {result.qlooCalls} new Qloo call{result.qlooCalls === 1 ? "" : "s"}; scores are cached for
					7 days.
				</li>
				<li>
					<b className="text-ink">Not a box-office forecast.</b> Pressure is a relative index of how much of your audience's attention is already spoken for. Dates further out are
					sparser on Wikipedia, so far weeks can look clearer than they will be.
				</li>
			</ul>
		</details>
	);
}

export function PlanView({ result, setup, weeks }: { result: PlanResult; setup: Setup; weeks: string[] }) {
	const [whatIf, setWhatIf] = useState<WhatIf>({ moves: {}, removed: [], yourWeek: result.you?.week });
	const [openRival, setOpenRival] = useState<string>();
	const [showEarly, setShowEarly] = useState(false);
	const from = setup.from;
	const original = useMemo(() => new Map(result.rivals.map((r) => [r.id, r])), [result]);
	const rivals = useMemo(
		() => result.rivals.filter((r) => !whatIf.removed.includes(r.id)).map((r) => (whatIf.moves[r.id] ? { ...r, week: whatIf.moves[r.id] as string } : r)),
		[result, whatIf],
	);
	const byId = useMemo(() => new Map(rivals.map((r) => [r.id, r])), [rivals]);
	const calendar = useMemo(() => planCalendar(rivals, weeks, { from }), [rivals, weeks, from]);
	// Clear picks never open head to head with one of your five biggest rivals.
	const range = useMemo(() => ({ earliest: from, latest: lastFullRun(weeks), avoid: topThreats(rivals, from).map((r) => r.id) }), [from, weeks, rivals]);
	const weekMap = useMemo(() => new Map(calendar.map((w) => [w.week, w])), [calendar]);
	const rec = useMemo(() => recommend(calendar, range), [calendar, range]);
	const yourTitle = result.you?.title ?? "Your film";
	const v = whatIf.yourWeek ? verdict(calendar, whatIf.yourWeek, range) : undefined;
	const story = narrate({
		compNames: setup.comps.map((c) => c.short ?? c.name),
		rivals,
		calendar,
		recommendation: rec,
		window: range,
		you: whatIf.yourWeek ? { title: yourTitle, date: whatIf.yourWeek === result.you?.week ? result.you.date : whatIf.yourWeek, week: whatIf.yourWeek } : undefined,
		verdict: v,
		scored: result.coverage.scored + result.coverage.gamesScored,
		total: result.coverage.films + result.coverage.games,
	});
	const changes = Object.keys(whatIf.moves).length + whatIf.removed.length + (whatIf.yourWeek !== result.you?.week ? 1 : 0);

	const lead = (week: string, by: "pressure" | "buzz" = "pressure") => {
		const c = [...(weekMap.get(week)?.contributors ?? [])].sort((x, y) => y[by] - x[by])[0];
		const r = c && c[by] > 0 ? byId.get(c.id) : undefined;
		return r && c ? `${r.title} (${runPhrase(c.k)})` : undefined;
	};
	const placeYou = (week: string) => setWhatIf((w) => ({ ...w, yourWeek: week }));
	const shift = (id: string, delta: number) =>
		setWhatIf((w) => {
			const current = w.moves[id] ?? original.get(id)?.week;
			if (!current) return w;
			const next = addDays(current, 7 * delta);
			const first = weeks[0] ?? next;
			const last = weeks.at(-1) ?? next;
			const clamped = next < first ? first : next > last ? last : next;
			const moves = { ...w.moves, [id]: clamped };
			if (clamped === original.get(id)?.week) delete moves[id];
			return { ...w, moves };
		});
	const openFor = (r: RivalScore) => {
		setOpenRival(r.id);
		requestAnimationFrame(() => scrollToWeek(r.week));
	};

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="font-display text-4xl tracking-wide">
					Plan for fans of <span className="text-marquee">{setup.comps.map((c) => c.short ?? c.name).join(" + ")}</span>
				</h2>
				<p className="text-xs text-muted">
					Earliest week: {fmtDay(from, { month: "short", day: "numeric", year: "numeric" })} · slate of{" "}
					{fmtDay(result.snapshot.createdAt ? new Date(result.snapshot.createdAt).toISOString().slice(0, 10) : from)}
				</p>
			</div>

			{result.notice && <p className="rounded-lg border border-marquee/50 bg-marquee/10 px-4 py-2 text-sm text-ink">{result.notice}</p>}

			{changes > 0 && (
				<div className="sticky top-2 z-20 flex items-center justify-between gap-3 rounded-lg border border-counter/50 bg-house/95 px-4 py-2 text-sm backdrop-blur">
					<span className="text-ink-2">
						What-if mode: {changes} change{changes === 1 ? "" : "s"} to the real calendar. Scores are recomputed in your browser; no new Qloo calls.
					</span>
					<button
						type="button"
						onClick={() => {
							setWhatIf({ moves: {}, removed: [], yourWeek: result.you?.week });
							setOpenRival(undefined);
						}}
						className="shrink-0 rounded-lg border border-line px-3 py-1 text-xs hover:border-marquee"
					>
						Reset
					</button>
				</div>
			)}

			<div className={`grid gap-4 ${v ? "lg:grid-cols-[2fr_1fr]" : ""}`}>
				<div className={`${panel} p-5`}>
					<p className="text-[11px] tracking-[0.3em] text-marquee">PLANNER NOTES</p>
					<div className="mt-2 space-y-2 text-ink-2">
						{story.map((line) => (
							<p key={line}>{line}</p>
						))}
					</div>
					<p className="mt-4 text-xs text-muted">
						{result.qlooCalls > 0 ? `Scored just now with ${result.qlooCalls} Qloo call${result.qlooCalls === 1 ? "" : "s"}.` : "Served from the score cache (no new Qloo calls)."}{" "}
						Every title, date and number here comes from the live slate and Qloo.
					</p>
				</div>
				{v && whatIf.yourWeek && weekMap.get(whatIf.yourWeek) && (
					<VerdictCard
						v={v}
						title={yourTitle}
						original={result.you?.week}
						week={weekMap.get(whatIf.yourWeek) as WeekScore}
						best={weekMap.get(v.best)}
						lead={lead(whatIf.yourWeek)}
						onTry={placeYou}
					/>
				)}
			</div>

			<div className="grid gap-4 md:grid-cols-3">
				<PickCard
					tone="clear"
					title="Clearest weeks"
					weeks={rec.clear}
					empty="No week in this window is clearly open for this audience."
					detail={(w) => {
						const s = weekMap.get(w);
						return `Pressure ${index(s?.p ?? 0)}${s?.season.label ? ` · ${s.season.label}` : ""}`;
					}}
					onTry={placeYou}
					tryLabel={result.you ? "Move here" : "Open here"}
				/>
				<PickCard
					tone="danger"
					title="Danger weeks"
					weeks={rec.danger}
					empty="No week carries more than half the peak pressure."
					detail={(w) => `Pressure ${index(weekMap.get(w)?.p ?? 0)}${lead(w) ? ` · ${lead(w)}` : ""}`}
					tryLabel=""
				/>
				<PickCard
					tone="counter"
					title="Counter-programming"
					weeks={rec.counter}
					empty="No big-crowd week that isn't also your crowd."
					detail={(w) => `Buzz ${index(weekMap.get(w)?.b ?? 0)}, pressure ${index(weekMap.get(w)?.p ?? 0)}${lead(w, "buzz") ? ` · crowd for ${lead(w, "buzz")}` : ""}`}
					onTry={placeYou}
					tryLabel={result.you ? "Move here" : "Open here"}
				/>
			</div>

			<HeatStrip calendar={calendar} rec={rec} from={from} latest={range.latest} yourWeek={whatIf.yourWeek} />

			<TopRivals rivals={rivals} from={from} onOpen={openFor} />

			{calendar.some((w) => w.week < from) && (
				<button type="button" onClick={() => setShowEarly(!showEarly)} className="text-xs text-muted underline decoration-dotted underline-offset-2 hover:text-ink">
					{showEarly ? "Hide" : "Show"} the {calendar.filter((w) => w.week < from).length} weeks before your earliest week
				</button>
			)}
			<ol className="space-y-2">
				{calendar
					.filter((w) => showEarly || w.week >= from || w.week === whatIf.yourWeek)
					.map((w) => {
						const opening = rivals.filter((r) => r.week === w.week).sort((a, b) => threat(b) - threat(a) || b.size - a.size);
						const felt = w.contributors.filter((c) => c.pressure > 0 && byId.get(c.id)?.week !== w.week).slice(0, 2);
						const open = openRival ? opening.find((r) => r.id === openRival) : undefined;
						const isYou = w.week === whatIf.yourWeek;
						const tooSoon = w.week < from;
						const tooLate = Boolean(range.latest && w.week > range.latest);
						return (
							<li key={w.week} id={`w-${w.week}`} className={`${panel} p-3 sm:p-4 ${tooSoon || tooLate ? "opacity-60" : ""} ${isYou ? "border-ink/70" : ""}`}>
								<div className="grid gap-3 sm:grid-cols-[7rem_13rem_1fr] sm:items-start">
									<div>
										<div className="font-display text-3xl leading-none tracking-wide">{fmtDay(w.week)}</div>
										<div className="mt-1 text-[11px] text-muted">
											{w.season.label ? `${w.season.label} ×${w.season.factor}` : fmtDay(w.week, { weekday: "short", year: "numeric" })}
										</div>
									</div>
									<div>
										<Meter label="Pressure" value={w.p} pressure />
										<Meter label="Buzz" value={w.b} />
										<div className="mt-2 flex flex-wrap gap-1">
											{isYou && <Badge tone="you">{result.you ? "Your week" : "Your film"}</Badge>}
											{rec.clear.includes(w.week) && <Badge tone="clear">Clear #{rec.clear.indexOf(w.week) + 1}</Badge>}
											{rec.danger.includes(w.week) && <Badge tone="danger">Danger</Badge>}
											{rec.counter.includes(w.week) && <Badge tone="counter">Counter</Badge>}
											{tooSoon && <Badge tone="muted">Too soon</Badge>}
											{tooLate && <Badge tone="muted">Slate thins out</Badge>}
											{w.confidence < 0.6 && w.buzz > 0 && <Badge tone="muted">{index(w.confidence)}% scored</Badge>}
										</div>
									</div>
									<div className="min-w-0">
										<div className="flex flex-wrap gap-1.5">
											{isYou && (
												<span className="rounded-md border border-ink bg-ink px-2 py-1 text-xs font-semibold text-house">
													{yourTitle}
													<span className="ml-1.5 font-normal opacity-70">you</span>
												</span>
											)}
											{opening.map((r) => (
												<RivalChip key={r.id} rival={r} active={openRival === r.id} onClick={() => setOpenRival(openRival === r.id ? undefined : r.id)} />
											))}
											{opening.length === 0 && !isYou && <span className="py-1 text-xs text-muted">No releases open this week.</span>}
										</div>
										{felt.length > 0 && (
											<p className="mt-2 text-[11px] text-muted">
												Also felt:{" "}
												{felt.map((c, i) => (
													<span key={c.id}>
														{i > 0 ? "; " : ""}
														{byId.get(c.id)?.title} ({runPhrase(c.k)})
													</span>
												))}
											</p>
										)}
										{!isYou && !tooSoon && (
											<button type="button" onClick={() => placeYou(w.week)} className="mt-2 text-[11px] text-muted underline decoration-dotted underline-offset-2 hover:text-ink">
												{result.you ? "Move your title here" : "Open your film here"}
											</button>
										)}
									</div>
								</div>
								{open && (
									<RivalDetail
										rival={open}
										movedFrom={whatIf.moves[open.id] ? original.get(open.id)?.week : undefined}
										onShift={(d) => shift(open.id, d)}
										onRemove={() => {
											setWhatIf((x) => ({ ...x, removed: [...x.removed, open.id] }));
											setOpenRival(undefined);
										}}
										onUndo={() =>
											setWhatIf((x) => {
												const moves = { ...x.moves };
												delete moves[open.id];
												return { ...x, moves };
											})
										}
										onClose={() => setOpenRival(undefined)}
									/>
								)}
							</li>
						);
					})}
			</ol>

			<Method result={result} />
		</div>
	);
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Comparison } from "../engine/explain/compare.ts";
import { AGE_BANDS, AGE_LABELS, type AudienceProfile } from "../engine/explain/demographics.ts";
import { DECAY, eligibleWeeks, lastFullRun, planCalendar, recommend, verdict, YOUR_RUN, type Recommendation, type Verdict, type WeekScore } from "../engine/score/calendar.ts";
import { fmtDay, narrate, percentLabel, runPhrase, topThreats } from "../engine/score/narrate.ts";
import { addDays } from "../shared/dates.ts";
import { ANCHOR_GAMES } from "../shared/games.ts";
import type { PlanResult, RivalScore } from "../shared/types.ts";
import { fetchAudience, fetchExplain } from "./api.ts";
import type { Setup } from "./Planner.tsx";
import { wikiUrl } from "./SlateList.tsx";

interface WhatIf {
	/** Rival ID → the week it was moved to. */
	moves: Record<string, string>;
	removed: string[];
	/** Where your title opens in this what-if. */
	yourWeek?: string;
}

const card = "rounded-[18px] border border-line bg-stage";
const primary = "min-h-12 rounded-[10px] bg-marquee px-5 text-[15px] font-semibold text-marquee-ink hover:brightness-110";
const ghost = "min-h-12 rounded-[10px] border border-line px-5 text-[15px] font-medium text-ink hover:border-marquee";
const index = (x: number) => Math.round(x * 100);
/** Bar fill by pressure: the more of your audience already spoken for, the hotter. */
const heat = (p: number) => (p >= 0.5 ? "bg-hot" : p >= 0.3 ? "bg-hot/65" : p >= 0.15 ? "bg-hot/45" : "bg-hot/30");
const fullDay = (day: string) => fmtDay(day, { month: "short", day: "numeric", year: "numeric" });
const scrollToDetail = () => document.getElementById("week-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });

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
				<div className={`h-full rounded ${pressure ? heat(value) : "bg-muted/70"}`} style={{ width: `${value > 0 ? Math.max(2, value * 100) : 0}%` }} />
			</div>
			<span className="w-7 text-right text-ink-2 tabular-nums">{index(value)}</span>
		</div>
	);
}

/** A 0–1 value as a thin bar with its label beside it. */
function Bar({ value, label, fill }: { value?: number; label: string; fill: string }) {
	return (
		<span className="flex items-center gap-2">
			<span className="h-1.5 flex-1 overflow-hidden rounded bg-line">
				<span className={`block h-full rounded ${fill}`} style={{ width: `${(value ?? 0) * 100}%` }} />
			</span>
			<span className="w-16 text-right font-mono text-xs text-ink-2 tabular-nums">{label}</span>
		</span>
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

function TagList({ label, tags, strong }: { label: string; tags: string[]; strong?: boolean }) {
	if (tags.length === 0) return null;
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-xs text-muted">{label}</span>
			<ul className="flex flex-wrap gap-1.5">
				{tags.map((t) => (
					<li key={t} className={`rounded-full border px-2.5 py-0.5 text-xs ${strong ? "border-marquee/50 bg-marquee/10 text-ink" : "border-line text-ink-2"}`}>
						{t}
					</li>
				))}
			</ul>
		</div>
	);
}

/** Qloo taste tags the comps share with the rival (or with a game's proxy), and tags only one side has. */
function WhyOverlap({ comps, rival }: { comps: string[]; rival: RivalScore }) {
	const [state, setState] = useState<{ data?: Comparison; error?: string }>({});
	const target = rival.qlooId;
	const key = comps.join();
	useEffect(() => {
		if (!target) return;
		const controller = new AbortController();
		setState({});
		fetchExplain(key.split(","), target, controller.signal)
			.then((data) => setState({ data }))
			.catch((e: unknown) => !controller.signal.aborted && setState({ error: e instanceof Error ? e.message : String(e) }));
		return () => controller.abort();
	}, [key, target]);
	if (!target) return null;
	const via = rival.kind === "game" && rival.proxy ? ` (through ${rival.proxy.name})` : "";
	return (
		<div className="mt-4 flex flex-col gap-3 border-t border-dashed border-line pt-4">
			<h4 className="text-[13px] font-semibold">Why they overlap{via}</h4>
			{state.error ? (
				<p className="text-xs text-hot">{state.error}</p>
			) : !state.data ? (
				<p className="text-xs text-muted">Comparing taste tags in Qloo…</p>
			) : state.data.shared.length === 0 && state.data.onlyYours.length === 0 && state.data.onlyTheirs.length === 0 ? (
				<p className="text-xs text-muted">Qloo has no tags to compare for this pair.</p>
			) : (
				<>
					<TagList label="Taste tags your comps share with it" tags={state.data.shared.map((t) => t.name)} strong />
					<div className="grid gap-3 sm:grid-cols-2">
						<TagList label="Only your comps" tags={state.data.onlyYours.slice(0, 6).map((t) => t.name)} />
						<TagList label={`Only ${rival.kind === "game" && rival.proxy ? rival.proxy.name : rival.title}`} tags={state.data.onlyTheirs.slice(0, 6).map((t) => t.name)} />
					</div>
					<p className="text-[11px] text-muted">From Qloo's compare analysis. Tags for unreleased titles come from their metadata.</p>
				</>
			)}
		</div>
	);
}

function RivalDetail(props: {
	rival: RivalScore;
	comps: string[];
	movedFrom?: string;
	onShift: (weeks: number) => void;
	onRemove: () => void;
	onUndo: () => void;
	onClose: () => void;
}) {
	const { rival } = props;
	const button = "min-h-9 rounded-lg border border-line px-2.5 text-xs text-ink-2 hover:border-marquee";
	return (
		<div className="rounded-xl border border-line bg-house p-4 text-sm">
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
			<WhyOverlap comps={props.comps} rival={rival} />
			<div className="mt-4 flex flex-wrap gap-2">
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

function Stat({ label, value, note, outOf = true, tone = "text-ink" }: { label: string; value: number; note: string; outOf?: boolean; tone?: string }) {
	return (
		<div className="flex flex-col gap-1">
			<dt className="text-xs tracking-[0.08em] text-muted uppercase">{label}</dt>
			<dd className={`font-mono text-5xl leading-none font-medium tabular-nums ${tone}`}>
				{value}
				{outOf && <span className="text-base text-muted"> / 100</span>}
			</dd>
			<dd className="max-w-[16rem] text-[13px] text-muted">{note}</dd>
		</div>
	);
}

const DOTS: Record<"clear" | "danger" | "counter", string> = { clear: "bg-clear", danger: "bg-hot", counter: "bg-counter" };

function PickList(props: {
	tone: "clear" | "danger" | "counter";
	heading: string;
	weeks: string[];
	empty: string;
	detail: (w: string) => string;
	onSelect: (w: string) => void;
	onTry?: (w: string) => void;
	tryLabel?: string;
}) {
	return (
		<div className="flex flex-col gap-2">
			<h3 className="flex items-center gap-2 text-[13px] font-semibold tracking-[0.04em]">
				<span aria-hidden className={`h-1 w-4 rounded-full ${DOTS[props.tone]}`} />
				{props.heading}
			</h3>
			{props.weeks.length === 0 ? (
				<p className="text-sm text-muted">{props.empty}</p>
			) : (
				<ol className="-ml-2.5 flex flex-col">
					{props.weeks.map((w) => (
						<li key={w} className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => props.onSelect(w)}
								className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-lg px-2.5 py-1.5 text-left hover:bg-line/50"
							>
								<span className="font-mono text-sm">Week of {fmtDay(w)}</span>
								<span className="text-xs text-muted">{props.detail(w)}</span>
							</button>
							{props.onTry && (
								<button type="button" onClick={() => props.onTry?.(w)} className="min-h-9 shrink-0 rounded-lg border border-line px-2.5 text-xs text-ink-2 hover:border-marquee">
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

/** The answer up top: the clearest week, or hold/move for a dated title, with the picks and planner notes behind it. */
function Hero(props: {
	compNames: string[];
	focus?: WeekScore;
	v?: Verdict;
	mine?: WeekScore;
	best?: WeekScore;
	yourTitle: string;
	original?: string;
	hasYou: boolean;
	eligible: number;
	rec: Recommendation;
	weekMap: Map<string, WeekScore>;
	lead: (week: string, by?: "pressure" | "buzz") => string | undefined;
	story: string[];
	footnote: string;
	onSelect: (week: string) => void;
	onPlace: (week: string) => void;
}) {
	const { v, focus, mine, best, weekMap, lead } = props;
	const names = props.compNames.join(" + ");
	const moved = Boolean(v && props.original && props.original !== v.week);
	const mainLead = v ? lead(v.week) : undefined;
	const range = (week: string) =>
		`${fmtDay(week, { weekday: "short", month: "short", day: "numeric" })} – ${fmtDay(addDays(week, 6), { weekday: "short", month: "short", day: "numeric", year: "numeric" })}`;
	const head = v
		? {
				eyebrow: `${moved ? "What-if date" : "Your date"} · ${props.yourTitle} · fans of ${names}`,
				headline: v.hold ? `Hold ${fmtDay(v.week)}` : `Move to ${fmtDay(v.best)}?`,
				tone: v.hold ? "text-clear" : "text-marquee [text-shadow:0_0_32px_rgb(242_182_50/0.3)]",
				sub: `${v.hold ? "Your week" : `Week of ${fmtDay(v.week)}`} ranks #${v.rank} of ${v.of} by clear score${mine?.season.label ? ` · ${mine.season.label}` : ""}`,
			}
		: focus
			? {
					eyebrow: `Clearest week for fans of ${names}`,
					headline: `Week of ${fmtDay(focus.week)}`,
					tone: "text-marquee [text-shadow:0_0_32px_rgb(242_182_50/0.3)]",
					sub: `${range(focus.week)}${focus.season.label ? ` · ${focus.season.label}` : ""}`,
				}
			: { eyebrow: `Fans of ${names}`, headline: "No clear run", tone: "text-ink", sub: "No week in this window is clearly open for this audience." };
	const tryLabel = props.hasYou ? "Move here" : "Open here";

	return (
		<section aria-labelledby="pick" className={`${card} overflow-hidden`}>
			<div aria-hidden className="marquee-bulbs h-[18px] border-b border-line bg-marquee/5" />
			<div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6 px-5 pt-7 sm:px-9">
				<div className="flex min-w-0 flex-col gap-2.5">
					<p className="font-mono text-xs tracking-[0.16em] text-marquee uppercase">{head.eyebrow}</p>
					<h1 id="pick" className={`font-display text-[clamp(52px,7.6vw,128px)] leading-[0.86] tracking-[0.01em] ${head.tone}`}>
						{head.headline}
					</h1>
					<p className="font-mono text-sm text-ink-2">{head.sub}</p>
				</div>
				<dl className="flex flex-wrap gap-x-9 gap-y-5">
					{v && mine && (
						<Stat label="Pressure, your week" value={index(mine.p)} note={mainLead ? `Mostly ${mainLead}` : `Week of ${fmtDay(v.week)}`} tone={v.hold ? "text-ink" : "text-hot"} />
					)}
					{v && best && <Stat label={`Pressure, ${fmtDay(best.week)}`} value={index(best.p)} note="The clearest week other than yours" tone="text-marquee" />}
					{!v && focus && (
						<>
							<Stat label="Pressure" value={index(focus.p)} note={`Clear pick #1 of ${props.eligible} weeks you could open`} />
							<Stat label="Buzz" value={index(focus.b)} note="General moviegoing attention across your first four weeks" />
						</>
					)}
				</dl>
			</div>

			<div className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-x-9 gap-y-6 border-t border-dashed border-line px-5 py-6 sm:px-9">
				<PickList
					tone="clear"
					heading="Clearest weeks"
					weeks={props.rec.clear}
					empty="No week in this window is clearly open for this audience."
					detail={(w) => {
						const s = weekMap.get(w);
						return `Pressure ${index(s?.p ?? 0)}${s?.season.label ? ` · ${s.season.label}` : ""}`;
					}}
					onSelect={props.onSelect}
					onTry={props.onPlace}
					tryLabel={tryLabel}
				/>
				<PickList
					tone="danger"
					heading="Danger weeks"
					weeks={props.rec.danger}
					empty="No week carries more than half the peak pressure."
					detail={(w) => `Pressure ${index(weekMap.get(w)?.p ?? 0)}${lead(w) ? ` · ${lead(w)}` : ""}`}
					onSelect={props.onSelect}
				/>
				<PickList
					tone="counter"
					heading="Counter-programming"
					weeks={props.rec.counter}
					empty="No big-crowd week that isn't also your crowd."
					detail={(w) => `Buzz ${index(weekMap.get(w)?.b ?? 0)}, pressure ${index(weekMap.get(w)?.p ?? 0)}${lead(w, "buzz") ? ` · crowd for ${lead(w, "buzz")}` : ""}`}
					onSelect={props.onSelect}
					onTry={props.onPlace}
					tryLabel={tryLabel}
				/>
			</div>

			<div className="flex flex-col gap-3 border-t border-dashed border-line px-5 py-6 sm:px-9">
				<h2 className="text-[13px] font-semibold tracking-[0.04em]">Planner notes</h2>
				<div className="flex max-w-3xl flex-col gap-2 text-sm text-pretty text-ink-2">
					{props.story.map((line) => (
						<p key={line}>{line}</p>
					))}
				</div>
				<p className="text-xs text-muted">{props.footnote}</p>
			</div>

			<div className="flex flex-wrap items-center gap-3 px-5 pb-7 sm:px-9">
				{v && (
					<button type="button" onClick={() => props.onPlace(v.best)} className={v.hold ? ghost : primary}>
						Try {fmtDay(v.best)}
					</button>
				)}
				{v && moved && props.original && (
					<button type="button" onClick={() => props.onPlace(props.original as string)} className={ghost}>
						Back to {fmtDay(props.original)}
					</button>
				)}
				{!v && focus && (
					<button type="button" onClick={() => props.onPlace(focus.week)} className={primary}>
						Plan my film for {fmtDay(focus.week)}
					</button>
				)}
			</div>
		</section>
	);
}

function PressureCalendar(props: {
	calendar: WeekScore[];
	rec: Recommendation;
	from: string;
	latest?: string;
	yourWeek?: string;
	focus?: string;
	selected?: string;
	onSelect: (week: string) => void;
}) {
	const { calendar, rec, from, latest } = props;
	const tick = (week: string) => (rec.clear.includes(week) ? "bg-clear" : rec.danger.includes(week) ? "bg-hot" : rec.counter.includes(week) ? "bg-counter" : "bg-transparent");
	const columns = { gridTemplateColumns: `repeat(${calendar.length}, minmax(0, 1fr))` };
	const months: { month: string; label: string; span: number }[] = [];
	for (const w of calendar) {
		const month = fmtDay(w.week, { month: "short" });
		const last = months.at(-1);
		if (last?.month === month) last.span++;
		else months.push({ month, label: month === "Jan" ? `${month} ${w.week.slice(0, 4)}` : month, span: 1 });
	}
	const first = calendar.findIndex((w) => w.week >= from);
	const end = latest ? calendar.findLastIndex((w) => w.week <= latest) : calendar.length - 1;
	// On narrow screens the strip scrolls sideways: start it at the recommended week, not the first week.
	const scroller = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const box = scroller.current;
		const column = box?.querySelector<HTMLElement>("[data-focus]");
		if (!box || !column || box.scrollWidth <= box.clientWidth) return;
		box.scrollLeft += column.getBoundingClientRect().left - box.getBoundingClientRect().left - (box.clientWidth - column.offsetWidth) / 2;
	}, [props.focus]);

	return (
		<section aria-labelledby="calendar" className={`${card} flex flex-col gap-5 px-4 pt-6 pb-5 sm:px-8`}>
			<div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
				<div className="flex max-w-[640px] flex-col gap-1.5">
					<h2 id="calendar" className="font-display text-4xl leading-none tracking-wide">
						Pressure calendar
					</h2>
					<p className="text-sm text-pretty text-ink-2">
						How much of your audience's attention is already spoken for if you open that week, across your first four weeks. 100 is the busiest week you could open in. Pick a week
						to see who is behind it.
					</p>
				</div>
				<ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-2">
					<li className="flex items-center gap-2">
						<span aria-hidden className="size-2.5 rounded-sm bg-hot/65" /> Pressure
					</li>
					<li className="flex items-center gap-2">
						<span aria-hidden className="size-2.5 rounded-sm bg-marquee" /> Recommended week
					</li>
					<li className="flex items-center gap-2">
						<span aria-hidden className="h-1 w-4 rounded-full bg-clear" /> Clear pick
					</li>
					<li className="flex items-center gap-2">
						<span aria-hidden className="h-1 w-4 rounded-full bg-hot" /> Danger
					</li>
					<li className="flex items-center gap-2">
						<span aria-hidden className="h-1 w-4 rounded-full bg-counter" /> Counter-programming
					</li>
					{props.yourWeek && (
						<li className="flex items-center gap-2">
							<span aria-hidden className="h-1 w-4 rounded-full bg-ink" /> Your week
						</li>
					)}
				</ul>
			</div>

			<div ref={scroller} className="overflow-x-auto pb-1">
				<div className="flex flex-col gap-2" style={{ minWidth: calendar.length * 30 }}>
					<div className="grid gap-1" style={columns}>
						{calendar.map((w) => {
							const isFocus = w.week === props.focus;
							const selected = w.week === props.selected;
							const faded = w.week < from || Boolean(latest && w.week > latest);
							const tags = [
								w.season.label,
								isFocus ? "recommended week" : undefined,
								rec.clear.includes(w.week) ? "clear pick" : undefined,
								rec.danger.includes(w.week) ? "danger" : undefined,
								rec.counter.includes(w.week) ? "counter-programming" : undefined,
								w.week === props.yourWeek ? "your week" : undefined,
								faded ? "outside the weeks you could open" : undefined,
							].filter(Boolean);
							const label = `Week of ${fmtDay(w.week)}: pressure ${index(w.p)}, buzz ${index(w.b)}${tags.length ? `, ${tags.join(", ")}` : ""}`;
							return (
								<button
									key={w.week}
									type="button"
									onClick={() => props.onSelect(w.week)}
									aria-pressed={selected}
									data-focus={isFocus || undefined}
									aria-label={label}
									title={label}
									className={`flex flex-col items-center gap-1.5 rounded-lg border py-2 hover:bg-line/50 ${selected ? "border-ink" : "border-transparent"} ${isFocus ? "bg-marquee/10" : ""} ${faded ? "opacity-40" : ""}`}
								>
									<span className={`font-mono text-[11px] leading-none tabular-nums ${isFocus ? "text-marquee" : "text-ink-2"}`}>{index(w.p)}</span>
									<span className="relative flex h-40 w-full items-end justify-center">
										{w.week === props.yourWeek && <span className="absolute inset-x-1 top-0 h-1 rounded-full bg-ink" />}
										<span
											className={`w-[58%] rounded-t-[3px] ${isFocus ? "bg-marquee shadow-[0_0_18px_rgb(242_182_50/0.6)]" : heat(w.p)}`}
											style={{ height: `${Math.max(2, w.p * 100)}%` }}
										/>
									</span>
									<span className={`h-1 w-[58%] rounded-full ${tick(w.week)}`} />
									<span className="font-mono text-xs leading-none">{fmtDay(w.week, { day: "numeric" })}</span>
								</button>
							);
						})}
					</div>
					<div className="grid gap-1" style={columns}>
						{months.map((m) => (
							<span
								key={m.label}
								style={{ gridColumn: `span ${m.span}` }}
								className="border-t border-line pt-1.5 font-mono text-[11px] tracking-[0.08em] whitespace-nowrap text-muted uppercase"
							>
								{m.label}
							</span>
						))}
					</div>
					{first >= 0 && end >= first && (
						<div className="grid gap-1" style={columns}>
							<p style={{ gridColumn: `${first + 1} / ${end + 2}` }} className="border-t-2 border-marquee pt-1.5 font-mono text-xs whitespace-nowrap text-marquee">
								Weeks you could open · {fmtDay(calendar[first]?.week ?? from)} – {fmtDay(calendar[end]?.week ?? from)}
							</p>
						</div>
					)}
				</div>
			</div>
			<p className="text-xs text-muted">Faded weeks are before your earliest week, or too late in the slate to judge a full run.</p>
		</section>
	);
}

/** One opening week, opened up: every rival your first four weeks would run into, and its share of the pressure. */
function WeekDetail(props: {
	week: WeekScore;
	rec: Recommendation;
	byId: Map<string, RivalScore>;
	from: string;
	latest?: string;
	yourWeek?: string;
	hasYou: boolean;
	openRival?: string;
	onToggleRival: (id: string) => void;
	onPlace: (week: string) => void;
	renderRival: (rival: RivalScore) => ReactNode;
}) {
	const { week: w, rec, byId } = props;
	const [all, setAll] = useState(false);
	const felt = w.contributors.filter((c) => byId.has(c.id));
	const rows = all ? felt : felt.slice(0, 8);
	const open = props.openRival && felt.some((c) => c.id === props.openRival) ? byId.get(props.openRival) : undefined;
	const isYou = w.week === props.yourWeek;
	const tooSoon = w.week < props.from;
	const tooLate = Boolean(props.latest && w.week > props.latest);

	return (
		<section id="week-detail" aria-labelledby="week-title" className={`${card} flex flex-col gap-5 px-4 py-6 sm:px-8`}>
			<div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
				<div className="flex min-w-0 flex-col gap-2.5">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
						<h2 id="week-title" className="font-display text-4xl leading-none tracking-wide">
							Week of {fullDay(w.week)}
						</h2>
						{isYou && <Badge tone="you">{props.hasYou ? "Your week" : "Your film"}</Badge>}
						{rec.clear.includes(w.week) && <Badge tone="clear">Clear #{rec.clear.indexOf(w.week) + 1}</Badge>}
						{rec.danger.includes(w.week) && <Badge tone="danger">Danger</Badge>}
						{rec.counter.includes(w.week) && <Badge tone="counter">Counter</Badge>}
						{tooSoon && <Badge tone="muted">Too soon</Badge>}
						{tooLate && <Badge tone="muted">Slate thins out</Badge>}
						{w.confidence < 0.6 && w.buzz > 0 && <Badge tone="muted">{index(w.confidence)}% scored</Badge>}
					</div>
					<p className="text-sm text-ink-2">
						{w.season.label ? `${w.season.label} ×${w.season.factor} · ` : ""}
						Who your first four weeks would run into if you opened here.
					</p>
				</div>
				<div className="flex w-full max-w-[18rem] flex-col gap-1.5">
					<Meter label="Pressure" value={w.p} pressure />
					<Meter label="Buzz" value={w.b} />
				</div>
			</div>

			{felt.length === 0 ? (
				<p className="text-sm text-muted">Nothing on the slate reaches this week.</p>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full min-w-[680px] border-collapse text-left text-sm">
						<thead>
							<tr className="border-b border-line font-mono text-[11px] tracking-[0.1em] text-muted uppercase">
								<th scope="col" className="pr-5 pb-2.5 font-normal">
									Rival
								</th>
								<th scope="col" className="pr-5 pb-2.5 font-normal">
									Opens
								</th>
								<th scope="col" className="pr-5 pb-2.5 font-normal">
									Overlap
								</th>
								<th scope="col" className="pr-5 pb-2.5 font-normal">
									30-day views
								</th>
								<th scope="col" className="pb-2.5 text-right font-normal">
									Share
								</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((c) => {
								const r = byId.get(c.id);
								if (!r) return null;
								return (
									<tr key={c.id} className="border-b border-line/60">
										<td className="py-2.5 pr-5">
											<button
												type="button"
												onClick={() => props.onToggleRival(r.id)}
												aria-expanded={props.openRival === r.id}
												className="text-left font-medium text-ink hover:underline"
											>
												{r.title}
											</button>
											<span className="block text-xs text-muted">
												{r.kind === "game" ? `Game · proxy ${r.proxy?.name ?? "none"}` : r.overlap === undefined ? "Film · no Qloo score" : "Film"}
											</span>
										</td>
										<td className="py-2.5 pr-5 whitespace-nowrap">
											<span className="font-mono text-[13px] text-ink-2">{fmtDay(r.date, { weekday: "short", month: "short", day: "numeric" })}</span>
											<span className="block text-xs text-muted">{runPhrase(c.k)}</span>
										</td>
										<td className="w-[24%] py-2.5 pr-5">
											<Bar value={r.overlap} label={r.overlap === undefined ? "no data" : percentLabel(r.overlap)} fill="bg-marquee" />
										</td>
										<td className="w-[24%] py-2.5 pr-5">
											<Bar value={r.size} label={typeof r.views30d === "number" ? r.views30d.toLocaleString("en-US") : "—"} fill="bg-ink-2" />
										</td>
										<td className="py-2.5 text-right font-mono tabular-nums">{w.pressure > 0 && c.pressure > 0 ? `${Math.round((100 * c.pressure) / w.pressure)}%` : "—"}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}

			<div className="flex flex-wrap items-center gap-x-5 gap-y-2">
				{felt.length > 8 && (
					<button type="button" onClick={() => setAll(!all)} className="min-h-9 text-xs text-muted underline decoration-dotted underline-offset-2 hover:text-ink">
						{all ? "Show the top 8" : `Show all ${felt.length} rivals`}
					</button>
				)}
				{!isYou && !tooSoon && (
					<button type="button" onClick={() => props.onPlace(w.week)} className="min-h-9 rounded-lg border border-line px-3 text-xs text-ink-2 hover:border-marquee">
						{props.hasYou ? "Move your title here" : "Open your film here"}
					</button>
				)}
			</div>
			{open && props.renderRival(open)}
			<p className="text-xs text-muted">
				Share is each rival's part of this week's pressure. Bars: overlap percentile (amber) and attention size (grey). Unscored rivals add buzz, not pressure.
			</p>
		</section>
	);
}

/** One diverging bar: an index from −1 to 1 around a zero hairline. */
function IndexBar({ label, value, left, right }: { label: string; value: number; left?: string; right?: string }) {
	const width = `${Math.min(1, Math.abs(value)) * 50}%`;
	const text = `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
	return (
		<div className="grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-3" title={`${label}: ${text}`}>
			<span className="text-[13px] text-ink-2">{label}</span>
			<span className="relative flex h-5 items-center">
				{left && <span className="absolute left-0 font-mono text-[10px] text-muted uppercase">{left}</span>}
				{right && <span className="absolute right-0 font-mono text-[10px] text-muted uppercase">{right}</span>}
				<span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-line" />
				<span aria-hidden className={`absolute h-2.5 bg-marquee ${value >= 0 ? "left-1/2 rounded-r-[4px]" : "right-1/2 rounded-l-[4px]"}`} style={{ width }} />
			</span>
			<span className="text-right font-mono text-xs text-ink-2 tabular-nums">{text}</span>
		</div>
	);
}

/** Who your comps' fans are: Qloo's age and gender indexes, relative to the general population. */
function Audience({ comps, names }: { comps: string[]; names: string[] }) {
	const [state, setState] = useState<{ profile?: AudienceProfile | null; error?: string }>({});
	const key = comps.join();
	useEffect(() => {
		const controller = new AbortController();
		fetchAudience(key.split(","), controller.signal)
			.then((profile) => setState({ profile }))
			.catch((e: unknown) => !controller.signal.aborted && setState({ error: e instanceof Error ? e.message : String(e) }));
		return () => controller.abort();
	}, [key]);
	if (state.profile === null || state.error) return null;
	const p = state.profile;
	return (
		<section aria-labelledby="audience" className={`${card} flex flex-col gap-4 px-4 py-6 sm:px-8`}>
			<div className="flex flex-col gap-1.5">
				<h2 id="audience" className="font-display text-4xl leading-none tracking-wide">
					Your audience
				</h2>
				<p className="text-sm text-pretty text-ink-2">
					{p ? `${p.summary}. ` : ""}Qloo's age and gender indexes for fans of {names.join(" and ")}, against the general population (0 is average). Unreleased titles have no
					demographics yet, which is why your audience is described by released comps.
				</p>
			</div>
			{!p ? (
				<p className="text-xs text-muted">Loading demographics…</p>
			) : (
				<div className="flex max-w-xl flex-col gap-1.5">
					{AGE_BANDS.map((b) => (
						<IndexBar key={b} label={AGE_LABELS[b]} value={p.age[b]} />
					))}
					<div className="mt-2 border-t border-line pt-3">
						<IndexBar label="Gender" value={p.male} left="Female" right="Male" />
					</div>
				</div>
			)}
		</section>
	);
}

function TopRivals({ rivals, from, onOpen }: { rivals: RivalScore[]; from: string; onOpen: (r: RivalScore) => void }) {
	const top = topThreats(rivals, from, 8);
	return (
		<section aria-labelledby="rivals" className={`${card} px-4 py-6 sm:px-8`}>
			<h2 id="rivals" className="font-display text-4xl leading-none tracking-wide">
				Who competes for your audience
			</h2>
			<p className="mt-2 text-xs text-muted">
				Ranked by overlap² × attention: how much of your audience's attention a rival takes in its opening week. Rivals that open well before your earliest week are left out.
			</p>
			<ol className="mt-3 divide-y divide-line">
				{top.map((r, i) => (
					<li key={r.id}>
						<button
							type="button"
							onClick={() => onOpen(r)}
							className="grid min-h-11 w-full grid-cols-[1.5rem_1fr_auto] items-center gap-3 py-2 text-left hover:bg-house/60 sm:grid-cols-[1.5rem_1fr_6rem_9rem_9rem]"
						>
							<span className="font-mono text-xs text-muted tabular-nums">{i + 1}</span>
							<span className="min-w-0">
								<span className="block truncate text-sm text-ink">{r.title}</span>
								<span className="block text-xs text-muted">{r.kind === "game" ? `Game · proxy ${r.proxy?.name ?? ""}` : "Film · content-based"}</span>
							</span>
							<span className="text-right font-mono text-xs text-ink-2 sm:text-left sm:text-sm">
								{fmtDay(r.date)}
								<span className="block text-muted sm:hidden">{percentLabel(r.overlap ?? 0)}</span>
							</span>
							<span className="hidden sm:block">
								<Bar value={r.overlap} label={percentLabel(r.overlap ?? 0)} fill="bg-marquee" />
							</span>
							<span className="hidden sm:block">
								<Bar value={r.size} label={String(index(r.size))} fill="bg-ink-2" />
							</span>
						</button>
					</li>
				))}
			</ol>
			<p className="mt-2 hidden text-[11px] text-muted sm:block">Bars: overlap percentile (amber) and attention size (grey). Pick a rival to see its week.</p>
		</section>
	);
}

function Method({ result }: { result: PlanResult }) {
	const c = result.coverage;
	const row = (decay: readonly number[]) => decay.map((d) => d.toFixed(2)).join(" · ");
	return (
		<details className={`${card} px-4 py-5 text-sm text-ink-2 sm:px-8`}>
			<summary className="font-display text-3xl tracking-wide text-ink">How this is scored</summary>
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
	const [selected, setSelected] = useState<string>();
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
	const eligible = useMemo(() => eligibleWeeks(calendar, range), [calendar, range]);
	const yourTitle = result.you?.title ?? "Your film";
	const v = whatIf.yourWeek ? verdict(calendar, whatIf.yourWeek, range) : undefined;
	const compNames = setup.comps.map((c) => c.short ?? c.name);
	const story = narrate({
		compNames,
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
	// The week the answer points at: your week when you should hold, else the clearest alternative or pick.
	const focus = v ? (v.hold ? v.week : v.best) : rec.clear[0];
	const shown = (selected ? weekMap.get(selected) : undefined) ?? (focus ? weekMap.get(focus) : undefined) ?? eligible[0] ?? calendar[0];
	const footnote =
		`${result.qlooCalls > 0 ? `Scored just now with ${result.qlooCalls} Qloo call${result.qlooCalls === 1 ? "" : "s"}.` : "Served from the score cache (no new Qloo calls)."} ` +
		`Every title, date and number here comes from the live slate and Qloo. Earliest week: ${fullDay(from)} · slate of ${fmtDay(new Date(result.snapshot.createdAt).toISOString().slice(0, 10))}.`;

	const lead = (week: string, by: "pressure" | "buzz" = "pressure") => {
		const c = [...(weekMap.get(week)?.contributors ?? [])].sort((x, y) => y[by] - x[by])[0];
		const r = c && c[by] > 0 ? byId.get(c.id) : undefined;
		return r && c ? `${r.title} (${runPhrase(c.k)})` : undefined;
	};
	const select = (week: string, scroll = false) => {
		setSelected(week);
		if (scroll) requestAnimationFrame(scrollToDetail);
	};
	const placeYou = (week: string) => {
		setWhatIf((w) => ({ ...w, yourWeek: week }));
		setSelected(week);
	};
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
		setSelected(r.week);
		setOpenRival(r.id);
		requestAnimationFrame(scrollToDetail);
	};

	return (
		<div className="flex flex-col gap-7">
			{result.notice && <p className="rounded-xl border border-marquee/50 bg-marquee/10 px-4 py-2.5 text-sm text-ink">{result.notice}</p>}

			{changes > 0 && (
				<div className="sticky top-2 z-20 flex items-center justify-between gap-3 rounded-xl border border-counter/50 bg-house/95 px-4 py-2 text-sm backdrop-blur">
					<span className="text-ink-2">
						What-if mode: {changes} change{changes === 1 ? "" : "s"} to the real calendar. Scores are recomputed in your browser; no new Qloo calls.
					</span>
					<button
						type="button"
						onClick={() => {
							setWhatIf({ moves: {}, removed: [], yourWeek: result.you?.week });
							setOpenRival(undefined);
						}}
						className="min-h-9 shrink-0 rounded-lg border border-line px-3 text-xs hover:border-marquee"
					>
						Reset
					</button>
				</div>
			)}

			<Hero
				compNames={compNames}
				focus={focus ? weekMap.get(focus) : undefined}
				v={v}
				mine={whatIf.yourWeek ? weekMap.get(whatIf.yourWeek) : undefined}
				best={v ? weekMap.get(v.best) : undefined}
				yourTitle={yourTitle}
				original={result.you?.week}
				hasYou={Boolean(result.you)}
				eligible={eligible.length}
				rec={rec}
				weekMap={weekMap}
				lead={lead}
				story={story}
				footnote={footnote}
				onSelect={(week) => select(week, true)}
				onPlace={placeYou}
			/>

			<PressureCalendar
				calendar={calendar}
				rec={rec}
				from={from}
				latest={range.latest}
				yourWeek={whatIf.yourWeek}
				focus={focus}
				selected={shown?.week}
				onSelect={(week) => select(week)}
			/>

			{shown && (
				<WeekDetail
					key={shown.week}
					week={shown}
					rec={rec}
					byId={byId}
					from={from}
					latest={range.latest}
					yourWeek={whatIf.yourWeek}
					hasYou={Boolean(result.you)}
					openRival={openRival}
					onToggleRival={(id) => setOpenRival(openRival === id ? undefined : id)}
					onPlace={placeYou}
					renderRival={(open) => (
						<RivalDetail
							rival={open}
							comps={result.comps}
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
				/>
			)}

			<TopRivals rivals={rivals} from={from} onOpen={openFor} />

			<Audience comps={result.comps} names={compNames} />

			<Method result={result} />
		</div>
	);
}

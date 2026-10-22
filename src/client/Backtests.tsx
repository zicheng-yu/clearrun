import type { BacktestResult, BacktestSide, PairRank } from "../engine/backtest/run.ts";
import { fmtDay, runPhrase } from "../engine/score/narrate.ts";
import { useJson } from "./api.ts";

const card = "rounded-[18px] border border-line bg-stage";
const index = (x: number) => Math.round(x * 100);
const fullDay = (day: string) => fmtDay(day, { month: "short", day: "numeric", year: "numeric" });

/** How close a rival is for an audience, from its overlap percentile among every scored title on that calendar. */
function level(r: PairRank): string {
	return r.overlap >= 0.75 ? "high" : r.overlap >= 0.4 ? "moderate" : "low";
}

/** "#41 of 59, low": a rank and what it means. */
const rankText = (r: PairRank) => `#${r.rank} of ${r.of} · ${level(r)}`;

/** One audience's view of the other film: before release (content) and today (behavioral), on a 0–100 percentile track. */
function Dumbbell({ side }: { side: BacktestSide }) {
	const pre = side.pre;
	const today = side.today;
	const lo = Math.min(pre?.overlap ?? 0, today?.overlap ?? pre?.overlap ?? 0);
	const hi = Math.max(pre?.overlap ?? 0, today?.overlap ?? pre?.overlap ?? 0);
	return (
		<li className="grid gap-x-5 gap-y-1.5 py-3 sm:grid-cols-[minmax(0,15rem)_1fr]">
			<p className="text-sm text-ink">
				{side.title} fans <span className="text-muted">→</span> {side.rival.title}
			</p>
			<div className="flex flex-col gap-1.5">
				<div
					className="relative h-3"
					role="img"
					aria-label={`${side.rival.title}: percentile ${pre ? index(pre.overlap) : "unscored"} before release, ${today ? index(today.overlap) : "unscored"} today`}
				>
					<div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded bg-line" />
					{pre && today && <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-marquee/40" style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%` }} />}
					{pre && (
						<span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-2 bg-house" style={{ left: `${pre.overlap * 100}%` }} />
					)}
					{today && <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-marquee" style={{ left: `${today.overlap * 100}%` }} />}
				</div>
				<p className="flex flex-wrap gap-x-4 font-mono text-[11px] text-muted">
					<span>
						<span aria-hidden className="mr-1 inline-block size-2 rounded-full border border-ink-2" />
						before release {pre ? `p${index(pre.overlap)} (${rankText(pre)})` : "not scored"}
					</span>
					<span>
						<span aria-hidden className="mr-1 inline-block size-2 rounded-full bg-marquee" />
						today {today ? `p${index(today.overlap)} (${rankText(today)})` : "not scored"}
					</span>
				</p>
			</div>
		</li>
	);
}

/** A templated reading of one direction: every number comes from the stored result. */
function reading(side: BacktestSide): string {
	const { pre, today } = side;
	if (!pre) return `Qloo had no content-based score for ${side.rival.title} against this audience.`;
	const before = `Before release, ${side.rival.title} ranked #${pre.rank} of ${pre.of} for ${side.title}'s audience: ${level(pre)} overlap.`;
	if (!today) return before;
	const change = moved(side);
	const after =
		change >= 10
			? ` In today's graph it ranks #${today.rank}: the audiences moved much closer once both films were out.`
			: change <= -10
				? ` In today's graph it ranks #${today.rank}, further apart than before release.`
				: ` In today's graph it ranks #${today.rank}, about the same.`;
	return before + after;
}

const moved = (s: BacktestSide) => (s.pre && s.today ? s.pre.rank - s.today.rank : 0);

/** One line per case: how close the two audiences were before release, and whether that changed. */
function summary(c: BacktestResult): string {
	const [a, b] = c.sides;
	if (!a?.pre || !b?.pre) return `${c.name}: not enough scores to compare.`;
	const before =
		level(a.pre) === level(b.pre) ? `${level(a.pre)} both ways before release` : `${level(a.pre)} for ${a.title}'s audience and ${level(b.pre)} for ${b.title}'s before release`;
	return `${c.name}: ${before}; ${c.sides.some((s) => moved(s) >= 10) ? "much closer once both films were out" : "little changed after release"}.`;
}

function Side({ side, asOf }: { side: BacktestSide; asOf: string }) {
	const plan = side.plan;
	const others = plan?.main.filter((m) => m.title !== side.rival.title).slice(0, 2) ?? [];
	return (
		<div className="flex flex-col gap-3 rounded-xl border border-line bg-house/60 p-4">
			<h3 className="text-[15px] font-semibold text-ink">{side.title}'s audience</h3>
			<p className="text-sm text-pretty text-ink-2">{reading(side)}</p>
			{side.closest.length > 0 && <p className="text-xs text-muted">Closest before release: {side.closest.map((c) => `${c.title} (${fmtDay(c.date)})`).join(", ")}.</p>}
			{plan && (
				<div className="border-t border-dashed border-line pt-3">
					<p className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">Opening week, as of {fullDay(asOf)}</p>
					<p className="mt-1 text-sm text-ink-2">
						Pressure {index(plan.pressure)} of 100 in the week of {fmtDay(side.week)}, and {side.rival.title}'s share of it was {index(plan.rivalShare)}%.
						{others.length > 0 ? ` Other large shares: ${others.map((m) => `${m.title} ${index(m.share)}% (${runPhrase(m.k)})`).join(", ")}.` : ""}
					</p>
				</div>
			)}
		</div>
	);
}

function Case({ c }: { c: BacktestResult }) {
	return (
		<section aria-labelledby={`bt-${c.id}`} className={`${card} flex flex-col gap-4 px-5 py-6 sm:px-8`}>
			<div className="flex flex-col gap-1.5">
				<p className="font-mono text-[11px] tracking-[0.16em] text-marquee uppercase">
					Opened {fullDay(c.date)} · re-planned as of {fullDay(c.asOf)}
				</p>
				<h2 id={`bt-${c.id}`} className="font-display text-4xl leading-none tracking-wide">
					{c.name}
				</h2>
				<p className="max-w-3xl text-sm text-pretty text-ink-2">{c.question}</p>
			</div>
			<div className="grid gap-3 lg:grid-cols-2">
				{c.sides.map((s) => (
					<Side key={s.title} side={s} asOf={c.asOf} />
				))}
			</div>
			<p className="text-xs text-muted">
				Calendar: {c.coverage.titles} US releases from {fullDay(c.asOf)} to {fullDay(c.windowEnd)} (Wikipedia), {c.coverage.mapped} matched to Qloo; {c.coverage.scored.pre} scored
				before release, {c.coverage.scored.today} in today's graph.
			</p>
		</section>
	);
}

export function Backtests() {
	const { data, error } = useJson<{ cases: BacktestResult[] }>("/api/backtests");
	const cases = data?.cases ?? [];
	const demo = cases.some((c) => c.demo);
	return (
		<div className="flex flex-col gap-7">
			<section aria-labelledby="backtests" className={`${card} overflow-hidden`}>
				<div aria-hidden className="marquee-bulbs h-[18px] border-b border-line bg-marquee/5" />
				<div className="flex flex-col gap-4 px-5 py-8 sm:px-9">
					<p className="font-mono text-xs tracking-[0.16em] text-marquee uppercase">Backtests</p>
					<h1 id="backtests" className="font-display text-[clamp(44px,6vw,88px)] leading-[0.9] tracking-[0.01em] text-marquee">
						What the taste data knew before release
					</h1>
					<p className="max-w-3xl text-pretty text-ink-2">
						Three pairs of films that opened the same day, re-run the way Clear Run would have seen them eight weeks earlier: the calendar from Wikipedia, attention from the
						pageviews each title had before that day, and overlap from Qloo's content-based scores, which compare the films' metadata rather than who watched what. Beside each, the
						same audience in Qloo's behavioral graph today, which includes everything audiences did after release.
					</p>
					{demo && (
						<p className="rounded-xl border border-counter/50 bg-counter/10 px-4 py-2.5 text-sm text-ink">
							Offline demo: these scores are synthetic (made from genre tags), so they say nothing about real audiences, and both readings agree by construction. With a Qloo key,
							the same job runs on Qloo's content-based and behavioral scores.
						</p>
					)}
					{error && <p className="text-sm text-hot">{error}</p>}
					{data && cases.length === 0 && <p className="text-sm text-muted">The backtests haven't been computed yet. They run in small steps after the daily slate refresh.</p>}
				</div>
			</section>

			{cases.length > 0 && (
				<section aria-labelledby="shift" className={`${card} px-5 py-6 sm:px-8`}>
					<h2 id="shift" className="font-display text-4xl leading-none tracking-wide">
						Before release vs. today
					</h2>
					<p className="mt-2 max-w-3xl text-sm text-pretty text-ink-2">
						Where each film ranks for the other's audience, as a percentile among every release Qloo scored on that calendar (100 = the closest). Before release means content-based
						scores; today means Qloo's behavioral graph, which also knows how the release went.
					</p>
					<ul className="mt-2 divide-y divide-line">{cases.flatMap((c) => c.sides.map((s) => <Dumbbell key={`${c.id}-${s.title}`} side={s} />))}</ul>
					<div className="mt-4 border-t border-dashed border-line pt-4">
						<h3 className="text-[13px] font-semibold">What it shows</h3>
						<ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
							{cases.map((c) => (
								<li key={c.id}>{summary(c)}</li>
							))}
						</ul>
						{cases.some((c) => c.sides.some((s) => moved(s) >= 10)) && (
							<p className="mt-3 max-w-3xl text-sm text-pretty text-ink">
								That gap is why Clear Run scores films that aren't out yet from content alone: today's graph already knows how these releases went, so it can't stand in for what
								was knowable at the time.
							</p>
						)}
					</div>
				</section>
			)}

			{cases.map((c) => (
				<Case key={c.id} c={c} />
			))}

			{cases.length > 0 && (
				<details className={`${card} px-4 py-5 text-sm text-ink-2 sm:px-8`}>
					<summary className="font-display text-3xl tracking-wide text-ink">How the backtests work, and what they can't say</summary>
					<ul className="mt-3 list-disc space-y-2 pl-5">
						<li>
							<b className="text-ink">Calendar.</b> Each case's window runs 24 weeks from its planning day, eight weeks before the opening. Wikipedia's "List of American films"
							tables give the titles and dates; the 60 titles with the most Wikipedia pageviews in the 30 days before the planning day are kept, and those pageviews size them.
							Dates are the films' actual release dates, so a title that moved after the planning day shows its final date.
						</li>
						<li>
							<b className="text-ink">Audience.</b> Each film is its own audience: its Qloo entity is the signal, and every other title on its calendar is a rival.
						</li>
						<li>
							<b className="text-ink">Before release</b> uses <code>bias.content_based=1</code>, as the live planner does for films that aren't out yet.{" "}
							<b className="text-ink">Today</b> uses Qloo's behavioral graph, which includes post-release viewing, so it can't be used to judge a decision made before release. The
							gap between the two is the event's effect on the audiences.
						</li>
						<li>
							<b className="text-ink">Pressure</b> is the live planner's index: the content-based overlap of every rival, weighted by attention and by how far into its run each
							rival is, across the film's own first four weeks, shown from 0 to 100 relative to the busiest week in the window.
						</li>
						<li>
							<b className="text-ink">What this can't say.</b> These are taste overlaps, not outcomes: there's no license-clean box-office data in this stack, and no claim here is
							about grosses or about whether a date was right. Tentpoles choose crowded holiday and summer weekends on purpose; Clear Run is built for films that need a week of
							their own.
						</li>
						<li>
							<b className="text-ink">Cost.</b> Computed once by a background job ({cases[0] ? `last run ${fullDay(new Date(cases[0].computedAt).toISOString().slice(0, 10))}` : ""}
							), about 35 Qloo calls in all. Visiting this page makes no Qloo calls.
						</li>
					</ul>
				</details>
			)}
		</div>
	);
}

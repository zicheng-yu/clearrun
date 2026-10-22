/**
 * Backtests (CLEARRUN-PLAN §2.7): two films that opened the same day, each re-planned as Clear Run would have
 * planned it eight weeks earlier. The case's own film is the audience (its Qloo entity is the signal), and every
 * other title on that calendar is a rival.
 *
 * Two readings of the same audience:
 * - "pre": content-based scores (`bias.content_based=1`), which compare the titles' metadata. This is the view
 *   the live planner uses for unreleased films, and it doesn't depend on who watched what after release.
 * - "today": Qloo's behavioral graph as it is now, which includes everything audiences did after release.
 * Only "pre" feeds the pressure calendar, so the plan is the one Clear Run could have made at the time.
 */
import type { BacktestCase, BacktestTitle } from "../../shared/backtests.ts";
import { releaseWeek } from "../../shared/dates.ts";
import { analyze } from "../score/analyze.ts";
import { leadWeek, listWeeks } from "../score/calendar.ts";
import { percentiles, sizes } from "../score/normalize.ts";

export type BacktestMode = "pre" | "today";
export const MODES: BacktestMode[] = ["pre", "today"];

/** Where the pair's other film ranks for this audience, among every rival Qloo scored. */
export interface PairRank {
	overlap: number;
	rank: number;
	of: number;
}

export interface BacktestSide {
	title: string;
	date: string;
	week: string;
	rival: { title: string; date: string };
	pre?: PairRank;
	today?: PairRank;
	/** The rivals this audience overlapped with most before release (content-based). */
	closest: { title: string; date: string; overlap: number }[];
	/** The plan Clear Run would have made on the case's asOf day, from content-based scores. */
	plan?: {
		hold: boolean;
		rank: number;
		of: number;
		/** Pressure at the film's own week, 0–1. */
		pressure: number;
		/** Share of that pressure from the pair's other film. */
		rivalShare: number;
		best: string;
		clear: string[];
		danger: string[];
		/** The rivals behind the film's own week's pressure, strongest first; k is weeks since the rival opened. */
		main: { title: string; k: number; share: number }[];
		threats: { title: string; date: string; overlap: number }[];
	};
}

export interface BacktestResult {
	id: string;
	name: string;
	question: string;
	date: string;
	asOf: string;
	windowEnd: string;
	/** Planning starts four weeks after asOf, like the live planner. */
	from: string;
	sides: BacktestSide[];
	coverage: { titles: number; mapped: number; scored: Record<BacktestMode, number> };
	computedAt: number;
	/** True when the scores come from the offline demo's synthetic model. */
	demo?: boolean;
}

/** One side's scores by mode: Qloo entity ID → affinity (null when Qloo had no score). */
export type SideScores = Partial<Record<BacktestMode, Record<string, number | null>>>;

const rivalKey = (t: BacktestTitle) => `${t.qid}@${t.date}`;

function rankOf(affinities: Map<string, number>, key: string): PairRank | undefined {
	const a = affinities.get(key);
	if (a === undefined) return undefined;
	const pct = percentiles(affinities);
	return { overlap: pct.get(key) ?? 0, rank: [...affinities.values()].filter((x) => x > a).length + 1, of: affinities.size };
}

export function runBacktest(input: {
	c: BacktestCase;
	titles: BacktestTitle[];
	/** Wikidata QID → Qloo entity ID (null when Qloo had no match). */
	qloo: Record<string, string | null>;
	/** Scores per side, in the order of `c.pair`. */
	scores: SideScores[];
	now?: number;
	demo?: boolean;
}): BacktestResult {
	const { c, titles, qloo } = input;
	const weeks = listWeeks(c.asOf, c.windowEnd);
	const from = leadWeek(weeks, c.asOf);
	const size = sizes(new Map(titles.map((t) => [rivalKey(t), t.views])));
	const idOf = (t: BacktestTitle) => qloo[t.qid] ?? undefined;

	const sides = c.pair.flatMap((page, i): BacktestSide[] => {
		const you = titles.find((t) => t.page === page);
		const other = titles.find((t) => t.page === c.pair[1 - i]);
		if (!you || !other) return [];
		const rivals = titles.filter((t) => t.page !== page);
		const byMode = (mode: BacktestMode) => {
			const raw = input.scores[i]?.[mode];
			const out = new Map<string, number>();
			for (const t of rivals) {
				const a = raw && idOf(t) ? raw[idOf(t) as string] : undefined;
				if (typeof a === "number") out.set(rivalKey(t), a);
			}
			return out;
		};
		const pre = byMode("pre");
		const today = byMode("today");
		const overlap = percentiles(pre);
		const side: BacktestSide = {
			title: you.title,
			date: you.date,
			week: releaseWeek(you.date),
			rival: { title: other.title, date: other.date },
			pre: rankOf(pre, rivalKey(other)),
			today: rankOf(today, rivalKey(other)),
			closest: [...pre.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 3)
				.flatMap(([key]) => {
					const t = rivals.find((r) => rivalKey(r) === key);
					return t ? [{ title: t.title, date: t.date, overlap: overlap.get(key) ?? 0 }] : [];
				}),
		};
		if (pre.size === 0) return [side];

		const calendarRivals = rivals.map((t) => ({
			id: rivalKey(t),
			kind: "film" as const,
			title: t.title,
			date: t.date,
			week: releaseWeek(t.date),
			size: size.get(rivalKey(t)) ?? 0.05,
			overlap: overlap.get(rivalKey(t)),
		}));
		const analysis = analyze({ rivals: calendarRivals, windowStart: c.asOf, windowEnd: c.windowEnd, from, yourWeek: side.week, weeks });
		const mine = analysis.calendar.find((w) => w.week === side.week);
		const v = analysis.verdict;
		if (!mine || !v) return [side];
		const titleOf = new Map(calendarRivals.map((r) => [r.id, r.title]));
		const felt = mine.contributors.filter((x) => x.pressure > 0);
		side.plan = {
			hold: v.hold,
			rank: v.rank,
			of: v.of,
			pressure: Math.round(mine.p * 1000) / 1000,
			rivalShare: mine.pressure > 0 ? Math.round(((felt.find((x) => x.id === rivalKey(other))?.pressure ?? 0) / mine.pressure) * 1000) / 1000 : 0,
			best: v.best,
			clear: analysis.recommendation.clear,
			danger: analysis.recommendation.danger,
			main: felt.slice(0, 3).map((x) => ({ title: titleOf.get(x.id) ?? x.id, k: x.k, share: Math.round((x.pressure / mine.pressure) * 1000) / 1000 })),
			threats: analysis.threats.map((r) => ({ title: r.title, date: r.date, overlap: r.overlap ?? 0 })),
		};
		return [side];
	});

	const mapped = titles.filter((t) => idOf(t)).length;
	const scored = (mode: BacktestMode) => Math.max(0, ...input.scores.map((s) => Object.values(s[mode] ?? {}).filter((x) => typeof x === "number").length));
	return {
		id: c.id,
		name: c.name,
		question: c.question,
		date: c.date,
		asOf: c.asOf,
		windowEnd: c.windowEnd,
		from,
		sides,
		coverage: { titles: titles.length, mapped, scored: { pre: scored("pre"), today: scored("today") } },
		computedAt: input.now ?? Date.now(),
		...(input.demo ? { demo: true } : {}),
	};
}

/**
 * The Audience Pressure calendar (CLEARRUN-PLAN §2.4). Pure functions shared by the Worker and the
 * browser, so what-ifs recompute instantly with no new Qloo calls. Decay and seasonality are labeled
 * assumptions in the UI.
 */
import { addDays, releaseWeek } from "../../shared/dates.ts";

export type RivalKind = "film" | "game";

export interface CalendarRival {
	id: string;
	kind: RivalKind;
	/** Friday of the release week it opens into. */
	week: string;
	/** Attention size, 0–1. */
	size: number;
	/** Overlap with your audience, 0–1; undefined when Qloo can't score it. */
	overlap?: number;
}

/** Share of a rival's opening-week pull felt k weeks after it opens, for k = −1 (the week before) through 5. */
export const DECAY: Record<RivalKind, readonly number[]> = {
	film: [0.25, 1, 0.55, 0.3, 0.17, 0.09, 0.05],
	game: [0.4, 1, 0.8, 0.6, 0.45, 0.3, 0.2],
};

export function decay(kind: RivalKind, k: number): number {
	return DECAY[kind][k + 1] ?? 0;
}

/**
 * Weights of your own film's first four weeks. A week's pressure is what your film would face across
 * that run, so opening two weeks before a big rival counts against you too.
 */
export const YOUR_RUN: readonly number[] = DECAY.film.slice(1, 5);

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
export const weeksBetween = (from: string, to: string) => Math.round((dayMs(to) - dayMs(from)) / WEEK_MS);

/** The first listed week at least four weeks after `today`: the earliest a release can realistically be planned. */
export function leadWeek(weeks: string[], today: string): string {
	return weeks.find((w) => w >= addDays(today, 28)) ?? weeks[0] ?? today;
}

/** Every release-week Friday from the week holding `start` through the week holding `end`. */
export function listWeeks(start: string, end: string): string[] {
	const out: string[] = [];
	const last = releaseWeek(end);
	for (let week = releaseWeek(start); week <= last; week = addDays(week, 7)) out.push(week);
	return out;
}

export interface Season {
	factor: number;
	label?: string;
}

const iso = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);

/** The nth (1-based) weekday (0 = Sunday) of a month, or the last one when n is −1. Months are 0-based. */
export function nthWeekday(year: number, month: number, weekday: number, n: number): string {
	if (n > 0) {
		const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
		return iso(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
	}
	const last = new Date(Date.UTC(year, month + 1, 0));
	return iso(year, month, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7));
}

const holidays = new Map<number, Map<string, Season>>();

/** US holiday release weeks for one year, keyed by their Friday (computed once per year). */
function holidayWeeks(year: number): Map<string, Season> {
	const known = holidays.get(year);
	if (known) return known;
	const weeks = new Map<string, Season>();
	holidays.set(year, weeks);
	const add = (day: string, factor: number, label: string) => weeks.set(releaseWeek(day), { factor, label });
	add(nthWeekday(year, 0, 1, 3), 1.15, "MLK weekend");
	add(nthWeekday(year, 1, 1, 3), 1.15, "Presidents' Day weekend");
	add(nthWeekday(year, 4, 1, -1), 1.15, "Memorial Day weekend");
	add(iso(year, 6, 4), 1.15, "Fourth of July");
	add(nthWeekday(year, 8, 1, 1), 1.15, "Labor Day weekend");
	add(nthWeekday(year, 10, 4, 4), 1.3, "Thanksgiving");
	return weeks;
}

/** Moviegoing season multiplier for a release week (an assumption, shown in the UI). */
export function season(week: string): Season {
	const year = Number(week.slice(0, 4));
	const holiday = holidayWeeks(year).get(week);
	if (holiday) return holiday;
	// Christmas–New Year: weeks that overlap the school holidays, about Dec 20 – Jan 2.
	if (addDays(week, 6) >= `${year}-12-20` || week <= `${year}-01-02`) return { factor: 1.3, label: "Christmas–New Year" };
	const monthDay = week.slice(5);
	if (monthDay >= "03-08" && monthDay <= "03-28") return { factor: 1.15, label: "Spring break" };
	return { factor: 1 };
}

export interface Contributor {
	id: string;
	/** Weeks since the rival opened, at your opening week (−2 = it opens two weeks after you). */
	k: number;
	pressure: number;
	buzz: number;
}

export interface WeekScore {
	week: string;
	/** Run-weighted Σ overlap² · size · decay over scored rivals: your audience's attention already spoken for. */
	pressure: number;
	/** Run-weighted Σ size · decay over all rivals: general moviegoing attention. */
	buzz: number;
	/** Pressure and buzz divided by their maxima over the weeks you could open, capped at 1. */
	p: number;
	b: number;
	season: Season;
	/** Season · (1 − p). Higher is better for you. */
	clear: number;
	/** b · (1 − p): a big crowd that isn't your crowd. */
	counter: number;
	/** Share of this week's buzz that Qloo could score, 0–1. */
	confidence: number;
	/** Rivals felt across your run, strongest pressure first. */
	contributors: Contributor[];
}

/**
 * Scores every week as an opening week. `from` (the earliest week you could open) sets the scale, so
 * a crowded week you couldn't use anyway doesn't flatten the rest.
 */
export function planCalendar(rivals: CalendarRival[], weeks: string[], options: { from?: string } = {}): WeekScore[] {
	const runTotal = YOUR_RUN.reduce((a, b) => a + b, 0);
	// Dates are parsed once up front: this loop runs weeks × run weeks × rivals times (about 10,000 for a slate).
	const starts = rivals.map((r) => dayMs(r.week));
	const rows = weeks.map((week) => {
		let pressure = 0;
		let buzz = 0;
		let scored = 0;
		const byRival = new Map<string, Contributor>();
		const weekStart = dayMs(week);
		YOUR_RUN.forEach((weight, j) => {
			const at = weekStart + j * WEEK_MS;
			rivals.forEach((rival, i) => {
				const start = starts[i] as number;
				const d = decay(rival.kind, Math.round((at - start) / WEEK_MS));
				if (d === 0) return;
				const b = (weight * rival.size * d) / runTotal;
				const p = rival.overlap === undefined ? 0 : rival.overlap ** 2 * b;
				buzz += b;
				pressure += p;
				if (rival.overlap !== undefined) scored += b;
				const c = byRival.get(rival.id) ?? { id: rival.id, k: Math.round((weekStart - start) / WEEK_MS), pressure: 0, buzz: 0 };
				c.pressure += p;
				c.buzz += b;
				byRival.set(rival.id, c);
			});
		});
		const contributors = [...byRival.values()].sort((x, y) => y.pressure - x.pressure || y.buzz - x.buzz);
		return { week, pressure, buzz, season: season(week), confidence: buzz > 0 ? scored / buzz : 1, contributors };
	});
	const scale = options.from && rows.some((r) => r.week >= (options.from as string)) ? rows.filter((r) => r.week >= (options.from as string)) : rows;
	const maxP = Math.max(0, ...scale.map((r) => r.pressure));
	const maxB = Math.max(0, ...scale.map((r) => r.buzz));
	return rows.map((r) => {
		const p = maxP > 0 ? Math.min(1, r.pressure / maxP) : 0;
		const b = maxB > 0 ? Math.min(1, r.buzz / maxB) : 0;
		return { ...r, p, b, clear: r.season.factor * (1 - p), counter: b * (1 - p) };
	});
}

/** Top weeks by score, at least `gap` weeks apart so the options are distinct. Ties keep calendar order. */
function topSpaced(weeks: WeekScore[], score: (w: WeekScore) => number, count: number, gap = 2): WeekScore[] {
	const picked: WeekScore[] = [];
	for (const w of [...weeks].sort((a, b) => score(b) - score(a))) {
		if (picked.length >= count) break;
		if (picked.every((p) => Math.abs(weeksBetween(p.week, w.week)) >= gap)) picked.push(w);
	}
	return picked;
}

export interface Window {
	/** Earliest week you could open. */
	earliest?: string;
	/** Last week to recommend: later weeks lack a full run inside the slate. */
	latest?: string;
}

export const eligibleWeeks = (calendar: WeekScore[], window: Window = {}) =>
	calendar.filter((w) => (!window.earliest || w.week >= window.earliest) && (!window.latest || w.week <= window.latest));

/** The last week whose whole run (your first four weeks) falls inside the listed weeks. */
export const lastFullRun = (weeks: string[]) => weeks[Math.max(0, weeks.length - YOUR_RUN.length)];

export interface Recommendation {
	/** Clearest weeks, best first. */
	clear: string[];
	/** Highest-pressure weeks, worst first. */
	danger: string[];
	/** Big-crowd weeks that aren't your crowd. */
	counter: string[];
}

export interface PickOptions extends Window {
	count?: number;
	/** Rival IDs whose opening weeks are never clear picks: your biggest rivals, met head to head. */
	avoid?: string[];
}

const headToHead = (w: WeekScore, avoid: Set<string>) => w.contributors.some((c) => c.k === 0 && avoid.has(c.id));

/**
 * Clear weeks score at least half the best Clear, are mostly scorable (confidence ≥ 0.5) and don't open
 * against a rival in `avoid`; danger weeks carry at least half the peak pressure; counter-programming
 * weeks have a big crowd (b ≥ 0.6) that is mostly not yours (p below the danger line and below 0.8 · b).
 */
export function recommend(calendar: WeekScore[], options: PickOptions = {}): Recommendation {
	const count = options.count ?? 3;
	const avoid = new Set(options.avoid ?? []);
	const eligible = eligibleWeeks(calendar, options);
	const confident = eligible.filter((w) => w.confidence >= 0.5 && !headToHead(w, avoid));
	const bestClear = Math.max(0, ...confident.map((w) => w.clear));
	const pick = (weeks: WeekScore[], score: (w: WeekScore) => number, n = count) => topSpaced(weeks, score, n).map((w) => w.week);
	return {
		clear: pick(
			confident.filter((w) => w.clear > 0 && w.clear >= 0.5 * bestClear),
			(w) => w.clear,
		),
		danger: pick(
			eligible.filter((w) => w.p >= 0.5),
			(w) => w.p,
		),
		counter: pick(
			eligible.filter((w) => w.b >= 0.6 && w.p < 0.5 && w.p <= 0.8 * w.b),
			(w) => w.counter,
			Math.min(count, 2),
		),
	};
}

export interface Verdict {
	week: string;
	/** Rank of your week by Clear among the weeks you could open (1 = clearest). */
	rank: number;
	of: number;
	/** Hold when your week is within 10% of the clearest alternative. */
	hold: boolean;
	/** The clearest week other than yours. */
	best: string;
}

export function verdict(calendar: WeekScore[], yourWeek: string, options: PickOptions = {}): Verdict | undefined {
	const avoid = new Set(options.avoid ?? []);
	const weeks = calendar.filter((w) => w.week === yourWeek || eligibleWeeks([w], options).length > 0);
	const mine = weeks.find((w) => w.week === yourWeek);
	const ranked = [...weeks].sort((a, b) => b.clear - a.clear);
	const best = ranked.find((w) => w.week !== yourWeek && w.confidence >= 0.5 && !headToHead(w, avoid)) ?? ranked.find((w) => w.week !== yourWeek);
	if (!mine || !best) return undefined;
	return { week: yourWeek, rank: ranked.indexOf(mine) + 1, of: ranked.length, hold: mine.clear >= 0.9 * best.clear, best: best.week };
}

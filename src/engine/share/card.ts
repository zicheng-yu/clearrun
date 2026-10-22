/**
 * Share cards: what a link preview shows for a plan or for the backtests, and the page title and description that go with it.
 * A card holds only data the server trusts: slate titles from Wikipedia, comp names from Qloo, and computed numbers. Text a
 * visitor typed (an agent question, a watch label) never reaches a card. svg.ts draws the card.
 */
import type { BacktestResult } from "../backtest/run.ts";
import type { Analysis } from "../score/analyze.ts";
import { eligibleWeeks } from "../score/calendar.ts";
import { fmtDay, runPhrase } from "../score/narrate.ts";

/** Bump when a card's layout or contents change, so cached images are drawn again. */
export const CARD_VERSION = 2;

export interface CardStat {
	label: string;
	value: number;
	note: string;
	tone: "hot" | "marquee" | "clear" | "ink";
}

export interface PlanCard {
	kind: "plan";
	v: number;
	/** What the card is about: a featured scenario's name, "Release agent", "Watched plan" or "Shared plan". */
	context: string;
	/** The dated title being planned, if any. */
	title?: string;
	comps: string[];
	headline: string;
	tone: "move" | "hold" | "pick" | "none";
	sub: string;
	stats: CardStat[];
	/**
	 * Every week on the calendar: pressure 0–1 in steps of 0.05, and whether it's your week, the recommended week, or one you can't
	 * open. A card is drawn once per distinct content, so it carries no date and rounds its bars: the daily slate refresh shifts
	 * pressure a little, and a card that looks the same shouldn't be drawn again.
	 */
	strip: { week: string; p: number; you?: boolean; focus?: boolean; faded?: boolean }[];
	demo?: boolean;
}

export interface BacktestCard {
	kind: "backtests";
	v: number;
	rows: { audience: string; rival: string; pre: Rank; today?: Rank }[];
	demo?: boolean;
}

export interface HomeCard {
	kind: "home";
	v: number;
}

export type Card = PlanCard | BacktestCard | HomeCard;

interface Rank {
	rank: number;
	of: number;
	overlap: number;
}

export interface CardMeta {
	title: string;
	description: string;
	/** Alt text for the card image. */
	alt: string;
}

const index = (x: number) => Math.round(x * 100);
const list = (items: string[]) => (items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

export const HOME_META: CardMeta = {
	title: "Clear Run · Find the week your audience is free",
	description:
		"A release-planning agent on Qloo's taste graph. It scores every rival on the live US release calendar against your audience, finds the weeks your audience is free, and re-plans when rivals move their dates.",
	alt: "Clear Run: find the week your audience is free. A row of weekly bars with one clear week lit.",
};

function suffix(slate: string, demo?: boolean): string {
	return demo
		? " Offline demo: a frozen calendar and synthetic scores, not Qloo data."
		: ` Live US release calendar of ${slate}, scored with Qloo's taste data. Pressure is a relative index, not a box-office forecast.`;
}

/** The card and page text for a plan: the verdict for a dated title (or a watched week), else the clearest week. */
export function planShare<R extends { id: string; title: string }>(input: {
	analysis: Analysis<R>;
	rivals: R[];
	context: string;
	comps: string[];
	/** The dated title, when the plan is for one (its week is the analysis's verdict week). */
	title?: string;
	slateAt: number;
	demo?: boolean;
}): { card: PlanCard; meta: CardMeta } {
	const { analysis } = input;
	const weeks = new Map(analysis.calendar.map((w) => [w.week, w]));
	const titles = new Map(input.rivals.map((r) => [r.id, r.title]));
	const lead = (week: string) => {
		const c = weeks.get(week)?.contributors.find((x) => x.pressure > 0);
		const title = c && titles.get(c.id);
		return c && title ? `${title} (${runPhrase(c.k)})` : undefined;
	};
	const p = (week?: string) => index(weeks.get(week ?? "")?.p ?? 0);
	const season = (week?: string) => weeks.get(week ?? "")?.season.label;
	const v = analysis.verdict;
	const rec = analysis.recommendation;
	const focus = v ? (v.hold ? v.week : v.best) : rec.clear[0];
	const audience = `fans of ${list(input.comps)}`;
	const slate = fmtDay(new Date(input.slateAt).toISOString().slice(0, 10));
	const subject = input.title ?? "your film";

	let card: Omit<PlanCard, "kind" | "v" | "context" | "title" | "comps" | "strip">;
	let meta: Omit<CardMeta, "alt">;
	if (v) {
		const main = lead(v.week);
		card = {
			headline: v.hold ? `Hold ${fmtDay(v.week)}` : `Move to ${fmtDay(v.best)}?`,
			tone: v.hold ? "hold" : "move",
			sub: `${v.hold ? "Your week" : `Week of ${fmtDay(v.week)}`} ranks #${v.rank} of ${v.of} by clear score${season(v.week) ? ` · ${season(v.week)}` : ""}`,
			stats: [
				{ label: "Pressure, your week", value: p(v.week), note: main ? `Mostly ${main}` : `Week of ${fmtDay(v.week)}`, tone: v.hold ? "clear" : "hot" },
				{ label: `Pressure, ${fmtDay(v.best)}`, value: p(v.best), note: "The clearest week other than yours", tone: "marquee" },
			],
		};
		meta = {
			title: v.hold ? `Hold ${subject} on ${fmtDay(v.week)}` : `Move ${subject} to ${fmtDay(v.best)}?`,
			description: v.hold
				? `For ${audience}, the week of ${fmtDay(v.week)} rates pressure ${p(v.week)} of 100 and ranks #${v.rank} of ${v.of} by clear score: hold the date.`
				: `For ${audience}, the week of ${fmtDay(v.week)} rates pressure ${p(v.week)} of 100${main ? `, mostly from ${main}` : ""}. The clearest alternative, ${fmtDay(v.best)}, rates ${p(v.best)}.`,
		};
	} else if (focus) {
		const danger = rec.danger[0];
		const near = lead(focus);
		const eligible = eligibleWeeks(analysis.calendar, analysis.range).length;
		card = {
			headline: `Week of ${fmtDay(focus)}`,
			tone: "pick",
			sub: `The clearest of ${eligible} weeks you could open${season(focus) ? ` · ${season(focus)}` : ""}`,
			stats: [
				{ label: `Pressure, ${fmtDay(focus)}`, value: p(focus), note: near ? `Nearest pull: ${near}` : "Little of this audience is spoken for", tone: "marquee" },
				...(danger
					? [{ label: `Pressure, ${fmtDay(danger)}`, value: p(danger), note: lead(danger) ? `The busiest week, led by ${lead(danger)}` : "The busiest week", tone: "hot" as const }]
					: []),
			],
		};
		meta = {
			title: `The clearest week for ${audience}: ${fmtDay(focus)}`,
			description: `For ${audience}, the clearest week to open is ${fmtDay(focus)} (pressure ${p(focus)} of 100)${danger ? `; the busiest is ${fmtDay(danger)} (pressure ${p(danger)})` : ""}.`,
		};
	} else {
		card = { headline: "No clear run", tone: "none", sub: "No week in this window is clearly open for this audience.", stats: [] };
		meta = { title: `No clear run for ${audience}`, description: `No week on the live calendar is clearly open for ${audience}.` };
	}

	const { earliest, latest } = analysis.range;
	return {
		card: {
			kind: "plan",
			v: CARD_VERSION,
			context: input.context,
			...(input.title ? { title: input.title } : {}),
			comps: input.comps,
			...card,
			strip: analysis.calendar.map((w) => ({
				week: w.week,
				p: Math.round(w.p * 20) / 20,
				...(v && w.week === v.week ? { you: true } : {}),
				...(w.week === focus ? { focus: true } : {}),
				...((earliest && w.week < earliest) || (latest && w.week > latest) ? { faded: true } : {}),
			})),
			...(input.demo ? { demo: true } : {}),
		},
		meta: {
			title: `${meta.title} · ${input.context} · Clear Run`,
			description: meta.description + suffix(slate, input.demo),
			alt: `Clear Run card for ${input.title ? `${input.title}, ` : ""}${audience}: "${card.headline}", with pressure by opening week across the calendar.`,
		},
	};
}

/** The card and page text for the backtests page: each film's rank for the other's audience, before release and today. */
export function backtestShare(cases: BacktestResult[]): { card: BacktestCard; meta: CardMeta } {
	const rows = cases.flatMap((c) => c.sides.flatMap((s) => (s.pre ? [{ audience: s.title, rival: s.rival.title, pre: s.pre, ...(s.today ? { today: s.today } : {}) }] : [])));
	const demo = cases.some((c) => c.demo);
	const first = rows[0];
	return {
		card: { kind: "backtests", v: CARD_VERSION, rows, ...(demo ? { demo: true } : {}) },
		meta: {
			title: "Backtests: what the taste data knew before release · Clear Run",
			description:
				(first
					? `For ${first.audience} fans, ${first.rival} ranked #${first.pre.rank} of ${first.pre.of} rivals before release${first.today ? ` and ranks #${first.today.rank} in Qloo's graph today` : ""}. `
					: "") +
				`${cases.length} pairs of same-day openings, re-planned eight weeks out with content-based scores and compared with today's graph.` +
				(demo ? " Offline demo: synthetic scores." : ""),
			alt: "Clear Run backtests: each film's rank for the other's audience, before release and in Qloo's graph today.",
		},
	};
}

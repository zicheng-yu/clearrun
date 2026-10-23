/** Templated narration for the scripted planner. Every name, date and number comes from the inputs. */
import { addDays } from "../../shared/dates.ts";
import { eligibleWeeks, type Recommendation, type Verdict, type WeekScore, type Window } from "./calendar.ts";

export interface NarrateRival {
	id: string;
	title: string;
	date: string;
	week: string;
	size: number;
	overlap?: number;
}

export interface NarrateInput {
	compNames: string[];
	rivals: NarrateRival[];
	calendar: WeekScore[];
	recommendation: Recommendation;
	window?: Window;
	you?: { title: string; date: string; week: string };
	verdict?: Verdict;
	scored: number;
	total: number;
}

export const fmtDay = (day: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
	new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...options });

export const percentLabel = (x: number) => `p${Math.round(x * 100)}`;

/** How much of your audience's attention a rival takes at its peak: overlap² · size. */
export const threat = (r: { size: number; overlap?: number }) => (r.overlap === undefined ? 0 : r.overlap ** 2 * r.size);

const join = (items: string[]) => (items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** Where a rival is relative to your opening week: "opening that week", "opening 2 weeks after", ... */
export function runPhrase(k: number): string {
	if (k === 0) return "opening that week";
	if (k === -1) return "opening the week after";
	if (k < -1) return `opening ${-k} weeks after`;
	return `${k === 1 ? "one week" : `${k} weeks`} into its run`;
}

/** Rivals that still matter in the window: those opening no more than two weeks before its first week. */
export const inPlay = <R extends { week: string }>(rivals: R[], earliest?: string) => (earliest ? rivals.filter((r) => r.week >= addDays(earliest, -14)) : rivals);

/** Your biggest rivals in play, by threat. Clear picks avoid opening head to head with them. */
export const topThreats = <R extends { week: string; size: number; overlap?: number }>(rivals: R[], earliest?: string, n = 5): R[] =>
	inPlay(rivals, earliest)
		.filter((r) => r.overlap !== undefined)
		.sort((a, b) => threat(b) - threat(a))
		.slice(0, n);

export function narrate(input: NarrateInput): string[] {
	const rivals = new Map(input.rivals.map((r) => [r.id, r]));
	const weeks = new Map(input.calendar.map((w) => [w.week, w]));
	const label = (week: string) => {
		const s = weeks.get(week)?.season.label;
		return s ? `${fmtDay(week)} (${s})` : fmtDay(week);
	};
	const lead = (week: string, by: "pressure" | "buzz" = "pressure") => {
		const w = weeks.get(week);
		const c = w && [...w.contributors].sort((x, y) => y[by] - x[by])[0];
		const title = c && rivals.get(c.id)?.title;
		return c && title ? (by === "pressure" && c.k !== 0 ? `${title}, ${runPhrase(c.k)}` : title) : undefined;
	};

	const out: string[] = [];
	const top = topThreats(input.rivals, input.window?.earliest, 3);
	out.push(
		`Fans of ${join(input.compNames)}: Qloo scored ${input.scored} of ${input.total} upcoming releases against this audience.` +
			(top.length ? ` The biggest claims on their attention: ${join(top.map((r) => `${r.title} (${fmtDay(r.date)}, overlap ${percentLabel(r.overlap ?? 0)})`))}.` : ""),
	);

	if (input.you && input.verdict) {
		const v = input.verdict;
		const mine = weeks.get(input.you.week);
		const best = weeks.get(v.best);
		const main = mine?.contributors[0];
		const mainRival = main && main.pressure > 0 ? rivals.get(main.id) : undefined;
		const cause = mainRival && main ? `, mostly from ${mainRival.title} (${runPhrase(main.k)})` : "";
		if (v.hold) {
			out.push(`Hold ${fmtDay(input.you.date)}. Its week ranks #${v.rank} of ${v.of} by clear score${cause}.`);
		} else if (mine && best) {
			const byPressure = [...eligibleWeeks(input.calendar, input.window)].sort((a, b) => b.p - a.p);
			const pressureRank = byPressure.findIndex((w) => w.week === mine.week) + 1;
			const where = pressureRank > 0 && pressureRank <= 5 ? `the #${pressureRank} pressure week for this audience` : `#${v.rank} of ${v.of} by clear score`;
			const relief = mine.p > 0.05 ? `, with ${Math.round((best.p / mine.p) * 100)}% of the pressure` : "";
			out.push(`Consider moving ${input.you.title}. ${fmtDay(input.you.week)} is ${where}${cause}. The clearest alternative is ${label(v.best)}${relief}.`);
		}
	}

	if (input.recommendation.clear.length) out.push(`Clearest weeks: ${join(input.recommendation.clear.map(label))}.`);
	// The last week a full run fits is where the calendar is thinnest: releases that far out are still being dated.
	const point = input.verdict ? (input.verdict.hold ? undefined : input.verdict.best) : input.recommendation.clear[0];
	if (point && point === input.window?.latest) {
		out.push(`${fmtDay(point)} is the last week whose first four weeks fit on the calendar, and releases that far out are still being dated: rivals may yet land there.`);
	}
	if (input.recommendation.danger.length) {
		out.push(
			`Most crowded for this audience: ${join(
				input.recommendation.danger.map((w) => {
					const who = lead(w);
					return who ? `${fmtDay(w)} (led by ${who})` : fmtDay(w);
				}),
			)}.`,
		);
	}
	if (input.recommendation.counter.length) {
		out.push(
			`Counter-programming: ${join(
				input.recommendation.counter.map((w) => {
					const who = lead(w, "buzz");
					return who ? `${fmtDay(w)} (a big crowd for ${who}, mostly not yours)` : fmtDay(w);
				}),
			)}.`,
		);
	}
	return out;
}

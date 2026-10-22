/**
 * One plan analysis, shared by the page and the agent so both always reach the same verdict: the weekly
 * calendar, the picks (with the head-to-head guard and the full-run cutoff) and your verdict.
 */
import { lastFullRun, listWeeks, planCalendar, recommend, verdict, type CalendarRival, type PickOptions, type Recommendation, type Verdict, type WeekScore } from "./calendar.ts";
import { topThreats } from "./narrate.ts";

export interface Analysis<R> {
	weeks: string[];
	calendar: WeekScore[];
	range: PickOptions;
	recommendation: Recommendation;
	verdict?: Verdict;
	/** Your five biggest rivals in play, by threat. */
	threats: R[];
}

export function analyze<R extends CalendarRival>(input: { rivals: R[]; windowStart: string; windowEnd: string; from: string; yourWeek?: string; weeks?: string[] }): Analysis<R> {
	const weeks = input.weeks ?? listWeeks(input.windowStart, input.windowEnd);
	const calendar = planCalendar(input.rivals, weeks, { from: input.from });
	const threats = topThreats(input.rivals, input.from);
	const range: PickOptions = { earliest: input.from, latest: lastFullRun(weeks), avoid: threats.map((r) => r.id) };
	return {
		weeks,
		calendar,
		range,
		recommendation: recommend(calendar, range),
		verdict: input.yourWeek ? verdict(calendar, input.yourWeek, range) : undefined,
		threats,
	};
}

/**
 * Compact tool results for the agent. The model sees only what these return, so every title, date and
 * number in its answer can be traced to them. Dates are written "Dec 18" (the slate spans under a year).
 */
import type { Analysis } from "../score/analyze.ts";
import type { Contributor, WeekScore } from "../score/calendar.ts";
import { fmtDay, percentLabel, runPhrase } from "../score/narrate.ts";

export interface BriefRival {
	id: string;
	title: string;
	kind: "film" | "game";
	date: string;
	week: string;
	size: number;
	overlap?: number;
	proxy?: { name: string };
}

const index = (x: number) => Math.round(x * 100);

/** Said of the last week a full run fits: the far end of the calendar is the thinnest. */
const FAR_EDGE = "The last week whose first four weeks fit on the calendar. Releases that far out are still being dated, so rivals may yet land here.";

function lead(w: WeekScore | undefined, rivals: Map<string, BriefRival>, by: "pressure" | "buzz" = "pressure", n = 2): string[] {
	if (!w) return [];
	return [...w.contributors]
		.sort((x: Contributor, y: Contributor) => y[by] - x[by])
		.filter((c) => c[by] > 0)
		.slice(0, n)
		.flatMap((c) => {
			const r = rivals.get(c.id);
			return r ? [`${r.title} (${runPhrase(c.k)})`] : [];
		});
}

export function rivalBrief(r: BriefRival) {
	return {
		title: r.title,
		kind: r.kind,
		opens: fmtDay(r.date),
		overlap: r.overlap === undefined ? "not scored" : percentLabel(r.overlap),
		size: index(r.size),
		...(r.proxy ? { scoredAs: `${r.proxy.name} (proxy)` } : {}),
	};
}

export interface PlanBriefInput {
	compNames: string[];
	rivals: BriefRival[];
	analysis: Analysis<BriefRival>;
	window: { start: string; end: string };
	coverage: { films: number; scored: number; games: number; gamesScored: number };
	you?: { title: string; date: string; week: string };
	audience?: string;
}

/** What plan_release returns: the verdict, the picks with their reasons, top rivals and caveats. */
export function planBrief(input: PlanBriefInput) {
	const { analysis } = input;
	const rivals = new Map(input.rivals.map((r) => [r.id, r]));
	const weeks = new Map(analysis.calendar.map((w) => [w.week, w]));
	const week = (w: string, extra: Record<string, unknown> = {}) => {
		const s = weeks.get(w);
		return {
			week: fmtDay(w),
			pressure: index(s?.p ?? 0),
			buzz: index(s?.b ?? 0),
			...(s?.season.label ? { season: s.season.label } : {}),
			...(w === analysis.range.latest ? { caveat: FAR_EDGE } : {}),
			...extra,
		};
	};
	const v = analysis.verdict;
	const mine = input.you ? weeks.get(input.you.week) : undefined;
	return {
		audience: `fans of ${input.compNames.join(", ")}`,
		...(input.audience ? { audienceProfile: input.audience } : {}),
		slate: `${fmtDay(input.window.start, { month: "short", day: "numeric", year: "numeric" })} to ${fmtDay(input.window.end, { month: "short", day: "numeric", year: "numeric" })}: ${input.coverage.films} films (${input.coverage.scored} scored by Qloo) and ${input.coverage.games} games (${input.coverage.gamesScored} scored through proxies)`,
		earliestWeek: fmtDay(analysis.range.earliest ?? analysis.weeks[0] ?? input.window.start),
		...(input.you && v && mine
			? {
					yourTitle: {
						title: input.you.title,
						opens: fmtDay(input.you.date),
						verdict: v.hold ? "hold" : "consider moving",
						rank: `${v.rank} of ${v.of} weeks by clear score`,
						pressure: index(mine.p),
						mainPressure: lead(mine, rivals),
						bestAlternative: week(v.best, { mainPressure: lead(weeks.get(v.best), rivals, "pressure", 1) }),
					},
				}
			: {}),
		topRivals: analysis.threats.map(rivalBrief),
		clearWeeks: analysis.recommendation.clear.map((w, i) =>
			week(w, { rank: i + 1, clearScore: Math.round((weeks.get(w)?.clear ?? 0) * 100) / 100, nearby: lead(weeks.get(w), rivals) }),
		),
		dangerWeeks: analysis.recommendation.danger.map((w) => week(w, { ledBy: lead(weeks.get(w), rivals, "pressure", 1) })),
		counterProgramming: analysis.recommendation.counter.map((w) => week(w, { bigCrowdFor: lead(weeks.get(w), rivals, "buzz", 1) })),
		notes: [
			"Pressure is a 0-100 index of the audience's attention already spoken for across your first four weeks, relative to the busiest week you could open in. It is not a box-office forecast.",
			"Scores for unreleased films are content-based (from metadata), not behavioral. Games are scored through a released predecessor.",
			"clearWeeks are ranked best first by clear score = season multiplier x (1 - pressure/100). Holiday and spring-break weeks get a bonus because more people go to the movies then. Clear weeks skip the opening weeks of the five biggest rivals and need at least half their buzz scored.",
		],
	};
}

/** What what_if returns: your week and the picks after the change. */
export function whatIfBrief(change: string, analysis: Analysis<BriefRival>, rivals: BriefRival[], you?: { title: string; week: string }) {
	const byId = new Map(rivals.map((r) => [r.id, r]));
	const weeks = new Map(analysis.calendar.map((w) => [w.week, w]));
	const v = analysis.verdict;
	const mine = you ? weeks.get(you.week) : undefined;
	return {
		change,
		...(you && v && mine
			? {
					yourTitle: {
						title: you.title,
						week: fmtDay(you.week),
						verdict: v.hold ? "hold" : "consider moving",
						rank: `${v.rank} of ${v.of}`,
						pressure: index(mine.p),
						mainPressure: lead(mine, byId),
					},
				}
			: {}),
		clearWeeks: analysis.recommendation.clear.map((w) => ({ week: fmtDay(w), pressure: index(weeks.get(w)?.p ?? 0) })),
		dangerWeeks: analysis.recommendation.danger.map((w) => ({ week: fmtDay(w), pressure: index(weeks.get(w)?.p ?? 0), ledBy: lead(weeks.get(w), byId, "pressure", 1) })),
	};
}

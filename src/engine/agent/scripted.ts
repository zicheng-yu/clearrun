/**
 * The scripted planner: the agent's fallback when no language model is available (no key, the budget is
 * spent, or the model is down). Fixed rules read the question, the same tools run in a fixed order, and a
 * template writes the answer from plan_release's result, so every title, date and number still comes from
 * the tools.
 */
import { GAMES } from "../../shared/games.ts";
import { normalizeTitle, parseDay } from "./text.ts";

export interface Intent {
	/** The dated title being planned: the first film on the slate the question names. */
	you?: { id: string; title: string };
	/** Other slate titles the question names, in order (rivals it asks about). */
	others: string[];
	/** Released films the question names as comps ("like Hereditary and Talk to Me"). */
	compQueries: string[];
	/** The franchise to search for comps when the question names a dated title but no comps. */
	franchise?: string;
	/** Earliest release day the question allows (YYYY-MM-DD). */
	earliest?: string;
}

const MONTH_WORDS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "Dune: Part Three" → "Dune", "Sonic the Hedgehog 4" → "Sonic the Hedgehog", "The Hunger Games: …" → "The Hunger Games". */
export function franchiseOf(title: string): string {
	return (title.split(":")[0] ?? title).replace(/\s+(?:\d+|II|III|IV|V|VI|Part (?:One|Two|Three|\d+))$/i, "").trim();
}

/**
 * Where a title's words appear in the question, as whole words; −1 when they don't. A one-word title must
 * match its capitalization too, so "remain on Dec 18" doesn't name the film "Remain".
 */
function position(question: string, title: string): number {
	const t = normalizeTitle(title);
	if (!t) return -1;
	if (!t.includes(" ") && !new RegExp(`(^|[^A-Za-z0-9])${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9])`).test(question)) return -1;
	return ` ${normalizeTitle(question)} `.indexOf(` ${t} `);
}

// Runs of capitalized words (and the small words inside titles) after a cue such as "like" or "fans of".
const CUE = /\b(?:like|fans of|similar to|such as|comps?:?|comparable to|in the vein of|audience of)\s+/gi;
const SMALL = new Set(["of", "the", "a", "an", "in", "on", "at", "to", "and", "&", "for"]);

function compRuns(question: string): string[] {
	const out: string[] = [];
	for (const m of question.matchAll(CUE)) {
		const rest = question.slice((m.index ?? 0) + m[0].length);
		const tokens = rest.split(/\s+/);
		let run: string[] = [];
		const flush = () => {
			while (run.length && SMALL.has((run.at(-1) ?? "").toLowerCase())) run.pop();
			if (run.length) out.push(run.join(" ").replace(/[.,;!?)]+$/, ""));
			run = [];
		};
		for (const raw of tokens) {
			const word = raw.replace(/^[("']+/, "");
			const ends = /[.,;!?)]$/.test(raw);
			const lower = word.toLowerCase().replace(/[.,;!?)]+$/, "");
			if (lower === "and" || lower === "or" || lower === "&") {
				flush();
				continue;
			}
			if (/^[A-Z0-9]/.test(word) || (run.length > 0 && SMALL.has(lower))) run.push(word);
			else break;
			if (ends) {
				flush();
				if (!/,$/.test(raw)) break;
			}
		}
		flush();
	}
	return [...new Set(out.filter((q) => q.length >= 2))].slice(0, 3);
}

function earliestIn(question: string, window: { start: string; end: string }): string | undefined {
	const q = question.toLowerCase();
	const iso = /\b(?:after|from|starting|no earlier than)\s+(\d{4}-\d{2}-\d{2})\b/.exec(q);
	if (iso?.[1]) return parseDay(iso[1], window);
	const day = /\b(?:after|from|starting|no earlier than)\s+([a-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)/.exec(q);
	if (day?.[1]) return parseDay(day[1], window);
	const month = new RegExp(`\\b(?:in|from|after|early|starting)\\s+(${MONTH_WORDS.join("|")})(?:\\s+(20\\d\\d))?\\b`).exec(q);
	if (month?.[1]) return parseDay(`${month[1]} 1${month[2] ? `, ${month[2]}` : ""}`, window);
	const year = /\b(?:in|early|from|after)\s+(?:early\s+)?(20\d\d)\b/.exec(q);
	if (year?.[1]) {
		const start = `${year[1]}-01-01`;
		return start > window.start ? start : undefined;
	}
	return undefined;
}

/** Reads a question with fixed rules. `titles` is the live slate. */
export function readQuestion(question: string, titles: { id: string; title: string; kind: "film" | "game" }[], window: { start: string; end: string }): Intent {
	const aliases = (t: { title: string }) => [t.title, ...(GAMES.find((g) => g.title === t.title)?.aliases ?? [])];
	const named = titles
		.map((t) => ({
			t,
			at: Math.min(
				...aliases(t)
					.map((a) => position(question, a))
					.map((x) => (x < 0 ? Number.POSITIVE_INFINITY : x)),
			),
		}))
		.filter((x) => Number.isFinite(x.at))
		// A longer title wins over one it contains ("Dune: Part Three" over a film called "Dune").
		.sort((a, b) => a.at - b.at || b.t.title.length - a.t.title.length);
	const seen = new Set<string>();
	const mentioned = named.filter((x) => !seen.has(x.t.id) && seen.add(x.t.id)).map((x) => x.t);
	const you = mentioned.find((t) => t.kind === "film");
	const compQueries = compRuns(question);
	return {
		...(you ? { you: { id: you.id, title: you.title } } : {}),
		others: mentioned.filter((t) => t.id !== you?.id).map((t) => t.title),
		compQueries,
		...(you && compQueries.length === 0 ? { franchise: franchiseOf(you.title) } : {}),
		...(earliestIn(question, window) ? { earliest: earliestIn(question, window) } : {}),
	};
}

/** The parts of plan_release's result the answer template reads. */
export interface PlanFacts {
	yourTitle?: {
		title: string;
		opens: string;
		verdict: string;
		rank: string;
		pressure: number;
		mainPressure: string[];
		bestAlternative: { week: string; pressure: number; caveat?: string };
	};
	topRivals: { title: string; opens: string; overlap: string }[];
	clearWeeks: { week: string; pressure: number; season?: string; nearby: string[]; caveat?: string }[];
	dangerWeeks: { week: string; pressure: number; ledBy: string[] }[];
	mainRival?: { title: string; sharedTags: string[] };
}

const list = (items: string[]) => (items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** The answer, in the agent's format: a recommendation, two to four evidence bullets and a caveat line. */
export function scriptedAnswer(facts: PlanFacts, compNames: string[]): string {
	const lines: string[] = [];
	const audience = `fans of ${list(compNames)}`;
	const y = facts.yourTitle;
	const weeks = facts.clearWeeks;
	const clear = weeks.map((w) => `${w.week} (pressure ${w.pressure}${w.season ? `, ${w.season}` : ""})`);
	if (y) {
		lines.push(
			y.verdict === "hold"
				? `Hold ${y.title} on ${y.opens}: for ${audience}, its week ranks #${y.rank}.`
				: `Consider moving ${y.title} from ${y.opens} to the week of ${y.bestAlternative.week}.`,
		);
		lines.push(`- ${y.opens} rates pressure ${y.pressure} of 100${y.mainPressure.length ? `, mostly from ${list(y.mainPressure)}` : ""}.`);
		if (y.verdict !== "hold") lines.push(`- The week of ${y.bestAlternative.week} rates pressure ${y.bestAlternative.pressure}.`);
		if (clear.length) lines.push(`- Clearest weeks: ${list(clear)}.`);
	} else if (weeks[0]) {
		lines.push(weeks.length === 1 ? `The clearest week for ${audience} is ${weeks[0].week}.` : `The clearest weeks for ${audience} are ${list(weeks.map((w) => w.week))}.`);
		lines.push(`- ${weeks[0].week} rates pressure ${weeks[0].pressure} of 100${weeks[0].nearby.length ? `; the nearest pull comes from ${list(weeks[0].nearby)}` : ""}.`);
	} else {
		lines.push(`No week stands out as clear for ${audience} on this calendar.`);
	}
	const danger = facts.dangerWeeks[0];
	if (danger) lines.push(`- Most crowded: ${danger.week}, pressure ${danger.pressure}${danger.ledBy.length ? `, led by ${list(danger.ledBy)}` : ""}.`);
	if (facts.mainRival?.sharedTags.length) lines.push(`- ${facts.mainRival.title} shares these taste tags with the comps: ${facts.mainRival.sharedTags.slice(0, 4).join(", ")}.`);
	else if (facts.topRivals.length) lines.push(`- Biggest rivals: ${list(facts.topRivals.slice(0, 3).map((r) => `${r.title} (${r.opens}, overlap ${r.overlap})`))}.`);
	// The week the answer points at, when it's the last one a full run fits: releases that far out are still being dated.
	const point = y ? (y.verdict === "hold" ? undefined : y.bestAlternative) : weeks[0];
	const far = point?.caveat ? ` ${point.week} is the last week whose first four weeks fit on the calendar, and releases that far out are still being dated.` : "";
	lines.push(`Comps: ${list(compNames)}. Pressure is a relative index, not a box-office forecast, and unreleased films are scored from their metadata.${far}`);
	return lines.join("\n");
}

/** When no comps can be found. */
export const NEED_COMPS =
	"I couldn't tell whose audience to plan for. Name one or two released films whose fans you want, for example \"an original horror film like Hereditary and Talk to Me\", or the dated title you're planning.";

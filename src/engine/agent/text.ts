/** Text helpers for the agent: matching titles, reading dates, and checking an answer's dates against tool results. */
import { releaseWeek } from "../../shared/dates.ts";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const normalizeTitle = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();

/** Best matches for a name: exact, then prefix, then substring, then all words present. */
export function matchTitles<T extends { title: string }>(items: T[], query: string, limit = 5): T[] {
	const q = normalizeTitle(query);
	if (!q) return [];
	const words = q.split(" ");
	const score = (t: T) => {
		const n = normalizeTitle(t.title);
		if (n === q) return 4;
		if (n.startsWith(q)) return 3;
		if (n.includes(q)) return 2;
		return words.every((w) => n.includes(w)) ? 1 : 0;
	};
	return items
		.map((t) => ({ t, s: score(t) }))
		.filter((x) => x.s > 0)
		.sort((a, b) => b.s - a.s)
		.slice(0, limit)
		.map((x) => x.t);
}

const isoOk = (iso: string) => {
	const d = new Date(`${iso}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
};

/**
 * A day from "2027-01-15", "Jan 15", "January 15" or "Jan 15, 2027". Without a year, the year is the one
 * that puts the day inside the window (the window spans at most two calendar years).
 */
export function parseDay(input: string, window?: { start: string; end: string }): string | undefined {
	const s = input.trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return isoOk(s) ? s : undefined;
	const m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/.exec(s);
	if (!m) return undefined;
	const month = MONTHS.indexOf((m[1] ?? "").slice(0, 3).toLowerCase());
	if (month < 0) return undefined;
	const day = String(Number(m[2])).padStart(2, "0");
	const mm = String(month + 1).padStart(2, "0");
	const years = m[3] ? [Number(m[3])] : window ? [...new Set([Number(window.start.slice(0, 4)), Number(window.end.slice(0, 4))])] : [new Date().getUTCFullYear()];
	const candidates = years.map((y) => `${y}-${mm}-${day}`).filter(isoOk);
	return candidates.find((c) => !window || (c >= window.start && c <= window.end)) ?? candidates[0];
}

/** A day's release week, from any form parseDay accepts. */
export const parseWeek = (input: string, window?: { start: string; end: string }) => {
	const day = parseDay(input, window);
	return day ? releaseWeek(day) : undefined;
};

/** Calendar days mentioned in a text, normalized to "Mon D" (e.g. "Dec 18"). */
export function datesIn(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?!\d)/g)) {
		const month = MONTHS.indexOf((m[1] ?? "").slice(0, 3).toLowerCase());
		const day = Number(m[2]);
		if (month >= 0 && day >= 1 && day <= 31) out.push(`${MONTH_NAMES[month]} ${day}`);
	}
	for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
		const month = Number(m[2]) - 1;
		if (month >= 0 && month < 12) out.push(`${MONTH_NAMES[month]} ${Number(m[3])}`);
	}
	return out;
}

/** Every date the answer states must appear in the tool results this run produced. */
export function checkDates(answer: string, evidence: string): { dates: number; unverified: string[] } {
	const known = new Set(datesIn(evidence));
	const stated = [...new Set(datesIn(answer))];
	return { dates: stated.length, unverified: stated.filter((d) => !known.has(d)) };
}

/**
 * Watching a plan: a compact summary of the plan at each check, what changed between two checks, and a
 * templated note. Pure, so the daily re-plan (cron) and Simulate share one path and it can be tested.
 */
import { addDays, releaseWeek } from "../../shared/dates.ts";
import type { WatchChange, WatchEvent, WatchState, WatchSummary } from "../../shared/types.ts";
import type { Analysis } from "../score/analyze.ts";
import type { CalendarRival } from "../score/calendar.ts";
import { fmtDay, runPhrase } from "../score/narrate.ts";

export interface SummaryRival extends CalendarRival {
	title: string;
	date: string;
}

/** A rival's slate id. Plan rivals are keyed `${slateId}@${date}`, so a film listed twice stays unique. */
export function slateIdOf(rivalId: string): string {
	const at = rivalId.lastIndexOf("@");
	return at > 0 ? rivalId.slice(0, at) : rivalId;
}

export function summarize<R extends SummaryRival>(input: {
	analysis: Analysis<R>;
	rivals: R[];
	week: string;
	snapshot: { id: string; createdAt: number; windowStart: string; windowEnd: string };
	youDate?: string;
}): WatchSummary {
	const { analysis, week } = input;
	const byId = new Map(input.rivals.map((r) => [r.id, r]));
	const w = analysis.calendar.find((x) => x.week === week);
	const v = analysis.verdict;
	const felt = (w?.contributors ?? [])
		.filter((c) => c.pressure > 0)
		.slice(0, 5)
		.flatMap((c) => {
			const r = byId.get(c.id);
			return r && w ? [{ title: r.title, date: r.date, k: c.k, share: Math.round((c.pressure / w.pressure) * 100) / 100 }] : [];
		});
	const rivals: WatchSummary["rivals"] = {};
	for (const r of input.rivals) {
		const id = slateIdOf(r.id);
		const entry = rivals[id] ?? { title: r.title, dates: [] };
		entry.dates = [...entry.dates, r.date].sort();
		rivals[id] = entry;
	}
	const round = (x: number) => Math.round(x * 1000) / 1000;
	return {
		week,
		pressure: round(w?.p ?? 0),
		buzz: round(w?.b ?? 0),
		hold: v?.hold ?? false,
		rank: v?.rank ?? 0,
		of: v?.of ?? 0,
		best: v?.best ?? analysis.recommendation.clear[0] ?? "",
		clear: analysis.recommendation.clear,
		danger: analysis.recommendation.danger,
		felt,
		snapshotId: input.snapshot.id,
		snapshotAt: input.snapshot.createdAt,
		windowStart: input.snapshot.windowStart,
		windowEnd: input.snapshot.windowEnd,
		youDate: input.youDate,
		rivals,
	};
}

/** The part of a summary shown before and after a change. */
export function stateOf(s: WatchSummary): WatchState {
	const { week, pressure, buzz, hold, rank, of, best, clear, danger, felt } = s;
	return { week, pressure, buzz, hold, rank, of, best, clear, danger, felt };
}

/** A rival opening in these weeks can touch your first four weeks (decay spans k = −1…5). */
function touches(day: string, week: string): boolean {
	const r = releaseWeek(day);
	return r >= addDays(week, -35) && r <= addDays(week, 28);
}

export interface Diff {
	/** Changes near the watched week (and your own title's moves), in calendar order. */
	changes: WatchChange[];
	/** Other date changes on the calendar. */
	elsewhere: number;
	severity: WatchEvent["severity"];
}

/**
 * What changed between two checks. Titles that simply passed their release date, and titles that only
 * entered because the window's far end moved forward, are not changes.
 */
export function diffSummaries(before: WatchSummary, after: WatchSummary, label: string): Diff {
	const all: WatchChange[] = [];
	if (before.youDate && before.youDate !== after.youDate) all.push({ kind: "you-moved", title: label, from: before.youDate, ...(after.youDate ? { to: after.youDate } : {}) });
	for (const id of new Set([...Object.keys(before.rivals), ...Object.keys(after.rivals)])) {
		const a = before.rivals[id];
		const b = after.rivals[id];
		if (a && b) {
			const gone = a.dates.filter((d) => !b.dates.includes(d) && d >= after.windowStart);
			const fresh = b.dates.filter((d) => !a.dates.includes(d));
			if (gone.length === 1 && fresh.length === 1) all.push({ kind: "moved", title: b.title, from: gone[0], to: fresh[0] });
			else {
				for (const d of fresh) all.push({ kind: "added", title: b.title, to: d });
				for (const d of gone) all.push({ kind: "removed", title: a.title, from: d });
			}
		} else if (b) {
			for (const d of b.dates.filter((d) => d <= before.windowEnd)) all.push({ kind: "added", title: b.title, to: d });
		} else if (a) {
			for (const d of a.dates.filter((d) => d >= after.windowStart)) all.push({ kind: "removed", title: a.title, from: d });
		}
	}
	const near = (c: WatchChange) => c.kind === "you-moved" || [c.from, c.to].some((d) => d !== undefined && (touches(d, before.week) || touches(d, after.week)));
	const changes = all.filter(near).sort((x, y) => (x.to ?? x.from ?? "").localeCompare(y.to ?? y.from ?? ""));
	// For a held date, a different "best alternative" is not news; for a move, it is the recommendation.
	const severity: Diff["severity"] =
		changes.some((c) => c.kind === "you-moved") || before.hold !== after.hold ? "action" : changes.length > 0 || (!after.hold && before.best !== after.best) ? "notable" : "quiet";
	return { changes, elsewhere: all.length - changes.length, severity };
}

const index = (x: number) => Math.round(x * 100);
const join = (items: string[]) => (items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

export function changePhrase(c: WatchChange): string {
	const to = c.to ? fmtDay(c.to) : "";
	const from = c.from ? fmtDay(c.from) : "";
	switch (c.kind) {
		case "you-moved":
			return c.to ? `${c.title} itself moved from ${from} to ${to}` : `${c.title} itself came off the calendar (it was dated ${from})`;
		case "moved":
			return `${c.title} moved from ${from} to ${to}${c.outside ? ", outside the slate window" : ""}`;
		case "added":
			return `${c.title} was added on ${to}`;
		case "removed":
			return `${c.title} came off the calendar (it was dated ${from})`;
	}
}

/** A short, templated account of a check: what changed, what it did to your week, and the verdict. */
export function describeEvent(e: { kind: WatchEvent["kind"]; changes: WatchChange[]; elsewhere: number; before?: WatchState; after: WatchState; label: string }): string {
	const { before, after } = e;
	const out: string[] = [];
	const verdictNow = after.hold ? "hold" : "consider moving";
	if (e.kind === "created" || !before) {
		out.push(`Watching ${e.label} in the week of ${fmtDay(after.week)}: pressure ${index(after.pressure)}.`);
		out.push(
			after.rank > 0
				? after.hold
					? `Verdict: hold (#${after.rank} of ${after.of} by clear score).`
					: `Verdict: consider moving; the clearest alternative is ${fmtDay(after.best)}.`
				: "",
		);
		const main = after.felt[0];
		if (main) out.push(`Main pressure: ${main.title} (${runPhrase(main.k)}).`);
		return out.filter(Boolean).join(" ");
	}
	if (e.kind === "ended") return `The week of ${fmtDay(after.week)} has arrived, so this watch has ended.`;

	const prefix = e.kind === "simulation" ? "Simulated: " : "";
	const shown = e.changes.slice(0, 3).map(changePhrase);
	if (e.changes.length > 3) shown.push(`${e.changes.length - 3} more`);
	out.push(shown.length ? `${prefix}${join(shown)}.` : `${prefix}No release dates changed near your week.`);
	if (before.week !== after.week) out.push(`Your week is now ${fmtDay(after.week)}.`);
	const a = index(before.pressure);
	const b = index(after.pressure);
	out.push(a === b ? `Pressure on your week stayed at ${b}.` : `Pressure on your week ${b > a ? "rose" : "fell"} from ${a} to ${b}.`);
	if (before.hold !== after.hold) out.push(`The verdict changed to ${verdictNow}${after.hold ? "" : `; the clearest alternative is ${fmtDay(after.best)}`}.`);
	else if (after.hold) out.push("Still hold.");
	else if (before.best !== after.best && after.best) out.push(`Still consider moving; the clearest alternative is now ${fmtDay(after.best)} (was ${fmtDay(before.best)}).`);
	else if (after.best) out.push(`Still consider moving; the clearest alternative is ${fmtDay(after.best)}.`);
	const main = after.felt[0];
	if (main && main.title !== before.felt[0]?.title) out.push(`Main pressure now: ${main.title} (${runPhrase(main.k)}).`);
	if (e.elsewhere > 0 && e.kind === "slate") out.push(`${e.elsewhere} other date change${e.elsewhere === 1 ? "" : "s"} elsewhere on the calendar.`);
	return out.join(" ");
}

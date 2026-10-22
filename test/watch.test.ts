import { describe, expect, it } from "vitest";
import { analyze } from "../src/engine/score/analyze.ts";
import { describeEvent, diffSummaries, slateIdOf, stateOf, summarize, type SummaryRival } from "../src/engine/watch/replan.ts";
import { releaseWeek } from "../src/shared/dates.ts";

const WINDOW = { windowStart: "2026-11-06", windowEnd: "2027-01-29" };
const snapshot = (id: string) => ({ id, createdAt: 0, ...WINDOW });
const rival = (id: string, title: string, date: string, size: number, overlap?: number): SummaryRival => ({
	id: `${id}@${date}`,
	kind: "film",
	title,
	date,
	week: releaseWeek(date),
	size,
	overlap,
});

// Your film holds Dec 18; Alpha opens the same week, Bravo two weeks later, Charlie far away.
const BASE = [rival("A", "Alpha", "2026-12-18", 1, 0.9), rival("B", "Bravo", "2027-01-01", 0.6, 0.8), rival("C", "Charlie", "2026-11-06", 0.5, 0.2)];

function check(rivals: SummaryRival[], id: string, week = "2026-12-18", youDate = "2026-12-18") {
	const analysis = analyze({ rivals, ...WINDOW, from: "2026-11-20", yourWeek: week });
	return summarize({ analysis, rivals, week, snapshot: snapshot(id), youDate });
}

describe("watch summaries", () => {
	it("records the watched week, its verdict, the rivals behind it and every rival's dates", () => {
		const s = check(BASE, "s1");
		expect(slateIdOf("Q123@2026-12-18")).toBe("Q123");
		expect(s.week).toBe("2026-12-18");
		expect(s.pressure).toBe(1);
		expect(s.hold).toBe(false);
		expect(s.felt.map((f) => [f.title, f.k])).toEqual([
			["Alpha", 0],
			["Bravo", -2],
		]);
		expect(s.felt.reduce((sum, f) => sum + f.share, 0)).toBeCloseTo(1, 1);
		expect(s.rivals).toEqual({ A: { title: "Alpha", dates: ["2026-12-18"] }, B: { title: "Bravo", dates: ["2027-01-01"] }, C: { title: "Charlie", dates: ["2026-11-06"] } });
		expect(stateOf(s)).not.toHaveProperty("rivals");
	});

	it("reports a nearby move, flags a verdict flip, and narrates it", () => {
		const before = check(BASE, "s1");
		const moved = BASE.map((r) => (r.id.startsWith("A@") ? rival("A", "Alpha", "2027-01-29", 1, 0.9) : r));
		const after = check(moved, "s2");
		const diff = diffSummaries(before, after, "Your film");
		expect(diff.changes).toEqual([{ kind: "moved", title: "Alpha", from: "2026-12-18", to: "2027-01-29" }]);
		expect(diff.severity).toBe(after.hold === before.hold ? "notable" : "action");
		const note = describeEvent({ kind: "slate", ...diff, before: stateOf(before), after: stateOf(after), label: "Your film" });
		expect(note).toContain("Alpha moved from Dec 18 to Jan 29.");
		expect(note).toMatch(/Pressure on your week fell from 100 to \d+\./);
	});

	it("ignores titles that passed their date or entered at the window's far end, and counts far-away changes", () => {
		const before = check(BASE, "s1");
		const later = { ...check([...BASE.slice(0, 2), rival("D", "Delta", "2027-02-05", 0.5, 0.5)], "s2"), windowStart: "2026-11-13", windowEnd: "2027-02-05" };
		expect(diffSummaries(before, later, "Your film")).toEqual({ changes: [], elsewhere: 0, severity: "quiet" });

		const far = check(
			// Nov 6 → Jan 22: both dates are outside the weeks that can touch a Dec 18 run (Nov 13 – Jan 15).
			BASE.map((r) => (r.id.startsWith("C@") ? rival("C", "Charlie", "2027-01-22", 0.5, 0.2) : r)),
			"s3",
		);
		const diff = diffSummaries(before, far, "Your film");
		expect(diff.changes).toEqual([]);
		expect(diff.elsewhere).toBe(1);
	});

	it("treats your own title's move as an action and follows it", () => {
		const before = check(BASE, "s1");
		const after = check(BASE, "s2", "2027-01-15", "2027-01-15");
		const diff = diffSummaries(before, after, "Dune: Part Three");
		expect(diff.changes[0]).toEqual({ kind: "you-moved", title: "Dune: Part Three", from: "2026-12-18", to: "2027-01-15" });
		expect(diff.severity).toBe("action");
		const note = describeEvent({ kind: "slate", ...diff, before: stateOf(before), after: stateOf(after), label: "Dune: Part Three" });
		expect(note).toContain("Dune: Part Three itself moved from Dec 18 to Jan 15.");
		expect(note).toContain("Your week is now Jan 15.");
	});

	it("describes a new watch and new entrants near the week", () => {
		const start = check(BASE, "s1");
		expect(describeEvent({ kind: "created", changes: [], elsewhere: 0, after: stateOf(start), label: "Your film" })).toBe(
			`Watching Your film in the week of Dec 18: pressure 100. Verdict: consider moving; the clearest alternative is ${new Date(`${start.best}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}. Main pressure: Alpha (opening that week).`,
		);
		const added = check([...BASE, rival("E", "Echo", "2026-12-25", 0.8, 0.7)], "s2");
		const diff = diffSummaries(start, added, "Your film");
		expect(diff.changes).toEqual([{ kind: "added", title: "Echo", to: "2026-12-25" }]);
		expect(describeEvent({ kind: "slate", ...diff, before: stateOf(start), after: stateOf(added), label: "Your film" })).toContain("Echo was added on Dec 25.");
	});
});

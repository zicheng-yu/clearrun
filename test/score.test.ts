import { describe, expect, it } from "vitest";
import { decay, lastFullRun, listWeeks, nthWeekday, planCalendar, recommend, season, verdict, weeksBetween, type CalendarRival } from "../src/engine/score/calendar.ts";
import { narrate } from "../src/engine/score/narrate.ts";
import { percentiles, placeAmong, sizes } from "../src/engine/score/normalize.ts";

describe("normalize", () => {
	it("ranks values into percentiles with shared ranks for ties", () => {
		const p = percentiles(
			new Map([
				["a", 0.9],
				["b", 0.8],
				["c", 0.8],
				["d", 0.95],
				["e", 0.7],
			]),
		);
		expect(Object.fromEntries(p)).toEqual({ e: 0, b: 0.375, c: 0.375, a: 0.75, d: 1 });
		expect(Object.fromEntries(percentiles(new Map([["solo", 0.5]])))).toEqual({ solo: 1 });
		expect(percentiles(new Map()).size).toBe(0);
	});

	it("places a value among others", () => {
		expect(placeAmong(0.9, [0.8, 0.85, 0.9, 0.95])).toBeCloseTo(0.625);
		expect(placeAmong(0.99, [0.8, 0.85])).toBe(1);
		expect(placeAmong(0.5, [])).toBeUndefined();
	});

	it("sizes attention by the square root of pageview share, with a floor", () => {
		const s = sizes(
			new Map<string, number | undefined>([
				["big", 400_000],
				["mid", 100_000],
				["tiny", 10],
				["none", undefined],
				["zero", 0],
			]),
		);
		expect(s.get("big")).toBe(1);
		expect(s.get("mid")).toBeCloseTo(0.5);
		expect(s.get("tiny")).toBe(0.05);
		expect(s.get("none")).toBe(0.05);
		expect(s.get("zero")).toBe(0.05);
	});
});

describe("calendar basics", () => {
	it("decays films faster than games and is zero outside the window", () => {
		expect(decay("film", -1)).toBe(0.25);
		expect(decay("film", 0)).toBe(1);
		expect(decay("game", 2)).toBe(0.6);
		expect(decay("film", -2)).toBe(0);
		expect(decay("game", 6)).toBe(0);
	});

	it("counts weeks and lists release Fridays", () => {
		expect(weeksBetween("2026-11-20", "2026-12-18")).toBe(4);
		expect(weeksBetween("2026-12-18", "2026-12-11")).toBe(-1);
		expect(listWeeks("2026-10-22", "2026-11-17")).toEqual(["2026-10-23", "2026-10-30", "2026-11-06", "2026-11-13"]);
	});

	it("finds US holiday dates", () => {
		expect(nthWeekday(2026, 10, 4, 4)).toBe("2026-11-26"); // Thanksgiving
		expect(nthWeekday(2027, 0, 1, 3)).toBe("2027-01-18"); // MLK Day
		expect(nthWeekday(2027, 4, 1, -1)).toBe("2027-05-31"); // Memorial Day
	});

	it("labels holiday and school-break weeks", () => {
		expect(season("2026-11-27")).toEqual({ factor: 1.3, label: "Thanksgiving" });
		expect(season("2026-11-20")).toEqual({ factor: 1 });
		expect(season("2026-12-11").factor).toBe(1);
		for (const w of ["2026-12-18", "2026-12-25", "2027-01-01"]) expect(season(w)).toEqual({ factor: 1.3, label: "Christmas–New Year" });
		expect(season("2027-01-08").factor).toBe(1);
		expect(season("2027-01-15")).toEqual({ factor: 1.15, label: "MLK weekend" });
		expect(season("2027-02-12")).toEqual({ factor: 1.15, label: "Presidents' Day weekend" });
		expect(season("2027-03-12").label).toBe("Spring break");
		expect(season("2027-03-05").factor).toBe(1);
		expect(season("2027-04-02").factor).toBe(1);
	});
});

// Five weeks around Thanksgiving 2026 with a big same-audience film, an unscored film and a game.
const WEEKS = ["2026-11-06", "2026-11-13", "2026-11-20", "2026-11-27", "2026-12-04"];
const RIVALS: CalendarRival[] = [
	{ id: "A", kind: "film", week: "2026-11-20", size: 1, overlap: 1 },
	{ id: "B", kind: "film", week: "2026-11-06", size: 0.5 },
	{ id: "C", kind: "game", week: "2026-11-13", size: 0.8, overlap: 0.5 },
];

describe("planCalendar", () => {
	const cal = planCalendar(RIVALS, WEEKS);
	const at = (week: string) => cal.find((w) => w.week === week);

	it("weights each week over your own four-week run", () => {
		// e.g. Nov 6: (0.08 + 0.55 × 0.45 + 0.30 × 1.16 + 0.17 × 0.67) / 2.02, from opening-week pressures 0.08, 0.45, 1.16, 0.67.
		expect(cal.map((w) => Number(w.pressure.toFixed(3)))).toEqual([0.391, 0.671, 0.834, 0.483, 0.279]);
		expect(cal.map((w) => Number(w.buzz.toFixed(3)))).toEqual([1.126, 1.368, 1.331, 0.83, 0.509]);
	});

	it("normalizes, applies the season and scores clear, counter and confidence", () => {
		expect(at("2026-11-20")?.p).toBe(1);
		expect(at("2026-11-20")?.clear).toBe(0);
		expect(at("2026-11-27")?.season.label).toBe("Thanksgiving");
		expect(at("2026-11-27")?.clear).toBeCloseTo(1.3 * (1 - 0.483 / 0.834), 2);
		expect(at("2026-11-06")?.confidence).toBeCloseTo(0.688, 2);
		expect(at("2026-11-06")?.counter).toBeCloseTo((1.126 / 1.368) * (1 - 0.391 / 0.834), 2);
		expect(at("2026-11-20")?.contributors.map((c) => [c.id, c.k])).toEqual([
			["A", 0],
			["C", 1],
			["B", 2],
		]);
	});

	it("scales pressure to the weeks you could open, capped at 1", () => {
		const later = planCalendar(RIVALS, WEEKS, { from: "2026-11-27" });
		expect(later.map((w) => Number(w.p.toFixed(3)))).toEqual([0.809, 1, 1, 1, 0.578]);
	});

	it("recommends distinct clear, danger and counter-programming weeks", () => {
		expect(recommend(cal)).toEqual({ clear: ["2026-12-04", "2026-11-06"], danger: ["2026-11-20"], counter: ["2026-11-06"] });
		expect(recommend(cal, { earliest: "2026-11-13" }).clear).toEqual(["2026-12-04"]);
		expect(recommend(cal, { latest: lastFullRun(WEEKS) })).toEqual({ clear: ["2026-11-06"], danger: ["2026-11-13"], counter: ["2026-11-06"] });
		// Never open head to head with a rival you were told to avoid.
		expect(recommend(cal, { avoid: ["B"] }).clear).toEqual(["2026-12-04"]);
	});

	it("tells you whether to hold your date", () => {
		expect(verdict(cal, "2026-11-20")).toEqual({ week: "2026-11-20", rank: 5, of: 5, hold: false, best: "2026-12-04" });
		expect(verdict(cal, "2026-12-04")).toMatchObject({ rank: 1, hold: true, best: "2026-11-27" });
	});

	it("narrates with names and dates from the inputs only", () => {
		const lines = narrate({
			compNames: ["Comp One", "Comp Two"],
			rivals: [
				{ id: "A", title: "Alpha", date: "2026-11-20", week: "2026-11-20", size: 1, overlap: 1 },
				{ id: "B", title: "Bravo", date: "2026-11-06", week: "2026-11-06", size: 0.5 },
				{ id: "C", title: "Charlie", date: "2026-11-12", week: "2026-11-13", size: 0.8, overlap: 0.5 },
			],
			calendar: cal,
			recommendation: recommend(cal),
			you: { title: "Yours", date: "2026-11-20", week: "2026-11-20" },
			verdict: verdict(cal, "2026-11-20"),
			scored: 2,
			total: 3,
		});
		expect(lines).toEqual([
			"Fans of Comp One and Comp Two: Qloo scored 2 of 3 upcoming releases against this audience. The biggest claims on their attention: Alpha (Nov 20, overlap p100) and Charlie (Nov 12, overlap p50).",
			"Consider moving Yours. Nov 20 is the #1 pressure week for this audience, mostly from Alpha (opening that week). The clearest alternative is Dec 4, with 33% of the pressure.",
			"Clearest weeks: Dec 4 and Nov 6.",
			"Most crowded for this audience: Nov 20 (led by Alpha).",
			"Counter-programming: Nov 6 (a big crowd for Charlie, mostly not yours).",
		]);
		// An alternative on the last week a full run fits says the calendar is still filling in there.
		const far = narrate({
			compNames: ["Comp One"],
			rivals: [],
			calendar: cal,
			recommendation: recommend(cal),
			window: { latest: "2026-12-04" },
			verdict: verdict(cal, "2026-11-20"),
			you: { title: "Yours", date: "2026-11-20", week: "2026-11-20" },
			scored: 0,
			total: 0,
		});
		expect(far).toContain("Dec 4 is the last week whose first four weeks fit on the calendar, and releases that far out are still being dated: rivals may yet land there.");
		expect(lines.some((l) => l.includes("still being dated"))).toBe(false);
	});
});

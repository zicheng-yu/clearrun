import { describe, expect, it } from "vitest";
import { planBrief, whatIfBrief, type BriefRival } from "../src/engine/agent/brief.ts";
import { checkDates, datesIn, matchTitles, normalizeTitle, parseDay, parseWeek } from "../src/engine/agent/text.ts";
import { analyze } from "../src/engine/score/analyze.ts";

describe("agent text helpers", () => {
	const slate = [{ title: "Dune: Part Three" }, { title: "Dune: Prophecy" }, { title: "The Hunger Games: Sunrise on the Reaping" }, { title: "Avengers: Doomsday" }];

	it("matches titles exactly first, then by prefix, substring and words", () => {
		expect(normalizeTitle("Fast & Furious: Part II")).toBe("fast and furious part ii");
		expect(matchTitles(slate, "dune part three").map((t) => t.title)).toEqual(["Dune: Part Three"]);
		expect(matchTitles(slate, "Dune").map((t) => t.title)).toEqual(["Dune: Part Three", "Dune: Prophecy"]);
		expect(matchTitles(slate, "sunrise reaping").map((t) => t.title)).toEqual(["The Hunger Games: Sunrise on the Reaping"]);
		expect(matchTitles(slate, "zzz")).toEqual([]);
	});

	it("reads days inside the slate window", () => {
		const window = { start: "2026-10-22", end: "2027-04-20" };
		expect(parseDay("2027-01-15", window)).toBe("2027-01-15");
		expect(parseDay("Jan 15", window)).toBe("2027-01-15");
		expect(parseDay("December 18", window)).toBe("2026-12-18");
		expect(parseDay("Dec 18th, 2027", window)).toBe("2027-12-18");
		expect(parseDay("2027-02-30", window)).toBeUndefined();
		expect(parseDay("next Friday", window)).toBeUndefined();
		expect(parseWeek("Nov 19", window)).toBe("2026-11-20");
	});

	it("checks every date in an answer against the tool results", () => {
		expect(datesIn("Move to Jan. 15 or March 12; avoid 2026-12-18 and Sept 4.")).toEqual(["Jan 15", "Mar 12", "Sep 4", "Dec 18"]);
		expect(checkDates("Hold Dec 18. Best: Mar 12, then Feb 26.", '{"opens":"Dec 18","clear":["Mar 12","Feb 26"]}')).toEqual({ dates: 3, unverified: [] });
		expect(checkDates("Try May 7.", '{"opens":"Dec 18"}')).toEqual({ dates: 1, unverified: ["May 7"] });
	});
});

describe("agent briefs", () => {
	const rivals: BriefRival[] = [
		{ id: "A", title: "Alpha", kind: "film", date: "2026-11-20", week: "2026-11-20", size: 1, overlap: 1 },
		{ id: "B", title: "Bravo", kind: "film", date: "2026-11-06", week: "2026-11-06", size: 0.5 },
		{ id: "C", title: "Charlie", kind: "game", date: "2026-11-12", week: "2026-11-13", size: 0.8, overlap: 0.5, proxy: { name: "Charlie I" } },
	];
	const base = { rivals, windowStart: "2026-11-06", windowEnd: "2026-12-29", from: "2026-11-06" };

	it("summarizes a plan with the verdict, picks and rivals", () => {
		const analysis = analyze({ ...base, yourWeek: "2026-11-20" });
		const brief = planBrief({
			compNames: ["Comp One"],
			rivals,
			analysis,
			window: { start: base.windowStart, end: base.windowEnd },
			coverage: { films: 2, scored: 1, games: 1, gamesScored: 1 },
			you: { title: "Yours", date: "2026-11-20", week: "2026-11-20" },
			audience: "Skews under 35, leans male",
		});
		expect(brief.audience).toBe("fans of Comp One");
		expect(brief.yourTitle).toMatchObject({
			title: "Yours",
			opens: "Nov 20",
			verdict: "consider moving",
			pressure: 100,
			mainPressure: ["Alpha (opening that week)", "Charlie (one week into its run)"],
		});
		expect(brief.topRivals[0]).toEqual({ title: "Alpha", kind: "film", opens: "Nov 20", overlap: "p100", size: 100 });
		expect(brief.topRivals[1]).toMatchObject({ title: "Charlie", scoredAs: "Charlie I (proxy)" });
		expect(brief.dangerWeeks[0]).toMatchObject({ week: "Nov 20", pressure: 100, ledBy: ["Alpha (opening that week)"] });
	});

	it("reports a what-if without touching the original plan", () => {
		const moved = rivals.map((r) => (r.id === "A" ? { ...r, week: "2026-12-25" } : r));
		const brief = whatIfBrief("Alpha moved to Dec 25", analyze({ ...base, rivals: moved, yourWeek: "2026-11-20" }), moved, { title: "Yours", week: "2026-11-20" });
		expect(brief.change).toBe("Alpha moved to Dec 25");
		expect(brief.yourTitle?.pressure).toBeLessThan(100);
		expect(rivals[0]?.week).toBe("2026-11-20");
	});
});

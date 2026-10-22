import { describe, expect, it } from "vitest";
import { checkClaims, findOnSlate, mentions, splitAnswer, titleKey } from "../src/engine/baseline/check.ts";

const SLATE = [
	{ title: "Avengers: Doomsday", date: "2026-12-18" },
	{ title: "Dune: Part Three", date: "2026-12-18" },
	{ title: "The Hunger Games: Sunrise on the Reaping", date: "2026-11-20" },
	{ title: "Narnia: The Magician's Nephew", date: "2027-02-12" },
	{ title: "Jumanji: Open World", date: "2026-12-25" },
	{ title: "The Cat in the Hat", date: "2026-11-06" },
	{ title: "Hexed", date: "2026-11-25" },
	{ title: "Grand Theft Auto VI", date: "2026-11-19", aliases: ["GTA VI", "GTA 6"] },
	{ title: "Wild Horse Nine", date: "2026-11-06" },
	{ title: "Wild Horse Nine", date: "2026-11-20" },
];
const WINDOW = { start: "2026-10-22", end: "2027-04-20" };

describe("splitAnswer", () => {
	it("separates the answer from its JSON list of releases", () => {
		const text =
			'Move to January.\n- Avengers opens Dec 18.\n\nReleases I relied on:\n```json\n[{"title": "Avengers: Doomsday", "date": "2026-12-18"}, {"title": "Narnia", "date": null}, {"date": "2026-01-01"}]\n```';
		expect(splitAnswer(text)).toEqual({
			answer: "Move to January.\n- Avengers opens Dec 18.",
			claims: [
				{ title: "Avengers: Doomsday", date: "2026-12-18" },
				{ title: "Narnia", date: null },
			],
		});
		expect(splitAnswer('Hold.\n[{"title": "Dune: Part Three", "date": "2026-12-18"}]').claims).toEqual([{ title: "Dune: Part Three", date: "2026-12-18" }]);
		expect(splitAnswer('Move to Dec 11.\n```json\n{"recommended": "2026-12-11", "releases": [{"title": "Avengers: Doomsday", "date": "2026-12-18"}]}\n```')).toEqual({
			answer: "Move to Dec 11.",
			claims: [{ title: "Avengers: Doomsday", date: "2026-12-18" }],
			recommended: "2026-12-11",
		});
		expect(splitAnswer('Hold.\n```json\n{"recommended": null, "releases": []}\n```')).toEqual({ answer: "Hold.", claims: [] });
		expect(splitAnswer("Hold the date.")).toEqual({ answer: "Hold the date." });
		expect(splitAnswer("Hold.\n```json\n[not json\n```").claims).toBeUndefined();
	});
});

describe("matching claims to the slate", () => {
	it("matches by title, alias, franchise, subtitle and long containment only", () => {
		expect(titleKey("The Cat in the Hat (2026 film)")).toBe("cat in the hat");
		const one = (q: string) => findOnSlate(q, SLATE).map((t) => t.title);
		expect(one("Avengers: Doomsday")).toEqual(["Avengers: Doomsday"]);
		expect(one("GTA 6")).toEqual(["Grand Theft Auto VI"]);
		expect(one("Narnia")).toEqual(["Narnia: The Magician's Nephew"]);
		expect(one("Sunrise on the Reaping")).toEqual(["The Hunger Games: Sunrise on the Reaping"]);
		expect(one("Hunger Games: Sunrise on the Reaping")).toEqual(["The Hunger Games: Sunrise on the Reaping"]);
		expect(one("Jumanji 3")).toEqual([]);
		expect(one("Avengers")).toEqual(["Avengers: Doomsday"]);
		expect(one("Hex")).toEqual([]);
		expect(one("Wild Horse Nine")).toEqual(["Wild Horse Nine", "Wild Horse Nine"]);
	});

	it("spots mentions in free text", () => {
		expect(mentions("Watch out for Sunrise on the Reaping in November.", SLATE[2] as (typeof SLATE)[number])).toBe(true);
		expect(mentions("GTA VI lands the day before.", SLATE[7] as (typeof SLATE)[number])).toBe(true);
		expect(mentions("Avengers will dominate December.", SLATE[0] as (typeof SLATE)[number])).toBe(true);
		expect(mentions("Hexed opens late November.", SLATE[6] as (typeof SLATE)[number])).toBe(true);
		expect(mentions("Nothing relevant here.", SLATE[3] as (typeof SLATE)[number])).toBe(false);
	});
});

describe("checkClaims", () => {
	it("grades each date and lists the top rivals the answer missed", () => {
		const result = checkClaims({
			claims: [
				{ title: "Avengers: Doomsday", date: "2026-12-18" },
				{ title: "Narnia: The Magician's Nephew", date: "2026-11-26" },
				{ title: "Hexed", date: "Nov 27" },
				{ title: "Jumanji 3", date: "2026-12-11" },
				{ title: "Shrek 5", date: "2027-06-30" },
				{ title: "Dune: Part Three", date: null },
				{ title: "Wild Horse Nine", date: "2026-11-20" },
				{ title: "The Cat in the Hat", date: "2026-12" },
			],
			slate: SLATE,
			window: WINDOW,
			answer: "Hold Dec 18 against Avengers.",
			top: [SLATE[0], SLATE[2], SLATE[7]] as typeof SLATE,
		});
		expect(result.claims.map((c) => [c.title, c.status, c.slate?.date])).toEqual([
			["Avengers: Doomsday", "right-date", "2026-12-18"],
			["Narnia: The Magician's Nephew", "wrong-date", "2027-02-12"],
			["Hexed", "right-week", "2026-11-25"],
			["Jumanji 3", "not-on-slate", undefined],
			["Shrek 5", "outside-window", undefined],
			["Dune: Part Three", "no-date", "2026-12-18"],
			["Wild Horse Nine", "right-date", "2026-11-20"],
			["The Cat in the Hat", "no-date", "2026-11-06"],
		]);
		expect(result.claims[7]?.saidText).toBe("2026-12");
		expect(result.counts).toEqual({ "right-date": 2, "right-week": 1, "wrong-date": 1, "no-date": 2, "not-on-slate": 1, "outside-window": 1 });
		expect(result.missed).toEqual([
			{ title: "The Hunger Games: Sunrise on the Reaping", date: "2026-11-20" },
			{ title: "Grand Theft Auto VI", date: "2026-11-19" },
		]);
		expect(result.topChecked).toBe(3);
	});
});

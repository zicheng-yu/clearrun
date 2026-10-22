import { describe, expect, it } from "vitest";
import { releaseWeek } from "../src/shared/dates.ts";
import { parseFilmList, quarterSections } from "../src/engine/wiki/parse.ts";
import { diffSlates } from "../src/engine/slate/diff.ts";
import type { SlateSnapshot } from "../src/shared/types.ts";

// Synthetic wikitext in the shape of Wikipedia's release tables, including the misspelled month label.
const WIKITEXT = [
	'! rowspan="3" style="text-align:center" data-sort-value="11" |<span aria-label="November">N<br>O<br>V</span>',
	"| rowspan=\"2\" style=\"text-align:center\" | '''20'''",
	"| ''[[Film One]]'' || Studio A || Cast",
	"|-",
	"| ''[[Film Two (2026 film)|Film Two]]'' || Studio B || Cast",
	'! rowspan="2" style="text-align:center" data-sort-value="12" |<span aria-label="Decmber">D<br>E<br>C</span>',
	"| style=\"text-align:center\" | '''18'''",
	"| ''[[Film Three]]'' || Studio C || Cast",
	"| Not a title row",
].join("\n");

describe("parseFilmList", () => {
	it("reads months from data-sort-value, carries days across rowspans and keeps display titles", () => {
		expect(parseFilmList(WIKITEXT, 2026)).toEqual([
			{ date: "2026-11-20", title: "Film One", page: "Film One" },
			{ date: "2026-11-20", title: "Film Two", page: "Film Two (2026 film)" },
			{ date: "2026-12-18", title: "Film Three", page: "Film Three" },
		]);
	});
});

// The older layout (2023–2024 lists): months spelled vertically, sometimes in bold, and repeated style attributes.
const OLDER = [
	'! rowspan="22" style="text-align:center; background:#f7bf87;" |J<br>U<br>L<br>Y',
	"| rowspan=\"6\" style=\"text-align:center;\" style=\"text-align:center;background:#f7dfc7\" | '''21'''",
	"| ''[[Barbie (film)|Barbie]]'' || Warner Bros. || Cast",
	"|-",
	"| ''Unlinked Film'' || Studio || Cast",
	"| rowspan=\"43\" style=\"text-align:center; background:#bf87f7; text color:#000;\" |'''N<br>O<br>V<br>E<br>M<br>B<br>E<br>R'''",
	"| rowspan=\"2\" style=\"text-align:center;background:#c7f7df\"| '''22'''",
	"| ''[[Gladiator II]]'' || Paramount || Cast",
].join("\n");

describe("parseFilmList on older lists", () => {
	it("reads vertically spelled months and skips titles without a page", () => {
		expect(parseFilmList(OLDER, 2024)).toEqual([
			{ date: "2024-07-21", title: "Barbie", page: "Barbie (film)" },
			{ date: "2024-11-22", title: "Gladiator II", page: "Gladiator II" },
		]);
	});
});

describe("quarterSections", () => {
	it("picks the quarterly tables that overlap the window", () => {
		const sections = [
			{ index: "1", line: "Box office" },
			{ index: "2", line: "January–March" },
			{ index: "3", line: "April–June" },
			{ index: "4", line: "July–September" },
			{ index: "5", line: "October–December" },
		];
		expect(quarterSections(sections, 2026, "2026-10-22", "2027-04-20")).toEqual(["5"]);
		expect(quarterSections(sections, 2027, "2026-10-22", "2027-04-20")).toEqual(["2", "3"]);
	});
});

describe("releaseWeek", () => {
	it("maps each opening day to the Friday of its release weekend", () => {
		expect(releaseWeek("2026-12-18")).toBe("2026-12-18"); // Friday
		expect(releaseWeek("2026-11-25")).toBe("2026-11-27"); // Wednesday before Thanksgiving
		expect(releaseWeek("2026-11-19")).toBe("2026-11-20"); // Thursday
		expect(releaseWeek("2026-12-25")).toBe("2026-12-25"); // Friday
		expect(releaseWeek("2026-12-22")).toBe("2026-12-18"); // Tuesday
	});
});

describe("diffSlates", () => {
	const base = (titles: { id: string; date: string }[]): SlateSnapshot => ({
		id: "s",
		createdAt: 0,
		windowStart: "2026-10-22",
		windowEnd: "2027-04-20",
		titles: titles.map((t) => ({ ...t, kind: "film" as const, title: t.id, page: t.id, week: releaseWeek(t.date) })),
		stats: { titles: titles.length, withWikidata: 0, mappedToQloo: 0, withViews: 0 },
	});
	it("reports moves, new entrants and removals", () => {
		const before = base([
			{ id: "A", date: "2026-12-18" },
			{ id: "B", date: "2026-11-20" },
		]);
		const after = base([
			{ id: "A", date: "2027-01-15" },
			{ id: "C", date: "2027-02-05" },
		]);
		expect(diffSlates(before, after)).toEqual([
			{ kind: "moved", id: "A", title: "A", from: "2026-12-18", to: "2027-01-15" },
			{ kind: "added", id: "C", title: "C", to: "2027-02-05" },
			{ kind: "removed", id: "B", title: "B", from: "2026-11-20" },
		]);
	});
});

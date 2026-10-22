import { describe, expect, it } from "vitest";
import type { BacktestResult } from "../src/engine/backtest/run.ts";
import { analyze } from "../src/engine/score/analyze.ts";
import { fmtDay } from "../src/engine/score/narrate.ts";
import { backtestShare, CARD_VERSION, planShare } from "../src/engine/share/card.ts";
import { cardSvg } from "../src/engine/share/svg.ts";
import { ellipsize, escapeXml, fitSize, textWidth, wrap } from "../src/engine/share/text.ts";
import { encodePng } from "../src/worker/og/png.ts";
import { inflateSync } from "node:zlib";

describe("card text layout", () => {
	it("measures, fits and cuts text with the fonts' metrics", () => {
		expect(textWidth("WWW", "text", 20)).toBeGreaterThan(textWidth("iii", "text", 20));
		expect(textWidth("ABC", "mono", 10)).toBeCloseTo(18, 0);
		const size = fitSize("MOVE TO MAR 12?", "display", 500, 160, 60);
		expect(size).toBeLessThan(160);
		expect(textWidth("MOVE TO MAR 12?", "display", size)).toBeLessThanOrEqual(500);
		expect(fitSize("HI", "display", 500, 160, 60)).toBe(160);
		const cut = ellipsize("The Hunger Games: Sunrise on the Reaping", "text", 20, 200);
		expect(cut.endsWith("…")).toBe(true);
		expect(textWidth(cut, "text", 20)).toBeLessThanOrEqual(200);
		const lines = wrap("Find the week your audience is free", "display", 124, 1072, 2);
		expect(lines).toEqual(["Find the week your", "audience is free"]);
		expect(wrap("one two three four five six seven eight", "text", 20, 120, 2).at(-1)?.endsWith("…")).toBe(true);
		expect(escapeXml(`Fast & "Furious" <2>`)).toBe("Fast &amp; &quot;Furious&quot; &lt;2&gt;");
	});
});

describe("share cards", () => {
	const rivals = [
		{ id: "A", title: "Alpha & Omega", kind: "film" as const, date: "2026-11-20", week: "2026-11-20", size: 1, overlap: 1 },
		{ id: "B", title: "Bravo", kind: "film" as const, date: "2026-12-18", week: "2026-12-18", size: 0.6, overlap: 0.8 },
		{ id: "C", title: "Charlie", kind: "film" as const, date: "2027-01-15", week: "2027-01-15", size: 0.3, overlap: 0.2 },
		{ id: "D", title: "Delta", kind: "film" as const, date: "2026-11-13", week: "2026-11-13", size: 0.5 },
	];
	const base = { rivals, windowStart: "2026-11-06", windowEnd: "2027-01-29", from: "2026-11-06" };
	const share = (yourWeek?: string, title?: string) =>
		planShare({ analysis: analyze({ ...base, yourWeek }), rivals, context: "Test", comps: ["Comp One", "Comp Two"], title, slateAt: Date.parse("2026-10-22T09:00:00Z") });

	it("says move, with your week's pressure and the clearest alternative, for a crowded dated title", () => {
		const { card, meta } = share("2026-11-20", "Yours");
		const best = card.strip.find((w) => w.focus)?.week ?? "";
		expect(card).toMatchObject({ kind: "plan", v: CARD_VERSION, tone: "move", title: "Yours", comps: ["Comp One", "Comp Two"] });
		expect(card.strip.every((w) => Number.isInteger(w.p * 20))).toBe(true);
		expect(card.headline).toBe(`Move to ${fmtDay(best)}?`);
		expect(card.stats.map((s) => s.tone)).toEqual(["hot", "marquee"]);
		expect(card.stats[0]?.note).toBe("Mostly Alpha & Omega (opening that week)");
		expect(card.strip.find((w) => w.you)?.week).toBe("2026-11-20");
		// Weeks too late for a full four-week run are faded, as on the page.
		expect(card.strip.at(-1)?.faded).toBe(true);
		expect(meta.title).toBe(`Move Yours to ${fmtDay(best)}? · Test · Clear Run`);
		expect(meta.description).toMatch(/^For fans of Comp One and Comp Two, the week of Nov 20 rates pressure 100 of 100, mostly from Alpha & Omega/);
		expect(meta.description).toMatch(/not a box-office forecast\.$/);
	});

	it("says hold when your week is the clearest, and names the clearest week for an undated plan", () => {
		const best = share("2026-11-20").card.strip.find((w) => w.focus)?.week ?? "";
		const hold = share(best, "Yours");
		expect(hold.card.tone).toBe("hold");
		expect(hold.card.headline).toBe(`Hold ${fmtDay(best)}`);
		expect(hold.meta.title).toBe(`Hold Yours on ${fmtDay(best)} · Test · Clear Run`);
		const pick = share();
		expect(pick.card.tone).toBe("pick");
		expect(pick.card.headline).toBe(`Week of ${fmtDay(best)}`);
		expect(pick.card.strip.some((w) => w.you)).toBe(false);
		expect(pick.meta.title).toBe(`The clearest week for fans of Comp One and Comp Two: ${fmtDay(best)} · Test · Clear Run`);
	});

	it("draws every card as a 1200×630 SVG with its text escaped", () => {
		const cases: BacktestResult[] = [
			{
				id: "x",
				name: "X",
				question: "q",
				date: "2023-07-21",
				asOf: "2023-05-26",
				windowEnd: "2023-11-10",
				from: "2023-06-23",
				sides: [
					{
						title: "Barbie",
						date: "2023-07-21",
						week: "2023-07-21",
						rival: { title: "Oppenheimer", date: "2023-07-21" },
						pre: { overlap: 0.3, rank: 41, of: 59 },
						today: { overlap: 0.8, rank: 12, of: 59 },
						closest: [],
					},
				],
				coverage: { titles: 60, mapped: 60, scored: { pre: 59, today: 59 } },
				computedAt: 0,
			},
		];
		const backtests = backtestShare(cases);
		expect(backtests.card.rows).toEqual([{ audience: "Barbie", rival: "Oppenheimer", pre: { overlap: 0.3, rank: 41, of: 59 }, today: { overlap: 0.8, rank: 12, of: 59 } }]);
		expect(backtests.meta.description).toMatch(/^For Barbie fans, Oppenheimer ranked #41 of 59 rivals before release and ranks #12 in Qloo's graph today\./);
		for (const card of [share("2026-11-20", "Yours").card, share().card, backtests.card, { kind: "home" as const, v: CARD_VERSION }]) {
			const svg = cardSvg(card);
			expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"`)).toBe(true);
			expect(svg).not.toMatch(/undefined|NaN|Infinity/);
			expect(svg).not.toMatch(/& /);
		}
		expect(cardSvg(share("2026-11-20", "Yours").card)).toContain("Mostly Alpha &amp; Omega");
		expect(cardSvg({ ...share().card, demo: true })).toContain("Offline demo");
	});
});

describe("card PNG encoding", () => {
	it("writes a valid RGBA PNG whose rows inflate back to the pixels", async () => {
		const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 14, 14, 17, 255]);
		const png = await encodePng(rgba, 2, 2);
		expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
		const view = new DataView(png.buffer, png.byteOffset);
		expect(new TextDecoder().decode(png.subarray(12, 16))).toBe("IHDR");
		expect([view.getUint32(16), view.getUint32(20), png[24], png[25]]).toEqual([2, 2, 8, 6]);
		const idat = view.getUint32(33);
		expect(new TextDecoder().decode(png.subarray(37, 41))).toBe("IDAT");
		const rows = inflateSync(png.subarray(41, 41 + idat));
		expect([...rows]).toEqual([0, ...rgba.subarray(0, 8), 0, ...rgba.subarray(8)]);
		expect(new TextDecoder().decode(png.subarray(png.length - 8, png.length - 4))).toBe("IEND");
	});
});

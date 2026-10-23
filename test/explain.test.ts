import { describe, expect, it } from "vitest";
import { reduceCompare } from "../src/engine/explain/compare.ts";
import { describeProfile, reduceDemographics } from "../src/engine/explain/demographics.ts";

describe("reduceCompare", () => {
	it("keeps the best score per shared tag and lists tags only one side has", () => {
		const raw = {
			results: {
				tags: [
					{ name: "Adventure", subtype: "urn:tag:genre:media", query: { score: 0.9 } },
					{ name: "Epic", subtype: "urn:tag:plot:qloo", query: { score: 0.8 } },
					{ name: "Adventure", subtype: "urn:tag:genre:qloo", query: { score: 0.7 } },
				],
				a: [
					{ name: "Prophecy", subtype: "urn:tag:keyword:qloo", query: { count: "1" } },
					{ name: "Epic", subtype: "urn:tag:plot:qloo", query: { count: "2" } },
					{ name: "Philosophical", subtype: "urn:tag:style:qloo", query: { count: "2" } },
					{ name: "Science fiction", subtype: "urn:tag:genre:qloo", query: { count: "2" } },
				],
				b: [
					{ name: "Science fiction", subtype: "urn:tag:genre:qloo", query: { count: "1" } },
					{ name: "Time Travel", subtype: "urn:tag:keyword:qloo", query: { count: "1" } },
				],
			},
		};
		expect(reduceCompare(raw)).toEqual({
			shared: [
				{ name: "Adventure", kind: "genre", score: 0.9 },
				{ name: "Epic", kind: "plot", score: 0.8 },
			],
			onlyYours: [
				{ name: "Philosophical", kind: "style" },
				{ name: "Prophecy", kind: "keyword" },
			],
			onlyTheirs: [{ name: "Time Travel", kind: "keyword" }],
		});
		expect(reduceCompare({})).toEqual({ shared: [], onlyYours: [], onlyTheirs: [] });
	});
});

describe("demographics", () => {
	it("averages comps and describes the skew", () => {
		const entry = (young: number, male: number) => ({
			query: { age: { "24_and_younger": young, "25_to_29": 0.4, "30_to_34": 0.3, "35_to_44": -0.6, "45_to_54": -0.4, "55_and_older": -0.5 }, gender: { male } },
		});
		const p = reduceDemographics({ results: { demographics: [entry(0.4, 0.25), entry(0, 0.25)] } });
		expect(p).toMatchObject({ comps: 2, male: 0.25, summary: "Skews under 35, leans male" });
		expect(p?.age["24_and_younger"]).toBe(0.2);
		expect(reduceDemographics({ results: { demographics: [] } })).toBeUndefined();
	});

	it("names gaps between over-indexed bands and gender balance", () => {
		const age = { "24_and_younger": -0.1, "25_to_29": 0.2, "30_to_34": 0, "35_to_44": 0, "45_to_54": 0.3, "55_and_older": 0.4 };
		expect(describeProfile(age, 0)).toBe("Skews 25–29 and 45+, gender-balanced");
		expect(describeProfile({ ...age, "25_to_29": 0 }, -0.2)).toBe("Skews 45+, leans female");
	});
});

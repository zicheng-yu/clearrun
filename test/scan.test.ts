import { describe, expect, it } from "vitest";
import { scanAffinities } from "../src/engine/qloo/scan.ts";

const A = "AAAAAAAA-0000-0000-0000-000000000001";
const B = "BBBBBBBB-0000-0000-0000-000000000002";
const NESTED = "CCCCCCCC-0000-0000-0000-000000000003";

describe("scanAffinities", () => {
	it("pairs each requested entity with its own affinity, compact or pretty-printed", () => {
		const body = {
			success: true,
			results: {
				entities: [
					{
						name: "A",
						entity_id: A,
						properties: { related: [{ entity_id: NESTED }] },
						tags: [{ id: "urn:tag:x" }],
						query: { affinity: 0.9491, measurements: { audience_growth: 0 } },
					},
					{ name: "B", entity_id: B.toLowerCase(), query: { affinity: 8.5e-1 } },
				],
			},
		};
		for (const text of [JSON.stringify(body), JSON.stringify(body, null, 2)]) {
			expect(Object.fromEntries(scanAffinities(text, [A, B]))).toEqual({ [A]: 0.9491, [B]: 0.85 });
		}
	});

	it("ignores entities that were not requested and results with no affinity", () => {
		const text = JSON.stringify({ results: { entities: [{ entity_id: NESTED, query: { affinity: 0.7 } }, { entity_id: A }, { entity_id: B, query: { affinity: 0.8 } }] } });
		expect(Object.fromEntries(scanAffinities(text, [A, B]))).toEqual({ [B]: 0.8 });
	});
});

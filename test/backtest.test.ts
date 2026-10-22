import { describe, expect, it } from "vitest";
import { runBacktest, type SideScores } from "../src/engine/backtest/run.ts";
import type { BacktestCase, BacktestTitle } from "../src/shared/backtests.ts";

const c: BacktestCase = { id: "t", name: "Test", question: "q", date: "2023-07-21", pair: ["A (film)", "B (film)"], asOf: "2023-05-26", windowEnd: "2023-11-10" };
const titles: BacktestTitle[] = [
	{ title: "A", page: "A (film)", date: "2023-07-21", qid: "QA", views: 300_000 },
	{ title: "B", page: "B (film)", date: "2023-07-21", qid: "QB", views: 900_000 },
	{ title: "C", page: "C", date: "2023-07-28", qid: "QC", views: 200_000 },
	{ title: "D", page: "D", date: "2023-08-04", qid: "QD", views: 100_000 },
	{ title: "E", page: "E", date: "2023-06-30", qid: "QE", views: 500_000 },
];
const qloo = { QA: "IA", QB: "IB", QC: "IC", QD: "ID", QE: null };
// Before release, A's audience is closest to C, then D, then B; today's graph puts B first.
const scores: SideScores[] = [
	{ pre: { IB: 0.8, IC: 0.95, ID: 0.9 }, today: { IB: 0.97, IC: 0.9, ID: 0.85 } },
	{ pre: { IA: 0.82, IC: 0.85, ID: 0.8 }, today: { IA: 0.96, IC: 0.8, ID: 0.7 } },
];

describe("runBacktest", () => {
	const result = runBacktest({ c, titles, qloo, scores, now: 1 });

	it("ranks the pair's other film for each audience, before release and today", () => {
		const [a, b] = result.sides;
		expect(a).toMatchObject({ title: "A", rival: { title: "B" }, pre: { rank: 3, of: 3, overlap: 0 }, today: { rank: 1, of: 3, overlap: 1 } });
		expect(a?.closest.map((x) => x.title)).toEqual(["C", "D", "B"]);
		expect(b).toMatchObject({ title: "B", rival: { title: "A" }, pre: { rank: 2, of: 3, overlap: 0.5 }, today: { rank: 1, of: 3 } });
	});

	it("plans each film from content-based scores, starting four weeks after the planning day", () => {
		expect(result.from).toBe("2023-06-23");
		const [a, b] = result.sides.map((s) => s.plan);
		expect(a?.of).toBeGreaterThan(10);
		// The lowest-overlap rival (percentile 0) adds no pressure; a mid-ranked one adds some.
		expect(a?.rivalShare).toBe(0);
		expect(b?.rivalShare).toBeGreaterThan(0);
		expect(b?.rivalShare).toBeLessThan(1);
		// E has no Qloo match, so it adds attention but no pressure.
		expect(a?.threats.map((t) => t.title)).not.toContain("E");
	});

	it("reports coverage", () => {
		expect(result.coverage).toEqual({ titles: 5, mapped: 4, scored: { pre: 3, today: 3 } });
	});
});

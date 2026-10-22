/**
 * The offline demo (`npm run dev:mock`). On the first request, an empty local database gets the frozen copy
 * of the release slate (with synthetic Qloo IDs for every tagged film), the featured scenarios are scored, their
 * watches are created, and the backtests run, all against the synthetic Qloo (engine/qloo/mock). Nothing needs
 * a key or the network.
 */
import { DEMO_SLATE, DEMO_TAGS } from "../engine/qloo/mock/fixtures.ts";
import { mockId } from "../engine/qloo/mock/model.ts";
import { SCENARIOS } from "../shared/scenarios.ts";
import type { SlateSnapshot } from "../shared/types.ts";
import { runBacktestStep } from "./backtest.ts";
import { planStep } from "./plan.ts";
import type { QlooClient } from "./qloo.ts";
import { latestSnapshot, saveSnapshot } from "./store.ts";
import { seedFeatured } from "./watch.ts";

export function demoSnapshot(): SlateSnapshot {
	const titles = DEMO_SLATE.titles.map((t) => (t.kind === "film" && t.wikidata && DEMO_TAGS[t.wikidata] ? { ...t, qloo: { id: mockId(t.wikidata), name: t.title } } : t));
	return {
		id: "demo-slate",
		createdAt: DEMO_SLATE.createdAt,
		windowStart: DEMO_SLATE.windowStart,
		windowEnd: DEMO_SLATE.windowEnd,
		titles,
		stats: {
			titles: titles.length,
			withWikidata: titles.filter((t) => t.wikidata).length,
			mappedToQloo: titles.filter((t) => t.qloo).length,
			withViews: titles.filter((t) => typeof t.views30d === "number").length,
		},
	};
}

/** Loads the frozen slate into an empty database and computes everything the demo shows. */
export async function seedDemo(db: D1Database, qloo: QlooClient): Promise<void> {
	if (!(await latestSnapshot(db))) await saveSnapshot(db, demoSnapshot(), []);
	// Score the featured audiences first (the synthetic Qloo has no limits), so their watches can be created.
	for (const s of SCENARIOS) {
		for (let step = 0; step < 10; step++) if ((await planStep({ db, qloo }, { comps: s.comps.map((c) => c.id), you: s.you })).status === "ready") break;
	}
	await seedFeatured({ db, qloo });
	for (let step = 0; step < 60; step++) {
		const result = await runBacktestStep({ db, qloo });
		if (result.phase === "done" || result.error) break;
	}
}

let seeded: Promise<void> | undefined;

/** Seeds the demo once per isolate; a failed attempt is retried on the next request. */
export function ensureDemo(db: D1Database, qloo: QlooClient): Promise<void> {
	seeded ??= seedDemo(db, qloo).catch((error: unknown) => {
		seeded = undefined;
		throw error;
	});
	return seeded;
}

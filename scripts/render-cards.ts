/**
 * Renders share cards in Node with the same templates and fonts the Worker uses.
 * - Always: the site's default card, public/og.png (no data on it, so it's committed and served as a static asset).
 * - With a site URL (node scripts/render-cards.ts https://clearrun.zichengyu.com): the featured scenarios' cards and the
 *   backtests card from that site's public API, into /tmp/clearrun-cards for a look. They carry Qloo-derived numbers, so they
 *   stay out of the repo.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import type { BacktestResult } from "../src/engine/backtest/run.ts";
import { backtestShare, CARD_VERSION, planShare, type Card } from "../src/engine/share/card.ts";
import { cardSvg } from "../src/engine/share/svg.ts";
import { analyze } from "../src/engine/score/analyze.ts";
import { leadWeek, listWeeks } from "../src/engine/score/calendar.ts";
import { isoDay } from "../src/shared/dates.ts";
import { SCENARIOS } from "../src/shared/scenarios.ts";
import type { PlanResponse, SlateSnapshot } from "../src/shared/types.ts";

await initWasm(readFileSync("node_modules/@resvg/resvg-wasm/index_bg.wasm"));
const fonts = ["BebasNeue-Regular", "Inter-Regular", "Inter-SemiBold", "JetBrainsMono-Medium"].map((f) => new Uint8Array(readFileSync(`src/worker/og/fonts/${f}.bin`)));

function render(card: Card): { png: Uint8Array; ms: number } {
	const start = performance.now();
	const resvg = new Resvg(cardSvg(card), { font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: "Inter" }, fitTo: { mode: "original" } });
	const png = resvg.render().asPng();
	resvg.free();
	return { png, ms: Math.round(performance.now() - start) };
}

mkdirSync("public", { recursive: true });
const home = render({ kind: "home", v: CARD_VERSION });
writeFileSync("public/og.png", home.png);
console.log(`public/og.png: ${home.png.length} bytes, ${home.ms} ms`);

const site = process.argv[2];
if (site) {
	const out = "/tmp/clearrun-cards";
	mkdirSync(out, { recursive: true });
	const slate = (await (await fetch(`${site}/api/slate`)).json()) as SlateSnapshot;
	const weeks = listWeeks(slate.windowStart, slate.windowEnd);
	for (const s of SCENARIOS) {
		const plan = (await (
			await fetch(`${site}/api/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comps: s.comps.map((c) => c.id), you: s.you }) })
		).json()) as PlanResponse;
		if (plan.status !== "ready") {
			console.log(`${s.id}: still scoring`);
			continue;
		}
		const from = s.from && weeks.includes(s.from) ? s.from : leadWeek(weeks, isoDay(new Date()));
		const analysis = analyze({ rivals: plan.rivals, windowStart: slate.windowStart, windowEnd: slate.windowEnd, from, yourWeek: plan.you?.week, weeks });
		const { card, meta } = planShare({
			analysis,
			rivals: plan.rivals,
			context: s.name,
			comps: s.comps.map((c) => c.short ?? c.name),
			title: plan.you?.title,
			slateAt: slate.createdAt,
		});
		const { png, ms } = render(card);
		writeFileSync(`${out}/${s.id}.png`, png);
		writeFileSync(`${out}/${s.id}.json`, JSON.stringify(card));
		console.log(`${s.id}: ${png.length} bytes, ${ms} ms\n  ${meta.title}\n  ${meta.description}`);
		// A dated title moved to its clearest alternative shows the "hold" card.
		const best = analysis.verdict && !analysis.verdict.hold ? analysis.verdict.best : undefined;
		if (best) {
			const held = analyze({ rivals: plan.rivals, windowStart: slate.windowStart, windowEnd: slate.windowEnd, from, yourWeek: best, weeks });
			const hold = planShare({
				analysis: held,
				rivals: plan.rivals,
				context: s.name,
				comps: s.comps.map((c) => c.short ?? c.name),
				title: plan.you?.title,
				slateAt: slate.createdAt,
			});
			writeFileSync(`${out}/${s.id}-hold.png`, render(hold.card).png);
			console.log(`  hold variant: ${hold.meta.title}`);
		}
	}
	const { cases } = (await (await fetch(`${site}/api/backtests`)).json()) as { cases: BacktestResult[] };
	if (cases.length) {
		const { card, meta } = backtestShare(cases);
		const { png, ms } = render(card);
		writeFileSync(`${out}/backtests.png`, png);
		console.log(`backtests: ${png.length} bytes, ${ms} ms\n  ${meta.title}\n  ${meta.description}`);
	}
}

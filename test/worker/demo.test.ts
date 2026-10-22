/**
 * The offline demo end to end: the frozen slate, synthetic Qloo, plans, explanations, watches, backtests and the
 * scripted agent, on an in-memory D1. One database per file (the schema is created once per module instance).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_TAGS } from "../../src/engine/qloo/mock/fixtures.ts";
import { affinity, mockId, tagsOf } from "../../src/engine/qloo/mock/model.ts";
import { demoQloo } from "../../src/engine/qloo/mock/transport.ts";
import { SCENARIOS } from "../../src/shared/scenarios.ts";
import { agentStep } from "../../src/worker/agent.ts";
import { backtests } from "../../src/worker/backtest.ts";
import { demoSnapshot, seedDemo } from "../../src/worker/demo.ts";
import { audienceOf, compareWithRival } from "../../src/worker/explain.ts";
import { planStep } from "../../src/worker/plan.ts";
import { QlooClient } from "../../src/worker/qloo.ts";
import { getWatch } from "../../src/worker/watch.ts";
import { memoryD1 } from "./d1.ts";

const db = memoryD1();
const qloo = new QlooClient({ apiKey: "demo", db, monthlyCap: 0, dailyCap: 0, globalReserve: 0, transport: demoQloo });
const dune = SCENARIOS.find((s) => s.id === "dunesday");
const duneThree = demoSnapshot().titles.find((t) => t.title === "Dune: Part Three");

beforeAll(() => seedDemo(db, qloo));

async function ask(question: string) {
	const ctx = { db, qloo, client: "test", dailyRuns: 100 };
	let res = await agentStep(ctx, { question });
	for (let i = 0; !res.done && i < 10; i++) res = await agentStep(ctx, { runId: res.runId, after: res.total });
	const answer = res.events.find((e) => e.type === "answer");
	return { res, answer: answer?.type === "answer" ? answer : undefined };
}

describe("synthetic Qloo", () => {
	it("gives every tagged film a stable synthetic ID that can't pass for a real Qloo ID", () => {
		const id = mockId("Q124714245");
		expect(id).toBe(mockId("Q124714245"));
		expect(id).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-0[0-9A-F]{3}-8[0-9A-F]{3}-[0-9A-F]{12}$/);
		expect(tagsOf(id)).toEqual(DEMO_TAGS.Q124714245);
	});

	it("scores a franchise's next film highest for fans of the earlier ones", async () => {
		const plan = await planStep({ db, qloo }, { comps: dune?.comps.map((c) => c.id) });
		expect(plan.status).toBe("ready");
		if (plan.status !== "ready") return;
		const top = [...plan.rivals].filter((r) => r.kind === "film" && r.overlap !== undefined).sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0))[0];
		expect(top?.title).toBe("Dune: Part Three");
		expect(plan.coverage.scored).toBeGreaterThan(80);
	});

	it("puts horror first for horror fans", async () => {
		const horror = SCENARIOS.find((s) => s.id === "horror");
		const plan = await planStep({ db, qloo }, { comps: horror?.comps.map((c) => c.id) });
		if (plan.status !== "ready") throw new Error("not ready");
		const top3 = [...plan.rivals]
			.filter((r) => r.kind === "film")
			.sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0))
			.slice(0, 3);
		for (const r of top3) expect(tagsOf(r.qlooId ?? "")).toContain("horror");
	});

	it("explains overlap with shared tags and gives a demographic profile", async () => {
		const comps = dune?.comps.map((c) => c.id) ?? [];
		const cmp = await compareWithRival(qloo, comps, duneThree?.qloo?.id ?? "");
		expect(cmp.shared.map((t) => t.name)).toContain("Dune franchise");
		const profile = await audienceOf(qloo, comps);
		expect(profile?.comps).toBe(2);
		expect(profile?.summary).toMatch(/male/);
	});

	it("scores only titles it has tags for", () => {
		expect(affinity(["NOT-A-COMP"], mockId("Q124714245"))).toBeUndefined();
	});
});

describe("demo seed", () => {
	it("creates the featured watches and the backtests", async () => {
		for (const s of SCENARIOS) expect((await getWatch(db, s.id))?.featured).toBe(true);
		const cases = await backtests(db);
		expect(cases.map((c) => c.id)).toEqual(["barbenheimer", "glicked", "sonic-mufasa"]);
		for (const c of cases) {
			expect(c.demo).toBe(true);
			expect(c.sides).toHaveLength(2);
			expect(c.sides[0]?.pre?.of).toBeGreaterThan(40);
			expect(c.sides[0]?.plan?.of).toBeGreaterThan(10);
		}
	});
});

describe("scripted agent", () => {
	it("answers a featured question with its scenario's comps", async () => {
		const { res, answer } = await ask(dune?.question ?? "");
		expect(res.plan?.comps.map((c) => c.id).sort()).toEqual(dune?.comps.map((c) => c.id).sort());
		expect(answer?.model).toBe("scripted planner");
		expect(answer?.modelCalls).toBe(0);
		expect(answer?.text).toMatch(/Dune: Part Three/);
		expect(answer?.check.unverified).toEqual([]);
	});

	it("finds a dated sequel's predecessors as comps", async () => {
		const { res, answer } = await ask("Should Dune: Part Three keep its Dec 18 date?");
		expect(res.plan?.you).toBe(duneThree?.id);
		expect(res.plan?.comps.map((c) => c.name).sort()).toEqual(["Dune", "Dune: Part Two"]);
		expect(answer?.check.unverified).toEqual([]);
	});

	it("reads comps and a start date from a free-form question", async () => {
		const { res, answer } = await ask("When should an original horror film like Hereditary open in early 2027?");
		expect(res.plan?.comps.map((c) => c.name)).toEqual(["Hereditary"]);
		expect(res.plan?.from >= "2027-01-01").toBe(true);
		expect(answer?.text).toMatch(/^The clearest weeks for fans of Hereditary/);
	});

	it("takes over when the model's budget is spent, and isn't replayed once the model is back", async () => {
		// A zero budget makes the model call fail before any request goes out.
		const llm = { apiKey: "test", model: "test", fallbackModels: [], maxTokens: 100, dailyUsd: 0, totalUsd: 0, appUrl: "http://localhost" };
		const ctx = { db, qloo, llm, client: "test", dailyRuns: 100 };
		const question = "Find a clear winter week for a family film like The Wild Robot.";
		let res = await agentStep(ctx, { question });
		const events = [...res.events];
		for (let i = 0; !res.done && i < 10; i++) {
			res = await agentStep(ctx, { runId: res.runId, after: res.total });
			events.push(...res.events);
		}
		expect(events.find((e) => e.type === "thought")).toMatchObject({ text: expect.stringMatching(/budget for today is spent/) });
		expect(events.find((e) => e.type === "answer")).toMatchObject({ model: "scripted planner", modelCalls: 0 });
		const again = await agentStep(ctx, { question });
		expect(again.replay).toBeUndefined();
		expect(again.runId).not.toBe(res.runId);
	});

	it("asks for comps when it can't find any", async () => {
		const { res, answer } = await ask("What is the best week for my film?");
		expect(res.plan).toBeUndefined();
		expect(answer?.text).toMatch(/Name one or two released films/);
	});
});

describe("fallbacks", () => {
	const comps = dune?.comps.map((c) => c.id) ?? [];

	it("serves older cached scores when live scoring is off", async () => {
		await db.prepare("UPDATE affinity_cache SET created_at = 0").run();
		const plan = await planStep({ db }, { comps });
		expect(plan.status).toBe("ready");
		if (plan.status !== "ready") return;
		expect(plan.notice).toMatch(/scores cached earlier are shown/);
		expect(plan.coverage.scored).toBeGreaterThan(80);
	});

	it("serves them when Qloo fails, and fails when there's nothing cached", async () => {
		const down = new QlooClient({ apiKey: "demo", db, monthlyCap: 0, dailyCap: 0, globalReserve: 0, transport: async () => new Response("down", { status: 500 }) });
		const plan = await planStep({ db, qloo: down }, { comps });
		expect(plan.status === "ready" && plan.notice).toMatch(/didn't answer/);
		const horror = SCENARIOS.find((s) => s.id === "horror")?.comps.map((c) => c.id) ?? [];
		await db
			.prepare("DELETE FROM affinity_cache WHERE signal = ?1")
			.bind([...horror].sort().join(","))
			.run();
		await expect(planStep({ db, qloo: down }, { comps: horror })).rejects.toThrow(/Qloo/);
	});
});

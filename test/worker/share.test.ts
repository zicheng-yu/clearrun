/** Share links and link previews on the offline demo's in-memory database. */
import { beforeAll, describe, expect, it } from "vitest";
import { demoQloo } from "../../src/engine/qloo/mock/transport.ts";
import { SCENARIOS } from "../../src/shared/scenarios.ts";
import { agentStep } from "../../src/worker/agent.ts";
import { seedDemo } from "../../src/worker/demo.ts";
import { QlooClient } from "../../src/worker/qloo.ts";
import { createSharedPlan, linkOf, shareMeta, ShareInputError, ShareLimitError, sharedPlan, targetOf } from "../../src/worker/share.ts";
import { loadCard } from "../../src/worker/store.ts";
import { createWatch } from "../../src/worker/watch.ts";
import { memoryD1 } from "./d1.ts";

const db = memoryD1();
const qloo = new QlooClient({ apiKey: "demo", db, monthlyCap: 0, dailyCap: 0, globalReserve: 0, transport: demoQloo });
const ctx = { db, demo: true };
const origin = "https://clear.example";
const hashOf = (image: string) => /\/og\/([0-9a-f]{16})\.png$/.exec(image)?.[1] ?? "";

beforeAll(() => seedDemo(db, qloo));

describe("share targets", () => {
	it("reads a page URL the way the page does", () => {
		const read = (q: string) => targetOf(new URLSearchParams(q));
		expect(read("")).toEqual({ kind: "home" });
		expect(read("view=backtests&scenario=dunesday")).toEqual({ kind: "backtests" });
		expect(read("scenario=dunesday&run=abc-1")).toEqual({ kind: "run", id: "abc-1" });
		expect(read("watch=dunesday")).toEqual({ kind: "watch", id: "dunesday" });
		expect(read("plan=<script>")).toEqual({ kind: "home" });
		expect(linkOf(origin, { kind: "scenario", id: "dunesday" })).toBe(`${origin}/?scenario=dunesday`);
		expect(linkOf(origin, { kind: "backtests" })).toBe(`${origin}/?view=backtests`);
	});
});

describe("link previews", () => {
	it("gives a featured scenario its own card, stored once under its hash", async () => {
		const meta = await shareMeta(ctx, origin, { kind: "scenario", id: "dunesday" });
		expect(meta.url).toBe(`${origin}/?scenario=dunesday`);
		expect(meta.title).toMatch(/^(Move Dune: Part Three to \w{3} \d{1,2}\?|Hold Dune: Part Three on \w{3} \d{1,2}) · Dunesday · Clear Run$/);
		expect(meta.description).toMatch(/Offline demo/);
		const card = await loadCard(db, hashOf(meta.image));
		expect(JSON.parse(card?.body ?? "{}")).toMatchObject({ kind: "plan", context: "Dunesday", title: "Dune: Part Three", demo: true });
		expect((await shareMeta(ctx, origin, { kind: "scenario", id: "dunesday" })).image).toBe(meta.image);
	});

	it("falls back to the site's card for anything it can't show", async () => {
		for (const target of [{ kind: "home" as const }, { kind: "scenario" as const, id: "nope" }, { kind: "run" as const, id: "missing" }]) {
			expect((await shareMeta(ctx, origin, target)).image).toBe(`${origin}/og.png`);
		}
	});

	it("shows an agent run's plan, never its question", async () => {
		const question = "Should Dune: Part Three keep its Dec 18 date? VISIT EXAMPLE.COM NOW";
		const step = { db, qloo, client: "test", dailyRuns: 100 };
		let res = await agentStep(step, { question });
		for (let i = 0; !res.done && i < 10; i++) res = await agentStep(step, { runId: res.runId, after: res.total });
		const meta = await shareMeta(ctx, origin, { kind: "run", id: res.runId });
		expect(meta.title).toMatch(/· Release agent · Clear Run$/);
		const stored = (await loadCard(db, hashOf(meta.image)))?.body ?? "";
		for (const text of [meta.title, meta.description, meta.alt, stored]) expect(text).not.toMatch(/EXAMPLE\.COM/i);
	});

	it("shows a featured watch and the backtests", async () => {
		expect((await shareMeta(ctx, origin, { kind: "watch", id: "family" })).title).toMatch(/· Watched plan · Clear Run$/);
		const backtests = await shareMeta(ctx, origin, { kind: "backtests" });
		expect(backtests.title).toBe("Backtests: what the taste data knew before release · Clear Run");
		expect(JSON.parse((await loadCard(db, hashOf(backtests.image)))?.body ?? "{}").rows).toHaveLength(6);
	});
});

describe("shared plans", () => {
	const horror = SCENARIOS.find((s) => s.id === "horror")?.comps.map((c) => c.id) ?? [];

	it("names comps from Qloo and gives the same plan the same link", async () => {
		const made = await createSharedPlan({ ...ctx, qloo, client: "a", daily: 5 }, origin, { comps: horror, from: "2027-01-01" });
		expect(made.url).toBe(`${origin}/?plan=${made.id}`);
		expect(made.title).toMatch(/fans of Hereditary and Talk to Me.* · Shared plan · Clear Run$/);
		expect(await sharedPlan(db, made.id)).toEqual({
			id: made.id,
			comps: [expect.objectContaining({ name: "Hereditary" }), expect.objectContaining({ name: "Talk to Me" })],
			from: "2027-01-01",
		});
		const again = await createSharedPlan({ ...ctx, qloo, client: "a", daily: 5 }, origin, { comps: [...horror].reverse(), from: "2027-01-01" });
		expect(again.id).toBe(made.id);
	});

	it("refuses IDs Qloo doesn't know as films, and caps new links per address", async () => {
		await expect(createSharedPlan({ ...ctx, qloo, client: "b", daily: 5 }, origin, { comps: ["00000000-0000-4000-8000-000000000000"] })).rejects.toThrow(ShareInputError);
		const dune = SCENARIOS.find((s) => s.id === "dunesday")?.comps.map((c) => c.id) ?? [];
		await createSharedPlan({ ...ctx, qloo, client: "c", daily: 1 }, origin, { comps: dune });
		await expect(createSharedPlan({ ...ctx, qloo, client: "c", daily: 1 }, origin, { comps: horror })).rejects.toThrow(ShareLimitError);
	});

	it("names a visitor's watch comps from Qloo, not from the request", async () => {
		const comps = SCENARIOS.find((s) => s.id === "family")?.comps.map((c) => ({ id: c.id, name: "Buy tickets at example.com" })) ?? [];
		const watch = await createWatch({ db, qloo, client: "d", dailyWatches: 5 }, { comps, week: "2027-02-26" });
		expect(watch.comps.map((c) => c.name)).toEqual(["Paddington 2", "The Wild Robot"]);
	});
});

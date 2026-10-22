import { Hono, type Context } from "hono";
import { AgentInputError, AgentLimitError, agentRun, agentStep } from "./agent.ts";
import { BaselineEmptyError, BaselineInputError, runBaseline } from "./baseline.ts";
import { audienceOf, compareWithRival } from "./explain.ts";
import { BudgetExhaustedError, DEFAULT_MODEL, LlmError, type LlmConfig } from "./openrouter.ts";
import { normalizeComps, PlanInputError, planStep, SlateNotReadyError } from "./plan.ts";
import { QlooClient, QlooError, QlooQuotaError, searchFilms } from "./qloo.ts";
import type { Health } from "../shared/types.ts";
import { runSlateStep, slateIdle, JOB_NAME, type SlateJobState } from "./slate-job.ts";
import { latestSnapshot, llmSpend, loadJob, qlooUsage, recentChanges } from "./store.ts";
import { createWatch, getWatch, runWatchStep, seedFeatured, simulateWatch, WatchInputError, WatchLimitError, WatchNotReadyError } from "./watch.ts";

type AppContext = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>().basePath("/api");

function numberOr(value: string | undefined, fallback: number): number {
	const n = Number(value);
	return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** A Qloo client when live mode and the key are both present. */
function qlooFor(env: Env): QlooClient | undefined {
	const apiKey = env.QLOO_API_KEY?.trim();
	if (env.QLOO_MODE !== "live" || !apiKey) return undefined;
	return new QlooClient({
		apiKey,
		db: env.DB,
		monthlyCap: numberOr(env.QLOO_MONTHLY_CAP, 25_000),
		dailyCap: numberOr(env.QLOO_DAILY_CAP, 1_500),
		globalReserve: numberOr(env.QLOO_GLOBAL_RESERVE, 2_000),
	});
}

/** The agent's model settings when the LLM agent is on and its key is present. */
function llmFor(env: Env): LlmConfig | undefined {
	const apiKey = env.OPENROUTER_API_KEY?.trim();
	if (env.AGENT_MODE !== "llm" || !apiKey) return undefined;
	return {
		apiKey,
		model: env.LLM_MODEL || DEFAULT_MODEL,
		fallbackModels: (env.LLM_FALLBACK_MODELS ?? "")
			.split(",")
			.map((m) => m.trim())
			.filter(Boolean),
		// A ceiling; each call asks for less (and is billed only for what it uses).
		maxTokens: 3000,
		dailyUsd: numberOr(env.LLM_DAILY_USD, 0.4),
		totalUsd: numberOr(env.LLM_TOTAL_USD, 5),
		appUrl: "https://clearrun.zichengyu.com",
	};
}

/** A short hash of the client address: enough to cap runs per client without storing the address. */
async function clientKey(c: AppContext): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`clearrun:${c.req.header("cf-connecting-ip") ?? "local"}`));
	return [...new Uint8Array(digest)]
		.slice(0, 8)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

const QLOO_ID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

/** Per-IP limit on routes that can spend Qloo quota or model budget. */
async function rateLimited(c: AppContext): Promise<boolean> {
	const { success } = await c.env.RATE_LIMITER.limit({ key: c.req.header("cf-connecting-ip") ?? "local" });
	return !success;
}

function log(message: string, fields: Record<string, unknown> = {}): void {
	console.log(JSON.stringify({ message, ...fields }));
}

app.get("/health", async (c) => {
	const env = c.env;
	const [snapshot, job, spend, usage] = await Promise.all([latestSnapshot(env.DB), loadJob<SlateJobState>(env.DB, JOB_NAME), llmSpend(env.DB), qlooUsage(env.DB)]);
	const agent = llmFor(env) ? "llm" : "scripted";
	const body: Health = {
		name: "Clear Run",
		modes: { qloo: qlooFor(env) ? "live" : "mock", agent, model: agent === "llm" ? env.LLM_MODEL || DEFAULT_MODEL : undefined },
		slate: {
			snapshotId: snapshot?.id,
			createdAt: snapshot?.createdAt,
			stats: snapshot?.stats,
			job: job ? { phase: job.phase, updatedAt: job.updatedAt, error: job.error } : undefined,
		},
		budgets: {
			llm: {
				todayUsd: Math.round(spend.today * 1e5) / 1e5,
				totalUsd: Math.round(spend.total * 1e5) / 1e5,
				dailyCapUsd: numberOr(env.LLM_DAILY_USD, 0.4),
				totalCapUsd: numberOr(env.LLM_TOTAL_USD, 5),
			},
			qloo: {
				month: usage.month,
				calls: usage.calls,
				cap: numberOr(env.QLOO_MONTHLY_CAP, 25_000),
				today: usage.today,
				dailyCap: numberOr(env.QLOO_DAILY_CAP, 1_500),
				sharedRemaining: usage.sharedRemaining,
			},
		},
	};
	return c.json(body, 200, { "Cache-Control": "no-store" });
});

app.get("/slate", async (c) => {
	const snapshot = await latestSnapshot(c.env.DB);
	if (!snapshot) return c.json({ error: "slate_not_ready" }, 503);
	return c.json(snapshot, 200, { "Cache-Control": "public, max-age=300" });
});

app.get("/changes", async (c) => c.json(await recentChanges(c.env.DB), 200, { "Cache-Control": "public, max-age=300" }));

/** One step of a plan: scores up to two batches of rivals, or returns the finished plan. The browser repeats until ready. */
app.post("/plan", async (c) => {
	if (await rateLimited(c)) return c.json({ error: "rate_limited", message: "Too many plans from this address. Try again in a minute." }, 429);
	const body = await c.req.json<{ comps?: unknown; you?: unknown }>().catch(() => undefined);
	if (!body) return c.json({ error: "bad_request", message: "Expected a JSON body" }, 400);
	try {
		return c.json(await planStep({ db: c.env.DB, qloo: qlooFor(c.env) }, body), 200, { "Cache-Control": "no-store" });
	} catch (error) {
		if (error instanceof PlanInputError) return c.json({ error: "bad_request", message: error.message }, 400);
		if (error instanceof SlateNotReadyError) return c.json({ error: "slate_not_ready", message: error.message }, 503);
		if (error instanceof QlooError) {
			log("qloo error", { status: error.status, path: "/plan" });
			return c.json({ error: "qloo_unavailable", message: "Qloo didn't answer. Try again in a moment." }, 502);
		}
		throw error;
	}
});

/** Why a rival overlaps: taste tags the comps share with it (Qloo compare, cached 7 days). */
app.get("/explain", async (c) => {
	const rival = c.req.query("rival") ?? "";
	let comps: string[];
	try {
		comps = normalizeComps((c.req.query("comps") ?? "").split(","));
	} catch (error) {
		return c.json({ error: "bad_request", message: (error as Error).message }, 400);
	}
	if (!QLOO_ID.test(rival)) return c.json({ error: "bad_request", message: "rival must be a Qloo entity ID" }, 400);
	if (await rateLimited(c)) return c.json({ error: "rate_limited", message: "Too many requests from this address. Try again in a minute." }, 429);
	const qloo = qlooFor(c.env);
	if (!qloo) return c.json({ error: "unavailable", message: "Live Qloo data is off here." }, 503);
	try {
		return c.json(await compareWithRival(qloo, comps, rival.toUpperCase()), 200, { "Cache-Control": "public, max-age=3600" });
	} catch (error) {
		if (error instanceof QlooQuotaError) return c.json({ error: "quota", message: error.message }, 503);
		if (error instanceof QlooError) return c.json({ error: "qloo_unavailable", message: "Qloo didn't answer. Try again in a moment." }, 502);
		throw error;
	}
});

/** Age and gender skew of the comps' fans (Qloo demographics, cached 7 days). */
app.get("/audience", async (c) => {
	let comps: string[];
	try {
		comps = normalizeComps((c.req.query("comps") ?? "").split(","));
	} catch (error) {
		return c.json({ error: "bad_request", message: (error as Error).message }, 400);
	}
	if (await rateLimited(c)) return c.json({ error: "rate_limited", message: "Too many requests from this address. Try again in a minute." }, 429);
	const qloo = qlooFor(c.env);
	if (!qloo) return c.json({ profile: null });
	try {
		return c.json({ profile: await audienceOf(qloo, comps) }, 200, { "Cache-Control": "public, max-age=3600" });
	} catch (error) {
		if (error instanceof QlooQuotaError || error instanceof QlooError) return c.json({ profile: null });
		throw error;
	}
});

/** One step of an agent run: start one with {question}, then repeat with {runId, after} until done. */
app.post("/agent/step", async (c) => {
	const llm = llmFor(c.env);
	if (!llm) return c.json({ error: "agent_off", message: "The AI agent is off right now. The planner below works without it." }, 503);
	if (await rateLimited(c)) return c.json({ error: "rate_limited", message: "Too many requests from this address. Try again in a minute." }, 429);
	const body = await c.req.json<{ question?: unknown; runId?: unknown; after?: unknown }>().catch(() => undefined);
	if (!body) return c.json({ error: "bad_request", message: "Expected a JSON body" }, 400);
	try {
		const ctx = { db: c.env.DB, qloo: qlooFor(c.env), llm, client: await clientKey(c), dailyRuns: numberOr(c.env.AGENT_DAILY_RUNS, 12) };
		return c.json(await agentStep(ctx, body), 200, { "Cache-Control": "no-store" });
	} catch (error) {
		if (error instanceof AgentInputError) return c.json({ error: "bad_request", message: error.message }, 400);
		if (error instanceof AgentLimitError) return c.json({ error: "limit", message: error.message }, 429);
		if (error instanceof SlateNotReadyError) return c.json({ error: "slate_not_ready", message: error.message }, 503);
		if (error instanceof LlmError) {
			log("llm error", { status: error.status });
			return c.json({ error: "model_unavailable", message: "The model didn't answer. Try again in a moment." }, 502);
		}
		throw error;
	}
});

/** The agent's question answered by the same model with no tools, its dates checked against the live slate. One call per run. */
app.post("/agent/baseline", async (c) => {
	const llm = llmFor(c.env);
	if (!llm) return c.json({ error: "agent_off", message: "The AI agent is off right now." }, 503);
	if (await rateLimited(c)) return c.json({ error: "rate_limited", message: "Too many requests from this address. Try again in a minute." }, 429);
	const body = await c.req.json<{ runId?: unknown }>().catch(() => undefined);
	if (!body) return c.json({ error: "bad_request", message: "Expected a JSON body" }, 400);
	try {
		return c.json(await runBaseline({ db: c.env.DB, qloo: qlooFor(c.env), llm }, body.runId), 200, { "Cache-Control": "no-store" });
	} catch (error) {
		if (error instanceof BaselineInputError) return c.json({ error: "bad_request", message: error.message }, 400);
		if (error instanceof BaselineEmptyError) return c.json({ error: "model_unavailable", message: error.message }, 502);
		if (error instanceof SlateNotReadyError) return c.json({ error: "slate_not_ready", message: error.message }, 503);
		if (error instanceof BudgetExhaustedError) return c.json({ error: "budget", message: error.message }, 503);
		if (error instanceof LlmError) {
			log("llm error", { status: error.status, path: "/agent/baseline" });
			return c.json({ error: "model_unavailable", message: "The model didn't answer. Try again in a moment." }, 502);
		}
		throw error;
	}
});

/** A stored run, for share links (?run=). No model calls. */
app.get("/agent/run", async (c) => {
	const run = await agentRun(c.env.DB, c.req.query("id") ?? "");
	return run ? c.json(run, 200, { "Cache-Control": "public, max-age=60" }) : c.json({ error: "not_found" }, 404);
});

function watchError(c: AppContext, error: unknown) {
	if (error instanceof WatchInputError || error instanceof PlanInputError) return c.json({ error: "bad_request", message: error.message }, 400);
	if (error instanceof WatchLimitError) return c.json({ error: "limit", message: error.message }, 429);
	if (error instanceof WatchNotReadyError) return c.json({ error: "not_ready", message: error.message }, 409);
	if (error instanceof SlateNotReadyError) return c.json({ error: "slate_not_ready", message: error.message }, 503);
	if (error instanceof QlooError) return c.json({ error: "qloo_unavailable", message: "Qloo didn't answer. Try again in a moment." }, 502);
	throw error;
}

/** Start watching a plan: {comps, you?, from, week}. The daily check re-plans it after every slate refresh. */
app.post("/watch", async (c) => {
	if (await rateLimited(c)) return c.json({ error: "rate_limited", message: "Too many requests from this address. Try again in a minute." }, 429);
	const body = await c.req.json<{ comps?: unknown; you?: unknown; from?: unknown; week?: unknown; label?: unknown }>().catch(() => undefined);
	if (!body) return c.json({ error: "bad_request", message: "Expected a JSON body" }, 400);
	try {
		const ctx = { db: c.env.DB, qloo: qlooFor(c.env), client: await clientKey(c), dailyWatches: numberOr(c.env.WATCH_DAILY, 10) };
		return c.json(await createWatch(ctx, body), 201);
	} catch (error) {
		return watchError(c, error);
	}
});

app.get("/watch", async (c) => {
	const watch = await getWatch(c.env.DB, c.req.query("id") ?? "");
	return watch ? c.json(watch, 200, { "Cache-Control": "no-store" }) : c.json({ error: "not_found" }, 404);
});

/** What the daily check would do if one rival's date changed: {id, rival, to (YYYY-MM-DD, or null for off the calendar)}. */
app.post("/watch/simulate", async (c) => {
	if (await rateLimited(c)) return c.json({ error: "rate_limited", message: "Too many requests from this address. Try again in a minute." }, 429);
	const body = await c.req.json<{ id?: unknown; rival?: unknown; to?: unknown }>().catch(() => undefined);
	if (!body) return c.json({ error: "bad_request", message: "Expected a JSON body" }, 400);
	try {
		const ctx = { db: c.env.DB, qloo: qlooFor(c.env), llm: llmFor(c.env), client: await clientKey(c), dailyNotes: numberOr(c.env.SIM_DAILY, 20) };
		return c.json(await simulateWatch(ctx, body), 200, { "Cache-Control": "no-store" });
	} catch (error) {
		return watchError(c, error);
	}
});

/** Released films by name, for picking comps. Cached for 7 days per query. */
app.get("/search", async (c) => {
	const q = (c.req.query("q") ?? "").trim().replace(/\s+/g, " ").toLowerCase();
	if (q.length < 2 || q.length > 80) return c.json({ error: "bad_request", message: "Search for 2 to 80 characters" }, 400);
	if (await rateLimited(c)) return c.json({ error: "rate_limited", message: "Too many searches from this address. Try again in a minute." }, 429);
	const qloo = qlooFor(c.env);
	if (!qloo) return c.json({ results: [] });
	try {
		return c.json({ results: await searchFilms(qloo, q) }, 200, { "Cache-Control": "public, max-age=3600" });
	} catch (error) {
		if (error instanceof QlooQuotaError) return c.json({ error: "quota", message: error.message }, 503);
		if (error instanceof QlooError) return c.json({ error: "qloo_unavailable", message: "Qloo didn't answer. Try again in a moment." }, 502);
		throw error;
	}
});

/** Admin routes need the x-admin-token header. */
const admin = (c: AppContext) => {
	const token = c.env.ADMIN_TOKEN?.trim();
	return Boolean(token && c.req.header("x-admin-token") === token);
};

/** Advances the slate refresh by one step. For the first build and for debugging; cron does this every 10 minutes. */
app.post("/admin/slate/step", async (c) => {
	if (!admin(c)) return c.json({ error: "forbidden" }, 403);
	const job = await runSlateStep({ db: c.env.DB, qloo: qlooFor(c.env), days: numberOr(c.env.SLATE_DAYS, 180) }, { restart: c.req.query("restart") === "1" });
	return c.json({ phase: job.phase, cursor: job.cursor, error: job.error, titles: job.state.titles.length, sections: job.state.sections.length });
});

/** Runs one round of watch re-plans now (cron does this whenever the slate refresh is idle). */
app.post("/admin/watch/step", async (c) => {
	if (!admin(c)) return c.json({ error: "forbidden" }, 403);
	return c.json(await runWatchStep({ db: c.env.DB, qloo: qlooFor(c.env), llm: llmFor(c.env) }, numberOr(c.req.query("limit"), 3)));
});

/** Creates the featured scenarios' watches (IDs = scenario IDs); ?force=1 recreates them. */
app.post("/admin/watch/seed", async (c) => {
	if (!admin(c)) return c.json({ error: "forbidden" }, 403);
	try {
		return c.json(await seedFeatured({ db: c.env.DB, qloo: qlooFor(c.env) }, { force: c.req.query("force") === "1" }));
	} catch (error) {
		return watchError(c, error);
	}
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((err, c) => {
	log("unhandled error", { path: c.req.path, error: err.message });
	return c.json({ error: "internal_error" }, 500);
});

/** One cron tick: a step of the slate refresh while it runs, else a round of watch re-plans against the new slate. */
async function tick(env: Env): Promise<Record<string, unknown>> {
	const qloo = qlooFor(env);
	if (slateIdle(await loadJob<SlateJobState>(env.DB, JOB_NAME))) return { watches: await runWatchStep({ db: env.DB, qloo, llm: llmFor(env) }) };
	const job = await runSlateStep({ db: env.DB, qloo, days: numberOr(env.SLATE_DAYS, 180) });
	return { slate: { phase: job.phase, cursor: job.cursor, error: job.error } };
}

export default {
	fetch: app.fetch,
	async scheduled(_controller, env, ctx) {
		ctx.waitUntil(
			tick(env).then(
				(result) => log("cron", result),
				(error: unknown) => log("cron failed", { error: error instanceof Error ? error.message : String(error) }),
			),
		);
	},
} satisfies ExportedHandler<Env>;

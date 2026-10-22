import { Hono, type Context } from "hono";
import { DEFAULT_MODEL } from "./openrouter.ts";
import { PlanInputError, planStep, SlateNotReadyError } from "./plan.ts";
import { QlooClient, QlooError, QlooQuotaError, searchFilms } from "./qloo.ts";
import type { Health } from "../shared/types.ts";
import { runSlateStep, JOB_NAME, type SlateJobState } from "./slate-job.ts";
import { latestSnapshot, llmSpend, loadJob, qlooUsage, recentChanges } from "./store.ts";

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

/** Per-IP limit on routes that can spend Qloo quota. */
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
	const agent = env.AGENT_MODE === "llm" && env.OPENROUTER_API_KEY ? "llm" : "scripted";
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

/** Advances the slate refresh by one step. For the first build and for debugging; cron does this every 10 minutes. */
app.post("/admin/slate/step", async (c) => {
	const token = c.env.ADMIN_TOKEN?.trim();
	if (!token || c.req.header("x-admin-token") !== token) return c.json({ error: "forbidden" }, 403);
	const job = await runSlateStep({ db: c.env.DB, qloo: qlooFor(c.env), days: numberOr(c.env.SLATE_DAYS, 180) }, { restart: c.req.query("restart") === "1" });
	return c.json({ phase: job.phase, cursor: job.cursor, error: job.error, titles: job.state.titles.length, sections: job.state.sections.length });
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((err, c) => {
	log("unhandled error", { path: c.req.path, error: err.message });
	return c.json({ error: "internal_error" }, 500);
});

export default {
	fetch: app.fetch,
	async scheduled(_controller, env, ctx) {
		ctx.waitUntil(
			runSlateStep({ db: env.DB, qloo: qlooFor(env), days: numberOr(env.SLATE_DAYS, 180) }).then(
				(job) => log("slate step", { phase: job.phase, cursor: job.cursor, error: job.error }),
				(error: unknown) => log("slate step failed", { error: error instanceof Error ? error.message : String(error) }),
			),
		);
	},
} satisfies ExportedHandler<Env>;

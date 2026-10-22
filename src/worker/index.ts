import { Hono } from "hono";
import { DEFAULT_MODEL } from "./openrouter.ts";
import { QlooClient } from "./qloo.ts";
import type { Health } from "../shared/types.ts";
import { runSlateStep, JOB_NAME, type SlateJobState } from "./slate-job.ts";
import { latestSnapshot, llmSpend, loadJob, qlooUsage, recentChanges } from "./store.ts";

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
		globalReserve: numberOr(env.QLOO_GLOBAL_RESERVE, 2_000),
	});
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
			qloo: { month: usage.month, calls: usage.calls, cap: numberOr(env.QLOO_MONTHLY_CAP, 25_000), sharedRemaining: usage.sharedRemaining },
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

import { bindings, defineConfig, triggers } from "cf/config";
import * as entrypoint from "./src/worker/index.ts" with { type: "cf-worker" };

export default defineConfig(({ mode }) => {
	// `cf dev --mode mock` serves synthetic data with no keys. A deploy runs live: real Qloo data
	// (QLOO_API_KEY) and, once the agent ships, OpenRouter (OPENROUTER_API_KEY). Secrets are uploaded
	// separately and never committed.
	const mock = mode === "mock";
	return {
		worker: {
			name: "clearrun",
			compatibilityDate: "2026-10-06",
			compatibilityFlags: ["nodejs_compat"],
			entrypoint,
			assets: {
				notFoundHandling: "single-page-application",
				runWorkerFirst: ["/api/*"],
			},
			domains: ["clearrun.zichengyu.com"],
			// One cron tick advances the slate refresh by one small step, so every invocation stays
			// inside the Workers Free plan (10 ms CPU, 50 external subrequests).
			triggers: [triggers.scheduled({ schedule: "*/10 * * * *" })],
			observability: {
				enabled: true,
				logs: { enabled: true, headSamplingRate: 1 },
			},
			env: {
				QLOO_MODE: bindings.text<"mock" | "live">(mock ? "mock" : "live"),
				// "scripted" runs the deterministic planner; "llm" runs the agent over OpenRouter.
				AGENT_MODE: bindings.text<"scripted" | "llm">("scripted"),
				// OpenRouter model IDs: the agent's model and the fallbacks tried when its providers fail.
				LLM_MODEL: bindings.text("anthropic/claude-haiku-5.5"),
				LLM_FALLBACK_MODELS: bindings.text("deepseek/deepseek-v4-flash"),
				// Spending caps in US dollars, enforced before every model call (ledger in D1).
				LLM_DAILY_USD: bindings.text("0.40"),
				LLM_TOTAL_USD: bindings.text("5"),
				// Qloo requests this app may spend per calendar month (half of the shared 50,000).
				QLOO_MONTHLY_CAP: bindings.text("25000"),
				// ...and per UTC day, so a burst of traffic can't spend the month in an afternoon.
				QLOO_DAILY_CAP: bindings.text("1500"),
				// Stop calling Qloo when the shared key's remaining monthly quota drops below this.
				QLOO_GLOBAL_RESERVE: bindings.text("2000"),
				// Days ahead covered by the release slate.
				SLATE_DAYS: bindings.text("180"),
				// Secrets, never committed: .dev.vars locally, uploaded with `cf deploy --secrets-file .dev.vars`.
				QLOO_API_KEY: bindings.secret(),
				OPENROUTER_API_KEY: bindings.secret(),
				ADMIN_TOKEN: bindings.secret(),
				DB: bindings.d1({ id: "fcf2a527-e528-4d34-8f3e-fb94eaa6c97d", name: "clearrun-db" }),
				// Per-IP limit on routes that can spend Qloo quota (/api/plan steps and /api/search).
				RATE_LIMITER: bindings.rateLimit({ namespace: "7311", simple: { limit: 20, period: 60 } }),
			},
		},
	};
});

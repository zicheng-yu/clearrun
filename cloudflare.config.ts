import { bindings, defineConfig, triggers } from "cf/config";
import * as entrypoint from "./src/worker/index.ts" with { type: "cf-worker" };

export default defineConfig(({ mode }) => {
	// `cf dev --mode mock` is the offline demo: a frozen copy of the slate, synthetic Qloo scores and the
	// scripted agent, in its own local database, with no keys and no network. A deploy runs live: real Qloo
	// data (QLOO_API_KEY) and the LLM agent over OpenRouter (OPENROUTER_API_KEY). Secrets are uploaded
	// separately and never committed.
	const mock = mode === "mock";
	return {
		worker: {
			name: "clearrun",
			compatibilityDate: "2026-10-06",
			compatibilityFlags: ["nodejs_compat"],
			entrypoint,
			// The Worker runs first for the API, for card images, and for the page itself, so it can write each share link's
			// title, description and card into the page for link previews. Everything else is served straight from assets.
			assets: {
				notFoundHandling: "single-page-application",
				runWorkerFirst: ["/api/*", "/og/*", "/"],
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
				// "llm" runs the agent over OpenRouter; "scripted" answers with the scripted planner (no model).
				AGENT_MODE: bindings.text<"scripted" | "llm">(mock ? "scripted" : "llm"),
				// Agent runs one client may start per UTC day (replays of an answered question are free).
				AGENT_DAILY_RUNS: bindings.text("12"),
				// Watches one client may start per UTC day, and fresh simulations that get an agent note.
				WATCH_DAILY: bindings.text("10"),
				SIM_DAILY: bindings.text("20"),
				// Custom plans one client may save as share links per UTC day.
				SHARE_DAILY: bindings.text("30"),
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
				// Secrets, never committed: .dev.vars locally, uploaded with `cf deploy --secrets-file .dev.vars`. The offline demo
				// declares none, so it never asks for keys and never sees one set in the shell.
				...(mock
					? {}
					: {
							QLOO_API_KEY: bindings.secret(),
							OPENROUTER_API_KEY: bindings.secret(),
							ADMIN_TOKEN: bindings.secret(),
						}),
				// The offline demo keeps its own local database, so it never mixes with live data (and is never deployed).
				ASSETS: bindings.assets(),
				DB: bindings.d1(mock ? { id: "00000000-0000-4000-8000-000000000de0", name: "clearrun-demo" } : { id: "fcf2a527-e528-4d34-8f3e-fb94eaa6c97d", name: "clearrun-db" }),
				// Per-IP limit on routes that can spend Qloo quota (/api/plan steps and /api/search).
				RATE_LIMITER: bindings.rateLimit({ namespace: "7311", simple: { limit: 20, period: 60 } }),
			},
		},
	};
});

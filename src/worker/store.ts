/** D1 storage: slate snapshots and changes, the refresh job, the Qloo caches, and spend ledgers. */
import type { SlateChange, SlateSnapshot } from "../shared/types.ts";

const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, window_start TEXT NOT NULL, window_end TEXT NOT NULL, body TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS changes (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, from_id TEXT, to_id TEXT NOT NULL, body TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS jobs (name TEXT PRIMARY KEY, phase TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error TEXT)`,
	`CREATE TABLE IF NOT EXISTS qloo_cache (key TEXT PRIMARY KEY, created_at INTEGER NOT NULL, body TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS affinity_cache (signal TEXT NOT NULL, domain TEXT NOT NULL, entity TEXT NOT NULL, affinity REAL, created_at INTEGER NOT NULL, PRIMARY KEY (signal, domain, entity))`,
	`CREATE TABLE IF NOT EXISTS qloo_usage (month TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0, shared_remaining INTEGER, updated_at INTEGER)`,
	`CREATE TABLE IF NOT EXISTS qloo_daily (day TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0)`,
	`CREATE TABLE IF NOT EXISTS llm_spend (day TEXT PRIMARY KEY, cost_usd REAL NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0, tokens INTEGER NOT NULL DEFAULT 0)`,
];

let ready: Promise<void> | undefined;

/** Creates the tables once per isolate. */
export function ensureSchema(db: D1Database): Promise<void> {
	if (!ready) ready = db.batch(SCHEMA.map((sql) => db.prepare(sql))).then(() => undefined);
	return ready;
}

export async function latestSnapshot(db: D1Database): Promise<SlateSnapshot | undefined> {
	await ensureSchema(db);
	const row = await db.prepare("SELECT body FROM snapshots ORDER BY created_at DESC LIMIT 1").first<{ body: string }>();
	return row ? (JSON.parse(row.body) as SlateSnapshot) : undefined;
}

export async function saveSnapshot(db: D1Database, snapshot: SlateSnapshot, changes: SlateChange[], previousId?: string): Promise<void> {
	await ensureSchema(db);
	const statements = [
		db
			.prepare("INSERT INTO snapshots (id, created_at, window_start, window_end, body) VALUES (?1, ?2, ?3, ?4, ?5)")
			.bind(snapshot.id, snapshot.createdAt, snapshot.windowStart, snapshot.windowEnd, JSON.stringify(snapshot)),
		// Keep the last 30 snapshots; diffs live on in `changes`.
		db.prepare("DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY created_at DESC LIMIT 30)"),
	];
	if (changes.length > 0) {
		statements.push(
			db
				.prepare("INSERT INTO changes (created_at, from_id, to_id, body) VALUES (?1, ?2, ?3, ?4)")
				.bind(snapshot.createdAt, previousId ?? null, snapshot.id, JSON.stringify(changes)),
		);
	}
	await db.batch(statements);
}

export async function recentChanges(db: D1Database, limit = 20): Promise<{ createdAt: number; changes: SlateChange[] }[]> {
	await ensureSchema(db);
	const rows = await db.prepare("SELECT created_at, body FROM changes ORDER BY created_at DESC LIMIT ?1").bind(limit).all<{ created_at: number; body: string }>();
	return rows.results.map((r) => ({ createdAt: r.created_at, changes: JSON.parse(r.body) as SlateChange[] }));
}

export interface JobRow<S> {
	name: string;
	phase: string;
	cursor: number;
	state: S;
	startedAt: number;
	updatedAt: number;
	error?: string;
}

export async function loadJob<S>(db: D1Database, name: string): Promise<JobRow<S> | undefined> {
	await ensureSchema(db);
	const row = await db
		.prepare("SELECT name, phase, cursor, state, started_at, updated_at, error FROM jobs WHERE name = ?1")
		.bind(name)
		.first<{ name: string; phase: string; cursor: number; state: string; started_at: number; updated_at: number; error: string | null }>();
	if (!row) return undefined;
	return {
		name: row.name,
		phase: row.phase,
		cursor: row.cursor,
		state: JSON.parse(row.state) as S,
		startedAt: row.started_at,
		updatedAt: row.updated_at,
		error: row.error ?? undefined,
	};
}

export async function saveJob<S>(db: D1Database, job: JobRow<S>): Promise<void> {
	await ensureSchema(db);
	await db
		.prepare(
			`INSERT INTO jobs (name, phase, cursor, state, started_at, updated_at, error) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
			 ON CONFLICT(name) DO UPDATE SET phase = excluded.phase, cursor = excluded.cursor, state = excluded.state,
			   started_at = excluded.started_at, updated_at = excluded.updated_at, error = excluded.error`,
		)
		.bind(job.name, job.phase, job.cursor, JSON.stringify(job.state), job.startedAt, job.updatedAt, job.error ?? null)
		.run();
}

export const monthKey = (now = new Date()) => now.toISOString().slice(0, 7);
export const dayKey = (now = new Date()) => now.toISOString().slice(0, 10);

export async function qlooUsage(db: D1Database): Promise<{ month: string; calls: number; today: number; sharedRemaining?: number }> {
	await ensureSchema(db);
	const month = monthKey();
	const row = await db
		.prepare(
			`SELECT (SELECT calls FROM qloo_usage WHERE month = ?1) AS calls, (SELECT shared_remaining FROM qloo_usage WHERE month = ?1) AS shared,
			   (SELECT calls FROM qloo_daily WHERE day = ?2) AS today`,
		)
		.bind(month, dayKey())
		.first<{ calls: number | null; shared: number | null; today: number | null }>();
	return { month, calls: row?.calls ?? 0, today: row?.today ?? 0, sharedRemaining: row?.shared ?? undefined };
}

export async function recordQlooCall(db: D1Database, sharedRemaining: number | undefined): Promise<void> {
	await db.batch([
		db
			.prepare(
				`INSERT INTO qloo_usage (month, calls, shared_remaining, updated_at) VALUES (?1, 1, ?2, ?3)
				 ON CONFLICT(month) DO UPDATE SET calls = calls + 1, shared_remaining = COALESCE(?2, shared_remaining), updated_at = ?3`,
			)
			.bind(monthKey(), sharedRemaining ?? null, Date.now()),
		db.prepare("INSERT INTO qloo_daily (day, calls) VALUES (?1, 1) ON CONFLICT(day) DO UPDATE SET calls = calls + 1").bind(dayKey()),
	]);
}

export type AffinityDomain = "movie" | "videogame";

/**
 * Cached affinities of one audience (`signal`: its sorted comp IDs) for entities in one domain.
 * `null` means Qloo was asked and returned no score.
 */
export async function cachedAffinities(db: D1Database, signal: string, domain: AffinityDomain, maxAgeMs: number): Promise<Map<string, number | null>> {
	await ensureSchema(db);
	const rows = await db
		.prepare("SELECT entity, affinity FROM affinity_cache WHERE signal = ?1 AND domain = ?2 AND created_at > ?3")
		.bind(signal, domain, Date.now() - maxAgeMs)
		.all<{ entity: string; affinity: number | null }>();
	return new Map(rows.results.map((r) => [r.entity, r.affinity]));
}

export async function storeAffinities(db: D1Database, signal: string, batches: { domain: AffinityDomain; asked: string[]; found: Map<string, number> }[]): Promise<void> {
	const now = Date.now();
	const insert = db.prepare("INSERT OR REPLACE INTO affinity_cache (signal, domain, entity, affinity, created_at) VALUES (?1, ?2, ?3, ?4, ?5)");
	const statements = batches.flatMap((b) => b.asked.map((entity) => insert.bind(signal, b.domain, entity, b.found.get(entity) ?? null, now)));
	if (statements.length > 0) await db.batch(statements);
}

export async function llmSpend(db: D1Database): Promise<{ today: number; total: number }> {
	await ensureSchema(db);
	const row = await db
		.prepare("SELECT (SELECT cost_usd FROM llm_spend WHERE day = ?1) AS today, (SELECT SUM(cost_usd) FROM llm_spend) AS total")
		.bind(dayKey())
		.first<{ today: number | null; total: number | null }>();
	return { today: row?.today ?? 0, total: row?.total ?? 0 };
}

export async function recordLlmSpend(db: D1Database, costUsd: number, tokens: number): Promise<void> {
	await ensureSchema(db);
	await db
		.prepare(
			`INSERT INTO llm_spend (day, cost_usd, calls, tokens) VALUES (?1, ?2, 1, ?3)
			 ON CONFLICT(day) DO UPDATE SET cost_usd = cost_usd + ?2, calls = calls + 1, tokens = tokens + ?3`,
		)
		.bind(dayKey(), costUsd, tokens)
		.run();
}

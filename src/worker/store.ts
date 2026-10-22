/** D1 storage: slate snapshots and changes, jobs, the Qloo caches, spend ledgers, agent runs, watches and backtests. */
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
	`CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, client TEXT NOT NULL, question_key TEXT NOT NULL, snapshot_id TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS watches (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, checked_at INTEGER NOT NULL, client TEXT NOT NULL, snapshot_id TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS sim_cache (key TEXT PRIMARY KEY, client TEXT NOT NULL, created_at INTEGER NOT NULL, body TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS backtests (id TEXT NOT NULL, version INTEGER NOT NULL, created_at INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (id, version))`,
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
 * Cached affinities of one audience (`signal`: its sorted comp IDs) for entities in one domain, younger than
 * `maxAgeMs` (Infinity for any age). `null` means Qloo was asked and returned no score.
 */
export async function cachedAffinities(db: D1Database, signal: string, domain: AffinityDomain, maxAgeMs: number): Promise<Map<string, number | null>> {
	await ensureSchema(db);
	const rows = await db
		.prepare("SELECT entity, affinity FROM affinity_cache WHERE signal = ?1 AND domain = ?2 AND created_at > ?3")
		.bind(signal, domain, Number.isFinite(maxAgeMs) ? Date.now() - maxAgeMs : -1)
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

export interface AgentRunRow<S> {
	id: string;
	createdAt: number;
	client: string;
	questionKey: string;
	snapshotId: string;
	status: "running" | "done";
	state: S;
}

export async function loadAgentRun<S>(db: D1Database, id: string): Promise<AgentRunRow<S> | undefined> {
	await ensureSchema(db);
	const row = await db
		.prepare("SELECT id, created_at, client, question_key, snapshot_id, status, body FROM agent_runs WHERE id = ?1")
		.bind(id)
		.first<{ id: string; created_at: number; client: string; question_key: string; snapshot_id: string; status: string; body: string }>();
	if (!row) return undefined;
	return {
		id: row.id,
		createdAt: row.created_at,
		client: row.client,
		questionKey: row.question_key,
		snapshotId: row.snapshot_id,
		status: row.status === "done" ? "done" : "running",
		state: JSON.parse(row.body) as S,
	};
}

export async function saveAgentRun<S>(db: D1Database, run: AgentRunRow<S>): Promise<void> {
	await ensureSchema(db);
	await db
		.prepare(
			`INSERT INTO agent_runs (id, created_at, updated_at, client, question_key, snapshot_id, status, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
			 ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, question_key = excluded.question_key, status = excluded.status, body = excluded.body`,
		)
		.bind(run.id, run.createdAt, Date.now(), run.client, run.questionKey, run.snapshotId, run.status, JSON.stringify(run.state))
		.run();
}

/** A finished run of the same question against the same slate, recent enough to replay instead of re-asking the model. */
export async function findAgentReplay(db: D1Database, questionKey: string, snapshotId: string, since: number): Promise<string | undefined> {
	await ensureSchema(db);
	const row = await db
		.prepare("SELECT id FROM agent_runs WHERE question_key = ?1 AND snapshot_id = ?2 AND status = 'done' AND created_at > ?3 ORDER BY created_at DESC LIMIT 1")
		.bind(questionKey, snapshotId, since)
		.first<{ id: string }>();
	return row?.id;
}

/** Runs one client started since `since`; also drops runs older than two weeks. */
export async function agentRunsSince(db: D1Database, client: string, since: number): Promise<number> {
	await ensureSchema(db);
	const [count] = await db.batch([
		db.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE client = ?1 AND created_at > ?2").bind(client, since),
		db.prepare("DELETE FROM agent_runs WHERE created_at < ?1").bind(Date.now() - 14 * 24 * 3600 * 1000),
	]);
	return (count?.results[0] as { n?: number } | undefined)?.n ?? 0;
}

export interface WatchRow<B> {
	id: string;
	createdAt: number;
	checkedAt: number;
	client: string;
	snapshotId: string;
	status: "active" | "ended";
	body: B;
}

type RawWatch = { id: string; created_at: number; checked_at: number; client: string; snapshot_id: string; status: string; body: string };
const watchOf = <B>(r: RawWatch): WatchRow<B> => ({
	id: r.id,
	createdAt: r.created_at,
	checkedAt: r.checked_at,
	client: r.client,
	snapshotId: r.snapshot_id,
	status: r.status === "ended" ? "ended" : "active",
	body: JSON.parse(r.body) as B,
});

export async function loadWatch<B>(db: D1Database, id: string): Promise<WatchRow<B> | undefined> {
	await ensureSchema(db);
	const row = await db.prepare("SELECT id, created_at, checked_at, client, snapshot_id, status, body FROM watches WHERE id = ?1").bind(id).first<RawWatch>();
	return row ? watchOf<B>(row) : undefined;
}

export async function saveWatch<B>(db: D1Database, w: WatchRow<B>): Promise<void> {
	await ensureSchema(db);
	await db
		.prepare(
			`INSERT INTO watches (id, created_at, checked_at, client, snapshot_id, status, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
			 ON CONFLICT(id) DO UPDATE SET checked_at = excluded.checked_at, snapshot_id = excluded.snapshot_id, status = excluded.status, body = excluded.body`,
		)
		.bind(w.id, w.createdAt, w.checkedAt, w.client, w.snapshotId, w.status, JSON.stringify(w.body))
		.run();
}

/** Active watches not yet checked against `snapshotId`, least recently checked first. */
export async function staleWatches<B>(db: D1Database, snapshotId: string, limit: number): Promise<WatchRow<B>[]> {
	await ensureSchema(db);
	const rows = await db
		.prepare("SELECT id, created_at, checked_at, client, snapshot_id, status, body FROM watches WHERE status = 'active' AND snapshot_id != ?1 ORDER BY checked_at LIMIT ?2")
		.bind(snapshotId, limit)
		.all<RawWatch>();
	return rows.results.map((r) => watchOf<B>(r));
}

export async function watchesSince(db: D1Database, client: string, since: number): Promise<number> {
	await ensureSchema(db);
	const row = await db.prepare("SELECT COUNT(*) AS n FROM watches WHERE client = ?1 AND created_at > ?2").bind(client, since).first<{ n: number }>();
	return row?.n ?? 0;
}

/** A cached simulation result, and how many fresh ones a client has run since `since`. */
export async function cachedSimulation<T>(db: D1Database, key: string): Promise<T | undefined> {
	await ensureSchema(db);
	const row = await db.prepare("SELECT body FROM sim_cache WHERE key = ?1").bind(key).first<{ body: string }>();
	return row ? (JSON.parse(row.body) as T) : undefined;
}

export async function storeSimulation(db: D1Database, key: string, client: string, body: unknown): Promise<void> {
	await ensureSchema(db);
	await db.batch([
		db.prepare("INSERT OR REPLACE INTO sim_cache (key, client, created_at, body) VALUES (?1, ?2, ?3, ?4)").bind(key, client, Date.now(), JSON.stringify(body)),
		db.prepare("DELETE FROM sim_cache WHERE created_at < ?1").bind(Date.now() - 7 * 24 * 3600 * 1000),
	]);
}

export async function simulationsSince(db: D1Database, client: string, since: number): Promise<number> {
	await ensureSchema(db);
	const row = await db.prepare("SELECT COUNT(*) AS n FROM sim_cache WHERE client = ?1 AND created_at > ?2").bind(client, since).first<{ n: number }>();
	return row?.n ?? 0;
}

/** The latest snapshot's ID without reading its body. */
export async function latestSnapshotId(db: D1Database): Promise<string | undefined> {
	await ensureSchema(db);
	const row = await db.prepare("SELECT id FROM snapshots ORDER BY created_at DESC LIMIT 1").first<{ id: string }>();
	return row?.id;
}

/** Finished backtest cases for one method version. */
export async function loadBacktests<T>(db: D1Database, version: number): Promise<T[]> {
	await ensureSchema(db);
	const rows = await db.prepare("SELECT body FROM backtests WHERE version = ?1").bind(version).all<{ body: string }>();
	return rows.results.map((r) => JSON.parse(r.body) as T);
}

export async function saveBacktests(db: D1Database, version: number, cases: { id: string }[]): Promise<void> {
	await ensureSchema(db);
	const insert = db.prepare("INSERT OR REPLACE INTO backtests (id, version, created_at, body) VALUES (?1, ?2, ?3, ?4)");
	await db.batch([...cases.map((c) => insert.bind(c.id, version, Date.now(), JSON.stringify(c))), db.prepare("DELETE FROM backtests WHERE version != ?1").bind(version)]);
}

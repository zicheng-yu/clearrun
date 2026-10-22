/**
 * Qloo client for the hackathon host (GET only). Every live request goes through two guards:
 * this app's monthly cap (half of the key's shared quota) and a reserve on the shared remaining
 * count reported by Qloo's rate-limit headers. Responses are cached privately in D1, never in the repo.
 */
import { ensureSchema, qlooUsage, recordQlooCall } from "./store.ts";

export const QLOO_BASE = "https://hackathon.api.qloo.com";

export class QlooQuotaError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "QlooQuotaError";
	}
}

export class QlooError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = "QlooError";
		this.status = status;
	}
}

export interface QlooOptions {
	apiKey: string;
	db: D1Database;
	monthlyCap: number;
	globalReserve: number;
}

async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class QlooClient {
	private readonly options: QlooOptions;

	constructor(options: QlooOptions) {
		this.options = options;
	}

	/** GET a Qloo path; cached responses younger than `ttlSec` are returned without spending quota. */
	async get<T>(path: string, params: Record<string, string>, ttlSec = 7 * 24 * 3600): Promise<T> {
		const { db } = this.options;
		await ensureSchema(db);
		const query = new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))).toString();
		const key = await sha256(`${path}?${query}`);
		const cached = await db.prepare("SELECT created_at, body FROM qloo_cache WHERE key = ?1").bind(key).first<{ created_at: number; body: string }>();
		if (cached && Date.now() - cached.created_at < ttlSec * 1000) return JSON.parse(cached.body) as T;

		const usage = await qlooUsage(db);
		if (usage.calls >= this.options.monthlyCap) throw new QlooQuotaError(`This app's Qloo budget for ${usage.month} is used up`);
		if (usage.sharedRemaining !== undefined && usage.sharedRemaining < this.options.globalReserve) {
			throw new QlooQuotaError("The shared Qloo quota is nearly exhausted; serving cached data only");
		}

		const response = await fetch(`${QLOO_BASE}${path}?${query}`, { headers: { "X-Api-Key": this.options.apiKey, Accept: "application/json" } });
		const remaining = Number(response.headers.get("X-Month-RateLimit-Remaining"));
		await recordQlooCall(db, Number.isFinite(remaining) ? remaining : undefined);
		if (!response.ok) throw new QlooError(response.status, `Qloo ${path} ${response.status}`);
		const body = await response.text();
		await db.prepare("INSERT OR REPLACE INTO qloo_cache (key, created_at, body) VALUES (?1, ?2, ?3)").bind(key, Date.now(), body).run();
		return JSON.parse(body) as T;
	}
}

export interface QlooEntity {
	entity_id: string;
	name: string;
	popularity?: number;
	properties?: { release_date?: string; external?: Record<string, { id?: string }> };
}

/** `/entities` lookup by external IDs. Wikidata IDs must be lowercase (q123) on the hackathon host. */
export async function entitiesByExternal(client: QlooClient, source: "wikidata" | "imdb", ids: string[]): Promise<Map<string, QlooEntity>> {
	const normalized = source === "wikidata" ? ids.map((id) => id.toLowerCase()) : ids;
	const data = await client.get<{ results?: QlooEntity[] }>("/entities", { [`external.${source}.ids`]: normalized.join(",") });
	const out = new Map<string, QlooEntity>();
	for (const entity of data.results ?? []) {
		const id = entity.properties?.external?.[source]?.id;
		if (id) out.set(id.toLowerCase(), entity);
	}
	return out;
}

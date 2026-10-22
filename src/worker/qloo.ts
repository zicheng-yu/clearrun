/**
 * Qloo client for the hackathon host (GET only). Every live request goes through three guards: this
 * app's monthly cap (half of the key's shared quota), a daily cap, and a reserve on the shared remaining
 * count reported by Qloo's rate-limit headers. Responses are cached privately in D1, never in the repo.
 * When Qloo can't be reached or a budget is spent, an expired cached response is served instead. The offline
 * demo passes a `transport` that answers from synthetic data, with no guards and no usage recorded.
 */
import { scanAffinities } from "../engine/qloo/scan.ts";
import type { Comp } from "../shared/types.ts";
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
	dailyCap: number;
	globalReserve: number;
	/** Answers requests in place of the network (the offline demo). Nothing is guarded or recorded. */
	transport?: (url: string, init: RequestInit) => Promise<Response>;
}

export interface GetOptions<T> {
	/** Serve cached responses younger than this; 0 skips the response cache for this call. */
	ttlSec?: number;
	/** Turns the raw body into the value returned and cached. Defaults to JSON.parse. */
	reduce?: (body: string) => T;
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

	/** True for the offline demo's synthetic Qloo. */
	get demo(): boolean {
		return Boolean(this.options.transport);
	}

	/**
	 * GET a Qloo path. Cached values younger than `ttlSec` are returned without spending quota; an older cached
	 * value is returned when the live call can't be made (a budget guard, an error, or no network).
	 */
	async get<T>(path: string, params: Record<string, string>, options: GetOptions<T> = {}): Promise<T> {
		const { db } = this.options;
		const ttlSec = options.ttlSec ?? 7 * 24 * 3600;
		await ensureSchema(db);
		const query = new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))).toString();
		const key = ttlSec > 0 ? await sha256(`${path}?${query}`) : undefined;
		let stale: string | undefined;
		if (key) {
			const cached = await db.prepare("SELECT created_at, body FROM qloo_cache WHERE key = ?1").bind(key).first<{ created_at: number; body: string }>();
			if (cached && Date.now() - cached.created_at < ttlSec * 1000) return JSON.parse(cached.body) as T;
			stale = cached?.body;
		}
		try {
			const value = await this.request(path, query, options);
			if (key) await db.prepare("INSERT OR REPLACE INTO qloo_cache (key, created_at, body) VALUES (?1, ?2, ?3)").bind(key, Date.now(), JSON.stringify(value)).run();
			return value;
		} catch (error) {
			if (stale !== undefined && (error instanceof QlooQuotaError || error instanceof QlooError || error instanceof TypeError)) return JSON.parse(stale) as T;
			throw error;
		}
	}

	private async request<T>(path: string, query: string, options: GetOptions<T>): Promise<T> {
		const { db, transport } = this.options;
		const url = `${QLOO_BASE}${path}?${query}`;
		const init = { headers: { "X-Api-Key": this.options.apiKey, Accept: "application/json" } };
		if (transport) {
			const response = await transport(url, init);
			if (!response.ok) throw new QlooError(response.status, `Qloo ${path} ${response.status}`);
			const body = await response.text();
			return options.reduce ? options.reduce(body) : (JSON.parse(body) as T);
		}

		const usage = await qlooUsage(db);
		if (usage.calls >= this.options.monthlyCap) throw new QlooQuotaError(`This app's Qloo budget for ${usage.month} is used up; serving cached data only`);
		if (usage.today >= this.options.dailyCap) throw new QlooQuotaError("This app's Qloo budget for today is used up; serving cached data only");
		if (usage.sharedRemaining !== undefined && usage.sharedRemaining < this.options.globalReserve) {
			throw new QlooQuotaError("The shared Qloo quota is nearly exhausted; serving cached data only");
		}

		const response = await fetch(url, init);
		// A missing header must not read as "0 remaining", which would block every later call.
		const header = response.headers.get("X-Month-RateLimit-Remaining");
		const remaining = header === null || header.trim() === "" ? undefined : Number(header);
		await recordQlooCall(db, remaining !== undefined && Number.isFinite(remaining) ? remaining : undefined);
		if (!response.ok) throw new QlooError(response.status, `Qloo ${path} ${response.status}`);
		const body = await response.text();
		return options.reduce ? options.reduce(body) : (JSON.parse(body) as T);
	}
}

export interface QlooEntity {
	entity_id: string;
	name: string;
	popularity?: number;
	properties?: { release_date?: string; external?: Record<string, { id?: string }> };
}

/**
 * `/entities` lookup by external IDs, with every entity found for each ID: one Wikidata item can carry more than
 * one Qloo entity (Wicked's item maps to both films). Wikidata IDs must be lowercase (q123) on the hackathon host.
 */
export async function entitiesByExternal(client: QlooClient, source: "wikidata" | "imdb", ids: string[]): Promise<Map<string, QlooEntity[]>> {
	const normalized = source === "wikidata" ? ids.map((id) => id.toLowerCase()) : ids;
	const data = await client.get<{ results?: QlooEntity[] }>(
		"/entities",
		{ [`external.${source}.ids`]: normalized.join(",") },
		{
			// Keep only what the slate needs; full entities run about 45 KB each.
			reduce: (body) => {
				const raw = JSON.parse(body) as { results?: QlooEntity[] };
				return {
					results: (raw.results ?? []).map((e) => ({
						entity_id: e.entity_id,
						name: e.name,
						popularity: e.popularity,
						properties: {
							release_date: e.properties?.release_date,
							external: { wikidata: { id: e.properties?.external?.wikidata?.id }, imdb: { id: e.properties?.external?.imdb?.id } },
						},
					})),
				};
			},
		},
	);
	const out = new Map<string, QlooEntity[]>();
	for (const entity of data.results ?? []) {
		const id = entity.properties?.external?.[source]?.id?.toLowerCase();
		if (id) out.set(id, [...(out.get(id) ?? []), entity]);
	}
	return out;
}

/** The entity whose Qloo release date is closest to the title's own date (the first one when none has a date). */
export function pickEntity(found: QlooEntity[] | undefined, date: string): QlooEntity | undefined {
	if (!found || found.length < 2) return found?.[0];
	const gap = (e: QlooEntity) => {
		const t = Date.parse(e.properties?.release_date ?? "");
		return Number.isFinite(t) ? Math.abs(t - Date.parse(date)) : Number.POSITIVE_INFINITY;
	};
	return [...found].sort((a, b) => gap(a) - gap(b))[0];
}

/**
 * Affinity of an audience (`signal`: comp IDs) for specific entities, as one batched insights call.
 * Unreleased films need `bias.content_based` to be scored at all. Not cached here: the caller caches per
 * entity, since an entity's affinity doesn't depend on the rest of the batch.
 */
export async function insightsAffinities(
	client: QlooClient,
	input: { type: "urn:entity:movie" | "urn:entity:videogame"; signal: string[]; ids: string[]; contentBased: boolean },
): Promise<Map<string, number>> {
	const params: Record<string, string> = {
		"filter.type": input.type,
		"signal.interests.entities": input.signal.join(","),
		"filter.results.entities": input.ids.join(","),
		take: String(Math.max(10, input.ids.length)),
	};
	if (input.contentBased) params["bias.content_based"] = "1";
	return client.get("/v2/insights", params, { ttlSec: 0, reduce: (body) => scanAffinities(body, input.ids) });
}

/** Released films matching a name, for picking comps. */
export async function searchFilms(client: QlooClient, query: string): Promise<Comp[]> {
	return client.get(
		"/search",
		{ query, types: "urn:entity:movie", take: "8" },
		{
			reduce: (body) => {
				const data = JSON.parse(body) as { results?: { entity_id: string; name: string; properties?: { release_year?: number; release_date?: string } }[] };
				return (data.results ?? []).map((e) => {
					const year = e.properties?.release_year ?? Number(e.properties?.release_date?.slice(0, 4));
					return { id: e.entity_id, name: e.name, year: Number.isFinite(year) && year > 0 ? year : undefined };
				});
			},
		},
	);
}

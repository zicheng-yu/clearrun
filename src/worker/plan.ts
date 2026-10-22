/**
 * Scores the slate against one audience, one step per request (client-driven), so every invocation stays
 * inside the Workers Free plan. A step makes at most two Qloo calls, in parallel. Affinities are cached
 * per (audience, entity) in D1 for 7 days, so a repeat plan costs no Qloo calls; what-ifs run in the
 * browser on the returned scores. When live scoring is off, out of budget or failing, older cached scores
 * fill the gaps, so a featured plan keeps working after its cache expires.
 */
import { percentiles, placeAmong, sizes } from "../engine/score/normalize.ts";
import { ANCHOR_GAMES } from "../shared/games.ts";
import type { PlanResponse, RivalScore, SlateSnapshot, SlateTitle } from "../shared/types.ts";
import { insightsAffinities, QlooError, QlooQuotaError, type QlooClient } from "./qloo.ts";
import { cachedAffinities, latestSnapshot, storeAffinities, type AffinityDomain } from "./store.ts";

const FILM_BATCH = 30;
const CALLS_PER_STEP = 2;
const AFFINITY_TTL_MS = 7 * 24 * 3600 * 1000;
const QLOO_ID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

export class PlanInputError extends Error {}
export class SlateNotReadyError extends Error {}

/** 1–5 Qloo entity IDs, uppercased, deduplicated and sorted, so one audience has one cache key. */
export function normalizeComps(comps: unknown): string[] {
	if (!Array.isArray(comps)) throw new PlanInputError("comps must be a list of Qloo entity IDs");
	const ids = [...new Set(comps.map((c) => String(c).trim().toUpperCase()))].sort();
	if (ids.length < 1 || ids.length > 5) throw new PlanInputError("Pick between 1 and 5 comps");
	if (!ids.every((id) => QLOO_ID.test(id))) throw new PlanInputError("Comps must be Qloo entity IDs");
	return ids;
}

/** Rival IDs are unique even when a film is listed twice (e.g., limited and wide dates). */
const rivalId = (t: SlateTitle) => `${t.id}@${t.date}`;
const unique = (ids: string[]) => [...new Set(ids.map((id) => id.toUpperCase()))];

/**
 * `maxCalls` caps this step's Qloo calls (the agent shares one scoring step per request across its tools).
 * `snapshot` plans against a given slate instead of the latest one: Simulate passes a copy with one date changed.
 */
export async function planStep(
	ctx: { db: D1Database; qloo?: QlooClient },
	input: { comps?: unknown; you?: unknown },
	options: { maxCalls?: number; snapshot?: SlateSnapshot } = {},
): Promise<PlanResponse> {
	const comps = normalizeComps(input.comps);
	const signal = comps.join(",");
	const snapshot = options.snapshot ?? (await latestSnapshot(ctx.db));
	if (!snapshot) throw new SlateNotReadyError("The release slate is still being built");

	const you = typeof input.you === "string" ? snapshot.titles.find((t) => t.id === input.you) : undefined;
	// Your own title and your comps are never rivals.
	const rivals = snapshot.titles.filter((t) => t.id !== you?.id && !(t.qloo && comps.includes(t.qloo.id.toUpperCase())));
	const films = rivals.filter((t) => t.kind === "film");
	const games = rivals.filter((t) => t.kind === "game");
	// Biggest titles first, so a partial run (e.g., a budget stop) still covers the ones that matter.
	const filmIds = unique([...films].sort((a, b) => (b.views30d ?? 0) - (a.views30d ?? 0)).flatMap((t) => (t.qloo ? [t.qloo.id] : [])));
	const gameIds = unique([...ANCHOR_GAMES.map((g) => g.id), ...games.flatMap((t) => (t.proxy ? [t.proxy.id] : []))]);

	const scores: Record<AffinityDomain, Map<string, number | null>> = {
		movie: await cachedAffinities(ctx.db, signal, "movie", AFFINITY_TTL_MS),
		videogame: await cachedAffinities(ctx.db, signal, "videogame", AFFINITY_TTL_MS),
	};
	const missing = () => ({ movie: filmIds.filter((id) => !scores.movie.has(id)), videogame: gameIds.filter((id) => !scores.videogame.has(id)) });

	let calls = 0;
	let notice: string | undefined;
	let failed: QlooError | undefined;
	const todo = missing();
	if (ctx.qloo && (options.maxCalls ?? CALLS_PER_STEP) > 0 && (todo.movie.length > 0 || todo.videogame.length > 0)) {
		const jobs: { domain: AffinityDomain; ids: string[] }[] = [];
		const limit = Math.min(CALLS_PER_STEP, options.maxCalls ?? CALLS_PER_STEP);
		for (let i = 0; i < todo.movie.length && jobs.length < limit; i += FILM_BATCH) jobs.push({ domain: "movie", ids: todo.movie.slice(i, i + FILM_BATCH) });
		if (todo.videogame.length > 0 && jobs.length < limit) jobs.push({ domain: "videogame", ids: todo.videogame });
		const qloo = ctx.qloo;
		try {
			const found = await Promise.all(
				jobs.map((job) =>
					insightsAffinities(qloo, {
						type: job.domain === "movie" ? "urn:entity:movie" : "urn:entity:videogame",
						signal: comps,
						ids: job.ids,
						// Unreleased films have no behavioral data; released anchor games do.
						contentBased: job.domain === "movie",
					}),
				),
			);
			calls = jobs.length;
			const batches = jobs.map((job, i) => ({ domain: job.domain, asked: job.ids, found: found[i] ?? new Map<string, number>() }));
			await storeAffinities(ctx.db, signal, batches);
			for (const b of batches) for (const id of b.asked) scores[b.domain].set(id, b.found.get(id) ?? null);
		} catch (error) {
			if (error instanceof QlooQuotaError) notice = error.message;
			else if (error instanceof QlooError) failed = error;
			else throw error;
		}
	}

	let left = missing();
	const total = filmIds.length + gameIds.length;
	const count = () => left.movie.length + left.videogame.length;
	if (count() > 0 && ctx.qloo && !notice && !failed) return { status: "scoring", scored: total - count(), total, qlooCalls: calls };
	// Live scoring is off, out of budget or failing: older cached scores fill the gaps.
	let stale = false;
	if (count() > 0) {
		for (const domain of ["movie", "videogame"] as const) {
			const old = await cachedAffinities(ctx.db, signal, domain, Number.POSITIVE_INFINITY);
			for (const id of left[domain]) {
				if (!old.has(id)) continue;
				scores[domain].set(id, old.get(id) ?? null);
				stale = true;
			}
		}
		left = missing();
	}
	// A passing error with nothing cached to fall back on: let the client retry.
	if (failed && count() > 0) throw failed;
	const pending = count();

	const size = sizes(new Map(snapshot.titles.map((t) => [rivalId(t), t.views30d])));
	const filmAffinity = new Map<string, number>();
	for (const t of films) {
		const a = t.qloo ? scores.movie.get(t.qloo.id.toUpperCase()) : undefined;
		if (typeof a === "number") filmAffinity.set(rivalId(t), a);
	}
	const filmOverlap = percentiles(filmAffinity);
	const anchors = ANCHOR_GAMES.map((g) => g.id.toUpperCase());

	const scored: RivalScore[] = rivals.map((t) => {
		const id = rivalId(t);
		const base: RivalScore = { id, kind: t.kind, title: t.title, page: t.page, date: t.date, week: t.week, views30d: t.views30d, size: size.get(id) ?? 0.05 };
		if (t.kind === "game") {
			if (!t.proxy) return base;
			const proxyId = t.proxy.id.toUpperCase();
			const a = scores.videogame.get(proxyId);
			const others = anchors
				.filter((x) => x !== proxyId)
				.flatMap((x) => {
					const v = scores.videogame.get(x);
					return typeof v === "number" ? [v] : [];
				});
			return { ...base, qlooId: proxyId, proxy: t.proxy, affinity: a ?? undefined, overlap: typeof a === "number" ? placeAmong(a, others) : undefined };
		}
		return { ...base, qlooId: t.qloo?.id, affinity: filmAffinity.get(id), overlap: filmOverlap.get(id) };
	});

	return {
		status: "ready",
		snapshot: { id: snapshot.id, createdAt: snapshot.createdAt, windowStart: snapshot.windowStart, windowEnd: snapshot.windowEnd },
		comps,
		you: you && { id: you.id, title: you.title, date: you.date, week: you.week, page: you.page },
		rivals: scored,
		coverage: {
			films: films.length,
			mapped: films.filter((t) => t.qloo).length,
			scored: scored.filter((r) => r.kind === "film" && r.overlap !== undefined).length,
			games: games.length,
			gamesScored: scored.filter((r) => r.kind === "game" && r.overlap !== undefined).length,
		},
		qlooCalls: calls,
		notice:
			notice ??
			(failed
				? "Qloo didn't answer, so scores cached earlier are shown."
				: pending > 0
					? "Live Qloo scoring is off here, so only cached scores are shown."
					: stale
						? "Live Qloo scoring is off here, so scores cached earlier are shown."
						: undefined),
	};
}

/**
 * Share links and link previews. Social sites read a page's Open Graph tags without running its script, so page loads run through
 * the Worker. It reads the share target from the URL: a featured scenario, an agent run, a watch, a shared plan or the backtests.
 * It builds the target's card from cached data (no Qloo scoring, no model calls) and writes the title, description and card
 * image into the SPA's index.html. A card's PNG is drawn on its first fetch and kept in D1 under the card's hash, so a preview
 * costs one render however often it's fetched.
 */
import { backtestShare, CARD_VERSION, HOME_META, planShare, type Card, type CardMeta } from "../engine/share/card.ts";
import { cardSvg } from "../engine/share/svg.ts";
import { analyze } from "../engine/score/analyze.ts";
import { leadWeek, listWeeks } from "../engine/score/calendar.ts";
import { isoDay } from "../shared/dates.ts";
import { SCENARIOS } from "../shared/scenarios.ts";
import type { Comp, ShareMeta, SharedPlan, SlateSnapshot } from "../shared/types.ts";
import { agentRun } from "./agent.ts";
import { backtests } from "./backtest.ts";
import { normalizeComps, planStep } from "./plan.ts";
import { namedComps, type QlooClient } from "./qloo.ts";
import { cachedShareMeta, latestSnapshot, latestSnapshotId, loadCard, loadShare, saveCard, saveCardImage, saveShare, sharesSince, storeShareMeta } from "./store.ts";
import { getWatch } from "./watch.ts";

export type ShareTarget = { kind: "home" } | { kind: "backtests" } | { kind: "scenario" | "run" | "watch" | "plan"; id: string };

export interface ShareContext {
	db: D1Database;
	/** True in the offline demo, whose cards say their scores are synthetic. */
	demo?: boolean;
}

export class ShareInputError extends Error {}
export class ShareLimitError extends Error {}

const ID = /^[A-Za-z0-9-]{1,64}$/;

/** What a page URL shares, read in the order the page reads its parameters. */
export function targetOf(params: URLSearchParams): ShareTarget {
	const view = params.get("view");
	if (view === "backtests") return { kind: "backtests" };
	if (view === "slate") return { kind: "home" };
	for (const kind of ["run", "plan", "watch", "scenario"] as const) {
		const id = params.get(kind);
		if (id && ID.test(id)) return { kind, id };
	}
	return { kind: "home" };
}

/** The canonical link for a target. */
export function linkOf(origin: string, target: ShareTarget): string {
	if (target.kind === "home") return `${origin}/`;
	if (target.kind === "backtests") return `${origin}/?view=backtests`;
	return `${origin}/?${target.kind}=${encodeURIComponent(target.id)}`;
}

async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A plan's card from cached scores. Undefined when too little is cached to say anything. */
async function planCard(
	ctx: ShareContext,
	snapshot: SlateSnapshot,
	input: { context: string; comps: Comp[]; you?: string; from?: string; week?: string },
): Promise<{ card: Card; meta: CardMeta } | undefined> {
	const plan = await planStep({ db: ctx.db }, { comps: input.comps.map((c) => c.id), you: input.you }, { maxCalls: 0, snapshot });
	if (plan.status !== "ready" || plan.coverage.scored < 10) return undefined;
	const weeks = listWeeks(snapshot.windowStart, snapshot.windowEnd);
	const from = input.from ?? leadWeek(weeks, isoDay(new Date()));
	const analysis = analyze({ rivals: plan.rivals, windowStart: snapshot.windowStart, windowEnd: snapshot.windowEnd, from, yourWeek: input.week ?? plan.you?.week, weeks });
	return planShare({
		analysis,
		rivals: plan.rivals,
		context: input.context,
		comps: input.comps.map((c) => c.short ?? c.name),
		title: plan.you?.title,
		slateAt: snapshot.createdAt,
		demo: ctx.demo,
	});
}

/** The same plan the page shows for a target, as a card. */
async function cardFor(ctx: ShareContext, target: ShareTarget): Promise<{ card: Card; meta: CardMeta } | undefined> {
	if (target.kind === "home") return undefined;
	if (target.kind === "backtests") {
		const cases = await backtests(ctx.db);
		return cases.length > 0 ? backtestShare(cases) : undefined;
	}
	const snapshot = await latestSnapshot(ctx.db);
	if (!snapshot) return undefined;
	switch (target.kind) {
		case "scenario": {
			const s = SCENARIOS.find((x) => x.id === target.id);
			const weeks = listWeeks(snapshot.windowStart, snapshot.windowEnd);
			return s && planCard(ctx, snapshot, { context: s.name, comps: s.comps, you: s.you, from: s.from && weeks.includes(s.from) ? s.from : undefined });
		}
		case "run": {
			// Comp names in a run come from Qloo search results the agent saw; the question itself never reaches the card.
			const run = await agentRun(ctx.db, target.id);
			return run?.done && run.plan ? planCard(ctx, snapshot, { context: "Release agent", comps: run.plan.comps, you: run.plan.you, from: run.plan.from }) : undefined;
		}
		case "watch": {
			const watch = await getWatch(ctx.db, target.id);
			if (!watch || watch.status === "ended") return undefined;
			const comps = (watch.featured && SCENARIOS.find((s) => s.id === watch.id)?.comps) || watch.comps;
			return planCard(ctx, snapshot, { context: "Watched plan", comps, you: watch.you, from: watch.from, week: watch.current.week });
		}
		case "plan": {
			const shared = await loadShare<SharedPlan>(ctx.db, target.id);
			return shared && planCard(ctx, snapshot, { context: "Shared plan", comps: shared.comps, you: shared.you, from: shared.from });
		}
	}
}

/**
 * The link, title, description and card image for a target, falling back to the site's own card. A target's card only changes
 * with the slate (watches re-plan on new slates; runs and shared plans never change), so the result is kept per slate snapshot:
 * a page load is then two small reads, and the plan is recomputed once a day.
 */
export async function shareMeta(ctx: ShareContext, origin: string, target: ShareTarget): Promise<ShareMeta> {
	const url = linkOf(origin, target);
	const fallback = { url, ...HOME_META, image: `${origin}/og.png` };
	if (target.kind === "home") return fallback;
	const key = `${target.kind}:${"id" in target ? target.id : ""}:${(await latestSnapshotId(ctx.db)) ?? ""}:${CARD_VERSION}`;
	const kept = await cachedShareMeta<CardMeta & { image: string }>(ctx.db, key);
	if (kept) return { url, ...kept, image: `${origin}${kept.image}` };
	const made = await cardFor(ctx, target);
	// Nothing to show yet (say, a run still in progress): no card, and nothing kept, so the next look tries again.
	if (!made) return fallback;
	const body = JSON.stringify(made.card);
	const hash = (await sha256(body)).slice(0, 16);
	await saveCard(ctx.db, hash, body);
	const image = `/og/${hash}.png`;
	await storeShareMeta(ctx.db, key, { ...made.meta, image });
	return { url, ...made.meta, image: `${origin}${image}` };
}

/** The SPA's index.html with a target's title, description, canonical link and Open Graph and Twitter tags. */
export async function sharePage(request: Request, assets: Fetcher, ctx: ShareContext, log: (message: string, fields: Record<string, unknown>) => void): Promise<Response> {
	const url = new URL(request.url);
	// A plain GET for the page, without conditional headers: the body changes with the URL, so a 304 for the file won't do.
	const page = await assets.fetch(new Request(new URL("/", url)));
	if (request.method !== "GET" || !page.ok || !(page.headers.get("content-type") ?? "").includes("text/html")) return page;
	let meta: ShareMeta;
	try {
		meta = await shareMeta(ctx, url.origin, targetOf(url.searchParams));
	} catch (error) {
		log("share meta failed", { error: error instanceof Error ? error.message : String(error) });
		meta = { url: `${url.origin}/`, ...HOME_META, image: `${url.origin}/og.png` };
	}
	const headers = new Headers(page.headers);
	headers.delete("etag");
	headers.set("cache-control", "no-cache");
	const set = (attribute: string, value: string) => ({ element: (e: Element) => void e.setAttribute(attribute, value) });
	return new HTMLRewriter()
		.on("title", { element: (e) => void e.setInnerContent(meta.title) })
		.on('link[rel="canonical"]', set("href", meta.url))
		.on('meta[property="og:url"]', set("content", meta.url))
		.on('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]', set("content", meta.description))
		.on('meta[property="og:title"], meta[name="twitter:title"]', set("content", meta.title))
		.on('meta[property="og:image"], meta[name="twitter:image"]', set("content", meta.image))
		.on('meta[property="og:image:alt"], meta[name="twitter:image:alt"]', set("content", meta.alt))
		.transform(new Response(page.body, { status: 200, headers }));
}

function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
	const binary = atob(text);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/**
 * A card image, /og/<hash>.png. Only cards this Worker built can be drawn, so a stranger can't make it render anything else. The
 * first fetch renders (resvg, loaded on demand) and stores the PNG; later fetches come from the edge cache or D1.
 */
export async function cardImage(request: Request, db: D1Database, waitUntil: (p: Promise<unknown>) => void, canRender: () => Promise<boolean>): Promise<Response> {
	const hash = /^\/og\/([0-9a-f]{16})\.png$/.exec(new URL(request.url).pathname)?.[1];
	if (!hash) return new Response("Not found", { status: 404 });
	const cache = caches.default;
	const hit = await cache.match(request);
	if (hit) return hit;
	const row = await loadCard(db, hash);
	if (!row) return new Response("Not found", { status: 404 });
	let png = row.png ? fromBase64(row.png) : undefined;
	if (!png) {
		if (!(await canRender())) return new Response("Too many requests", { status: 429, headers: { "retry-after": "60" } });
		const { renderPng } = await import("./og/render.ts");
		png = await renderPng(cardSvg(JSON.parse(row.body) as Card));
		await saveCardImage(db, hash, toBase64(png));
	}
	// A hash names one card forever, so the image never changes.
	const response = new Response(png, { headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" } });
	waitUntil(cache.put(request, response.clone()));
	return response;
}

/**
 * Saves a custom plan for a share link (?plan=). Comp names come from Qloo, never from the client, so a link preview can't be made
 * to show text a visitor typed. The ID is derived from the plan, so sharing the same plan twice gives the same link.
 */
export async function createSharedPlan(
	ctx: ShareContext & { qloo?: QlooClient; client: string; daily: number },
	origin: string,
	input: { comps?: unknown; you?: unknown; from?: unknown },
): Promise<ShareMeta & { id: string }> {
	const ids = normalizeComps(input.comps);
	const snapshot = await latestSnapshot(ctx.db);
	if (!snapshot) throw new ShareInputError("The release slate is still being built");
	const weeks = listWeeks(snapshot.windowStart, snapshot.windowEnd);
	const from = typeof input.from === "string" && weeks.includes(input.from) ? input.from : leadWeek(weeks, isoDay(new Date()));
	const you = typeof input.you === "string" && snapshot.titles.some((t) => t.id === input.you) ? input.you : undefined;
	const id = (await sha256(`${ids.join(",")}|${you ?? ""}|${from}`)).slice(0, 12);
	if (!(await loadShare<SharedPlan>(ctx.db, id))) {
		if ((await sharesSince(ctx.db, ctx.client, Date.parse(`${isoDay(new Date())}T00:00:00Z`))) >= ctx.daily) {
			throw new ShareLimitError(`This address has shared ${ctx.daily} plans today.`);
		}
		const comps = await namedComps(ctx.qloo, ids);
		if (!comps) throw new ShareInputError("Comps must be released films that Qloo knows");
		const plan: SharedPlan = { id, comps, ...(you ? { you } : {}), from };
		await saveShare(ctx.db, id, ctx.client, plan);
	}
	return { id, ...(await shareMeta(ctx, origin, { kind: "plan", id })) };
}

export function sharedPlan(db: D1Database, id: string): Promise<SharedPlan | undefined> {
	return ID.test(id) ? loadShare<SharedPlan>(db, id) : Promise.resolve(undefined);
}

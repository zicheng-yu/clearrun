/**
 * Builds the committed fixtures from open data only. Nothing here comes from Qloo.
 *
 * - src/shared/backtest-slates.ts: the release calendar around each backtest case, from Wikipedia's "List of
 *   American films" tables (CC BY-SA 4.0), with Wikidata IDs (CC0) and the Wikimedia pageviews each title had
 *   in the 30 days before the case's planning day. The 60 most-viewed titles are kept, plus the case's pair.
 * - src/engine/qloo/mock/fixtures.ts: the offline demo. A frozen copy of the live slate (dates, IDs and
 *   pageviews from the public /api/slate, with every Qloo field removed), released films for comp search, and
 *   SYNTHETIC taste tags for every film, read from the first sentence of its Wikipedia article and its Wikidata
 *   genres. The mock Qloo client scores audiences from these tags.
 *
 * Run: node scripts/build-fixtures.ts   (about 700 Wikimedia requests the first time, cached in /tmp/clearrun-fixtures)
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { imdbIds, pageProps, pageSections, pageviews, sectionWikitext } from "../src/engine/wiki/client.ts";
import { parseFilmList, quarterSections } from "../src/engine/wiki/parse.ts";
import { BACKTESTS, type BacktestTitle } from "../src/shared/backtests.ts";
import { addDays } from "../src/shared/dates.ts";
import { SCENARIOS } from "../src/shared/scenarios.ts";
import type { SlateSnapshot, SlateTitle } from "../src/shared/types.ts";

const SITE = "https://clearrun.zichengyu.com";
const CACHE = "/tmp/clearrun-fixtures";
const UA = "ClearRun/0.1 (https://clearrun.zichengyu.com; Qloo hackathon project)";
const KEEP = 60;
mkdirSync(CACHE, { recursive: true });

// Every GET goes through a disk cache, so a rerun costs nothing. 404s are cached too (pageviews return 404 for no data).
const realFetch = globalThis.fetch;
let live = 0;
let lastLive = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = String(input instanceof Request ? input.url : input);
	const file = `${CACHE}/${createHash("sha1").update(url).digest("hex")}.json`;
	if (existsSync(file)) {
		const { status, body } = JSON.parse(readFileSync(file, "utf8")) as { status: number; body: string };
		return new Response(body, { status });
	}
	for (let attempt = 0; ; attempt++) {
		// Stay well under Wikimedia's rate limits: at most about five live requests a second.
		const wait = lastLive + 200 - Date.now();
		lastLive = Date.now() + Math.max(0, wait);
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
		live += 1;
		const response = await realFetch(input, { ...init, headers: { ...(init?.headers ?? {}), "User-Agent": UA, "Api-User-Agent": UA } });
		if ((response.status === 429 || response.status >= 500) && attempt < 6) {
			const retryAfter = Number(response.headers.get("retry-after"));
			await new Promise((r) => setTimeout(r, (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 5 * (attempt + 1)) * 1000));
			continue;
		}
		const body = await response.text();
		if (response.ok || response.status === 404) writeFileSync(file, JSON.stringify({ status: response.status, body }));
		return new Response(body, { status: response.status });
	}
}) as typeof fetch;

async function getJson<T>(url: string): Promise<T> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${new URL(url).host} ${response.status}`);
	return (await response.json()) as T;
}

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await fn(items[i] as T);
			}
		}),
	);
	return out;
}

const ymd = (day: string) => day.replaceAll("-", "");

// ---------------------------------------------------------------------------------------------------------
// 1. Backtest calendars
// ---------------------------------------------------------------------------------------------------------

async function listRows(start: string, end: string) {
	const rows: { date: string; title: string; page: string }[] = [];
	for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year++) {
		const page = `List of American films of ${year}`;
		for (const index of quarterSections(await pageSections(page), year, start, end)) rows.push(...parseFilmList(await sectionWikitext(page, index), year));
	}
	const seen = new Set<string>();
	return rows.filter((r) => r.date >= start && r.date <= end && !seen.has(`${r.page}|${r.date}`) && seen.add(`${r.page}|${r.date}`));
}

async function resolvePages(pages: string[]) {
	const out = new Map<string, { qid?: string; resolved: string }>();
	for (const batch of chunk([...new Set(pages)], 50)) for (const [k, v] of await pageProps(batch)) out.set(k, v);
	return out;
}

async function imdbOf(qids: string[]) {
	const out = new Map<string, string>();
	for (const batch of chunk([...new Set(qids)], 50)) for (const [k, v] of await imdbIds(batch)) out.set(k, v);
	return out;
}

const backtestSlates: Record<string, BacktestTitle[]> = {};
for (const c of BACKTESTS) {
	const rows = await listRows(c.asOf, c.windowEnd);
	const props = await resolvePages(rows.map((r) => r.page));
	const withIds = rows.flatMap((r) => {
		const p = props.get(r.page);
		return p?.qid ? [{ title: r.title, page: p.resolved, date: r.date, qid: p.qid }] : [];
	});
	const imdb = await imdbOf(withIds.map((t) => t.qid));
	const start = ymd(addDays(c.asOf, -30));
	const end = ymd(addDays(c.asOf, -1));
	const views = await pool(withIds, 6, (t) => pageviews(t.page, start, end).catch(() => 0));
	const all = withIds.map((t, i) => ({ ...t, ...(imdb.get(t.qid) ? { imdb: imdb.get(t.qid) } : {}), views: views[i] ?? 0 }));
	const pair = c.pair.map((page) => props.get(page)?.resolved ?? page);
	const kept = [...all].sort((a, b) => b.views - a.views).filter((t, i) => i < KEEP || pair.includes(t.page));
	for (const page of pair) if (!kept.some((t) => t.page === page)) throw new Error(`${c.id}: ${page} isn't on the list`);
	backtestSlates[c.id] = kept.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
	console.log(`${c.id}: ${rows.length} listed, ${withIds.length} with QIDs, kept ${kept.length} (views ≥ ${kept.at(-1) ? Math.min(...kept.map((t) => t.views)) : 0})`);
}

// ---------------------------------------------------------------------------------------------------------
// 2. The frozen demo slate, and released films for comp search
// ---------------------------------------------------------------------------------------------------------

const slate = (await (await realFetch(`${SITE}/api/slate`)).json()) as SlateSnapshot;
const demoTitles: SlateTitle[] = slate.titles.map(({ qloo: _qloo, ...t }) => t);

/** Featured scenario comps keep their real Qloo IDs (they're already in scenarios.ts); their tags come from Wikipedia. */
const COMP_PAGES: Record<string, string> = {
	"878A5D45-469C-4556-8494-963C2B1D3A95": "Dune: Part Two",
	"3037F0E8-C912-4DC0-BDE3-1F94631F9DA6": "Dune (2021 film)",
	"526DA082-8186-4149-95F9-DD14ED56AEA4": "The Hunger Games (film)",
	"ECFA2EC6-55FD-4CE7-ADA7-12A4A41B0A4A": "The Hunger Games: Catching Fire",
	"0063BFEC-EB8C-458D-A0BF-D7028F5294F6": "The Hunger Games: The Ballad of Songbirds & Snakes",
	"FD27AC52-4880-404E-BECF-E99DEDEAE2FC": "Paddington 2",
	"D908E95E-3471-464F-9472-281639E731FF": "The Wild Robot",
	"17C8BCEF-2FF2-4A23-8F51-6C8CB9CD8114": "Hereditary (film)",
	"E26FA111-146B-47F1-BA1E-34414DF96C83": "Talk to Me (2022 film)",
};
for (const s of SCENARIOS) for (const c of s.comps) if (!COMP_PAGES[c.id]) throw new Error(`Add a Wikipedia page for comp ${c.name}`);

/** Well-known released films that mock search can offer as comps (synthetic IDs). */
const SEARCH_PAGES = [
	"Arrival (film)",
	"Interstellar (film)",
	"Barbie (film)",
	"Oppenheimer (film)",
	"Inside Out 2",
	"Frozen (2013 film)",
	"The Batman (film)",
	"Top Gun: Maverick",
	"Everything Everywhere All at Once",
	"Get Out",
	"Spider-Man: Across the Spider-Verse",
	"Avengers: Endgame",
	"John Wick: Chapter 4",
	"Wicked (2024 film)",
	"Moana 2",
	"The Super Mario Bros. Movie",
	"Knives Out",
	"La La Land",
	"Mad Max: Fury Road",
	"Nope (film)",
	"Smile (2022 film)",
	"M3GAN",
	"Elvis (2022 film)",
	"Little Women (2019 film)",
	"Lady Bird (film)",
	"The Lego Movie",
	"Godzilla x Kong: The New Empire",
	"Encanto",
	"Coco (2017 film)",
	"Puss in Boots: The Last Wish",
	"Paddington (film)",
	"A Quiet Place (film)",
	"The Conjuring",
	"It (2017 film)",
	"Gladiator (2000 film)",
	"Wonka (film)",
	"Deadpool & Wolverine",
	"Sinners (2025 film)",
	"Superman (2025 film)",
];

const compProps = await resolvePages([...Object.values(COMP_PAGES), ...SEARCH_PAGES]);

// ---------------------------------------------------------------------------------------------------------
// 3. Synthetic taste tags: lead sentences (Wikipedia) and genres (Wikidata P136)
// ---------------------------------------------------------------------------------------------------------

async function leads(pages: string[]): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	for (const batch of chunk([...new Set(pages)], 20)) {
		const url = `https://en.wikipedia.org/w/api.php?${new URLSearchParams({ action: "query", prop: "extracts", exintro: "1", explaintext: "1", exsentences: "1", exlimit: "20", redirects: "1", titles: batch.join("|"), format: "json", formatversion: "2" })}`;
		const data = await getJson<{
			query?: { redirects?: { from: string; to: string }[]; normalized?: { from: string; to: string }[]; pages?: { title: string; extract?: string }[] };
		}>(url);
		const alias = new Map<string, string>();
		for (const n of [...(data.query?.normalized ?? []), ...(data.query?.redirects ?? [])]) alias.set(n.to, n.from);
		for (const p of data.query?.pages ?? []) {
			out.set(p.title, p.extract ?? "");
			if (alias.has(p.title)) out.set(alias.get(p.title) as string, p.extract ?? "");
		}
	}
	return out;
}

async function genres(qids: string[]): Promise<Map<string, string[]>> {
	const byQid = new Map<string, string[]>();
	for (const batch of chunk([...new Set(qids)], 50)) {
		const url = `https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: "wbgetentities", ids: batch.join("|"), props: "claims", format: "json" })}`;
		const data = await getJson<{ entities?: Record<string, { claims?: { P136?: { mainsnak?: { datavalue?: { value?: { id?: string } } } }[] } }> }>(url);
		for (const [qid, e] of Object.entries(data.entities ?? {}))
			byQid.set(
				qid,
				(e.claims?.P136 ?? []).flatMap((c) => (c.mainsnak?.datavalue?.value?.id ? [c.mainsnak.datavalue.value.id] : [])),
			);
	}
	const labels = new Map<string, string>();
	for (const batch of chunk([...new Set([...byQid.values()].flat())], 50)) {
		const url = `https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: "wbgetentities", ids: batch.join("|"), props: "labels", languages: "en", format: "json" })}`;
		const data = await getJson<{ entities?: Record<string, { labels?: { en?: { value?: string } } }> }>(url);
		for (const [qid, e] of Object.entries(data.entities ?? {})) if (e.labels?.en?.value) labels.set(qid, e.labels.en.value);
	}
	return new Map([...byQid].map(([qid, ids]) => [qid, ids.flatMap((id) => (labels.has(id) ? [labels.get(id) as string] : []))]));
}

// Tag vocabulary. "live-action" isn't "action".
const VOCAB: [tag: string, pattern: RegExp][] = [
	["superhero", /superhero/],
	["comic book", /\bcomics?\b|\bmarvel\b|\bdc studios\b|\bmanga\b/],
	["science fiction", /science[- ]fiction|sci-fi|space opera|cyberpunk/],
	["fantasy", /fantasy|sword and sorcery|fairy[- ]tale/],
	["action", /(?<!live-)\baction\b/],
	["adventure", /adventure/],
	["animation", /animat|stop-motion/],
	["family", /\bfamily (?:film|comedy|adventure|musical|fantasy|movie)|children's|\bkids\b/],
	["comedy", /comed|satir|parody|spoof|farce/],
	["horror", /horror|slasher|zombie|vampire|werewolf/],
	["thriller", /thriller|suspense/],
	["drama", /\bdrama\b/],
	["romance", /romanc|romantic/],
	["musical", /\bmusical\b|concert film|jukebox/],
	["war", /\bwar (?:film|drama|epic|thriller)|anti-war/],
	["biographical", /biograph|biopic/],
	["crime", /\bcrime\b|heist|gangster|neo-noir|\bnoir\b/],
	["mystery", /mystery|whodunit|detective/],
	["documentary", /documentary/],
	["sports", /\bsports?\b|boxing|football|baseball|basketball|\bracing\b|wrestling/],
	["western", /\bwestern\b/],
	["historical", /historical|\bperiod (?:drama|piece|film)/],
	["epic", /\bepic\b/],
	["psychological", /psychological/],
	["disaster", /disaster/],
	["monster", /monster|kaiju/],
	["spy", /\bspy\b|espionage/],
	["teen", /\bteen|coming[- ]of[- ]age|young adult/],
	["holiday", /christmas|holiday film/],
	["dance", /\bdance (?:film|drama)/],
	["martial arts", /martial arts|kung fu/],
	["video game adaptation", /video game/],
	["dystopian", /dystopi|post-apocalyptic/],
	["supernatural", /supernatural|paranormal|\bghost/],
	["political", /political/],
	["survival", /survival/],
];

function tagsFrom(text: string, genreLabels: string[]): string[] {
	const lead = text.toLowerCase();
	const labels = genreLabels.map((g) => g.toLowerCase()).join(" | ");
	return VOCAB.filter(([, re]) => re.test(lead) || re.test(labels)).map(([tag]) => tag);
}

/** The franchise a title belongs to, from its name: "Dune: Part Three" → "Dune", "Paddington 2" → "Paddington". */
function franchiseOf(title: string): string {
	return title
		.split(":")[0]
		.replace(/\s*\((?:\d{4} )?film\)$/i, "")
		.replace(/^the\s+/i, "")
		.replace(/\s+(?:\d+|ii|iii|iv|v|vi|part (?:one|two|three|\d+))$/i, "")
		.trim();
}

const displayName = (page: string) => page.replace(/\s*\((?:\d{4} )?(?:American )?film\)$/i, "").trim();
const yearIn = (text: string) => Number(/\b(19[2-9]\d|20[0-4]\d)\b/.exec(text)?.[1] ?? 0) || undefined;

// Every film that needs tags, by QID.
const films = new Map<string, { title: string; page: string }>();
for (const t of demoTitles) if (t.kind === "film" && t.wikidata) films.set(t.wikidata, { title: t.title, page: t.page });
for (const list of Object.values(backtestSlates)) for (const t of list) films.set(t.qid, { title: t.title, page: t.page });
for (const page of [...Object.values(COMP_PAGES), ...SEARCH_PAGES]) {
	const p = compProps.get(page);
	if (!p?.qid) throw new Error(`No QID for ${page}`);
	films.set(p.qid, { title: displayName(p.resolved), page: p.resolved });
}
const leadText = await leads([...films.values()].map((f) => f.page));
const genreLabels = await genres([...films.keys()]);

const counts = new Map<string, number>();
for (const f of films.values()) counts.set(franchiseOf(f.title), (counts.get(franchiseOf(f.title)) ?? 0) + 1);
const tags: Record<string, string[]> = {};
for (const [qid, f] of films) {
	const base = tagsFrom(leadText.get(f.page) ?? "", genreLabels.get(qid) ?? []);
	const franchise = franchiseOf(f.title);
	// A franchise tag only means something when two films share it.
	const series = (counts.get(franchise) ?? 0) >= 2 ? [`${franchise} franchise`] : [];
	if (base.length + series.length > 0) tags[qid] = [...series, ...base];
}

const searchFilms = [...Object.entries(COMP_PAGES).map(([id, page]) => ({ id, page })), ...SEARCH_PAGES.map((page) => ({ id: undefined, page }))].map(({ id, page }) => {
	const p = compProps.get(page);
	const resolved = p?.resolved ?? page;
	return { ...(id ? { id } : {}), qid: p?.qid as string, name: displayName(resolved), year: yearIn(leadText.get(resolved) ?? "") };
});

// ---------------------------------------------------------------------------------------------------------
// 4. Write the files
// ---------------------------------------------------------------------------------------------------------

const stamp = new Date().toISOString().slice(0, 10);
writeFileSync(
	"src/shared/backtest-slates.ts",
	`/**
 * GENERATED by scripts/build-fixtures.ts on ${stamp}. Do not edit by hand.
 * The release calendar around each backtest case: Wikipedia's "List of American films" tables (CC BY-SA 4.0),
 * Wikidata IDs (CC0) and Wikimedia pageviews in the 30 days before each case's planning day. No Qloo data.
 */
import type { BacktestTitle } from "./backtests.ts";

export const BACKTEST_SLATES: Record<string, BacktestTitle[]> = ${JSON.stringify(backtestSlates)};
`,
);

const demo = { createdAt: slate.createdAt, windowStart: slate.windowStart, windowEnd: slate.windowEnd, titles: demoTitles };
mkdirSync("src/engine/qloo/mock", { recursive: true });
writeFileSync(
	"src/engine/qloo/mock/fixtures.ts",
	`/**
 * GENERATED by scripts/build-fixtures.ts on ${stamp}. Do not edit by hand. Offline demo data, no Qloo data:
 * - DEMO_SLATE: a frozen copy of the live US release slate (Wikipedia dates, Wikidata IDs, Wikimedia pageviews), Qloo fields removed.
 * - DEMO_FILMS: released films that mock search offers as comps. The featured comps keep their Qloo IDs from scenarios.ts.
 * - DEMO_TAGS: SYNTHETIC taste tags by Wikidata QID, read from each film's Wikipedia lead sentence and its Wikidata genres.
 */
import type { SlateTitle } from "../../../shared/types.ts";

export const DEMO_SLATE: { createdAt: number; windowStart: string; windowEnd: string; titles: SlateTitle[] } = ${JSON.stringify(demo)};

export const DEMO_FILMS: { id?: string; qid: string; name: string; year?: number }[] = ${JSON.stringify(searchFilms)};

export const DEMO_TAGS: Record<string, string[]> = ${JSON.stringify(tags)};
`,
);
execFileSync("npx", ["prettier", "--use-tabs", "--print-width", "180", "--write", "src/shared/backtest-slates.ts", "src/engine/qloo/mock/fixtures.ts"], { stdio: "inherit" });

const tagged = [...films.keys()].filter((q) => tags[q]).length;
console.log(`demo slate: ${demoTitles.length} titles · films tagged: ${tagged} of ${films.size} · ${live} live requests`);
for (const q of [...films.keys()].filter((q) => !tags[q]).slice(0, 15)) console.log(`  untagged: ${films.get(q)?.title}`);

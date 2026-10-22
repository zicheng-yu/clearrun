/**
 * The slate refresh, as a resumable job of small steps. Each cron tick (or admin call) runs one
 * step, so every invocation stays inside the Workers Free plan: a few milliseconds of CPU and well under
 * 50 external subrequests. A full refresh takes about 20 steps; a finished job restarts after 20 hours.
 * Qloo mappings carry over from the previous snapshot, so a daily refresh only looks up new titles.
 */
import { addDays, isoDay, releaseWeek } from "../shared/dates.ts";
import { GAMES } from "../shared/games.ts";
import type { SlateSnapshot, SlateTitle } from "../shared/types.ts";
import { diffSlates } from "../engine/slate/diff.ts";
import { entitiesByExternal, type QlooClient, type QlooEntity } from "./qloo.ts";
import { parseFilmList, quarterSections } from "../engine/wiki/parse.ts";
import { imdbIds, pageProps, pageSections, pageviews, sectionWikitext } from "../engine/wiki/client.ts";
import { latestSnapshot, loadJob, saveJob, saveSnapshot, type JobRow } from "./store.ts";

export const JOB_NAME = "slate";
const RESTART_AFTER_MS = 20 * 3600 * 1000;
const QLOO_WD_BATCH = 20;
const QLOO_IMDB_BATCH = 15;
const VIEWS_PER_STEP = 25;

type Phase = "plan" | "lists" | "qids" | "qloo-wd" | "imdb" | "qloo-imdb" | "views" | "finalize" | "done";

export interface SlateJobState {
	windowStart: string;
	windowEnd: string;
	sections: { year: number; page: string; index: string }[];
	titles: SlateTitle[];
}

const listPage = (year: number) => `List of American films of ${year}`;

function newJob(days: number, now = Date.now()): JobRow<SlateJobState> {
	const windowStart = isoDay(new Date(now));
	return {
		name: JOB_NAME,
		phase: "plan",
		cursor: 0,
		state: { windowStart, windowEnd: addDays(windowStart, days), sections: [], titles: [] },
		startedAt: now,
		updatedAt: now,
	};
}

/** Curated game tentpoles that open inside the window (films come from the Wikipedia lists). */
function gamesIn(s: SlateJobState): SlateTitle[] {
	return GAMES.filter((g) => g.date >= s.windowStart && g.date <= s.windowEnd).map((g) => ({
		id: g.page,
		kind: "game",
		title: g.title,
		page: g.page,
		date: g.date,
		week: releaseWeek(g.date),
		proxy: g.proxy,
		source: g.source,
	}));
}

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

export interface StepContext {
	db: D1Database;
	qloo?: QlooClient;
	days: number;
}

/** Runs one step. Returns the updated job (already saved). */
export async function runSlateStep(ctx: StepContext, options: { restart?: boolean } = {}): Promise<JobRow<SlateJobState>> {
	let job = await loadJob<SlateJobState>(ctx.db, JOB_NAME);
	const now = Date.now();
	if (!job || options.restart || (job.phase === "done" && now - job.updatedAt > RESTART_AFTER_MS)) job = newJob(ctx.days, now);
	if (job.phase === "done") return job;
	try {
		job = await advance(ctx, job);
		job.error = undefined;
	} catch (error) {
		// Keep the phase and cursor; the next tick retries the same step.
		job.error = error instanceof Error ? error.message : String(error);
	}
	job.updatedAt = Date.now();
	await saveJob(ctx.db, job);
	return job;
}

async function advance(ctx: StepContext, job: JobRow<SlateJobState>): Promise<JobRow<SlateJobState>> {
	const s = job.state;
	const next = (phase: Phase) => ({ ...job, phase, cursor: 0 });
	switch (job.phase as Phase) {
		case "plan": {
			const startYear = Number(s.windowStart.slice(0, 4));
			const endYear = Number(s.windowEnd.slice(0, 4));
			const sections: SlateJobState["sections"] = [];
			for (let year = startYear; year <= endYear; year++) {
				const page = listPage(year);
				for (const index of quarterSections(await pageSections(page), year, s.windowStart, s.windowEnd)) sections.push({ year, page, index });
			}
			return { ...next("lists"), state: { ...s, sections } };
		}
		case "lists": {
			const section = s.sections[job.cursor];
			const titles = [...s.titles];
			if (section) {
				const rows = parseFilmList(await sectionWikitext(section.page, section.index), section.year);
				const seen = new Set(titles.map((t) => `${t.page}|${t.date}`));
				for (const row of rows) {
					if (row.date < s.windowStart || row.date > s.windowEnd || seen.has(`${row.page}|${row.date}`)) continue;
					seen.add(`${row.page}|${row.date}`);
					titles.push({ id: row.page, kind: "film", title: row.title, page: row.page, date: row.date, week: releaseWeek(row.date) });
				}
			}
			const cursor = job.cursor + 1;
			if (cursor < s.sections.length) return { ...job, cursor, state: { ...s, titles } };
			return { ...next("qids"), state: { ...s, titles: [...titles, ...gamesIn(s)] } };
		}
		case "qids": {
			const titles = s.titles.map((t) => ({ ...t }));
			for (const batch of chunk([...new Set(titles.map((t) => t.page))], 50)) {
				const props = await pageProps(batch);
				for (const t of titles) {
					const p = props.get(t.page);
					if (!p) continue;
					t.page = p.resolved;
					if (p.qid) {
						t.wikidata = p.qid;
						t.id = p.qid;
					}
				}
			}
			// Carry Qloo mappings over from the previous snapshot; only new titles need lookups.
			const previous = new Map(((await latestSnapshot(ctx.db))?.titles ?? []).filter((t) => t.kind === "film" && t.wikidata).map((t) => [t.wikidata, t]));
			for (const t of titles) {
				const before = t.kind === "film" && t.wikidata ? previous.get(t.wikidata) : undefined;
				if (before?.qloo) t.qloo = before.qloo;
				if (before?.imdb) t.imdb = before.imdb;
			}
			return { ...next("qloo-wd"), state: { ...s, titles } };
		}
		case "qloo-wd":
		case "qloo-imdb": {
			const source = job.phase === "qloo-wd" ? "wikidata" : "imdb";
			const size = source === "wikidata" ? QLOO_WD_BATCH : QLOO_IMDB_BATCH;
			// Games are scored through their proxies, never their own (placeholder) Qloo entities.
			const idOf = (t: SlateTitle) => (t.kind !== "film" ? undefined : source === "wikidata" ? t.wikidata : t.imdb);
			// The cursor walks a list that never shrinks, so mapping titles mid-phase can't skip any.
			const all = [...new Set(s.titles.map(idOf).filter((id): id is string => Boolean(id)))];
			const ids = all.slice(job.cursor, job.cursor + size * 2);
			if (ids.length === 0 || !ctx.qloo) return next(source === "wikidata" ? "imdb" : "views");
			const mapped = new Set(s.titles.filter((t) => t.qloo).map(idOf));
			const found = new Map<string, QlooEntity>();
			for (const part of chunk(
				ids.filter((id) => !mapped.has(id)),
				size,
			)) {
				for (const [k, v] of await entitiesByExternal(ctx.qloo, source, part)) found.set(k, v);
			}
			const titles = s.titles.map((t) => {
				const e = found.get(idOf(t)?.toLowerCase() ?? "");
				return e && !t.qloo ? { ...t, qloo: { id: e.entity_id, name: e.name, popularity: e.popularity, release: e.properties?.release_date } } : t;
			});
			return { ...job, cursor: job.cursor + ids.length, state: { ...s, titles } };
		}
		case "imdb": {
			const titles = s.titles.map((t) => ({ ...t }));
			const qids = [...new Set(titles.filter((t) => t.kind === "film" && !t.qloo && !t.imdb && t.wikidata).map((t) => t.wikidata as string))];
			for (const batch of chunk(qids, 50)) {
				const ids = await imdbIds(batch);
				for (const t of titles) if (t.wikidata && ids.has(t.wikidata)) t.imdb = ids.get(t.wikidata);
			}
			return { ...next("qloo-imdb"), state: { ...s, titles } };
		}
		case "views": {
			// Titles Qloo can score come first, so a partial run still sizes the ones that matter.
			const order = s.titles.map((t, i) => i).sort((a, b) => Number(!s.titles[a]?.qloo) - Number(!s.titles[b]?.qloo));
			const slice = order.slice(job.cursor, job.cursor + VIEWS_PER_STEP);
			if (slice.length === 0) return next("finalize");
			const end = addDays(isoDay(new Date()), -1).replaceAll("-", "");
			const start = addDays(addDays(isoDay(new Date()), -1), -29).replaceAll("-", "");
			const titles = s.titles.map((t) => ({ ...t }));
			await Promise.all(
				slice.map(async (i) => {
					const t = titles[i];
					if (t) t.views30d = await pageviews(t.page, start, end).catch(() => undefined);
				}),
			);
			return { ...job, cursor: job.cursor + slice.length, state: { ...s, titles } };
		}
		case "finalize": {
			const previous = await latestSnapshot(ctx.db);
			const titles = [...s.titles].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
			const snapshot: SlateSnapshot = {
				id: crypto.randomUUID(),
				createdAt: Date.now(),
				windowStart: s.windowStart,
				windowEnd: s.windowEnd,
				titles,
				stats: {
					titles: titles.length,
					withWikidata: titles.filter((t) => t.wikidata).length,
					mappedToQloo: titles.filter((t) => t.qloo).length,
					withViews: titles.filter((t) => typeof t.views30d === "number").length,
				},
			};
			await saveSnapshot(ctx.db, snapshot, previous ? diffSlates(previous, snapshot) : [], previous?.id);
			return { ...next("done"), state: { ...s, sections: [], titles: [] } };
		}
		default:
			return job;
	}
}

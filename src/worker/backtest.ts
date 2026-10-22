/**
 * The backtest job: maps each case's calendar to Qloo, scores both films' audiences against it in both modes
 * (content-based "pre" and behavioral "today"), then stores the finished cases. Like the slate refresh it runs
 * in small steps (at most two Qloo calls each, from an admin call or an idle cron tick), so every invocation
 * stays inside the Workers Free plan. About 40 Qloo calls in all; visitors only ever read the stored results.
 */
import { MODES, runBacktest, type BacktestResult, type SideScores } from "../engine/backtest/run.ts";
import { BACKTEST_SLATES } from "../shared/backtest-slates.ts";
import { BACKTESTS, type BacktestTitle } from "../shared/backtests.ts";
import { entitiesByExternal, insightsAffinities, pickEntity, QlooQuotaError, type QlooClient } from "./qloo.ts";
import { loadBacktests, loadJob, saveBacktests, saveJob, type JobRow } from "./store.ts";

/** Bump when the method changes: the job restarts and older results are no longer served. */
export const BACKTEST_VERSION = 1;
const JOB = `backtest:v${BACKTEST_VERSION}`;
const CALLS_PER_STEP = 2;
const WD_BATCH = 20;
const IMDB_BATCH = 15;
const SCORE_BATCH = 30;

interface BacktestJobState {
	/** Wikidata QID → Qloo entity ID; null when looked up and not found. */
	mapped: Record<string, string | null>;
	/** QIDs already looked up by IMDb ID. */
	imdbTried: string[];
	/** `${caseId}:${side}:${mode}` → Qloo entity ID → affinity (null when Qloo returned no score). */
	scores: Record<string, Record<string, number | null>>;
}

const allTitles = () => {
	const byQid = new Map<string, BacktestTitle>();
	for (const list of Object.values(BACKTEST_SLATES)) for (const t of list) if (!byQid.has(t.qid)) byQid.set(t.qid, t);
	return [...byQid.values()];
};

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

interface ScoreTask {
	key: string;
	signal: string;
	ids: string[];
	contentBased: boolean;
}

/** Every (case, side, mode) to score, with the rivals still missing a score. A side whose film isn't on Qloo is skipped. */
function scoreTasks(state: BacktestJobState): ScoreTask[] {
	return BACKTESTS.flatMap((c) => {
		const titles = BACKTEST_SLATES[c.id] ?? [];
		return c.pair.flatMap((page, side) => {
			const you = titles.find((t) => t.page === page);
			const signal = you ? state.mapped[you.qid] : null;
			if (!signal) return [];
			const ids = [...new Set(titles.filter((t) => t.page !== page).flatMap((t) => (state.mapped[t.qid] ? [state.mapped[t.qid] as string] : [])))];
			return MODES.map((mode) => {
				const key = `${c.id}:${side}:${mode}`;
				const have = state.scores[key] ?? {};
				return { key, signal, ids: ids.filter((id) => !(id in have)), contentBased: mode === "pre" };
			});
		});
	}).filter((t) => t.ids.length > 0);
}

export interface BacktestStep {
	phase: "map" | "map-imdb" | "score" | "done";
	calls: number;
	left?: number;
	error?: string;
}

/** Runs one step of the job; finishes by storing every case. */
export async function runBacktestStep(ctx: { db: D1Database; qloo?: QlooClient }): Promise<BacktestStep> {
	const now = Date.now();
	const job: JobRow<BacktestJobState> = (await loadJob<BacktestJobState>(ctx.db, JOB)) ?? {
		name: JOB,
		phase: "map",
		cursor: 0,
		state: { mapped: {}, imdbTried: [], scores: {} },
		startedAt: now,
		updatedAt: now,
	};
	if (job.phase === "done") return { phase: "done", calls: 0 };
	if (!ctx.qloo) return { phase: job.phase as BacktestStep["phase"], calls: 0, error: "Qloo is off here" };
	const qloo = ctx.qloo;
	const s = job.state;
	const titles = allTitles();
	let calls = 0;
	try {
		const unmapped = titles.filter((t) => !(t.qid in s.mapped));
		const imdbLeft = titles.filter((t) => s.mapped[t.qid] === null && t.imdb && !s.imdbTried.includes(t.qid));
		if (unmapped.length > 0) {
			job.phase = "map";
			const batches = chunk(unmapped, WD_BATCH).slice(0, CALLS_PER_STEP);
			const found = await Promise.all(
				batches.map((b) =>
					entitiesByExternal(
						qloo,
						"wikidata",
						b.map((t) => t.qid),
					),
				),
			);
			calls = batches.length;
			batches.forEach((b, i) => {
				for (const t of b) s.mapped[t.qid] = pickEntity(found[i]?.get(t.qid.toLowerCase()), t.date)?.entity_id.toUpperCase() ?? null;
			});
		} else if (imdbLeft.length > 0) {
			job.phase = "map-imdb";
			const batches = chunk(imdbLeft, IMDB_BATCH).slice(0, CALLS_PER_STEP);
			const found = await Promise.all(
				batches.map((b) =>
					entitiesByExternal(
						qloo,
						"imdb",
						b.map((t) => t.imdb as string),
					),
				),
			);
			calls = batches.length;
			batches.forEach((b, i) => {
				for (const t of b) {
					s.imdbTried.push(t.qid);
					const e = pickEntity(found[i]?.get((t.imdb as string).toLowerCase()), t.date);
					if (e) s.mapped[t.qid] = e.entity_id.toUpperCase();
				}
			});
		} else {
			const tasks = scoreTasks(s);
			if (tasks.length > 0) {
				job.phase = "score";
				// One audience per step: its missing rivals, up to two batches.
				const task = tasks[0] as ScoreTask;
				const batches = chunk(task.ids, SCORE_BATCH).slice(0, CALLS_PER_STEP);
				const found = await Promise.all(batches.map((ids) => insightsAffinities(qloo, { type: "urn:entity:movie", signal: [task.signal], ids, contentBased: task.contentBased })));
				calls = batches.length;
				const have = { ...(s.scores[task.key] ?? {}) };
				batches.forEach((ids, i) => {
					for (const id of ids) have[id] = found[i]?.get(id.toUpperCase()) ?? null;
				});
				s.scores[task.key] = have;
			} else {
				await saveBacktests(ctx.db, BACKTEST_VERSION, results(s, qloo.demo));
				job.phase = "done";
			}
		}
		job.error = undefined;
	} catch (error) {
		// Keep the state; the next step retries. A spent budget waits for the next day.
		job.error = error instanceof QlooQuotaError ? error.message : error instanceof Error ? error.message : String(error);
	}
	job.updatedAt = Date.now();
	await saveJob(ctx.db, job);
	return { phase: job.phase as BacktestStep["phase"], calls, left: job.phase === "done" ? 0 : scoreTasks(s).length, ...(job.error ? { error: job.error } : {}) };
}

function results(s: BacktestJobState, demo: boolean): BacktestResult[] {
	return BACKTESTS.map((c) =>
		runBacktest({
			c,
			titles: BACKTEST_SLATES[c.id] ?? [],
			qloo: s.mapped,
			scores: c.pair.map((_, side) => Object.fromEntries(MODES.map((mode) => [mode, s.scores[`${c.id}:${side}:${mode}`] ?? {}])) as SideScores),
			demo,
		}),
	);
}

/** Finished backtests for the current method version, in case order; empty until the job has run. Names and questions come from the code. */
export async function backtests(db: D1Database): Promise<BacktestResult[]> {
	const stored = await loadBacktests<BacktestResult>(db, BACKTEST_VERSION);
	return BACKTESTS.flatMap((c) => stored.filter((r) => r.id === c.id).map((r) => ({ ...r, name: c.name, question: c.question })));
}

/** Recomputes the stored cases from the job's saved scores, with no Qloo calls (after a change to how results are derived). */
export async function rebuildBacktests(db: D1Database, demo: boolean): Promise<number> {
	const job = await loadJob<BacktestJobState>(db, JOB);
	if (!job || job.phase !== "done") return 0;
	const cases = results(job.state, demo);
	await saveBacktests(db, BACKTEST_VERSION, cases);
	return cases.length;
}

/** Restarts the job (an admin action, e.g. after the calendars were rebuilt). */
export async function restartBacktests(db: D1Database): Promise<void> {
	const now = Date.now();
	await saveJob<BacktestJobState>(db, { name: JOB, phase: "map", cursor: 0, state: { mapped: {}, imdbTried: [], scores: {} }, startedAt: now, updatedAt: now });
}

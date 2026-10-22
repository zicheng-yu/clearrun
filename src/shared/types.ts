/** A release on the slate: a US theatrical film from Wikipedia, or a curated game tentpole. */
export interface SlateTitle {
	/** Wikidata QID when known, else the Wikipedia page title. */
	id: string;
	kind: "film" | "game";
	title: string;
	/** Wikipedia page title as linked from the list. */
	page: string;
	/** US release date from Wikipedia (YYYY-MM-DD). The source of truth for dates. */
	date: string;
	/** Friday that starts the release week the title opens into (YYYY-MM-DD). */
	week: string;
	wikidata?: string;
	imdb?: string;
	qloo?: QlooRef;
	/** Games only: a released predecessor that stands in for the unreleased game in Qloo. */
	proxy?: QlooRef;
	/** Games only: where the release date was checked. */
	source?: string;
	/** Wikipedia pageviews over the last 30 complete days: the shared attention unit. */
	views30d?: number;
}

export interface QlooRef {
	id: string;
	name: string;
	popularity?: number;
	/** Qloo's own release date, which can be a festival or foreign date; informational only. */
	release?: string;
}

export interface SlateStats {
	titles: number;
	withWikidata: number;
	mappedToQloo: number;
	withViews: number;
}

export interface SlateSnapshot {
	id: string;
	createdAt: number;
	windowStart: string;
	windowEnd: string;
	titles: SlateTitle[];
	stats: SlateStats;
}

export interface SlateChange {
	kind: "moved" | "added" | "removed";
	id: string;
	title: string;
	from?: string;
	to?: string;
}

export interface Health {
	name: "Clear Run";
	modes: { qloo: "live" | "mock"; agent: "llm" | "scripted"; model?: string };
	slate: { snapshotId?: string; createdAt?: number; stats?: SlateStats; job?: { phase: string; updatedAt: number; error?: string } };
	budgets: {
		llm: { todayUsd: number; totalUsd: number; dailyCapUsd: number; totalCapUsd: number };
		qloo: { month: string; calls: number; cap: number; today: number; dailyCap: number; sharedRemaining?: number };
	};
}

/** A released title that describes your audience (Qloo signal). */
export interface Comp {
	id: string;
	name: string;
	year?: number;
	/** Shorter display name, for long franchise titles. */
	short?: string;
}

/** A rival as scored against one audience. Calendar math happens in `engine/score` (Worker and browser). */
export interface RivalScore {
	id: string;
	kind: "film" | "game";
	title: string;
	page: string;
	date: string;
	week: string;
	views30d?: number;
	/** Attention size, 0.05–1: min–max of log10 pageviews across the slate. */
	size: number;
	/** Raw Qloo affinity of your audience for this rival (films) or for its proxy (games). */
	affinity?: number;
	/** Overlap percentile, 0–1: among scored films, or the proxy's place among anchor games. */
	overlap?: number;
	/** Qloo entity ID used for scoring (the film itself or the game's proxy). */
	qlooId?: string;
	proxy?: QlooRef;
}

export interface PlanRequest {
	comps: string[];
	/** Slate ID of your own title, when it is already dated; it is left out of the rivals. */
	you?: string;
}

export interface PlanProgress {
	status: "scoring";
	scored: number;
	total: number;
	qlooCalls: number;
}

export interface PlanResult {
	status: "ready";
	snapshot: { id: string; createdAt: number; windowStart: string; windowEnd: string };
	comps: string[];
	you?: { id: string; title: string; date: string; week: string; page: string };
	rivals: RivalScore[];
	coverage: { films: number; mapped: number; scored: number; games: number; gamesScored: number };
	/** Qloo requests this call made; repeat plans are served from the cache. */
	qlooCalls: number;
	/** Set when scoring stopped early (e.g., a Qloo budget guard) and some rivals are unscored. */
	notice?: string;
}

export type PlanResponse = PlanProgress | PlanResult;

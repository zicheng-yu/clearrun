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
		qloo: { month: string; calls: number; cap: number; sharedRemaining?: number };
	};
}

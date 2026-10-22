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

/** What the agent planned with, so the page can render the same plan. */
export interface AgentPlan {
	comps: Comp[];
	you?: string;
	from: string;
}

export type AgentEvent =
	| { type: "call"; id: string; tool: string; label: string }
	| { type: "result"; id: string; tool: string; summary: string; error?: boolean }
	| { type: "progress"; text: string }
	| { type: "thought"; text: string }
	| {
			type: "answer";
			text: string;
			/** Dates in the answer checked against this run's tool results. */
			check: { dates: number; unverified: string[] };
			costUsd: number;
			modelCalls: number;
			model?: string;
			tokens?: { input: number; cached: number; output: number };
	  }
	| { type: "error"; text: string };

export interface AgentStepResponse {
	runId: string;
	done: boolean;
	/** Events after the `after` index the client sent. */
	events: AgentEvent[];
	total: number;
	plan?: AgentPlan;
	question: string;
	/** True when a finished run of the same question was replayed at no model cost. */
	replay?: boolean;
	/** The no-tools comparison, once someone asked for it. */
	baseline?: BaselineResult;
}

/** A watched plan at one check: the part shown before and after a change. */
export interface WatchState {
	/** The opening week being watched (Friday). */
	week: string;
	/** Pressure and buzz at that week, 0–1. */
	pressure: number;
	buzz: number;
	hold: boolean;
	/** Rank of the watched week by clear score, of the weeks you could open (0 when it can't be ranked). */
	rank: number;
	of: number;
	/** The clearest week other than the watched one. */
	best: string;
	clear: string[];
	danger: string[];
	/** Rivals behind the watched week's pressure, strongest first; k is weeks since the rival opened. */
	felt: { title: string; date: string; k: number; share: number }[];
}

/** A watched plan at one check, with what's needed to spot changes at the next one. */
export interface WatchSummary extends WatchState {
	snapshotId: string;
	snapshotAt: number;
	windowStart: string;
	windowEnd: string;
	/** The planned title's own opening day, when it is dated. */
	youDate?: string;
	/** Every rival's opening days by slate id, to spot moves, new entrants and exits. */
	rivals: Record<string, { title: string; dates: string[] }>;
}

export interface WatchChange {
	kind: "moved" | "added" | "removed" | "you-moved";
	title: string;
	from?: string;
	to?: string;
	/** The new date falls outside the slate window. */
	outside?: boolean;
}

export interface AgentNote {
	text: string;
	check: { dates: number; unverified: string[] };
	costUsd: number;
	model?: string;
	replay?: boolean;
}

export interface WatchEvent {
	at: number;
	kind: "created" | "slate" | "simulation" | "ended";
	/** "action": the verdict flipped or your own title moved; "notable": a nearby rival changed or the best week moved. */
	severity: "action" | "notable" | "quiet";
	changes: WatchChange[];
	/** Date changes elsewhere on the calendar that don't touch the watched week. */
	elsewhere: number;
	before?: WatchState;
	after: WatchState;
	/** Templated summary of the change; every name and number comes from the two checks. */
	note: string;
	agentNote?: AgentNote;
	slateAt: number;
}

export interface WatchView {
	id: string;
	label: string;
	featured: boolean;
	createdAt: number;
	checkedAt: number;
	status: "active" | "ended";
	comps: Comp[];
	you?: string;
	from: string;
	followsYou: boolean;
	current: WatchState;
	slateAt: number;
	/** A newer slate exists and the daily check hasn't reached this watch yet. */
	stale: boolean;
	events: WatchEvent[];
}

export type ClaimStatus = "right-date" | "right-week" | "wrong-date" | "no-date" | "not-on-slate" | "outside-window";

export interface CheckedClaim {
	title: string;
	/** The date the model gave (YYYY-MM-DD), when it gave a full one. */
	said?: string;
	saidText?: string;
	status: ClaimStatus;
	slate?: { title: string; date: string };
}

/** The same question answered by the same model with no tools, and its release dates checked against the live slate. */
export interface BaselineResult {
	answer: string;
	/** Null when the model's list of releases couldn't be read. */
	claims: CheckedClaim[] | null;
	counts: Record<ClaimStatus, number>;
	/** The audience's biggest rivals (from the agent's plan) that the answer never mentions. */
	missed: { title: string; date: string }[];
	topChecked: number;
	/** The date the model recommended, rated on the live calendar for the agent's audience. */
	pick?: { said: string; week: string; pressure: number; rank: number; of: number; season?: string };
	costUsd: number;
	model?: string;
	at: number;
}

/**
 * Backtest cases: two films that opened the same day, re-planned as Clear Run would have planned them eight
 * weeks earlier. The calendar around each case comes from Wikipedia (backtest-slates.ts, built by
 * scripts/build-fixtures.ts), with attention sized by the pageviews each title had before that day.
 */
import { addDays } from "./dates.ts";

export interface BacktestCase {
	id: string;
	name: string;
	/** What the case tests, in one sentence. */
	question: string;
	/** The opening day the two films shared (YYYY-MM-DD). */
	date: string;
	/** Wikipedia pages of the two films, as linked from the list. */
	pair: [string, string];
	/** The day Clear Run plans on: eight weeks before the opening. */
	asOf: string;
	/** End of the slate window: 24 weeks after `asOf`, close to the live slate's 180 days. */
	windowEnd: string;
}

const LEAD_DAYS = 56;
const WINDOW_DAYS = 168;

function backtest(c: Omit<BacktestCase, "asOf" | "windowEnd">): BacktestCase {
	const asOf = addDays(c.date, -LEAD_DAYS);
	return { ...c, asOf, windowEnd: addDays(asOf, WINDOW_DAYS) };
}

export const BACKTESTS: BacktestCase[] = [
	backtest({
		id: "barbenheimer",
		name: "Barbenheimer",
		question: "Barbie and Oppenheimer opened the same day. How much did their audiences overlap before release?",
		date: "2023-07-21",
		pair: ["Barbie (film)", "Oppenheimer (film)"],
	}),
	backtest({
		id: "glicked",
		name: "Glicked",
		question: "Wicked and Gladiator II opened the same day. How much did their audiences overlap before release?",
		date: "2024-11-22",
		pair: ["Wicked (2024 film)", "Gladiator II"],
	}),
	backtest({
		id: "sonic-mufasa",
		name: "Sonic 3 and Mufasa",
		question: "Sonic the Hedgehog 3 and Mufasa: The Lion King, two family films, opened the same day. How much did their audiences overlap before release?",
		date: "2024-12-20",
		pair: ["Sonic the Hedgehog 3 (film)", "Mufasa: The Lion King"],
	}),
];

/** A title on a backtest calendar: open data only (no Qloo fields). */
export interface BacktestTitle {
	title: string;
	/** Wikipedia page title, redirects resolved. */
	page: string;
	date: string;
	qid: string;
	imdb?: string;
	/** User pageviews in the 30 days before the case's `asOf` day. */
	views: number;
}

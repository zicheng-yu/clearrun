/**
 * Parser for Wikipedia's "List of American films of {year}" release tables (CC BY-SA 4.0).
 *
 * Each quarterly table has month header cells (`! rowspan=… data-sort-value="MM" | …`), day cells
 * (`| rowspan=… | '''18'''`) and title rows that start with an italic link (`| ''[[Page|Title]]''`).
 * Months come from `data-sort-value`: the aria-label text is not reliable (December has been
 * spelled "Decmber").
 */

export interface ListRow {
	date: string;
	title: string;
	page: string;
}

const MONTH_HEADER = /^!.*rowspan="\d+".*data-sort-value="(\d{1,2})"/;
const DAY_CELL = /^\|\s*(?:rowspan="\d+"\s*)?(?:style="[^"]*"\s*)?\|\s*'''(\d{1,2})'''/;
const TITLE_CELL = /^\|\s*''\[\[([^\]|]+)(?:\|([^\]]+))?\]\]''/;

const pad = (n: number) => String(n).padStart(2, "0");

export function parseFilmList(wikitext: string, year: number): ListRow[] {
	const rows: ListRow[] = [];
	let month: number | undefined;
	let day: number | undefined;
	for (const line of wikitext.split("\n")) {
		const header = MONTH_HEADER.exec(line);
		if (header) {
			const value = Number(header[1]);
			if (value >= 1 && value <= 12) {
				month = value;
				day = undefined;
			}
		}
		const dayCell = DAY_CELL.exec(line);
		if (dayCell) {
			day = Number(dayCell[1]);
			continue;
		}
		const title = TITLE_CELL.exec(line);
		if (title?.[1] && month && day) {
			const page = title[1].trim();
			rows.push({ date: `${year}-${pad(month)}-${pad(day)}`, title: (title[2] ?? page).trim(), page });
		}
	}
	return rows;
}

const QUARTERS: { months: [number, number]; words: string[] }[] = [
	{ months: [1, 3], words: ["January", "March"] },
	{ months: [4, 6], words: ["April", "June"] },
	{ months: [7, 9], words: ["July", "September"] },
	{ months: [10, 12], words: ["October", "December"] },
];

/** Section indexes of the quarterly tables that overlap [start, end] for one year. */
export function quarterSections(sections: { index: string; line: string }[], year: number, start: string, end: string): string[] {
	const out: string[] = [];
	for (const q of QUARTERS) {
		const qStart = `${year}-${pad(q.months[0])}-01`;
		const qEnd = `${year}-${pad(q.months[1])}-31`;
		if (qEnd < start || qStart > end) continue;
		const section = sections.find((s) => q.words.every((w) => s.line.includes(w)));
		if (section) out.push(section.index);
	}
	return out;
}

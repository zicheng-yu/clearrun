/**
 * Pulls (entity_id, affinity) pairs out of a raw /v2/insights body without JSON.parse. Insights entities
 * run about 45 KB each (tags, keywords, websites), so parsing a 30-title batch whole would overrun the
 * Workers Free CPU budget; native string search costs a fraction of that. Only IDs we asked for are
 * accepted, so IDs nested elsewhere in the body can't be mistaken for results.
 */

const ID_KEY = '"entity_id"';
const AFFINITY_KEY = '"affinity"';
const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/y;

/** Index just past `:` and any whitespace after a JSON key that ends at `from`, or −1. */
function valueStart(text: string, from: number): number {
	let i = from;
	while (text[i] === " " || text[i] === "\n" || text[i] === "\r" || text[i] === "\t") i++;
	if (text[i] !== ":") return -1;
	i++;
	while (text[i] === " " || text[i] === "\n" || text[i] === "\r" || text[i] === "\t") i++;
	return i;
}

export function scanAffinities(text: string, wanted: Iterable<string>): Map<string, number> {
	const ids = new Set([...wanted].map((id) => id.toUpperCase()));
	const out = new Map<string, number>();
	let current: string | undefined;
	let nextId = text.indexOf(ID_KEY);
	let nextAffinity = text.indexOf(AFFINITY_KEY);
	while (nextId >= 0 || nextAffinity >= 0) {
		if (nextId >= 0 && (nextAffinity < 0 || nextId < nextAffinity)) {
			const start = valueStart(text, nextId + ID_KEY.length);
			if (start >= 0 && text[start] === '"') {
				const end = text.indexOf('"', start + 1);
				const id = text.slice(start + 1, end).toUpperCase();
				if (ids.has(id)) current = id;
			}
			nextId = text.indexOf(ID_KEY, nextId + ID_KEY.length);
		} else {
			const start = valueStart(text, nextAffinity + AFFINITY_KEY.length);
			NUMBER.lastIndex = start;
			const match = start >= 0 ? NUMBER.exec(text) : null;
			if (current && match && !out.has(current)) out.set(current, Number(match[0]));
			current = undefined;
			nextAffinity = text.indexOf(AFFINITY_KEY, nextAffinity + AFFINITY_KEY.length);
		}
	}
	return out;
}

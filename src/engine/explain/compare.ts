/**
 * Rival explanations from Qloo's /v2/analysis/compare: taste tags your comps share with a rival, and
 * tags only one side has. It works for unreleased titles too (their tags come from metadata).
 */

export interface Tag {
	name: string;
	/** Tag family from its subtype, e.g. "genre", "theme", "keyword", "audience". */
	kind: string;
}

export interface Comparison {
	shared: (Tag & { score: number })[];
	onlyYours: Tag[];
	onlyTheirs: Tag[];
}

interface RawTag {
	name?: string;
	subtype?: string;
	query?: { score?: number; count?: string | number };
}

const kindOf = (subtype?: string) => subtype?.split(":")[2] ?? "tag";
const key = (name: string) => name.trim().toLowerCase();

/** Shared tags by score, then each side's own tags (most widely held first), names deduplicated. */
export function reduceCompare(raw: { results?: { tags?: RawTag[]; a?: RawTag[]; b?: RawTag[] } }, limit = 8): Comparison {
	const results = raw.results ?? {};
	const shared = new Map<string, Tag & { score: number }>();
	for (const t of results.tags ?? []) {
		if (!t.name) continue;
		const score = t.query?.score ?? 0;
		const seen = shared.get(key(t.name));
		if (!seen || score > seen.score) shared.set(key(t.name), { name: t.name, kind: kindOf(t.subtype), score });
	}
	const sides = (list: RawTag[] | undefined, other: RawTag[] | undefined): Tag[] => {
		const theirs = new Set((other ?? []).flatMap((t) => (t.name ? [key(t.name)] : [])));
		const out = new Map<string, Tag & { count: number }>();
		for (const t of list ?? []) {
			if (!t.name || shared.has(key(t.name)) || theirs.has(key(t.name)) || out.has(key(t.name))) continue;
			out.set(key(t.name), { name: t.name, kind: kindOf(t.subtype), count: Number(t.query?.count ?? 1) || 1 });
		}
		return [...out.values()]
			.sort((x, y) => y.count - x.count)
			.slice(0, limit)
			.map(({ name, kind }) => ({ name, kind }));
	};
	return {
		shared: [...shared.values()].sort((x, y) => y.score - x.score).slice(0, limit),
		onlyYours: sides(results.a, results.b),
		onlyTheirs: sides(results.b, results.a),
	};
}

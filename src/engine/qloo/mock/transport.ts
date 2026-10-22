/**
 * A stand-in for the Qloo hackathon host in the offline demo. It answers the five calls Clear Run makes
 * (`/entities`, `/search`, `/v2/insights` for titles and for demographics, `/v2/analysis/compare`) with JSON in
 * Qloo's response shapes, so the real client, reducers and caches all run. Every value is SYNTHETIC (model.ts).
 */
import { BACKTEST_SLATES } from "../../../shared/backtest-slates.ts";
import { DEMO_FILMS, DEMO_SLATE, DEMO_TAGS } from "./fixtures.ts";
import { affinity, demographicsOf, mockId, tagsOf, weightOf } from "./model.ts";

interface Known {
	qid: string;
	name: string;
	date?: string;
	imdb?: string;
}

// Every film the fixtures know, by QID, with a name and a date to answer `/entities` lookups.
const known = new Map<string, Known>();
for (const list of Object.values(BACKTEST_SLATES)) for (const t of list) known.set(t.qid, { qid: t.qid, name: t.title, date: t.date, imdb: t.imdb });
for (const t of DEMO_SLATE.titles) if (t.kind === "film" && t.wikidata) known.set(t.wikidata, { qid: t.wikidata, name: t.title, date: t.date, imdb: t.imdb });
for (const f of DEMO_FILMS) if (!known.has(f.qid)) known.set(f.qid, { qid: f.qid, name: f.name, date: f.year ? `${f.year}-01-01` : undefined });
const byImdb = new Map([...known.values()].flatMap((k) => (k.imdb ? [[k.imdb, k] as const] : [])));
const nameOf = new Map<string, string>();
for (const k of known.values()) if (DEMO_TAGS[k.qid]) nameOf.set(mockId(k.qid), k.name);
for (const f of DEMO_FILMS) if (f.id) nameOf.set(f.id.toUpperCase(), f.name);

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", "X-Month-RateLimit-Remaining": "50000" } });
const list = (value: string | null) =>
	(value ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
const words = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.split(" ")
		.filter(Boolean);

function entity(k: Known) {
	return {
		entity_id: DEMO_FILMS.find((f) => f.qid === k.qid)?.id ?? mockId(k.qid),
		name: k.name,
		properties: { release_date: k.date, external: { wikidata: { id: k.qid.toLowerCase() }, ...(k.imdb ? { imdb: { id: k.imdb } } : {}) } },
	};
}

function entities(params: URLSearchParams) {
	const found = [...list(params.get("external.wikidata.ids")).map((q) => known.get(q.toUpperCase())), ...list(params.get("external.imdb.ids")).map((id) => byImdb.get(id))];
	return { results: found.flatMap((k) => (k && DEMO_TAGS[k.qid] ? [entity(k)] : [])) };
}

function search(params: URLSearchParams) {
	const q = words(params.get("query") ?? "");
	const take = Number(params.get("take") ?? 8);
	const hits = DEMO_FILMS.filter((f) => q.every((w) => words(f.name).includes(w) || words(f.name).some((x) => x.startsWith(w))));
	return { results: hits.slice(0, take).map((f) => ({ entity_id: f.id ?? mockId(f.qid), name: f.name, properties: { release_year: f.year } })) };
}

function insights(params: URLSearchParams) {
	const signal = list(params.get("signal.interests.entities"));
	if (params.get("filter.type") === "urn:demographics") {
		return {
			results: {
				demographics: signal.flatMap((id) => {
					const d = demographicsOf(id);
					return d ? [{ entity_id: id, query: { age: d.age, gender: { male: d.male, female: -d.male } } }] : [];
				}),
			},
		};
	}
	const scored = list(params.get("filter.results.entities")).flatMap((id) => {
		const a = affinity(signal, id);
		return a === undefined ? [] : [{ entity_id: id.toUpperCase(), name: nameOf.get(id.toUpperCase()) ?? "Demo title", query: { affinity: a } }];
	});
	return { results: { entities: scored.sort((x, y) => y.query.affinity - x.query.affinity) } };
}

const tag = (name: string) => ({ name, subtype: name.endsWith(" franchise") ? "urn:tag:franchise:demo" : "urn:tag:genre:demo" });

function compare(params: URLSearchParams) {
	const a = list(params.get("a.signal.interests.entities")).map((id) => tagsOf(id) ?? []);
	const b = list(params.get("b.signal.interests.entities")).map((id) => tagsOf(id) ?? []);
	const count = (sides: string[][]) => {
		const out = new Map<string, number>();
		for (const tags of sides) for (const t of tags) out.set(t, (out.get(t) ?? 0) + 1);
		return out;
	};
	const ca = count(a);
	const cb = count(b);
	const shared = [...ca.keys()].filter((t) => cb.has(t));
	return {
		results: {
			tags: shared.map((t) => ({ ...tag(t), query: { score: Math.round(Math.min(1, (weightOf(t) / 3) * ((ca.get(t) ?? 0) / Math.max(1, a.length))) * 1000) / 1000 } })),
			a: [...ca].map(([t, n]) => ({ ...tag(t), query: { count: n } })),
			b: [...cb].map(([t, n]) => ({ ...tag(t), query: { count: n } })),
		},
	};
}

/** Answers a Qloo GET from the synthetic model. Unknown paths return 404, like an unsupported call would. */
export async function demoQloo(url: string): Promise<Response> {
	const u = new URL(url);
	switch (u.pathname) {
		case "/entities":
			return json(entities(u.searchParams));
		case "/search":
			return json(search(u.searchParams));
		case "/v2/insights":
			return json(insights(u.searchParams));
		case "/v2/analysis/compare":
			return json(compare(u.searchParams));
		default:
			return new Response(JSON.stringify({ error: "not in the offline demo" }), { status: 404 });
	}
}

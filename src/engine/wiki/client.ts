/** Wikipedia, Wikidata and Wikimedia pageviews: open data with a descriptive User-Agent. */

const UA = "ClearRun/0.1 (https://clearrun.zichengyu.com; Qloo hackathon project)";
const headers = { "User-Agent": UA, "Api-User-Agent": UA, Accept: "application/json" };

async function getJson<T>(url: string): Promise<T> {
	const response = await fetch(url, { headers });
	if (!response.ok) throw new Error(`${new URL(url).host} ${response.status}`);
	return (await response.json()) as T;
}

const api = (params: Record<string, string>) => `https://en.wikipedia.org/w/api.php?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;

export async function pageSections(page: string): Promise<{ index: string; line: string }[]> {
	const data = await getJson<{ parse?: { sections?: { index: string; line: string }[] } }>(api({ action: "parse", page, prop: "sections", redirects: "1" }));
	return data.parse?.sections ?? [];
}

export async function sectionWikitext(page: string, section: string): Promise<string> {
	const data = await getJson<{ parse?: { wikitext?: string } }>(api({ action: "parse", page, prop: "wikitext", section, redirects: "1" }));
	return data.parse?.wikitext ?? "";
}

/** Wikidata QIDs and resolved titles for up to 50 Wikipedia pages (redirects followed). */
export async function pageProps(pages: string[]): Promise<Map<string, { qid?: string; resolved: string }>> {
	const data = await getJson<{
		query?: {
			normalized?: { from: string; to: string }[];
			redirects?: { from: string; to: string }[];
			pages?: { title: string; missing?: boolean; pageprops?: { wikibase_item?: string } }[];
		};
	}>(api({ action: "query", prop: "pageprops", ppprop: "wikibase_item", redirects: "1", titles: pages.join("|") }));
	const q = data.query ?? {};
	const alias = new Map<string, string>();
	for (const n of [...(q.normalized ?? []), ...(q.redirects ?? [])]) alias.set(n.from, n.to);
	const byTitle = new Map((q.pages ?? []).map((p) => [p.title, p.pageprops?.wikibase_item]));
	const out = new Map<string, { qid?: string; resolved: string }>();
	for (const page of pages) {
		let t = page;
		for (let i = 0; i < 3 && alias.has(t); i++) t = alias.get(t) ?? t;
		out.set(page, { qid: byTitle.get(t), resolved: t });
	}
	return out;
}

/** IMDb IDs (Wikidata P345) for up to 50 QIDs. */
export async function imdbIds(qids: string[]): Promise<Map<string, string>> {
	const url = `https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: "wbgetentities", ids: qids.join("|"), props: "claims", format: "json" })}`;
	const data = await getJson<{ entities?: Record<string, { claims?: { P345?: { mainsnak?: { datavalue?: { value?: string } } }[] } }> }>(url);
	const out = new Map<string, string>();
	for (const [qid, entity] of Object.entries(data.entities ?? {})) {
		const id = entity.claims?.P345?.map((c) => c.mainsnak?.datavalue?.value).find((v) => v?.startsWith("tt"));
		if (id) out.set(qid, id);
	}
	return out;
}

/** Total user pageviews of one article between two days (YYYYMMDD), or 0 when there is no data yet. */
export async function pageviews(title: string, start: string, end: string): Promise<number> {
	const article = encodeURIComponent(title.replaceAll(" ", "_"));
	const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${article}/daily/${start}/${end}`;
	const response = await fetch(url, { headers });
	if (response.status === 404) return 0;
	if (!response.ok) throw new Error(`pageviews ${response.status}`);
	const data = (await response.json()) as { items?: { views: number }[] };
	return (data.items ?? []).reduce((sum, item) => sum + item.views, 0);
}

import { useMemo } from "react";
import { fmtDay } from "../engine/score/narrate.ts";
import type { SlateSnapshot, SlateTitle } from "../shared/types.ts";

export const wikiUrl = (page: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(page.replaceAll(" ", "_"))}`;

function AttentionBar({ views, max }: { views?: number; max: number }) {
	const width = views && views > 0 ? Math.max(4, (Math.log10(views + 1) / Math.log10(max + 1)) * 100) : 0;
	return (
		<div className="mt-1.5 h-1 w-full rounded bg-line" aria-hidden>
			<div className="h-1 rounded bg-marquee" style={{ width: `${width}%` }} />
		</div>
	);
}

function TitleChip({ t, max }: { t: SlateTitle; max: number }) {
	const offDay = t.date !== t.week;
	const taste = t.kind === "game" ? (t.proxy ? `proxy: ${t.proxy.name}` : "game") : t.qloo ? "Qloo ✓" : "no taste data";
	return (
		<li className={`rounded-lg border bg-stage px-3 py-2 ${t.kind === "game" ? "border-dashed border-marquee/60" : "border-line"}`}>
			<div className="flex items-baseline justify-between gap-3">
				<a href={wikiUrl(t.page)} target="_blank" rel="noreferrer" className="font-medium text-ink hover:underline">
					{t.title}
				</a>
				<span className="shrink-0 text-xs text-muted">{taste}</span>
			</div>
			<div className="mt-0.5 text-xs text-muted">
				{t.kind === "game" ? "Game · " : ""}
				{offDay ? `Opens ${fmtDay(t.date, { weekday: "short", month: "short", day: "numeric" })} · ` : ""}
				{typeof t.views30d === "number" ? `${t.views30d.toLocaleString("en-US")} Wikipedia views (30 days)` : "attention not measured yet"}
			</div>
			<AttentionBar views={t.views30d} max={max} />
		</li>
	);
}

/** The raw release slate, week by week: what the planner works from. */
export function SlateList({ slate }: { slate?: SlateSnapshot }) {
	const weeks = useMemo(() => {
		const map = new Map<string, SlateTitle[]>();
		for (const t of slate?.titles ?? []) map.set(t.week, [...(map.get(t.week) ?? []), t]);
		return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
	}, [slate]);
	const maxViews = useMemo(() => Math.max(1, ...(slate?.titles ?? []).map((t) => t.views30d ?? 0)), [slate]);
	const stats = slate?.stats;
	if (!slate) return null;

	return (
		<section>
			<p className="mb-6 max-w-3xl text-sm text-ink-2">
				The live US release calendar the planner works from: Wikipedia's lists of American films, matched to Qloo through Wikidata, plus curated game tentpoles. It's rebuilt every
				day, and date changes are logged.
			</p>
			{stats && (
				<dl className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
					{[
						["Releases", stats.titles],
						["Matched to Qloo", stats.mappedToQloo],
						["With attention data", stats.withViews],
						["Weeks", weeks.length],
					].map(([label, value]) => (
						<div key={label} className="rounded-lg border border-line bg-stage px-4 py-3">
							<dt className="text-xs text-muted">{label}</dt>
							<dd className="font-display text-3xl tracking-wide">{value}</dd>
						</div>
					))}
				</dl>
			)}
			<ol className="space-y-6">
				{weeks.map(([week, titles]) => (
					<li key={week}>
						<h3 className="mb-2 font-display text-2xl tracking-wide text-marquee">Week of {fmtDay(week, { month: "short", day: "numeric", year: "numeric" })}</h3>
						<ul className="grid gap-2 sm:grid-cols-2">
							{titles.map((t) => (
								<TitleChip key={`${t.id}-${t.date}`} t={t} max={maxViews} />
							))}
						</ul>
					</li>
				))}
			</ol>
		</section>
	);
}

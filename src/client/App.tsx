import { useEffect, useMemo, useState } from "react";
import type { Health, SlateSnapshot, SlateTitle } from "../shared/types.ts";

const fmtDay = (day: string, opts: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });

function useJson<T>(url: string): { data?: T; error?: string } {
	const [state, setState] = useState<{ data?: T; error?: string }>({});
	useEffect(() => {
		let live = true;
		fetch(url)
			.then(async (r) => (r.ok ? ((await r.json()) as T) : Promise.reject(new Error(r.status === 503 ? "The release calendar is still being built. Check back in a few minutes." : `HTTP ${r.status}`))))
			.then((data) => live && setState({ data }))
			.catch((e: unknown) => live && setState({ error: e instanceof Error ? e.message : String(e) }));
		return () => {
			live = false;
		};
	}, [url]);
	return state;
}

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
	return (
		<li className="rounded-lg border border-line bg-stage px-3 py-2">
			<div className="flex items-baseline justify-between gap-3">
				<a href={`https://en.wikipedia.org/wiki/${encodeURIComponent(t.page.replaceAll(" ", "_"))}`} target="_blank" rel="noreferrer" className="font-medium text-ink hover:underline">
					{t.title}
				</a>
				<span className="shrink-0 text-xs text-muted">{t.qloo ? "Qloo ✓" : "no taste data"}</span>
			</div>
			<div className="mt-0.5 text-xs text-muted">
				{offDay ? `Opens ${fmtDay(t.date, { weekday: "short", month: "short", day: "numeric" })} · ` : ""}
				{typeof t.views30d === "number" ? `${t.views30d.toLocaleString("en-US")} Wikipedia views (30 days)` : "attention not measured yet"}
			</div>
			<AttentionBar views={t.views30d} max={max} />
		</li>
	);
}

export function App() {
	const slate = useJson<SlateSnapshot>("/api/slate");
	const health = useJson<Health>("/api/health");
	const weeks = useMemo(() => {
		const map = new Map<string, SlateTitle[]>();
		for (const t of slate.data?.titles ?? []) map.set(t.week, [...(map.get(t.week) ?? []), t]);
		return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
	}, [slate.data]);
	const maxViews = useMemo(() => Math.max(1, ...(slate.data?.titles ?? []).map((t) => t.views30d ?? 0)), [slate.data]);
	const stats = slate.data?.stats;

	return (
		<div className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
			<header className="pt-10 pb-8">
				<p className="text-xs tracking-[0.3em] text-marquee">QLOO AGENTIC HACKATHON</p>
				<h1 className="font-display text-7xl leading-none tracking-wide sm:text-8xl">Clear Run</h1>
				<p className="mt-3 max-w-2xl text-lg text-ink-2">Find the week your audience is free.</p>
				<p className="mt-2 max-w-2xl text-sm text-muted">
					Below is the live US release calendar the agent plans against, rebuilt every day from open data and matched to Qloo's taste graph. Audience-overlap
					scoring and the release agent come next.
				</p>
			</header>

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

			{slate.error && <p className="rounded-lg border border-line bg-stage p-4 text-ink-2">{slate.error}</p>}

			<ol className="space-y-6">
				{weeks.map(([week, titles]) => (
					<li key={week}>
						<h2 className="mb-2 font-display text-2xl tracking-wide text-marquee">Week of {fmtDay(week, { month: "short", day: "numeric", year: "numeric" })}</h2>
						<ul className="grid gap-2 sm:grid-cols-2">
							{titles.map((t) => (
								<TitleChip key={`${t.id}-${t.date}`} t={t} max={maxViews} />
							))}
						</ul>
					</li>
				))}
			</ol>

			<footer className="mt-14 border-t border-line pt-6 text-xs leading-relaxed text-muted">
				<p>
					Release dates: Wikipedia, "List of American films" (CC BY-SA 4.0). IDs: Wikidata (CC0). Attention: Wikimedia pageviews. Taste data by Qloo. Clear Run is
					not affiliated with any studio.
				</p>
				{slate.data && <p className="mt-1">Calendar built {new Date(slate.data.createdAt).toLocaleString("en-US")}.</p>}
				{health.data && (
					<p className="mt-1">
						Budgets: Qloo {health.data.budgets.qloo.calls.toLocaleString("en-US")} / {health.data.budgets.qloo.cap.toLocaleString("en-US")} requests this month · AI agent $
						{health.data.budgets.llm.todayUsd.toFixed(3)} today (cap ${health.data.budgets.llm.dailyCapUsd.toFixed(2)}).
					</p>
				)}
			</footer>
		</div>
	);
}

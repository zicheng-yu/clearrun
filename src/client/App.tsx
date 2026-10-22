import { useState } from "react";
import type { Health, SlateSnapshot } from "../shared/types.ts";
import { useJson } from "./api.ts";
import { Planner } from "./Planner.tsx";
import { SlateList } from "./SlateList.tsx";

type Tab = "plan" | "slate";

export function App() {
	const slate = useJson<SlateSnapshot>("/api/slate");
	const health = useJson<Health>("/api/health");
	const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).get("view") === "slate" ? "slate" : "plan"));
	const stats = slate.data?.stats;
	const games = slate.data?.titles.filter((t) => t.kind === "game").length ?? 0;

	return (
		<div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
			<header className="pt-10 pb-8">
				<p className="text-xs tracking-[0.3em] text-marquee">QLOO AGENTIC HACKATHON</p>
				<h1 className="font-display text-7xl leading-none tracking-wide sm:text-8xl">Clear Run</h1>
				<p className="mt-3 max-w-2xl text-xl text-ink">Find the week your audience is free.</p>
				<p className="mt-3 max-w-3xl text-sm text-ink-2">
					Pick a release week your audience isn't already spoken for. Clear Run builds the live US release calendar from open data, asks Qloo's taste graph how strongly fans of
					your comps care about every rival (games included), and turns that into week-by-week audience pressure, with clear weeks, danger weeks and counter-programming openings.
				</p>
				{stats && (
					<p className="mt-3 text-xs text-muted">
						Live slate: {stats.titles - games} films and {games} game{games === 1 ? "" : "s"} from{" "}
						{new Date(`${slate.data?.windowStart}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} to{" "}
						{new Date(`${slate.data?.windowEnd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}, {stats.mappedToQloo}{" "}
						matched to Qloo.
					</p>
				)}
			</header>

			<nav className="mb-6 flex gap-1 border-b border-line" role="tablist">
				{(
					[
						["plan", "Plan a release"],
						["slate", "Release slate"],
					] as const
				).map(([id, label]) => (
					<button
						key={id}
						type="button"
						role="tab"
						aria-selected={tab === id}
						onClick={() => setTab(id)}
						className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === id ? "border-marquee text-ink" : "border-transparent text-muted hover:text-ink-2"}`}
					>
						{label}
					</button>
				))}
			</nav>

			{slate.error && <p className="mb-6 rounded-lg border border-line bg-stage p-4 text-ink-2">{slate.error}</p>}
			<div hidden={tab !== "plan"}>
				<Planner slate={slate.data} />
			</div>
			<div hidden={tab !== "slate"}>
				<SlateList slate={slate.data} />
			</div>

			<footer className="mt-14 border-t border-line pt-6 text-xs leading-relaxed text-muted">
				<p>
					Release dates: Wikipedia,{" "}
					<a className="underline" href="https://en.wikipedia.org/wiki/List_of_American_films_of_2026" target="_blank" rel="noreferrer">
						"List of American films"
					</a>{" "}
					(CC BY-SA 4.0) and each game's article. IDs: Wikidata (CC0). Attention: Wikimedia pageviews. Taste data by Qloo. Clear Run is not affiliated with any studio or publisher,
					and it doesn't forecast box office.
				</p>
				{slate.data && <p className="mt-1">Calendar built {new Date(slate.data.createdAt).toLocaleString("en-US")}.</p>}
				{health.data && (
					<p className="mt-1">
						Budgets: Qloo {health.data.budgets.qloo.today.toLocaleString("en-US")} / {health.data.budgets.qloo.dailyCap.toLocaleString("en-US")} requests today,{" "}
						{health.data.budgets.qloo.calls.toLocaleString("en-US")} / {health.data.budgets.qloo.cap.toLocaleString("en-US")} this month · AI agent $
						{health.data.budgets.llm.todayUsd.toFixed(3)} today (cap ${health.data.budgets.llm.dailyCapUsd.toFixed(2)}).
					</p>
				)}
			</footer>
		</div>
	);
}

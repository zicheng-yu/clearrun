import { useState } from "react";
import type { Health, SlateSnapshot } from "../shared/types.ts";
import { useJson } from "./api.ts";
import { Planner } from "./Planner.tsx";
import { SlateList } from "./SlateList.tsx";

type Tab = "plan" | "slate";

const TABS = [
	["plan", "Plan a release"],
	["slate", "Release slate"],
] as const;

/** The mark: a run of crowded weeks with one short, lit bar, the week your audience is free. */
function Mark() {
	const bars: [x: number, height: number, fill: string][] = [
		[0, 16, "fill-hot/45"],
		[5.2, 20, "fill-hot/70"],
		[10.4, 6, "fill-marquee"],
		[15.6, 18, "fill-hot/70"],
		[20.8, 12, "fill-hot/45"],
		[26, 22, "fill-hot"],
	];
	return (
		<svg width="30" height="22" viewBox="0 0 30 22" aria-hidden="true">
			{bars.map(([x, height, fill]) => (
				<rect key={x} x={x} y={22 - height} width="4" height={height} rx="1" className={fill} />
			))}
		</svg>
	);
}

export function App() {
	const slate = useJson<SlateSnapshot>("/api/slate");
	const health = useJson<Health>("/api/health");
	const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).get("view") === "slate" ? "slate" : "plan"));
	const stats = slate.data?.stats;
	const games = slate.data?.titles.filter((t) => t.kind === "game").length ?? 0;

	return (
		<div className="min-h-screen">
			<header className="border-b border-line bg-black/20">
				<div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-x-8 gap-y-1 px-4 py-2 sm:px-8">
					<div className="flex flex-wrap items-center gap-x-7 gap-y-1">
						<a href="/" className="flex min-h-11 items-center gap-2.5 text-ink">
							<Mark />
							<span className="font-display text-3xl leading-none tracking-[0.06em]">Clear Run</span>
						</a>
						<nav aria-label="Views" className="flex gap-1" role="tablist">
							{TABS.map(([id, label]) => (
								<button
									key={id}
									type="button"
									role="tab"
									aria-selected={tab === id}
									onClick={() => setTab(id)}
									className={`min-h-10 rounded-lg px-3.5 text-sm font-medium ${tab === id ? "bg-line text-ink" : "text-ink-2 hover:bg-line/50 hover:text-ink"}`}
								>
									{label}
								</button>
							))}
						</nav>
					</div>
					{stats && (
						<p className="flex items-center gap-2 py-2 font-mono text-xs text-muted">
							<span aria-hidden className="size-2 rounded-full bg-marquee shadow-[0_0_8px_rgb(242_182_50/0.7)]" />
							Live slate · {stats.titles - games} films, {games} game{games === 1 ? "" : "s"} · {stats.mappedToQloo} on Qloo
						</p>
					)}
				</div>
			</header>

			<main className="mx-auto max-w-[1360px] px-4 pt-7 pb-12 sm:px-8">
				{slate.error && <p className="mb-6 rounded-xl border border-line bg-stage p-4 text-ink-2">{slate.error}</p>}
				<div hidden={tab !== "plan"}>
					<Planner slate={slate.data} />
				</div>
				<div hidden={tab !== "slate"}>
					<SlateList slate={slate.data} />
				</div>
			</main>

			<footer className="mx-auto max-w-[1360px] px-4 pb-10 sm:px-8">
				<div className="border-t border-line pt-5 text-xs leading-relaxed text-muted">
					<p>
						Built for the Qloo Agentic Hackathon. Release dates: Wikipedia,{" "}
						<a className="underline" href="https://en.wikipedia.org/wiki/List_of_American_films_of_2026" target="_blank" rel="noreferrer">
							"List of American films"
						</a>{" "}
						(CC BY-SA 4.0) and each game's article. IDs: Wikidata (CC0). Attention: Wikimedia pageviews. Taste data by Qloo. Clear Run is not affiliated with any studio or
						publisher, and it doesn't forecast box office.
					</p>
					{slate.data && <p className="mt-1">Calendar built {new Date(slate.data.createdAt).toLocaleString("en-US")}.</p>}
					{health.data && (
						<p className="mt-1">
							Budgets: Qloo {health.data.budgets.qloo.today.toLocaleString("en-US")} / {health.data.budgets.qloo.dailyCap.toLocaleString("en-US")} requests today,{" "}
							{health.data.budgets.qloo.calls.toLocaleString("en-US")} / {health.data.budgets.qloo.cap.toLocaleString("en-US")} this month · AI agent $
							{health.data.budgets.llm.todayUsd.toFixed(3)} today (cap ${health.data.budgets.llm.dailyCapUsd.toFixed(2)}).
						</p>
					)}
				</div>
			</footer>
		</div>
	);
}

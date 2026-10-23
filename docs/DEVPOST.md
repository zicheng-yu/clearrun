# Devpost submission: paste-ready fields

Copy each block into the matching field of the Devpost form. Everything is in English, as the rules require. Numbers are from the live site on the dates given.

## Project name
Clear Run

## Tagline (elevator pitch)
Find the week your audience is free: an agent that scores every rival on the live US release calendar against your audience with Qloo's taste graph, and re-plans when rivals move.

## Inspiration
Release dates are a fight over attention. Einav's study of the US film industry (*Economic Inquiry*, 2010) found that releases bunch up on the big holiday weekends more than is good for them, and that moving some holiday releases by a week or two would raise revenue. The tools that plan this today are paid and closed: Gower Street calls its FORECAST STUDIO "the only commercially available release date optimisation tool".

But a crowded week is only crowded for an audience. Barbie and Oppenheimer opened on the same day in July 2023, took $162.0M and $82.4M in their opening weekend, and helped give the industry its fourth-biggest weekend ever: two big films can share a date when their audiences are different. The 2026 calendar asks the harder question. Dune: Part Three opens on Dec 18 against Avengers: Doomsday ("Dunesday"), and GTA VI launches on Nov 19, the day before The Hunger Games: Sunrise on the Reaping. When we asked Qloo which film on the upcoming calendar GTA V's fans are most drawn to, it named Sunrise on the Reaping.

A general-purpose model can't tell you whether your audience is free on a given week. It doesn't know the current calendar (asked for the dates of the 20 most-watched upcoming titles, it got 20% right), and it can't measure whose fans overlap. Qloo's taste graph can.

## What it does
Describe your audience with 2–5 released films whose fans you want (your comps), and optionally the title you're planning and its date. Or ask the release agent in plain English. Clear Run then:

- builds the live US release calendar from Wikipedia every day (on Oct 23, 2026: 100 films and 2 games over the next six months);
- asks Qloo how strongly your comps' fans are drawn to every rival on it, games included;
- turns that into a week-by-week **pressure calendar**: how much of your audience's attention is already spoken for if you open that week, across your first four weeks;
- recommends **clear weeks**, flags **danger weeks** and **counter-programming** openings, and gives a **hold or move** verdict for a dated title;
- explains every rival: its overlap with your audience, its attention (Wikipedia views), and the taste tags it shares with your comps. It also shows your audience's age and gender skew;
- runs what-ifs (move or remove a rival, move your own title), recomputed instantly in the browser with no new calls.

Then it keeps going:
- **Watch and re-plan:** after every daily refresh, a watched plan is re-planned against the new calendar. Date moves, new entrants and verdict flips are logged, each with a note from the agent. **Simulate** shows what the daily check would do if a rival moved.
- **The model alone:** beside each agent answer, the same model answers the same question with no tools, and its dates are checked against the live calendar.
- **Backtests:** three famous same-day openings, re-planned as Clear Run would have seen them eight weeks earlier.
- **Share links:** every plan, agent answer, watch and the backtests has a link that unfurls into a card drawn from the live data.

Four featured scenarios start from real decisions on the calendar of Oct 23, 2026:
- **Dunesday:** for fans of Dune and Dune: Part Two, Dec 18 rates pressure 100 of 100, mostly from Avengers: Doomsday. Clear Run suggests Mar 12, 2027 (pressure 29).
- **GTA VI week:** for fans of the earlier Hunger Games films, Nov 20 rates 71, and GTA VI (scored through GTA V) is the biggest single source. Clear Run suggests Feb 12, 2027 (27).
- **Family slot** and **Indie horror:** undated original films; Clear Run finds the clearest week for each audience and explains it.

## How we built it
- **Agent:**
  - Claude Haiku 5.5 through OpenRouter runs a tool-calling loop with four tools:
    - `find_titles`: the live calendar and Qloo search;
    - `plan_release`: scoring, the pressure calendar, the verdict, and the tags the main rival shares with your audience;
    - `explain_rival`;
    - `what_if`.
  - The model sees only what the tools return. Every date in its answer is checked against the run's tool results, and the page shows the check.
  - A run takes 3–4 model calls and costs about $0.001–0.0015. A spending ledger caps model use at $0.40 a day and $5 in total. When the model is unavailable or the budget is spent, a scripted planner answers with the same tools.
- **Qloo:**
  - `/entities` maps the calendar: Wikipedia pages → Wikidata IDs → Qloo entities (`external.wikidata.ids`, with an IMDb fallback through `external.imdb.ids`). `entity_ids` names the comps on share links, so a card never shows text a visitor typed.
  - `/search` finds released films to use as comps.
  - `/v2/insights` scores every rival for your audience: your comps are the signal, the rivals go in `filter.results.entities` (up to 30 a call), and `bias.content_based=1` lets Qloo score films that aren't out yet. Games use `filter.type=urn:entity:videogame` and are scored through a released predecessor (GTA V for GTA VI), placed among eight anchor games.
  - `/v2/insights` with `filter.type=urn:demographics` gives the age and gender skew of your comps' fans.
  - `/v2/analysis/compare` gives the taste tags your comps share with a rival, and the tags only one side has.
  - Every request is a GET to the hackathon host. Scores are cached in D1 for 7 days, so a repeated plan makes no new Qloo calls.
- **Data:**
  - Wikipedia's "List of American films" tables (CC BY-SA), parsed every day, plus game tentpoles checked against each game's own article.
  - Wikidata (CC0) for IDs and Wikimedia pageviews for attention.
  - TMDB was ruled out: its API terms forbid use in AI applications.
- **Platform:**
  - One Cloudflare Worker on the Free plan serves the React app and a Hono API. D1 holds everything.
  - A Cron Trigger every 10 minutes runs resumable jobs in small steps: the daily calendar refresh, the watches and the backtests.
  - The pressure calendar is plain TypeScript shared by the Worker and the browser, so what-ifs need no new calls.
  - Share cards are SVGs drawn in the Worker, rasterized with resvg (WebAssembly), and stored by the hash of their content.
- **Quality:**
  - 71 Vitest tests, including the Worker's routes against an in-memory D1 and a synthetic Qloo transport.
  - `npm run dev:mock` runs the whole app with no keys: a frozen calendar, synthetic Qloo scores and the scripted agent.
  - An eval script measures what the model knows about the calendar without tools.

## Why it needs Qloo (add to the end of "How we built it", or keep as a section)
Take Qloo away and every audience gets the same calendar. We built the comparison instead of asserting it:

- **The same week, opposite answers.** On the calendar of Oct 23, 2026, the week of Mar 12, 2027 rates pressure 29 for Dune fans, their clearest week. For fans of Hereditary and Talk to Me it rates 100, their most crowded week, mostly because The Exorcist: Martyrs opens that day. Release size alone can't tell those apart; Qloo's taste overlap can.
- **It scores films that don't exist yet.** Everything on a release calendar is unreleased. Qloo's content-based scoring rates those films from their metadata, so Clear Run can plan months ahead.
- **Films and games in one graph.** GTA VI is scored for film audiences through GTA V, which is how Clear Run sees that fans of the Hunger Games films are exposed to a game launch.
- **The agent's tools are Qloo queries.** `plan_release` and `explain_rival` run the Qloo calls. The model only picks the tools and writes the answer, and the overlap tags it cites come from Qloo's compare analysis.
- **The same question without tools.** Next to every answer, the same model answers with no tools. On the four example questions (Oct 22, 2026), it never mentioned 17 of the 20 biggest rivals for those audiences. Its own picks ranked #17 of 19, #14 of 19, #7 of 13 and #11 of 19 weeks by clear score on the live calendar. For Dune: Part Three it suggested Dec 11 (pressure 91); the agent suggested Mar 12 (pressure 29).

## Challenges we ran into
- **No license-clean release-date API.** TMDB's terms forbid AI applications, so the calendar is parsed from Wikipedia every day. Older lists use different table layouts, and one Wikidata item can map to two Qloo entities (Wicked), which are told apart by date.
- **Everything on the calendar is unreleased.** Behavioral data doesn't exist yet for those films, so Clear Run uses Qloo's content-based scores. That also shaped the backtests: today's graph already knows how past releases went, so a backtest on it would leak. Before release, Oppenheimer ranked #41 of 59 rivals for Barbie's audience; in today's graph it ranks #12.
- **Games have no scores before launch.** Each is scored through a released predecessor, placed among eight well-known anchor games so its score sits on the same scale as the films'.
- **The far end of the calendar is thinner.** Fewer releases are dated six months out, so far weeks look clearer than they will be. Picks stop at the last week whose four-week run fits the calendar, and the planner says so when it picks that week.
- **The Workers Free plan.**
  - Qloo insights entities run about 45 KB each, so affinities are read with a string scan instead of `JSON.parse`.
  - Long jobs run in small resumable steps from the cron.
  - A share card's first draw takes 200–430 ms of CPU, so each card is drawn once and then served from the cache.
- **Keeping the agent honest.** The model sees only tool results, and every date it states is checked against them.

## Accomplishments that we're proud of
- An answer that changes with the audience, explained rival by rival with Qloo's own taste tags.
- A watch that re-plans by itself after every daily refresh and says what changed and why.
- Backtests that are honest about leakage: before-release scores beside today's graph, with no claims about grosses.
- A measured comparison with the model alone, shown on every answer.
- All of it on the Workers Free plan with hard budgets (25,000 Qloo requests a month, $5 of model spend in total), and an offline demo that runs with no keys.

## What we learned
- Overlap and size are different questions. Mar 12, 2027 is the clearest week for Dune fans and the most crowded for indie-horror fans on the same calendar.
- Qloo's graph connects games and films: GTA V's fans lean toward The Hunger Games: Sunrise on the Reaping, which opens the day after GTA VI.
- Models don't know the release calendar. Asked with no tools for the dates of the 20 most-watched titles on the slate (3 trials, Oct 22, 2026), the agent's model got 20% right, 8% wrong, and gave no date for 72%. It also gave stale dates for films that had moved, such as Narnia: The Magician's Nephew.
- Wikipedia pageviews are a workable, license-clean signal of attention.

## What's next
- Attention that accounts for lead time: pageviews grow as a release nears, and the daily snapshots can show how far-out weeks fill in.
- More markets (UK, Japan) and streaming premieres.
- Screen competition: IMAX and premium-format windows.
- Alerts by email or Slack when a watched plan's verdict flips.

## Built with (tags)
Qloo Insights API · Claude Haiku 5.5 via OpenRouter · Cloudflare Workers, D1, Cron Triggers · Hono · React · Vite · Tailwind CSS · resvg (WebAssembly) · Wikipedia, Wikidata and Wikimedia pageviews · Vitest

## Try it out links
- Demo: https://clearrun.zichengyu.com
- Repository: https://github.com/zicheng-yu/clearrun
- Video: none. The rules state that demo videos are not required.

## Image gallery
Upload from `docs/screenshots/` in this order. Devpost shows the first image as the thumbnail, so use the plan shot:
1. `plan.jpg`: the Dunesday verdict, "Move to Mar 12?", with the clearest and danger weeks.
2. `agent.jpg`: the release agent's trace and answer.
3. `baseline.jpg`: the same model with no tools, its dates checked against the live calendar.
4. `calendar.jpg`: the pressure calendar for Dune fans.
5. `rival.jpg`: why Avengers: Doomsday overlaps with Dune's fans, in Qloo's taste tags.
6. `watch.jpg`: Simulate on the Dunesday watch: Avengers: Doomsday taken off the calendar.
7. `backtests.jpg`: before release vs. today for three same-day openings.
8. `share.jpg`: a share link and its card.
9. `home.jpg`: the landing page.
10. `mobile.jpg`: the landing page, a verdict and the backtests on a phone.

## Testing instructions
Open https://clearrun.zichengyu.com. No login and no setup; the planner and the agent run on live Qloo data.
1. Under "Try a real release decision", pick **Dunesday**. Read the verdict, then click weeks on the pressure calendar to see who is behind each one.
2. In the week detail, click a rival (Avengers: Doomsday in the week of Dec 18) for its overlap, its attention and the Qloo taste tags it shares with Dune's fans. Try "1 week later" or "Remove it" to re-plan instantly.
3. Ask the release agent one of the example questions, or your own, such as "When should my Hereditary-style horror film open?". Follow the trace, check the date check under the answer, then press "Compare: the same model without tools".
4. Scroll to the featured watch and press **Simulate** (for example, Avengers: Doomsday taken off the calendar).
5. Open the **Backtests** tab.
6. Press **Share this plan** to see the link and its card. Paste the link into Slack, Discord or X to see the preview.
7. Plan your own title: search 2–5 released films as comps, optionally pick your title from the calendar, and press "Find my week".
8. To run it offline with no keys: `git clone https://github.com/zicheng-yu/clearrun && cd clearrun && npm ci && npm run dev:mock`.

## Submission checklist
- [x] Functional, externally hosted demo, no login: https://clearrun.zichengyu.com
- [x] Public repository with source, assets and instructions: https://github.com/zicheng-yu/clearrun
- [x] MIT license, visible in the repository's About section
- [x] Text description, in English
- [x] Qloo-integrated and agentic: four tools over Qloo and the live calendar, a tool-calling LLM loop with a scripted fallback, and watches that re-plan by themselves every day
- [x] Images for the gallery
- [ ] Submit the form while logged in to Devpost (the entrant's own account)

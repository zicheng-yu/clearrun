# Clear Run

**Find the week your audience is free.** Clear Run is an agent that picks a release week your audience isn't already spoken for, using Qloo's taste graph, and re-plans when rivals move their dates.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/) (2026). Live at **https://clearrun.zichengyu.com**.

> Status: live. Ask the release agent a question in plain English, pick a featured scenario (Dunesday, GTA VI week, a family slot, indie horror), or describe your audience with released comps. Clear Run scores every rival on the live calendar, explains the overlap with Qloo taste tags, recommends weeks, and watches the plan: after every daily refresh it re-plans and logs what changed. Next to each agent answer, the same model with no tools answers the same question, and its dates are checked against the slate.

## How it works

1. **Release calendar:**
   - Wikipedia's "List of American films of {year}" tables (CC BY-SA 4.0), parsed every day.
   - Plus curated game tentpoles (GTA VI, Fable), each date checked against the game's own article.
2. **IDs:** Wikipedia pages → Wikidata QIDs (CC0) → Qloo entities via `/entities?external.wikidata.ids` (lowercase QIDs), with an IMDb fallback (Wikidata P345 → `external.imdb.ids`).
3. **Attention size:** Wikimedia pageviews over the last 30 days. Films and games share one unit.
4. **Taste overlap:**
   - One Qloo `/v2/insights` call per batch of up to 30 rivals. Your comps are the signal, the rivals go in `filter.results.entities`, and `bias.content_based=1` lets Qloo score films that aren't out yet.
   - Affinities become percentiles within the slate.
   - Unreleased games have no scores, so each is scored through a released predecessor (GTA V for GTA VI), placed among eight well-known anchor games.
5. **Pressure calendar** (`src/engine/score`, shared by the Worker and the browser):
   - Each week is scored as your opening week across your first four weeks, summing rival overlap² × size × decay.
   - Season multipliers turn that into clear weeks, danger weeks and counter-programming openings, plus a hold/move verdict when your title is already dated.
   - What-ifs (move or remove a rival, move your title) recompute in the browser with no new Qloo calls.

6. **Explanations:**
   - Qloo `/v2/analysis/compare` gives the taste tags your comps share with a rival (a game is compared through its proxy), and the tags only one side has.
   - `urn:demographics` gives the age and gender skew of your comps' fans. Unreleased titles have no demographics, which is why the audience is described by released comps.
7. **Release agent** (`src/worker/agent.ts`): Claude Haiku 5.5 over OpenRouter, with four coarse tools:
   - `find_titles`: the live slate and Qloo search;
   - `plan_release`: scoring, the calendar, the verdict, and the main rival's shared tags;
   - `explain_rival`;
   - `what_if`.

   The model only sees what the tools return. Every date in its answer is checked against this run's tool results, and the page shows the result of that check. A typical run takes 3–4 model calls and costs about $0.001–0.0015, with the system prompt and tools read from the prompt cache.

8. **Watch and re-plan** (`src/worker/watch.ts`, `src/engine/watch`):
   - A watch stores a plan (comps, your title, the week you'd open) and its state at the last check.
   - After each daily slate refresh, the cron re-plans every watch against the new slate. It logs date moves, new entrants and exits near your week (rivals that can touch your first four weeks), plus verdict flips, each with a short note from the agent.
   - Scores are cached, so a re-plan costs no Qloo calls unless new titles were dated.
   - **Simulate** runs the same re-plan against a copy of today's calendar with one rival's date changed. Nothing real changes, and simulations aren't logged.
   - The four featured scenarios have watches, at `?watch=dunesday` and the other scenario IDs.
9. **Baseline** (`src/worker/baseline.ts`, `src/engine/baseline`):
   - The agent's question goes to the same model with today's date and the same answer format, but no tools and no live data.
   - The model lists the releases it relied on, and each date is checked against the slate: right date, right week, wrong date, no date, or not on the slate.
   - The audience's biggest rivals that it never mentions are counted.
   - Its own recommended date is rated on the live calendar for the agent's audience.

Decay, seasonality and size scaling are assumptions, and the page labels them as such. Pressure is a relative index, not a box-office forecast.

TMDB is deliberately not used: its API terms forbid use in ML/AI applications.

## API

| Route | What it does |
|---|---|
| `GET /api/slate` | The latest release slate snapshot |
| `POST /api/plan` | One step of a plan: `{comps: [Qloo IDs], you?: slate ID}`. Returns `{status: "scoring"}` until every rival is scored, then the scored rivals. Repeat until `status` is `"ready"`. |
| `GET /api/search?q=` | Released films by name, for picking comps |
| `GET /api/explain?comps=&rival=` | Taste tags your comps share with a rival (Qloo compare) |
| `GET /api/audience?comps=` | Age and gender skew of your comps' fans (Qloo demographics) |
| `POST /api/agent/step` | One step of an agent run: `{question}` starts one, `{runId, after}` continues it until `done` |
| `GET /api/agent/run?id=` | A stored run, for share links (`?run=`); no model calls |
| `POST /api/agent/baseline` | `{runId}`: the run's question answered by the same model with no tools, with its dates checked. One call per run, then stored |
| `POST /api/watch` | `{comps, you?, from, week}`: start watching a plan |
| `GET /api/watch?id=` | A watch: its current state and change log |
| `POST /api/watch/simulate` | `{id, rival, to}`: what the daily check would do if one rival moved (`to: null` takes it off the calendar) |
| `GET /api/changes` | Date moves and new entrants between snapshots |
| `GET /api/health` | Modes, slate status and budgets |

## Runs on the Workers Free plan

- **Slate refresh:**
  - A resumable job of small steps. A cron tick every 10 minutes runs one step.
  - Qloo mappings carry over between snapshots, so a daily refresh only looks up new titles.
- **Plans:**
  - The browser drives a plan step by step. Each step makes at most two Qloo calls in parallel.
  - Insights entities run about 45 KB each, so affinities are pulled from the raw body with a string scan rather than `JSON.parse`.
  - Affinities are cached per (audience, entity) in D1 for 7 days, so repeat plans cost nothing.
- **Agent:**
  - The browser drives a run step by step. Each step makes at most one model call and one scoring step.
  - Runs live in D1. The same question against the same slate replays the stored run for free for 24 hours.
- **Watches:**
  - While the slate refresh runs, each cron tick runs one refresh step. Once it's done, each tick re-plans the three least recently checked watches against the new slate.
  - Simulations are cached per (watch, slate, change).
- **Storage:** D1 holds snapshots, diffs, the Qloo caches, agent runs, watches and the spend ledgers. Nothing is kept in KV, whose free plan allows only 1,000 writes a day.
- **Hard budgets:**
  - Qloo: 25,000 requests a month (half of a shared key) and 1,500 a day, with a reserve on the key's shared remaining count. A per-IP rate limit applies to `/api/plan` and `/api/search`.
  - LLM: OpenRouter with `anthropic/claude-haiku-5.5` at low reasoning effort and automatic prompt caching.
    - Caps: $0.40 a day and $5 in total, checked before every call.
    - At most 6 model calls per run.
    - 12 runs per address per day; replays are free.

## Evaluation

- **The model alone doesn't know the calendar.** `scripts/eval-baseline.ts` asks the agent's model, with no tools, for the US dates of the 20 most-watched titles on the live slate (3 trials, Oct 22, 2026).
  - Results: 20% right, 8% wrong, and no date given for 72%.
  - It knows the four tentpoles announced long ago: Avengers: Doomsday, Dune: Part Three, The Hunger Games: Sunrise on the Reaping and GTA VI.
  - It gives stale dates for films that moved, such as Clayface and Narnia: The Magician's Nephew.
  - Asked for "the 15 biggest releases, Nov – Mar", it named 5 of the slate's 15 most-watched films.
  - Full table: [docs/eval-baseline.md](docs/eval-baseline.md).
- **The agent states only dates from its tools.** Every answer is checked, and the page shows the result.
- **Side by side on the four example questions** (production, Oct 22), the model alone with the same question and no tools:
  - It never mentions 17 of the 20 biggest rivals for those audiences (5 per audience).
  - Its own picks rank #17 of 19, #14 of 19, #7 of 13 and #11 of 19 by clear score on the live calendar.
  - For Dune: Part Three it recommends Dec 11, which rates pressure 91 for Dune fans; the agent recommends Mar 12 (pressure 29).
  - It also places Narnia on Thanksgiving; the film now opens Feb 12, 2027.

## Develop

```sh
npm install
cp .dev.vars.example .dev.vars   # add QLOO_API_KEY, OPENROUTER_API_KEY, ADMIN_TOKEN
npm run dev                      # then build a local slate: POST /api/admin/slate/step with x-admin-token, repeated until "done"
npm test && npm run typecheck
npx cf deploy --secrets-file .dev.vars
```

Never commit keys or Qloo response data.

## Data and attribution

Release dates: Wikipedia (CC BY-SA 4.0), including each game's article. IDs: Wikidata (CC0). Attention: Wikimedia pageviews. Taste data by Qloo. Clear Run is not affiliated with any studio or publisher.

## License

MIT

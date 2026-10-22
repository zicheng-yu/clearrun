# Clear Run

**Find the week your audience is free.** Clear Run is an agent that picks a release week your audience isn't already spoken for, using Qloo's taste graph, and re-plans when rivals move their dates.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/) (2026). Live at **https://clearrun.zichengyu.com**.

> Status: the planner is live. Pick a featured scenario (Dunesday, GTA VI week, a family slot, indie horror) or describe your audience with released comps, and Clear Run scores every rival on the live calendar and recommends weeks. The LLM agent, explanations and the watch-and-re-plan loop are in progress.

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

Decay, seasonality and size scaling are assumptions, and the page labels them as such. Pressure is a relative index, not a box-office forecast.

TMDB is deliberately not used: its API terms forbid use in ML/AI applications.

## API

| Route | What it does |
|---|---|
| `GET /api/slate` | The latest release slate snapshot |
| `POST /api/plan` | One step of a plan: `{comps: [Qloo IDs], you?: slate ID}`. Returns `{status: "scoring"}` until every rival is scored, then the scored rivals. Repeat until `status` is `"ready"`. |
| `GET /api/search?q=` | Released films by name, for picking comps |
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
- **Storage:** D1 holds snapshots, diffs, the Qloo caches and the spend ledgers. Nothing is kept in KV, whose free plan allows only 1,000 writes a day.
- **Hard budgets:**
  - Qloo: 25,000 requests a month (half of a shared key) and 1,500 a day, with a reserve on the key's shared remaining count. A per-IP rate limit applies to `/api/plan` and `/api/search`.
  - LLM: OpenRouter with `anthropic/claude-haiku-5.5` at low reasoning effort. Daily and all-time USD caps are checked before every call.

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

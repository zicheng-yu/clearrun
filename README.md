# Clear Run

**Find the week your audience is free.** Clear Run is an agent that picks a release week your audience isn't already spoken for, using Qloo's taste graph, and re-plans when rivals move their dates.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/) (2026). Live at **https://clearrun.zichengyu.com**.

> Status: early build. The live US release calendar is running in production. Audience-overlap scoring, the weekly pressure calendar and the release agent are in progress.

## How it works (so far)

- **Release calendar:** Wikipedia's "List of American films of {year}" tables (CC BY-SA 4.0), parsed every day.
- **IDs:** Wikipedia pages → Wikidata QIDs (CC0) → Qloo entities via `/entities?external.wikidata.ids` (lowercase QIDs), with an IMDb fallback (Wikidata P345 → `external.imdb.ids`).
- **Attention size:** Wikimedia pageviews over the last 30 days. Films and games share one unit.
- **Taste overlap (next):** Qloo `/v2/insights` with `filter.results.entities`, scoring how strongly your audience (released comparison titles) cares about every rival. Unreleased titles are scored with `bias.content_based=1`.

TMDB is deliberately not used: its API terms forbid use in ML/AI applications.

## Runs on the Workers Free plan

- The slate refresh is a resumable job of small steps. A cron tick every 10 minutes runs one step, so every invocation stays under 10 ms of CPU and 50 external subrequests.
- Storage is D1: snapshots, diffs, a private Qloo response cache and spend ledgers. Nothing is kept in KV, whose free plan allows only 1,000 writes a day.
- Hard budgets:
  - Qloo: 25,000 requests a month for this app (half of a shared key), with a reserve on the key's shared remaining count.
  - LLM: OpenRouter with `anthropic/claude-haiku-5.5` at low reasoning effort. Daily and all-time USD caps are checked before every call.

## Develop

```sh
npm install
cp .dev.vars.example .dev.vars   # add QLOO_API_KEY, OPENROUTER_API_KEY, ADMIN_TOKEN
npm run dev
npm test && npm run typecheck
npx cf deploy --secrets-file .dev.vars
```

Never commit keys or Qloo response data.

## Data and attribution

Release dates: Wikipedia (CC BY-SA 4.0). IDs: Wikidata (CC0). Attention: Wikimedia pageviews. Taste data by Qloo. Clear Run is not affiliated with any studio.

## License

MIT

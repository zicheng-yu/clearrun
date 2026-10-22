# Baseline evaluation: the model alone vs. the live slate

Run 2026-10-22 against the live slate of Oct 22, 2026 (100 titles, 2026-10-22 to 2027-04-20).
Model: `anthropic/claude-haiku-5.5` over OpenRouter, low reasoning effort, no tools: the same model and settings as the Clear Run agent, with today's date in the prompt. 3 trials; total cost $0.0072.

Release dates come from Wikipedia's "List of American films" tables (CC BY-SA 4.0) and each game's article. The agent never states a date it didn't get from its tools, and every answer is checked (the date check under each answer).

## 1. Dates of the 20 most-watched titles

- Right date: 12/60 (20%)
- Right week, wrong day: 0/60 (0%)
- Wrong date: 5/60 (8%)
- No date given: 43/60 (72%)

| Title | Slate date | Trial 1 | Trial 2 | Trial 3 |
|---|---|---|---|---|
| Clayface | 2026-10-23 | 2026-09-11 ✗ | 2026-09-11 ✗ | 2026-09-11 ✗ |
| Avengers: Doomsday | 2026-12-18 | 2026-12-18 ✓ | 2026-12-18 ✓ | 2026-12-18 ✓ |
| Grand Theft Auto VI (game) | 2026-11-19 | 2026-11-19 ✓ | 2026-11-19 ✓ | 2026-11-19 ✓ |
| Wildwood | 2026-10-23 | — | — | — |
| Wicker | 2026-10-23 | — | — | — |
| Narnia: The Magician's Nephew | 2027-02-12 | 2026-11-26 ✗ | — | 2026-11-26 ✗ |
| The Exorcist: Martyrs | 2027-03-12 | — | — | — |
| The Further Mis-Adventures of Cliff Booth | 2026-11-25 | — | — | — |
| Ray Gunn | 2026-12-04 | — | — | — |
| The Hunger Games: Sunrise on the Reaping | 2026-11-20 | 2026-11-20 ✓ | 2026-11-20 ✓ | 2026-11-20 ✓ |
| Dune: Part Three | 2026-12-18 | 2026-12-18 ✓ | 2026-12-18 ✓ | 2026-12-18 ✓ |
| Ebenezer | 2026-11-13 | — | — | — |
| Artificial | 2026-12-25 | — | — | — |
| Werwulf | 2026-12-25 | — | — | — |
| Day Drinker | 2027-03-26 | — | — | — |
| Klara and the Sun | 2026-10-23 | — | — | — |
| Hexed | 2026-11-25 | — | — | — |
| Wild Horse Nine | 2026-11-06 | — | — | — |
| River | 2027-01-15 | — | — | — |
| I Play Rocky | 2026-11-06 | — | — | — |

✓ right date · ≈ right release week · ✗ wrong date · — no date given

## 2. "The 15 biggest US releases, Nov 1 – Mar 31, 2027"

1 of 3 trials returned no readable list; the averages cover the other 2.

Average per trial: 8.5 titles named, 7.5 of them on the slate. Of those, 5.5 had the right date, 0.0 the right week and 2.0 a wrong date. 1.0 weren't on the current US slate under that name.
It named 5.0 of the slate's 15 most-watched films in that span on average. Those films: Avengers: Doomsday (Dec 18), Narnia: The Magician's Nephew (Feb 12), The Exorcist: Martyrs (Mar 12), The Further Mis-Adventures of Cliff Booth (Nov 25), Ray Gunn (Dec 4), The Hunger Games: Sunrise on the Reaping (Nov 20), Dune: Part Three (Dec 18), Ebenezer (Nov 13), Artificial (Dec 25), Werwulf (Dec 25), Day Drinker (Mar 26), Hexed (Nov 25), Wild Horse Nine (Nov 6), River (Jan 15), I Play Rocky (Nov 6).

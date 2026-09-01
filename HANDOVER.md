# Handover

State of the football intelligence app as of commit `435ceab` on
`claude/football-intelligence-handover-xaxped`, three commits ahead of `main`
(`a88f806`).

Read `## Next, in order` if you only read one section.

`docs/football-intelligence-roadmap.pdf` is the same material laid out for
reading, with screenshots of the branch running and a diagram of the
ingestion path.

## Codex continuation — 1 September 2026

- Production and GitHub `main` are aligned through commit `2b10cc0` before the
  feature-pipeline work described below. The live Site is version 26 and remains
  owner-only.
- Baseline v2 is now a real Dixon–Coles model with exponential time decay. Model
  Lab compares v1 and v2 on the same walk-forward fixtures using accuracy, Brier
  score and log loss. Pre-kickoff availability snapshots and current market
  prices are stored alongside forecast snapshots when available.
- Historical fixture statistics are complete for Premier League (1,900/1,900),
  Ligue 1 (1,688/1,688), and all but the provider-empty fixtures in Championship
  (2,783/2,785), League One (2,784/2,785), and League Two (2,785/2,785): 11,937
  of 11,940 across that tranche. Overall coverage is 11,937 of 23,884 completed
  matches. The 01:30 automation continues the remaining seven competitions when
  provider quota is at least 7,200.
- A leakage-safe feature pipeline now lives in `lib/features.ts`, backed by the
  joined D1 reader in `db/features.ts` and the audit endpoint at
  `app/api/football/features/route.ts`. It builds five-match rolling inputs only
  from fixtures earlier than the target kickoff. Goals, shots, shots on target,
  possession, corners, card points, pass accuracy, xG and rest days are exposed;
  the current match result is kept in separate target fields.
- Model Lab now shows the number of eligible feature rows and readiness/coverage
  per competition. The endpoint intentionally returns the audit, not the full
  training matrix; model fitting can call `buildPreMatchFeatures` server-side.
- The first feature-based model is implemented in `lib/model-features.ts`: a
  regularised multinomial logistic regression using training-only scaling and
  mean imputation for optional fields. `app/api/football/models/features/route.ts`
  compares it with Dixon–Coles on identical chronological holdouts and exposes
  aggregate feature influence. It remains explicitly experimental.
- The same module now includes a second candidate: 48 pre-sorted vector-valued
  gradient-boosted decision stumps, with training-period median imputation and a fixed
  chronological holdout. Model Lab shows all three Brier scores on identical
  fixtures and uses tree split gain for the feature-influence view.
- The local integration suite is now **31/31**. It validates real importer paths,
  snapshot scoring, identical-fixture market comparison, feature generation,
  the no-current-fixture-statistics cutoff, feature-model training, and its
  identical-fixture Dixon–Coles comparison.
- Immediate next work: let the scheduled statistics backfill finish, inspect the
  full feature-model comparison, and promote it only if Brier score, log loss and
  calibration beat Dixon–Coles. Otherwise tune or replace it with gradient-boosted
  trees, retaining the same chronological holdouts.

## Codex continuation — 31 August 2026

- The Claude branch was fast-forwarded into `main`, verified, and deployed.
- The local importer authentication header was corrected to
  `OAI-Sites-Authorization`.
- Historical ingestion is complete: **60/60 competition-seasons**, with the
  49 missing seasons adding 17,985 fixtures and no failures.
- The first real pre-kickoff record stored 32 upcoming forecasts.
- API-Football returned no bookmaker data for sampled Premier League and
  Championship fixtures in every season from 2021 through 2025, so the planned
  4,686-call historical odds sweep was stopped before wasting the allowance.
- Current Premier League odds were available and imported: 30 fixtures and 344
  bookmaker rows. The snapshot schema now freezes the de-vigged 1X2 market
  probabilities beside each new forecast, and Models reports model-versus-market
  Brier and log-loss scores on the same settled fixtures.
- The expanded offline verification now has 23 checks, including market capture
  before kickoff and model-versus-market scoring after settlement.
- Current-season data for all 12 competitions was refreshed on 31 August 2026:
  4,538 fixtures were imported or updated with no failures.
- Near-term odds collection is now windowed to the next 14 days to protect the
  provider allowance. The first run stored 1,341 odds rows for 126 fixtures
  after 235 provider calls; 109 fixtures had no currently published prices.
- `scripts/refresh-current.mjs` is the unattended entry point. It refreshes the
  active season, imports near-term odds under a 600-call ceiling, and records
  immutable pre-kickoff forecasts. Forecasts are recorded in 12 bounded
  competition calls so the hosted worker does not time out on the full set;
  each call retries transient failures three times.
- The current-data automation runs at 07:00, 18:00 and 23:00 Europe/London.
  Open dashboard tabs re-read stored standings every five minutes and whenever
  the tab regains focus; the interface shows the database's actual sync time.
- Prediction, team and match dialogs override the starter component's narrow
  responsive cap and scroll within the viewport instead of clipping columns.

---

## Where it stands

| Piece | State | Detail |
| --- | --- | --- |
| Historical seasons | Unchanged | 11 of 60 competition-seasons stored in production. Two failed runs (League One 2022, League Two 2021) are recorded as retryable. |
| Season upload | Built, unrun | Route and local importer. Simulated to 60/60 against a mock provider; a repeat run skips completed seasons before making any provider call. |
| Forecast snapshots | Built, unrun | Table, endpoints and Models panel. Zero forecasts recorded — the record only fills going forward. |
| Statistics, line-ups, odds | Built, unrun | Three tables, a validated batch upload, a coverage report and a budgeted importer. Zero rows stored. |
| Deployment | Outstanding | Sites still serves version 18 at `a88f806`. The importers post to routes that do not exist there yet. |

Nothing on this branch has run against real data. The environment it was built
in blocks `v3.football.api-sports.io`, `football-data.co.uk` and
`understat.com`, and cannot reach the production D1 database. Every number in
the verification output comes from `scripts/dev/mock-provider.mjs`.

---

## Why the importers run on your machine

This constraint shapes the whole ingestion design, so do not undo it without
re-measuring.

The API-Football subscription is healthy: Pro, active, roughly 66 of 7,500
daily calls used. But the hosted worker leaves through a **shared egress
address whose per-minute allowance is spent after about one historical
request**, while the same key called from a local machine showed 298 of 300
minute-requests still available.

So the provider call happens locally and only the data is uploaded:

```
your machine ──requests a season──▶ API-Football
your machine ◀──fixtures───────────  (its own 300/min applies)
your machine ──fixture data only──▶ /api/football/history/upload ──▶ D1
                                     (no credential crosses)

Sites worker ──▶ API-Football   ✗ throttled after ~1 request
```

`API_FOOTBALL_KEY` stays in `.env.local`. The upload routes hold no credential
of their own and reach no third party; they are guarded by the site's
owner-only access, exactly as `POST /api/football/history` already was.

---

## What the three commits added

**`5427672` — local-machine ingestion for historical seasons**

- `app/api/football/history/upload` — takes a season's fixtures collected
  elsewhere. Validates the competition, season, fixture and team ids, kickoff
  times, team names and scores; caps a season at 700 fixtures; skips seasons
  already stored unless `replace: true`; records the sync run.
- `scripts/import-history.mjs` — reads the import dashboard, skips completed
  seasons, fetches the rest from the provider locally, uploads fixture data.
- `db/history.ts` — the batched D1 writes and the stored/complete check, now
  shared by both ingestion paths.
- `lib/competitions.ts` — the supported-competition list, previously repeated
  in four routes.
- The fixture upsert now also updates `competition_id` and `season`, so a row
  corrected by a later import moves rather than keeping its first labels.

**`651470c` — pre-kickoff forecast snapshots**

- `prediction_snapshots` table (`drizzle/0001_steep_gateway.sql`). A stored
  forecast is never rewritten; a changed forecast is a new row, and a re-run
  producing the same probabilities stores nothing.
- `POST /api/football/predictions/snapshot` writes a forecast for every
  upcoming fixture in the window, training only on matches completed by that
  moment. `GET` scores the last forecast recorded before each kickoff —
  **rows created after a kickoff are excluded at read time**, so the record
  cannot be improved with hindsight.
- `lib/model.ts` — the model itself, which `models/route.ts` had been
  importing out of a route file. `prepareModel` / `predict` split the fit from
  the per-fixture prediction so a batch of forecasts walks the training window
  once instead of once per fixture.
- `db/fixtures.ts` — the fixture query the routes were each spelling out.
- Models view gained the forecast record: coverage, scores, and a reliability
  diagram whose points are sized by the number of forecasts in each band.
  `GET /prediction` also returns the stored forecast beside the live one.

**`435ceab` — match statistics, line-ups and odds**

- `fixture_statistics`, `fixture_lineups`, `fixture_odds`
  (`drizzle/0002_sleepy_shiver_man.sql`), keyed on fixtures that already
  exist — detail for an unknown fixture is refused rather than orphaned.
- `POST /api/football/history/upload/match` — up to 50 fixtures of detail per
  request, validating every count, price and squad entry.
- `GET /api/football/history/coverage` — what is stored per competition-season;
  `?missing=statistics|lineups|odds&league=&season=&limit=` lists the fixtures
  still outstanding, which is what makes the importer resumable.
- `scripts/import-match-detail.mjs` — works through that list under a call
  budget, remembering locally which fixtures the provider had no data for.
- The match view reads stored detail before calling the provider and reports
  which it used; it shows line-ups and the market's 1X2 view with the
  bookmakers' margin divided out.
- The Data Explorer readiness panel counts rows in the database per class
  instead of asserting a state.

---

## Data model

`db/football.ts` creates the schema at runtime (`ensureFootballSchema`) and is
the authority. `db/schema.ts` and `drizzle/` mirror it for tooling; keep all
three in step when adding a table.

```
competitions (id, season)          fixtures (id)
teams (id)                         sync_runs (id)
prediction_snapshots (id)          fixture_statistics (fixture_id, team_id)
fixture_lineups (fixture_id, team_id)
fixture_odds (fixture_id, bookmaker_id)
```

Line-ups store each team's starting eleven and bench as JSON on one row rather
than in a players table. That is fine while nothing queries across players; the
day a model wants "matches without their first-choice keeper", it needs
normalising first.

---

## Running the importers

Both read `API_FOOTBALL_KEY` from `.env.local`, take the Sites bypass token as
`--token`, send it in `OAI-Sites-Authorization`, and never send the provider key
anywhere but API-Football.

```bash
# Finish the historical seasons. Two to five minutes; re-running is a no-op.
node scripts/import-history.mjs --site https://<host> --token <site-token>

# Per-match detail, budgeted. One provider call per fixture per class.
node scripts/import-match-detail.mjs --site https://<host> --token <site-token> \
  --include odds --leagues 39,40 --budget 5000
```

`--help` on either prints full usage. `--dry-run` reports the outstanding work
without calling anything.

**Budget maths.** Detail costs one call per fixture per class. All three
classes across all twelve competitions for five seasons is roughly 21,500
fixtures, about 64,000 calls — nine days at the 7,500/day allowance. Target it
rather than sweeping it.

---

## Verifying without a provider

```bash
pnpm build
npx wrangler dev --config dist/server/wrangler.json --port 8787 --local &
node scripts/dev/verify.mjs
```

24 checks covering season ingestion, upload validation, snapshot recording and
scoring, detail import, coverage reporting and the match view. It runs the real
importer scripts against `scripts/dev/mock-provider.mjs`, so a pass means the
path a real backfill takes is working. No allowance is spent.

**The local database lives at `dist/server/.wrangler/state`**, beside the built
worker config rather than at the project root — so `pnpm build` clears it, and
that is the path to delete for a genuinely empty run. Deleting `.wrangler/state`
at the project root does nothing.

---

## Next, in order

The first three are one evening's work and unlock everything after them.

1. **Deploy this branch.** Nothing else can start: the importers post to routes
   that do not exist on version 18. `pnpm build` passes; the route list gains
   `/history/upload`, `/history/upload/match`, `/history/coverage` and
   `/predictions/snapshot`. Confirm the site stays owner-only.
2. **Run the season backfill to 60/60.** Then check Imports reads 60/60 and
   Models evaluates all twelve competitions rather than the three it sees now.
3. **Start recording forecasts, and keep doing it.** This is the step with a
   deadline: a pre-kickoff record only accumulates forward, so every week it
   does not run is evidence that cannot be recovered.
   `POST /api/football/predictions/snapshot {"withinDays":7}`, or press
   *Record forecasts* in Models, once before each round.
4. **Backfill odds for the Premier League and Championship first.** Roughly
   4,700 fixtures, inside one day's allowance. Odds are the benchmark — a
   football model is judged against the closing price, not a coin toss.
5. **Put the market next to the model.** Carry the de-vigged market
   probabilities into the prediction view and store them on each forecast
   snapshot, then report the model's Brier score against the market's on the
   same fixtures. This single column turns "is this any good?" from a
   judgement into a number, and it is the honest frame for everything after it.
6. **Automate the two things that must not be forgotten.** A scheduled task
   that refreshes results for finished fixtures and then snapshots upcoming
   ones. Both are single HTTP calls now.
7. **Backfill statistics, then fit on shots rather than goals.** Expected goals
   and shot counts are a far lower-variance read on the same team than goals
   are — the largest single accuracy gain available.
8. **Dixon-Coles, and a real comparison.** Add the low-score correction and
   exponential time decay the current Poisson baseline lacks, then score it
   against the baseline *and the market* on Brier and log loss, not accuracy.
   Only add gradient boosting if it beats a well-specified Dixon-Coles there.
9. **Calibration by competition and season**, with confidence bands on thin
   samples.
10. **The conversational layer, last.** It should read the stored evidence and
    the recorded forecasts. Built earlier, it would give a fluent voice to
    numbers nobody has checked.

---

## Open decisions

- **Keep `history/upload`?** The original plan was to delete it after the
  migration. The egress throttle is not going away and the same path serves
  every future re-import, so keeping it is the recommendation — it is validated
  and guarded like the existing POST rather than being a hole. Deleting it is
  removing one route directory.
- **How much match detail?** See the budget maths above. Odds and statistics
  for the Premier League and Championship first; skip line-ups entirely until
  something consumes them.
- **Line-ups as JSON.** Fine until a model reads them; see Data model.

---

## Not built, and why

- **Injuries.** The provider publishes them as a current state, not a
  historical record. Storing them usefully means capturing a snapshot before
  each kickoff — that belongs with the automation in step 6, not a backfill.
- **Match events.** A fourth call per fixture, and no planned model reads them.
  Cheap to add to the same importer when one does.
- **Model comparison.** Deliberately left until odds are stored. Comparing two
  models to each other, with no benchmark either has to beat, is how you end up
  confident in the wrong one.

---

## Gotchas

- `pnpm lint` reports pre-existing errors in generated `components/ui` files
  plus `next/image` and React-compiler suggestions. Lint is not a clean
  project-wide gate; the code added here is clean under
  `npx oxlint db lib app scripts`.
- `pnpm format` (oxfmt) reports issues on the existing codebase too, so the
  project does not enforce it. Match surrounding style rather than reformatting.
- Deployment needs the Sites tooling, which only exists on the owner's machine:
  build, commit, obtain a source write credential, push with it as a
  per-command header, package with the sites-hosting `package-site.sh`, save a
  Site version against the pushed SHA, verify owner-only, deploy. Do not
  persist the source credential or the SIWC bypass token.

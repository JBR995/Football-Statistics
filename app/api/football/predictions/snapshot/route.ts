import { FIXTURE_QUERY, readCompletedHistory } from '@/db/fixtures';
import { ensureFootballSchema } from '@/db/football';
import { readStoredOdds } from '@/db/match-detail-read';
import { writeSnapshot } from '@/db/snapshots';
import { getCompetition } from '@/lib/competitions';
import { MODEL_NAME, MODEL_VERSION, outcomeIndex, predict, prepareModel, type FixtureRow } from '@/lib/model';
import { MODEL_V2_NAME, MODEL_V2_VERSION, predictDixonColes, prepareDixonColes } from '@/lib/model-v2';

// Forecasts are only evidence if they were recorded before the result was
// known. POST writes a snapshot for every upcoming fixture in the window; GET
// scores the snapshots whose fixtures have since finished. Nothing here reads
// a result to produce a forecast, and a stored forecast is never rewritten —
// a changed forecast is a new row.

const UPCOMING_STATUSES = `f.status IN ('NS', 'TBD')`;
const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 60;
const MAX_FIXTURES_PER_RUN = 500;
const CALIBRATION_BINS = 10;
const CALIBRATION_MINIMUM_FIXTURES = 50;

type ScoredSnapshot = {
  id: number;
  fixture_id: number;
  competition_id: number;
  competition_name: string | null;
  season: number;
  model_name: string;
  model_version: string;
  created_at: string;
  kickoff: string;
  home_probability: number;
  draw_probability: number;
  away_probability: number;
  market_home_probability: number | null;
  market_draw_probability: number | null;
  market_away_probability: number | null;
  market_bookmakers: number | null;
  home_goals: number;
  away_goals: number;
};

export async function POST(request: Request) {
  let body: { competitions?: unknown; withinDays?: unknown } = {};
  try {
    body = await request.json() as typeof body;
  } catch { /* An empty body means "every competition, default window". */ }

  const requested = Array.isArray(body.competitions) ? body.competitions.map(Number) : null;
  if (requested?.some((id) => !getCompetition(id))) {
    return Response.json({ connected: false, error: 'That competition is not enabled.' }, { status: 400 });
  }
  const withinDays = clampWindow(body.withinDays);

  try {
    const db = await ensureFootballSchema();
    const now = new Date();
    const until = new Date(now.getTime() + withinDays * 86_400_000);
    const filter = requested?.length ? ` AND f.competition_id IN (${requested.map(() => '?').join(', ')})` : '';
    const upcoming = (await db
      .prepare(`${FIXTURE_QUERY} WHERE ${UPCOMING_STATUSES} AND f.kickoff > ? AND f.kickoff <= ?${filter} ORDER BY f.kickoff ASC, f.id ASC LIMIT ${MAX_FIXTURES_PER_RUN + 1}`)
      .bind(now.toISOString(), until.toISOString(), ...(requested ?? []))
      .all<FixtureRow>()).results;

    const truncated = upcoming.length > MAX_FIXTURES_PER_RUN;
    const fixtures = truncated ? upcoming.slice(0, MAX_FIXTURES_PER_RUN) : upcoming;

    // One training window per competition-season: every fixture in it is
    // forecast from the same evidence, which is everything completed by now.
    const groups = new Map<string, FixtureRow[]>();
    for (const fixture of fixtures) {
      const key = `${fixture.competition_id}:${fixture.season}`;
      const group = groups.get(key) ?? [];
      group.push(fixture);
      groups.set(key, group);
    }

    let stored = 0;
    let withMarket = 0;
    let unchanged = 0;
    const skipped: Array<{ competitionId: number; season: number; reason: string }> = [];
    for (const group of groups.values()) {
      const [first] = group;
      const history = await readCompletedHistory(db, {
        competitionId: first.competition_id,
        fromSeason: first.season - 5,
        toSeason: first.season,
        beforeKickoff: now.toISOString(),
      });
      if (!history.length) {
        skipped.push({ competitionId: first.competition_id, season: first.season, reason: 'No completed matches are stored for this competition yet.' });
        continue;
      }
      const v1Context = prepareModel(history);
      const v2Context = prepareDixonColes(history);
      for (const fixture of group) {
        const storedOdds = await readStoredOdds(db, fixture.id);
        const market = storedOdds.market ? {
          home: storedOdds.market.probabilities.home / 100,
          draw: storedOdds.market.probabilities.draw / 100,
          away: storedOdds.market.probabilities.away / 100,
          bookmakers: storedOdds.market.bookmakers,
        } : null;
        const forecasts = [
          { model: { name: MODEL_NAME, version: MODEL_VERSION }, output: predict(fixture, v1Context) },
          { model: { name: MODEL_V2_NAME, version: MODEL_V2_VERSION }, output: predictDixonColes(fixture, v2Context) },
        ];
        for (const forecast of forecasts) {
          const written = await writeSnapshot(db, fixture, forecast.output, history.length, market, forecast.model);
          if (written) {
            stored++;
            if (market) withMarket++;
          } else unchanged++;
        }
      }
    }

    return Response.json({
      connected: true,
      models: [
        { name: MODEL_NAME, version: MODEL_VERSION },
        { name: MODEL_V2_NAME, version: MODEL_V2_VERSION },
      ],
      windowDays: withinDays,
      scanned: fixtures.length,
      stored,
      withMarket,
      unchanged,
      skipped,
      truncated,
      recordedAt: now.toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({
      connected: false,
      error: error instanceof Error ? error.message : 'Prediction snapshots could not be recorded.',
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function GET(request: Request) {
  const withinDays = clampWindow(new URL(request.url).searchParams.get('withinDays'));

  try {
    const db = await ensureFootballSchema();
    const now = new Date();
    const until = new Date(now.getTime() + withinDays * 86_400_000);

    const coverage = (await db.prepare(`
      SELECT f.competition_id, MAX(c.name) AS competition_name,
             COUNT(*) AS upcoming,
             SUM(CASE WHEN s.fixture_id IS NULL THEN 0 ELSE 1 END) AS covered
      FROM fixtures f
      JOIN competitions c ON c.id = f.competition_id AND c.season = f.season
      LEFT JOIN (SELECT DISTINCT fixture_id FROM prediction_snapshots) s ON s.fixture_id = f.id
      WHERE ${UPCOMING_STATUSES} AND f.kickoff > ? AND f.kickoff <= ?
      GROUP BY f.competition_id
      ORDER BY MAX(c.name)
    `).bind(now.toISOString(), until.toISOString())
      .all<{ competition_id: number; competition_name: string; upcoming: number; covered: number }>()).results;

    // A snapshot counts only if it predates both the kickoff it was filed
    // against and the kickoff the fixture was actually played at.
    const rows = (await db.prepare(`
      SELECT s.id, s.fixture_id, s.competition_id, c.name AS competition_name, s.season, s.model_name, s.model_version, s.created_at,
             f.kickoff, s.home_probability, s.draw_probability, s.away_probability,
             s.market_home_probability, s.market_draw_probability, s.market_away_probability, s.market_bookmakers,
             f.home_goals, f.away_goals
      FROM prediction_snapshots s
      JOIN fixtures f ON f.id = s.fixture_id
      LEFT JOIN competitions c ON c.id = s.competition_id AND c.season = s.season
      WHERE f.status IN ('FT', 'AET', 'PEN') AND f.home_goals IS NOT NULL AND f.away_goals IS NOT NULL
        AND s.created_at < s.kickoff AND s.created_at < f.kickoff
      ORDER BY s.fixture_id ASC, s.model_version ASC, s.id DESC
    `).all<ScoredSnapshot>()).results;

    const latest = new Map<string, ScoredSnapshot>();
    for (const row of rows) {
      const key = `${row.fixture_id}:${row.model_version}`;
      if (!latest.has(key)) latest.set(key, row);
    }

    const scored = [...latest.values()];
    const primary = scored.filter((snapshot) => snapshot.model_version === MODEL_V2_VERSION);
    const pendingResult = (await db.prepare(`
      SELECT COUNT(DISTINCT s.fixture_id) AS count
      FROM prediction_snapshots s
      JOIN fixtures f ON f.id = s.fixture_id
      WHERE f.status NOT IN ('FT', 'AET', 'PEN')
    `).first<{ count: number }>())?.count ?? 0;

    return Response.json({
      connected: true,
      model: { name: MODEL_V2_NAME, version: MODEL_V2_VERSION },
      windowDays: withinDays,
      coverage: {
        upcoming: coverage.reduce((sum, row) => sum + Number(row.upcoming), 0),
        covered: coverage.reduce((sum, row) => sum + Number(row.covered), 0),
        byCompetition: coverage.map((row) => ({
          competitionId: row.competition_id,
          competition: row.competition_name,
          upcoming: Number(row.upcoming),
          covered: Number(row.covered),
        })),
      },
      awaitingResult: Number(pendingResult),
      performance: score(primary),
      marketComparison: compareMarket(primary),
      identicalFixtureComparison: compareIdenticalFixtures(scored),
      byCompetition: byCompetition(primary),
      calibration: calibration(primary),
      methodology: 'Scored on the last forecast recorded before kickoff for each fixture. V1, v2 and market comparisons use only identical fixtures with all three probability sets present. Nothing recorded after kickoff is counted.',
      checkedAt: now.toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({
      connected: false,
      error: error instanceof Error ? error.message : 'Prediction snapshots could not be scored.',
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

function compareMarket(snapshots: ScoredSnapshot[]) {
  const matched = snapshots.filter((snapshot) => marketTriple(snapshot) !== null);
  if (!matched.length) {
    return { matches: 0, modelBrier: null, marketBrier: null, brierDifference: null, modelLogLoss: null, marketLogLoss: null, logLossDifference: null };
  }
  let modelBrier = 0;
  let marketBrier = 0;
  let modelLogLoss = 0;
  let marketLogLoss = 0;
  for (const snapshot of matched) {
    const model = triple(snapshot);
    const market = marketTriple(snapshot)!;
    const actual = outcomeIndex(snapshot.home_goals, snapshot.away_goals);
    modelBrier += brierFor(model, actual);
    marketBrier += brierFor(market, actual);
    modelLogLoss += -Math.log(Math.max(model[actual], 0.001));
    marketLogLoss += -Math.log(Math.max(market[actual], 0.001));
  }
  const modelBrierMean = modelBrier / matched.length;
  const marketBrierMean = marketBrier / matched.length;
  const modelLogLossMean = modelLogLoss / matched.length;
  const marketLogLossMean = marketLogLoss / matched.length;
  return {
    matches: matched.length,
    modelBrier: round(modelBrierMean, 3),
    marketBrier: round(marketBrierMean, 3),
    brierDifference: round(modelBrierMean - marketBrierMean, 3),
    modelLogLoss: round(modelLogLossMean, 3),
    marketLogLoss: round(marketLogLossMean, 3),
    logLossDifference: round(modelLogLossMean - marketLogLossMean, 3),
  };
}

function compareIdenticalFixtures(snapshots: ScoredSnapshot[]) {
  const byFixture = new Map<number, Map<string, ScoredSnapshot>>();
  for (const snapshot of snapshots) {
    const versions = byFixture.get(snapshot.fixture_id) ?? new Map<string, ScoredSnapshot>();
    versions.set(snapshot.model_version, snapshot);
    byFixture.set(snapshot.fixture_id, versions);
  }
  const matched = [...byFixture.values()].filter((versions) => {
    const v1 = versions.get(MODEL_VERSION);
    return Boolean(v1 && versions.has(MODEL_V2_VERSION) && marketTriple(v1) !== null);
  });
  if (!matched.length) return { matches: 0, entries: [] };

  const accumulators = [
    { key: 'v1', name: MODEL_NAME, version: MODEL_VERSION, brier: 0, logLoss: 0 },
    { key: 'v2', name: MODEL_V2_NAME, version: MODEL_V2_VERSION, brier: 0, logLoss: 0 },
    { key: 'market', name: 'Bookmaker consensus', version: null, brier: 0, logLoss: 0 },
  ];
  for (const versions of matched) {
    const v1 = versions.get(MODEL_VERSION)!;
    const v2 = versions.get(MODEL_V2_VERSION)!;
    const probabilities = [triple(v1), triple(v2), marketTriple(v1)!];
    const actual = outcomeIndex(v1.home_goals, v1.away_goals);
    for (const [index, entry] of accumulators.entries()) {
      entry.brier += brierFor(probabilities[index], actual);
      entry.logLoss += -Math.log(Math.max(probabilities[index][actual], 0.001));
    }
  }
  return {
    matches: matched.length,
    entries: accumulators.map((entry) => ({
      key: entry.key,
      name: entry.name,
      version: entry.version,
      brier: round(entry.brier / matched.length, 3),
      logLoss: round(entry.logLoss / matched.length, 3),
    })),
  };
}

function brierFor(probabilities: number[], actual: number) {
  return probabilities.reduce((sum, probability, outcome) => sum + (probability - (outcome === actual ? 1 : 0)) ** 2, 0);
}

function score(snapshots: ScoredSnapshot[]) {
  if (!snapshots.length) return { matches: 0, accuracy: null, brier: null, logLoss: null, medianLeadHours: null };
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  const leads: number[] = [];
  for (const snapshot of snapshots) {
    const probabilities = triple(snapshot);
    const actual = outcomeIndex(snapshot.home_goals, snapshot.away_goals);
    if (probabilities.indexOf(Math.max(...probabilities)) === actual) correct++;
    brier += probabilities.reduce((sum, probability, outcome) => sum + (probability - (outcome === actual ? 1 : 0)) ** 2, 0);
    logLoss += -Math.log(Math.max(probabilities[actual], 0.001));
    leads.push((Date.parse(snapshot.kickoff) - Date.parse(snapshot.created_at)) / 3_600_000);
  }
  leads.sort((a, b) => a - b);
  return {
    matches: snapshots.length,
    accuracy: round(100 * correct / snapshots.length, 1),
    brier: round(brier / snapshots.length, 3),
    logLoss: round(logLoss / snapshots.length, 3),
    medianLeadHours: round(leads[Math.floor(leads.length / 2)], 1),
  };
}

function byCompetition(snapshots: ScoredSnapshot[]) {
  const groups = new Map<number, ScoredSnapshot[]>();
  for (const snapshot of snapshots) {
    const group = groups.get(snapshot.competition_id) ?? [];
    group.push(snapshot);
    groups.set(snapshot.competition_id, group);
  }
  return [...groups.entries()]
    .map(([competitionId, group]) => ({
      competitionId,
      competition: group[0].competition_name ?? getCompetition(competitionId)?.name ?? null,
      ...score(group),
    }))
    .sort((a, b) => b.matches - a.matches);
}

// One-vs-rest reliability: every forecast contributes its three probabilities,
// each paired with whether that outcome happened.
function calibration(snapshots: ScoredSnapshot[]) {
  const eligible = snapshots.length >= CALIBRATION_MINIMUM_FIXTURES;
  if (!eligible) {
    return {
      eligible: false,
      settledFixtures: snapshots.length,
      minimumFixtures: CALIBRATION_MINIMUM_FIXTURES,
      points: snapshots.length * 3,
      expectedCalibrationError: null,
      bins: [],
    };
  }
  const bins = Array.from({ length: CALIBRATION_BINS }, (_, index) => ({
    from: round(index / CALIBRATION_BINS, 2),
    to: round((index + 1) / CALIBRATION_BINS, 2),
    count: 0,
    predicted: 0,
    observed: 0,
  }));

  let points = 0;
  for (const snapshot of snapshots) {
    const probabilities = triple(snapshot);
    const actual = outcomeIndex(snapshot.home_goals, snapshot.away_goals);
    for (const [outcome, probability] of probabilities.entries()) {
      const bin = bins[Math.min(CALIBRATION_BINS - 1, Math.floor(probability * CALIBRATION_BINS))];
      bin.count++;
      bin.predicted += probability;
      bin.observed += outcome === actual ? 1 : 0;
      points++;
    }
  }

  const filled = bins.filter((bin) => bin.count > 0);
  const error = points
    ? filled.reduce((sum, bin) => sum + bin.count * Math.abs(bin.predicted / bin.count - bin.observed / bin.count), 0) / points
    : null;
  return {
    eligible: true,
    settledFixtures: snapshots.length,
    minimumFixtures: CALIBRATION_MINIMUM_FIXTURES,
    points,
    expectedCalibrationError: error === null ? null : round(error, 3),
    bins: filled.map((bin) => ({
      from: bin.from,
      to: bin.to,
      count: bin.count,
      predicted: round(bin.predicted / bin.count, 3),
      observed: round(bin.observed / bin.count, 3),
    })),
  };
}

function triple(snapshot: ScoredSnapshot) {
  return [snapshot.home_probability, snapshot.draw_probability, snapshot.away_probability];
}

function marketTriple(snapshot: ScoredSnapshot) {
  if (snapshot.market_home_probability === null || snapshot.market_draw_probability === null || snapshot.market_away_probability === null) return null;
  return [snapshot.market_home_probability, snapshot.market_draw_probability, snapshot.market_away_probability];
}

function clampWindow(value: unknown) {
  const days = Number(value);
  if (!Number.isFinite(days) || days <= 0) return DEFAULT_WINDOW_DAYS;
  return Math.min(Math.round(days), MAX_WINDOW_DAYS);
}

function round(value: number, places: number) { return Number(value.toFixed(places)); }

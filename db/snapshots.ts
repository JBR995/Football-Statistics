import type { FixtureRow, ModelOutput } from '@/lib/model';
import { MODEL_NAME, MODEL_VERSION } from '@/lib/model';

export type SnapshotRow = {
  id: number;
  fixture_id: number;
  competition_id: number;
  season: number;
  kickoff: string;
  model_name: string;
  model_version: string;
  home_probability: number;
  draw_probability: number;
  away_probability: number;
  expected_home_goals: number;
  expected_away_goals: number;
  over25_probability: number;
  btts_probability: number;
  training_matches: number;
  created_at: string;
};

// Probabilities move a little between runs, so an exact comparison would store
// a near-duplicate row every time. A tenth of a percentage point is the
// smallest change worth keeping.
const PROBABILITY_EPSILON = 0.001;

export async function readLatestSnapshot(db: D1Database, fixtureId: number, modelVersion = MODEL_VERSION) {
  return db
    .prepare(`SELECT * FROM prediction_snapshots WHERE fixture_id = ? AND model_version = ? ORDER BY id DESC LIMIT 1`)
    .bind(fixtureId, modelVersion)
    .first<SnapshotRow>();
}

// Records a forecast made before kickoff. Returns false when an equivalent
// forecast is already the latest one held for the fixture.
export async function writeSnapshot(db: D1Database, fixture: FixtureRow, prediction: ModelOutput, trainingMatches: number) {
  const probabilities = {
    home: prediction.probabilities.home / 100,
    draw: prediction.probabilities.draw / 100,
    away: prediction.probabilities.away / 100,
  };
  const previous = await readLatestSnapshot(db, fixture.id);
  if (previous && unchanged(previous, probabilities)) return false;

  await db.prepare(`
    INSERT INTO prediction_snapshots (
      fixture_id, competition_id, season, kickoff, model_name, model_version,
      home_probability, draw_probability, away_probability,
      expected_home_goals, expected_away_goals, over25_probability, btts_probability,
      training_matches, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    fixture.id, fixture.competition_id, fixture.season, fixture.kickoff, MODEL_NAME, MODEL_VERSION,
    probabilities.home, probabilities.draw, probabilities.away,
    prediction.expectedGoals.home, prediction.expectedGoals.away,
    prediction.markets.over25 / 100, prediction.markets.btts / 100,
    trainingMatches, new Date().toISOString(),
  ).run();
  return true;
}

function unchanged(previous: SnapshotRow, probabilities: { home: number; draw: number; away: number }) {
  return Math.abs(previous.home_probability - probabilities.home) < PROBABILITY_EPSILON
    && Math.abs(previous.draw_probability - probabilities.draw) < PROBABILITY_EPSILON
    && Math.abs(previous.away_probability - probabilities.away) < PROBABILITY_EPSILON;
}

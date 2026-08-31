import { env } from 'cloudflare:workers';

export function getFootballDb() {
  if (!env.DB) throw new Error('The football database is unavailable.');
  return env.DB;
}

export async function ensureFootballSchema() {
  const db = getFootballDb();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS competitions (id INTEGER NOT NULL, season INTEGER NOT NULL, name TEXT NOT NULL, country TEXT, logo TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (id, season))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL, logo TEXT, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS fixtures (id INTEGER PRIMARY KEY, competition_id INTEGER NOT NULL, season INTEGER NOT NULL, round TEXT, kickoff TEXT NOT NULL, status TEXT NOT NULL, venue TEXT, home_team_id INTEGER NOT NULL, away_team_id INTEGER NOT NULL, home_goals INTEGER, away_goals INTEGER, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sync_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, competition_id INTEGER NOT NULL, season INTEGER NOT NULL, status TEXT NOT NULL, records INTEGER NOT NULL DEFAULT 0, error TEXT, started_at TEXT NOT NULL, finished_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS fixture_statistics (fixture_id INTEGER NOT NULL, team_id INTEGER NOT NULL, shots_total INTEGER, shots_on INTEGER, shots_off INTEGER, shots_blocked INTEGER, shots_inside_box INTEGER, shots_outside_box INTEGER, fouls INTEGER, corners INTEGER, offsides INTEGER, possession REAL, yellow_cards INTEGER, red_cards INTEGER, saves INTEGER, passes_total INTEGER, passes_accurate INTEGER, expected_goals REAL, updated_at TEXT NOT NULL, PRIMARY KEY (fixture_id, team_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS fixture_lineups (fixture_id INTEGER NOT NULL, team_id INTEGER NOT NULL, formation TEXT, coach TEXT, starters TEXT NOT NULL, substitutes TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (fixture_id, team_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS fixture_odds (fixture_id INTEGER NOT NULL, bookmaker_id INTEGER NOT NULL, bookmaker TEXT NOT NULL, home_odds REAL, draw_odds REAL, away_odds REAL, over25_odds REAL, under25_odds REAL, btts_yes_odds REAL, btts_no_odds REAL, updated_at TEXT NOT NULL, PRIMARY KEY (fixture_id, bookmaker_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS prediction_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, fixture_id INTEGER NOT NULL, competition_id INTEGER NOT NULL, season INTEGER NOT NULL, kickoff TEXT NOT NULL, model_name TEXT NOT NULL, model_version TEXT NOT NULL, home_probability REAL NOT NULL, draw_probability REAL NOT NULL, away_probability REAL NOT NULL, expected_home_goals REAL NOT NULL, expected_away_goals REAL NOT NULL, over25_probability REAL NOT NULL, btts_probability REAL NOT NULL, market_home_probability REAL, market_draw_probability REAL, market_away_probability REAL, market_bookmakers INTEGER, training_matches INTEGER NOT NULL, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_fixtures_competition_season_kickoff ON fixtures (competition_id, season, kickoff)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_fixtures_home_team ON fixtures (home_team_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_fixtures_away_team ON fixtures (away_team_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sync_runs_competition_season ON sync_runs (competition_id, season)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_fixture_statistics_fixture ON fixture_statistics (fixture_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_fixture_lineups_fixture ON fixture_lineups (fixture_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_fixture_odds_fixture ON fixture_odds (fixture_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_prediction_snapshots_fixture ON prediction_snapshots (fixture_id, model_version, id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_prediction_snapshots_kickoff ON prediction_snapshots (kickoff)`),
  ]);
  const snapshotColumns = (await db.prepare('PRAGMA table_info(prediction_snapshots)').all<{ name: string }>()).results;
  const existing = new Set(snapshotColumns.map((column) => column.name));
  const additions = [
    ['market_home_probability', 'REAL'],
    ['market_draw_probability', 'REAL'],
    ['market_away_probability', 'REAL'],
    ['market_bookmakers', 'INTEGER'],
  ].filter(([name]) => !existing.has(name));
  if (additions.length) {
    await db.batch(additions.map(([name, type]) => db.prepare(`ALTER TABLE prediction_snapshots ADD COLUMN ${name} ${type}`)));
  }
  return db;
}

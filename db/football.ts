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
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_fixtures_competition_season_kickoff ON fixtures (competition_id, season, kickoff)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_fixtures_home_team ON fixtures (home_team_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_fixtures_away_team ON fixtures (away_team_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sync_runs_competition_season ON sync_runs (competition_id, season)`),
  ]);
  return db;
}

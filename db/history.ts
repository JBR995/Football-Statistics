import type { Competition } from '@/lib/competitions';

// One fixture in the shape the database stores it, independent of which
// provider — or which route — produced it.
export type SeasonFixture = {
  id: number;
  kickoff: string;
  status: string;
  round: string | null;
  venue: string | null;
  homeTeamId: number;
  homeTeamName: string;
  homeTeamLogo: string | null;
  awayTeamId: number;
  awayTeamName: string;
  awayTeamLogo: string | null;
  homeGoals: number | null;
  awayGoals: number | null;
};

// D1 caps a batch at 100 bound statements; 75 leaves headroom.
const BATCH_SIZE = 75;

export const MIN_SEASON = 2010;

export function maxSeason() {
  return new Date().getUTCFullYear();
}

export function isSupportedSeason(season: number) {
  return Number.isInteger(season) && season >= MIN_SEASON && season <= maxSeason();
}

// A season counts as stored only when fixtures are present *and* a run
// completed. Either one alone is a partial import that should be repaired.
export async function readSeasonState(db: D1Database, competitionId: number, season: number) {
  const stored = await db
    .prepare('SELECT COUNT(*) AS count FROM fixtures WHERE competition_id = ? AND season = ?')
    .bind(competitionId, season)
    .first<{ count: number }>();
  const completed = await db
    .prepare(`SELECT id FROM sync_runs WHERE competition_id = ? AND season = ? AND status = 'complete' ORDER BY id DESC LIMIT 1`)
    .bind(competitionId, season)
    .first<{ id: number }>();
  const records = Number(stored?.count ?? 0);
  return { records, complete: records > 0 && Boolean(completed) };
}

export async function storeSeason(db: D1Database, options: {
  competitionId: number;
  season: number;
  competition: Competition;
  competitionLogo: string | null;
  fixtures: SeasonFixture[];
  startedAt: string;
}) {
  const { competitionId, season, competition, competitionLogo, fixtures, startedAt } = options;
  const updatedAt = new Date().toISOString();
  const teams = new Map<number, { id: number; name: string; logo: string | null }>();
  for (const fixture of fixtures) {
    teams.set(fixture.homeTeamId, { id: fixture.homeTeamId, name: fixture.homeTeamName, logo: fixture.homeTeamLogo });
    teams.set(fixture.awayTeamId, { id: fixture.awayTeamId, name: fixture.awayTeamName, logo: fixture.awayTeamLogo });
  }

  const statements = [
    db.prepare(`INSERT INTO competitions (id, season, name, country, logo, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id, season) DO UPDATE SET name=excluded.name, country=excluded.country, logo=excluded.logo, updated_at=excluded.updated_at`).bind(competitionId, season, competition.name, competition.country, competitionLogo, updatedAt),
    ...Array.from(teams.values()).map((team) => db.prepare(`INSERT INTO teams (id, name, logo, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, logo=excluded.logo, updated_at=excluded.updated_at`).bind(team.id, team.name, team.logo, updatedAt)),
    ...fixtures.map((fixture) => db.prepare(`INSERT INTO fixtures (id, competition_id, season, round, kickoff, status, venue, home_team_id, away_team_id, home_goals, away_goals, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET competition_id=excluded.competition_id, season=excluded.season, round=excluded.round, kickoff=excluded.kickoff, status=excluded.status, venue=excluded.venue, home_goals=excluded.home_goals, away_goals=excluded.away_goals, updated_at=excluded.updated_at`).bind(fixture.id, competitionId, season, fixture.round, fixture.kickoff, fixture.status, fixture.venue, fixture.homeTeamId, fixture.awayTeamId, fixture.homeGoals, fixture.awayGoals, updatedAt)),
  ];
  for (let index = 0; index < statements.length; index += BATCH_SIZE) {
    await db.batch(statements.slice(index, index + BATCH_SIZE));
  }

  await db
    .prepare(`INSERT INTO sync_runs (competition_id, season, status, records, started_at, finished_at) VALUES (?, ?, 'complete', ?, ?, ?)`)
    .bind(competitionId, season, fixtures.length, startedAt, updatedAt)
    .run();
  return fixtures.length;
}

export async function recordFailedSeason(db: D1Database, competitionId: number, season: number, message: string, startedAt: string) {
  try {
    await db
      .prepare(`INSERT INTO sync_runs (competition_id, season, status, records, error, started_at, finished_at) VALUES (?, ?, 'failed', 0, ?, ?, ?)`)
      .bind(competitionId, season, message, startedAt, new Date().toISOString())
      .run();
  } catch { /* Preserve the original error when status logging is unavailable. */ }
}

import type { FixtureRow } from '@/lib/model';

// One fixture projection, so every reader sees the same columns.
export const FIXTURE_QUERY = `
  SELECT f.id, f.competition_id, c.name AS competition_name, f.season, f.kickoff, f.status, f.round, f.venue,
         f.home_team_id, ht.name AS home_name, ht.logo AS home_logo,
         f.away_team_id, at.name AS away_name, at.logo AS away_logo,
         f.home_goals, f.away_goals
  FROM fixtures f
  JOIN competitions c ON c.id = f.competition_id AND c.season = f.season
  JOIN teams ht ON ht.id = f.home_team_id
  JOIN teams at ON at.id = f.away_team_id
`;

const COMPLETED = `f.status IN ('FT', 'AET', 'PEN') AND f.home_goals IS NOT NULL AND f.away_goals IS NOT NULL`;

export function readFixture(db: D1Database, fixtureId: number) {
  return db.prepare(`${FIXTURE_QUERY} WHERE f.id = ?`).bind(fixtureId).first<FixtureRow>();
}

// The completed matches a model may learn from. `beforeKickoff` is what keeps
// a prediction free of results that were not yet known.
export async function readCompletedHistory(db: D1Database, options: {
  competitionId: number;
  fromSeason: number;
  toSeason: number;
  beforeKickoff?: string;
}) {
  const { competitionId, fromSeason, toSeason, beforeKickoff } = options;
  const kickoffFilter = beforeKickoff ? 'AND f.kickoff < ?' : '';
  const statement = db
    .prepare(`${FIXTURE_QUERY} WHERE f.competition_id = ? AND f.season >= ? AND f.season <= ? ${kickoffFilter} AND ${COMPLETED} ORDER BY f.kickoff ASC, f.id ASC`);
  const bound = beforeKickoff
    ? statement.bind(competitionId, fromSeason, toSeason, beforeKickoff)
    : statement.bind(competitionId, fromSeason, toSeason);
  return (await bound.all<FixtureRow>()).results;
}

import { ensureFootballSchema } from '@/db/football';
import { getCompetition } from '@/lib/competitions';

// What detail is actually stored, per competition-season, and which fixtures
// are still missing a given class. The importer reads this to resume where it
// stopped; the Data Explorer reads it so the readiness panel reports the
// database rather than an assumption about it.

const COMPLETED = `f.status IN ('FT', 'AET', 'PEN')`;
const CLASSES = { statistics: 'fixture_statistics', lineups: 'fixture_lineups', odds: 'fixture_odds' } as const;
const DEFAULT_MISSING_LIMIT = 200;
const MAX_MISSING_LIMIT = 1000;

type CoverageRow = {
  competition_id: number;
  competition_name: string;
  season: number;
  fixtures: number;
  completed: number;
  with_statistics: number;
  with_lineups: number;
  with_odds: number;
};

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const missing = params.get('missing');

  try {
    const db = await ensureFootballSchema();
    if (missing) return await listMissing(db, missing, params);

    const rows = (await db.prepare(`
      SELECT f.competition_id, MAX(c.name) AS competition_name, f.season,
             COUNT(*) AS fixtures,
             SUM(CASE WHEN ${COMPLETED} THEN 1 ELSE 0 END) AS completed,
             SUM(CASE WHEN ${COMPLETED} AND st.fixture_id IS NOT NULL THEN 1 ELSE 0 END) AS with_statistics,
             SUM(CASE WHEN ${COMPLETED} AND lu.fixture_id IS NOT NULL THEN 1 ELSE 0 END) AS with_lineups,
             SUM(CASE WHEN od.fixture_id IS NOT NULL THEN 1 ELSE 0 END) AS with_odds
      FROM fixtures f
      JOIN competitions c ON c.id = f.competition_id AND c.season = f.season
      LEFT JOIN (SELECT DISTINCT fixture_id FROM fixture_statistics) st ON st.fixture_id = f.id
      LEFT JOIN (SELECT DISTINCT fixture_id FROM fixture_lineups) lu ON lu.fixture_id = f.id
      LEFT JOIN (SELECT DISTINCT fixture_id FROM fixture_odds) od ON od.fixture_id = f.id
      GROUP BY f.competition_id, f.season
      ORDER BY MAX(c.name), f.season DESC
    `).all<CoverageRow>()).results;

    const seasons = rows.map((row) => ({
      competitionId: row.competition_id,
      competition: row.competition_name ?? getCompetition(row.competition_id)?.name ?? null,
      season: row.season,
      fixtures: Number(row.fixtures),
      completed: Number(row.completed),
      statistics: Number(row.with_statistics),
      lineups: Number(row.with_lineups),
      odds: Number(row.with_odds),
    }));

    const total = (key: 'completed' | 'fixtures' | 'statistics' | 'lineups' | 'odds') =>
      seasons.reduce((sum, season) => sum + season[key], 0);

    return Response.json({
      connected: true,
      seasons,
      summary: {
        seasons: seasons.length,
        fixtures: total('fixtures'),
        completed: total('completed'),
        // Statistics and line-ups exist only for matches that were played;
        // odds are quoted for every fixture, so each has its own denominator.
        statistics: { stored: total('statistics'), of: total('completed') },
        lineups: { stored: total('lineups'), of: total('completed') },
        odds: { stored: total('odds'), of: total('fixtures') },
      },
      checkedAt: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({
      connected: false,
      error: error instanceof Error ? error.message : 'Detail coverage could not be read.',
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

async function listMissing(db: D1Database, missing: string, params: URLSearchParams) {
  const table = CLASSES[missing as keyof typeof CLASSES];
  if (!table) {
    return Response.json({ connected: false, error: `Ask for one of ${Object.keys(CLASSES).join(', ')}.` }, { status: 400 });
  }

  const league = Number(params.get('league'));
  if (!getCompetition(league)) {
    return Response.json({ connected: false, error: 'That competition is not enabled.' }, { status: 400 });
  }
  const season = Number(params.get('season'));
  if (!Number.isInteger(season)) {
    return Response.json({ connected: false, error: 'A valid season is required.' }, { status: 400 });
  }
  const requestedLimit = Number(params.get('limit'));
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, MAX_MISSING_LIMIT) : DEFAULT_MISSING_LIMIT;

  // Odds are quoted before a match, statistics and line-ups only exist after
  // one, so only the latter two are restricted to completed fixtures.
  const playedOnly = missing === 'odds' ? '' : `AND ${COMPLETED}`;
  const rows = (await db.prepare(`
    SELECT f.id, f.kickoff
    FROM fixtures f
    WHERE f.competition_id = ? AND f.season = ? ${playedOnly}
      AND NOT EXISTS (SELECT 1 FROM ${table} d WHERE d.fixture_id = f.id)
    ORDER BY f.kickoff ASC
    LIMIT ?
  `).bind(league, season, limit).all<{ id: number; kickoff: string }>()).results;

  const remaining = (await db.prepare(`
    SELECT COUNT(*) AS count
    FROM fixtures f
    WHERE f.competition_id = ? AND f.season = ? ${playedOnly}
      AND NOT EXISTS (SELECT 1 FROM ${table} d WHERE d.fixture_id = f.id)
  `).bind(league, season).first<{ count: number }>())?.count ?? 0;

  return Response.json({
    connected: true,
    missing,
    competitionId: league,
    season,
    remaining: Number(remaining),
    fixtures: rows.map((row) => ({ id: row.id, kickoff: row.kickoff })),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

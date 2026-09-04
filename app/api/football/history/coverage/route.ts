import { ensureFootballSchema } from '@/db/football';
import { getCompetition } from '@/lib/competitions';

// What detail is actually stored, per competition-season, and which fixtures
// are still missing a given class. The importer reads this to resume where it
// stopped; the Data Explorer reads it so the readiness panel reports the
// database rather than an assumption about it.

const COMPLETED = `f.status IN ('FT', 'AET', 'PEN')`;
const CLASSES = {
  statistics: 'fixture_statistics',
  players: 'fixture_player_statistics',
  lineups: 'fixture_lineups',
  injuries: 'fixture_availability_snapshots',
  odds: 'fixture_odds',
} as const;
const DEFAULT_MISSING_LIMIT = 200;
const MAX_MISSING_LIMIT = 1000;

type CoverageRow = {
  competition_id: number;
  competition_name: string;
  season: number;
  fixtures: number;
  completed: number;
  with_statistics: number;
  with_players: number;
  with_lineups: number;
  with_availability: number;
  with_odds: number;
};

type QualityCounts = FieldCounts & {
  shots_total_zero: number;
  shots_on_zero: number;
  fouls_zero: number;
  fouls_drawn?: number;
  fouls_drawn_zero?: number;
  yellow_cards_zero: number;
  red_cards_zero: number;
};

type ReconciliationRow = {
  groups: number;
  shots_comparable: number; shots_exact: number;
  shots_on_comparable: number; shots_on_exact: number;
  fouls_comparable: number; fouls_exact: number;
  yellow_comparable: number; yellow_exact: number;
  red_comparable: number; red_exact: number;
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
             SUM(CASE WHEN ${COMPLETED} AND ps.fixture_id IS NOT NULL THEN 1 ELSE 0 END) AS with_players,
             SUM(CASE WHEN ${COMPLETED} AND lu.fixture_id IS NOT NULL THEN 1 ELSE 0 END) AS with_lineups,
             SUM(CASE WHEN av.fixture_id IS NOT NULL THEN 1 ELSE 0 END) AS with_availability,
             SUM(CASE WHEN od.fixture_id IS NOT NULL THEN 1 ELSE 0 END) AS with_odds
      FROM fixtures f
      JOIN competitions c ON c.id = f.competition_id AND c.season = f.season
      LEFT JOIN (SELECT DISTINCT fixture_id FROM fixture_statistics) st ON st.fixture_id = f.id
      LEFT JOIN (SELECT DISTINCT fixture_id FROM fixture_player_statistics) ps ON ps.fixture_id = f.id
      LEFT JOIN (SELECT DISTINCT fixture_id FROM fixture_lineups) lu ON lu.fixture_id = f.id
      LEFT JOIN (SELECT DISTINCT fixture_id FROM fixture_availability_snapshots) av ON av.fixture_id = f.id
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
      players: Number(row.with_players),
      lineups: Number(row.with_lineups),
      availability: Number(row.with_availability),
      odds: Number(row.with_odds),
    }));

    const total = (key: 'completed' | 'fixtures' | 'statistics' | 'players' | 'lineups' | 'availability' | 'odds') =>
      seasons.reduce((sum, season) => sum + season[key], 0);

    const teamFields = await db.prepare(`
      SELECT COUNT(*) AS rows,
             SUM(shots_total IS NOT NULL) AS shots_total,
             SUM(shots_on IS NOT NULL) AS shots_on,
             SUM(fouls IS NOT NULL) AS fouls,
             SUM(yellow_cards IS NOT NULL) AS yellow_cards,
             SUM(red_cards IS NOT NULL) AS red_cards
      FROM fixture_statistics
    `).first<FieldCounts>();
    const playerFields = await db.prepare(`
      SELECT COUNT(*) AS rows,
             SUM(shots_total IS NOT NULL) AS shots_total,
             SUM(shots_on IS NOT NULL) AS shots_on,
             SUM(fouls_committed IS NOT NULL) AS fouls,
             SUM(yellow_cards IS NOT NULL) AS yellow_cards,
             SUM(red_cards IS NOT NULL) AS red_cards
      FROM fixture_player_statistics
    `).first<FieldCounts>();
    const [teamQuality, playerQuality, reconciliation, outcomeRows, failedRows] = await Promise.all([
      db.prepare(`
        SELECT COUNT(*) AS rows,
          SUM(shots_total IS NOT NULL) AS shots_total, SUM(shots_total = 0) AS shots_total_zero,
          SUM(shots_on IS NOT NULL) AS shots_on, SUM(shots_on = 0) AS shots_on_zero,
          SUM(fouls IS NOT NULL) AS fouls, SUM(fouls = 0) AS fouls_zero,
          SUM(yellow_cards IS NOT NULL) AS yellow_cards, SUM(yellow_cards = 0) AS yellow_cards_zero,
          SUM(red_cards IS NOT NULL) AS red_cards, SUM(red_cards = 0) AS red_cards_zero
        FROM fixture_statistics
      `).first<QualityCounts>(),
      db.prepare(`
        SELECT COUNT(*) AS rows,
          SUM(shots_total IS NOT NULL) AS shots_total, SUM(shots_total = 0) AS shots_total_zero,
          SUM(shots_on IS NOT NULL) AS shots_on, SUM(shots_on = 0) AS shots_on_zero,
          SUM(fouls_committed IS NOT NULL) AS fouls, SUM(fouls_committed = 0) AS fouls_zero,
          SUM(fouls_drawn IS NOT NULL) AS fouls_drawn, SUM(fouls_drawn = 0) AS fouls_drawn_zero,
          SUM(yellow_cards IS NOT NULL) AS yellow_cards, SUM(yellow_cards = 0) AS yellow_cards_zero,
          SUM(red_cards IS NOT NULL) AS red_cards, SUM(red_cards = 0) AS red_cards_zero
        FROM fixture_player_statistics
      `).first<QualityCounts>(),
      db.prepare(`
        WITH player_totals AS (
          SELECT fixture_id, team_id, COUNT(*) AS player_rows,
            SUM(shots_total) AS shots_total, SUM(shots_total IS NULL) AS shots_missing,
            SUM(shots_on) AS shots_on, SUM(shots_on IS NULL) AS shots_on_missing,
            SUM(fouls_committed) AS fouls, SUM(fouls_committed IS NULL) AS fouls_missing,
            SUM(yellow_cards) AS yellow_cards, SUM(yellow_cards IS NULL) AS yellow_missing,
            SUM(red_cards) AS red_cards, SUM(red_cards IS NULL) AS red_missing
          FROM fixture_player_statistics GROUP BY fixture_id, team_id
        )
        SELECT COUNT(*) AS groups,
          SUM(p.shots_missing = 0 AND t.shots_total IS NOT NULL) AS shots_comparable,
          SUM(p.shots_missing = 0 AND t.shots_total IS NOT NULL AND p.shots_total = t.shots_total) AS shots_exact,
          SUM(p.shots_on_missing = 0 AND t.shots_on IS NOT NULL) AS shots_on_comparable,
          SUM(p.shots_on_missing = 0 AND t.shots_on IS NOT NULL AND p.shots_on = t.shots_on) AS shots_on_exact,
          SUM(p.fouls_missing = 0 AND t.fouls IS NOT NULL) AS fouls_comparable,
          SUM(p.fouls_missing = 0 AND t.fouls IS NOT NULL AND p.fouls = t.fouls) AS fouls_exact,
          SUM(p.yellow_missing = 0 AND t.yellow_cards IS NOT NULL) AS yellow_comparable,
          SUM(p.yellow_missing = 0 AND t.yellow_cards IS NOT NULL AND p.yellow_cards = t.yellow_cards) AS yellow_exact,
          SUM(p.red_missing = 0 AND t.red_cards IS NOT NULL) AS red_comparable,
          SUM(p.red_missing = 0 AND t.red_cards IS NOT NULL AND p.red_cards = t.red_cards) AS red_exact
        FROM player_totals p JOIN fixture_statistics t ON t.fixture_id = p.fixture_id AND t.team_id = p.team_id
      `).first<ReconciliationRow>(),
      db.prepare(`SELECT detail_class, status, COUNT(*) AS count FROM fixture_detail_imports GROUP BY detail_class, status ORDER BY detail_class, status`).all<{ detail_class: string; status: string; count: number }>(),
      db.prepare(`
        SELECT i.fixture_id, i.detail_class, i.message, i.attempted_at,
          c.name AS competition, f.season, ht.name AS home, at.name AS away
        FROM fixture_detail_imports i
        JOIN fixtures f ON f.id = i.fixture_id
        JOIN competitions c ON c.id = f.competition_id AND c.season = f.season
        JOIN teams ht ON ht.id = f.home_team_id JOIN teams at ON at.id = f.away_team_id
        WHERE i.status = 'failed' ORDER BY i.attempted_at DESC LIMIT 20
      `).all<{ fixture_id: number; detail_class: string; message: string | null; attempted_at: string; competition: string; season: number; home: string; away: string }>(),
    ]);

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
        players: { stored: total('players'), of: total('completed') },
        lineups: { stored: total('lineups'), of: total('completed') },
        availability: { stored: total('availability'), of: total('fixtures') },
        odds: { stored: total('odds'), of: total('fixtures') },
      },
      fields: {
        team: fieldCoverage(teamFields),
        player: fieldCoverage(playerFields),
      },
      quality: {
        team: qualityCoverage(teamQuality, false),
        player: qualityCoverage(playerQuality, true),
        reconciliation: reconciliationCoverage(reconciliation),
        importOutcomes: outcomeRows.results.map((row) => ({ detailClass: row.detail_class, status: row.status, count: Number(row.count) })),
        failedFixtures: failedRows.results.map((row) => ({
          fixtureId: row.fixture_id, detailClass: row.detail_class, message: row.message,
          attemptedAt: row.attempted_at, competition: row.competition, season: row.season,
          match: `${row.home} v ${row.away}`,
        })),
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

  // Statistics only exist after the match. Line-ups and injuries are queried
  // before kickoff; repeat=true asks for a fresh immutable observation even
  // when an earlier capture exists.
  const playedOnly = missing === 'statistics' || missing === 'players' ? `AND ${COMPLETED}` : '';
  const repeat = params.get('repeat') === 'true' && (missing === 'lineups' || missing === 'injuries');
  const absent = repeat ? '' : `AND NOT EXISTS (SELECT 1 FROM ${table} d WHERE d.fixture_id = f.id)`;
  const terminalEmpty = missing === 'statistics' || missing === 'players'
    ? `AND NOT EXISTS (SELECT 1 FROM fixture_detail_imports i WHERE i.fixture_id = f.id AND i.detail_class = '${missing}' AND i.status = 'empty')`
    : '';
  const rows = (await db.prepare(`
    SELECT f.id, f.kickoff
    FROM fixtures f
    WHERE f.competition_id = ? AND f.season = ? ${playedOnly}
      ${absent} ${terminalEmpty}
    ORDER BY f.kickoff ASC
    LIMIT ?
  `).bind(league, season, limit).all<{ id: number; kickoff: string }>()).results;

  const remaining = (await db.prepare(`
    SELECT COUNT(*) AS count
    FROM fixtures f
    WHERE f.competition_id = ? AND f.season = ? ${playedOnly}
      ${absent} ${terminalEmpty}
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

type FieldCounts = {
  rows: number;
  shots_total: number;
  shots_on: number;
  fouls: number;
  yellow_cards: number;
  red_cards: number;
};

function fieldCoverage(row: FieldCounts | null) {
  const of = Number(row?.rows ?? 0);
  return {
    rows: of,
    shots: { stored: Number(row?.shots_total ?? 0), of },
    shotsOnTarget: { stored: Number(row?.shots_on ?? 0), of },
    fouls: { stored: Number(row?.fouls ?? 0), of },
    yellowCards: { stored: Number(row?.yellow_cards ?? 0), of },
    redCards: { stored: Number(row?.red_cards ?? 0), of },
  };
}

function qualityCoverage(row: QualityCounts | null, player: boolean) {
  const total = Number(row?.rows ?? 0);
  const field = (present: number | undefined, zero: number | undefined) => ({
    present: Number(present ?? 0),
    missing: Math.max(0, total - Number(present ?? 0)),
    zero: Number(zero ?? 0),
    of: total,
  });
  return {
    rows: total,
    shots: field(row?.shots_total, row?.shots_total_zero),
    shotsOnTarget: field(row?.shots_on, row?.shots_on_zero),
    foulsCommitted: field(row?.fouls, row?.fouls_zero),
    ...(player ? { foulsDrawn: field(row?.fouls_drawn, row?.fouls_drawn_zero) } : {}),
    yellowCards: field(row?.yellow_cards, row?.yellow_cards_zero),
    redCards: field(row?.red_cards, row?.red_cards_zero),
  };
}

function reconciliationCoverage(row: ReconciliationRow | null) {
  const field = (comparable: number | undefined, exact: number | undefined) => ({
    comparable: Number(comparable ?? 0), exact: Number(exact ?? 0),
    different: Math.max(0, Number(comparable ?? 0) - Number(exact ?? 0)),
  });
  return {
    groups: Number(row?.groups ?? 0),
    shots: field(row?.shots_comparable, row?.shots_exact),
    shotsOnTarget: field(row?.shots_on_comparable, row?.shots_on_exact),
    fouls: field(row?.fouls_comparable, row?.fouls_exact),
    yellowCards: field(row?.yellow_comparable, row?.yellow_exact),
    redCards: field(row?.red_comparable, row?.red_exact),
  };
}

import { ensureFootballSchema } from '@/db/football';
import { getCompetition } from '@/lib/competitions';

const COMPLETE = `f.status IN ('FT','AET','PEN')`;
const PLAYER_SORTS: Record<string, string> = {
  name: 'name', team: 'team', matches: 'matches', minutes: 'minutes', goals: 'goals', assists: 'assists',
  shots: 'shots', shotsOnTarget: 'shots_on_target', foulsCommitted: 'fouls_committed',
  foulsDrawn: 'fouls_drawn', yellowCards: 'yellow_cards', redCards: 'red_cards',
};
const TEAM_SORTS: Record<string, string> = {
  name: 'name', matches: 'matches', goals: 'goals', shots: 'shots', shotsOnTarget: 'shots_on_target',
  foulsCommitted: 'fouls_committed', yellowCards: 'yellow_cards', redCards: 'red_cards',
};

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get('kind') === 'teams' ? 'teams' : 'players';
  const league = optionalInteger(params.get('league'));
  const season = optionalInteger(params.get('season'));
  const entityId = optionalInteger(params.get('id'));
  const teamId = optionalInteger(params.get('team'));
  const venue = ['home', 'away'].includes(params.get('venue') ?? '') ? params.get('venue')! : 'all';
  const recent = [5, 10].includes(Number(params.get('recent'))) ? Number(params.get('recent')) : 0;
  const search = (params.get('search') ?? '').trim().slice(0, 80);
  const page = Math.max(1, optionalInteger(params.get('page')) ?? 1);
  const requestedLimit = optionalInteger(params.get('limit')) ?? 25;
  const format = params.get('format') === 'csv' ? 'csv' : 'json';
  const download = params.get('download') === '1' || format === 'csv';
  const limit = download ? Math.min(requestedLimit, 25_000) : Math.min(requestedLimit, 100);
  const direction = params.get('direction') === 'asc' ? 'ASC' : 'DESC';
  const sorts = kind === 'players' ? PLAYER_SORTS : TEAM_SORTS;
  const sortKey = params.get('sort') ?? (kind === 'players' ? 'minutes' : 'matches');
  const sort = sorts[sortKey] ?? sorts[kind === 'players' ? 'minutes' : 'matches'];

  if (league !== null && !getCompetition(league)) return Response.json({ connected: false, error: 'Unsupported competition.' }, { status: 400 });
  if (season !== null && (season < 2000 || season > 2100)) return Response.json({ connected: false, error: 'Invalid season.' }, { status: 400 });

  try {
    const db = await ensureFootballSchema();
    if (entityId !== null) return await readMatches(db, { kind, entityId, teamId, league, season, venue, recent });

    const result = kind === 'players'
      ? await readPlayers(db, { league, season, venue, recent, search, page, limit, sort, direction, download })
      : await readTeams(db, { league, season, venue, recent, search, page, limit, sort, direction, download });

    if (format === 'csv') return csv(result.rows, `${kind}-statistics.csv`);
    return Response.json({ connected: true, kind, filters: { league, season, venue, recent, search }, ...result }, {
      headers: {
        'Cache-Control': 'no-store',
        ...(download ? { 'Content-Disposition': `attachment; filename="${kind}-statistics.json"` } : {}),
      },
    });
  } catch (error) {
    return Response.json({ connected: false, error: error instanceof Error ? error.message : 'Statistics could not be loaded.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

type Query = {
  league: number | null; season: number | null; venue: string; recent: number; search: string;
  page: number; limit: number; sort: string; direction: string; download: boolean;
};

async function readPlayers(db: D1Database, query: Query) {
  const where: string[] = [COMPLETE];
  const binds: Array<string | number> = [];
  if (query.league !== null) { where.push('f.competition_id = ?'); binds.push(query.league); }
  if (query.season !== null) { where.push('f.season = ?'); binds.push(query.season); }
  if (query.venue === 'home') where.push('f.home_team_id = p.team_id');
  if (query.venue === 'away') where.push('f.away_team_id = p.team_id');
  if (query.search) { where.push('(p.player_name LIKE ? OR t.name LIKE ?)'); binds.push(`%${query.search}%`, `%${query.search}%`); }
  const recentWhere = query.recent ? `WHERE recency <= ${query.recent}` : '';
  const recency = query.recent
    ? 'ROW_NUMBER() OVER (PARTITION BY p.player_id, p.team_id, f.competition_id, f.season ORDER BY f.kickoff DESC)'
    : '0';
  const cte = `
    WITH ranked AS (
      SELECT p.*, f.competition_id, f.season, f.kickoff,
        CASE WHEN f.home_team_id = p.team_id THEN 'home' ELSE 'away' END AS venue_side,
        ${recency} AS recency
      FROM fixture_player_statistics p
      JOIN fixtures f ON f.id = p.fixture_id JOIN teams t ON t.id = p.team_id
      WHERE ${where.join(' AND ')}
    ), selected AS (SELECT * FROM ranked ${recentWhere}), totals AS (
      SELECT player_id AS id, MAX(player_name) AS name, team_id, MAX(t.name) AS team,
        s.competition_id, MAX(c.name) AS competition, s.season, MAX(position) AS position,
        COUNT(*) AS matches, SUM(minutes) AS minutes,
        SUM(goals) AS goals, SUM(assists) AS assists, SUM(shots_total) AS shots,
        SUM(shots_on) AS shots_on_target, SUM(fouls_committed) AS fouls_committed,
        SUM(fouls_drawn) AS fouls_drawn, SUM(yellow_cards) AS yellow_cards, SUM(red_cards) AS red_cards,
        SUM(venue_side = 'home') AS home_matches, SUM(venue_side = 'away') AS away_matches
      FROM selected s JOIN teams t ON t.id = s.team_id
      JOIN competitions c ON c.id = s.competition_id AND c.season = s.season
      GROUP BY player_id, team_id, s.competition_id, s.season
    )`;
  const count = await db.prepare(`${cte} SELECT COUNT(*) AS count FROM totals`).bind(...binds).first<{ count: number }>();
  const offset = query.download ? 0 : (query.page - 1) * query.limit;
  const rows = (await db.prepare(`${cte} SELECT * FROM totals ORDER BY ${query.sort} ${query.direction}, name ASC LIMIT ? OFFSET ?`).bind(...binds, query.limit, offset).all<Record<string, unknown>>()).results.map(playerRow);
  return page(rows, Number(count?.count ?? 0), query.page, query.limit);
}

async function readTeams(db: D1Database, query: Query) {
  const where: string[] = [COMPLETE];
  const binds: Array<string | number> = [];
  if (query.league !== null) { where.push('f.competition_id = ?'); binds.push(query.league); }
  if (query.season !== null) { where.push('f.season = ?'); binds.push(query.season); }
  if (query.venue === 'home') where.push('f.home_team_id = s.team_id');
  if (query.venue === 'away') where.push('f.away_team_id = s.team_id');
  if (query.search) { where.push('t.name LIKE ?'); binds.push(`%${query.search}%`); }
  const recentWhere = query.recent ? `WHERE recency <= ${query.recent}` : '';
  const recency = query.recent
    ? 'ROW_NUMBER() OVER (PARTITION BY s.team_id, f.competition_id, f.season ORDER BY f.kickoff DESC)'
    : '0';
  const cte = `
    WITH ranked AS (
      SELECT s.*, f.competition_id, f.season, f.kickoff,
        CASE WHEN f.home_team_id = s.team_id THEN 'home' ELSE 'away' END AS venue_side,
        CASE WHEN f.home_team_id = s.team_id THEN f.home_goals ELSE f.away_goals END AS goals,
        ${recency} AS recency
      FROM fixture_statistics s JOIN fixtures f ON f.id = s.fixture_id JOIN teams t ON t.id = s.team_id
      WHERE ${where.join(' AND ')}
    ), selected AS (SELECT * FROM ranked ${recentWhere}), totals AS (
      SELECT team_id AS id, MAX(t.name) AS name, s.competition_id, MAX(c.name) AS competition, s.season,
        COUNT(*) AS matches, SUM(goals) AS goals, SUM(shots_total) AS shots,
        SUM(shots_on) AS shots_on_target, SUM(fouls) AS fouls_committed,
        SUM(yellow_cards) AS yellow_cards, SUM(red_cards) AS red_cards,
        SUM(venue_side = 'home') AS home_matches, SUM(venue_side = 'away') AS away_matches
      FROM selected s JOIN teams t ON t.id = s.team_id
      JOIN competitions c ON c.id = s.competition_id AND c.season = s.season
      GROUP BY team_id, s.competition_id, s.season
    )`;
  const count = await db.prepare(`${cte} SELECT COUNT(*) AS count FROM totals`).bind(...binds).first<{ count: number }>();
  const offset = query.download ? 0 : (query.page - 1) * query.limit;
  const rows = (await db.prepare(`${cte} SELECT * FROM totals ORDER BY ${query.sort} ${query.direction}, name ASC LIMIT ? OFFSET ?`).bind(...binds, query.limit, offset).all<Record<string, unknown>>()).results.map(teamRow);
  return page(rows, Number(count?.count ?? 0), query.page, query.limit);
}

async function readMatches(db: D1Database, query: Pick<Query, 'league' | 'season' | 'venue' | 'recent'> & { kind: string; entityId: number; teamId: number | null }) {
  const isPlayer = query.kind === 'players';
  const statTable = isPlayer ? 'fixture_player_statistics p' : 'fixture_statistics p';
  const where = [COMPLETE, isPlayer ? 'p.player_id = ?' : 'p.team_id = ?'];
  const binds: Array<string | number> = [query.entityId];
  if (isPlayer && query.teamId !== null) { where.push('p.team_id = ?'); binds.push(query.teamId); }
  if (query.league !== null) { where.push('f.competition_id = ?'); binds.push(query.league); }
  if (query.season !== null) { where.push('f.season = ?'); binds.push(query.season); }
  if (query.venue === 'home') where.push('f.home_team_id = p.team_id');
  if (query.venue === 'away') where.push('f.away_team_id = p.team_id');
  const limit = query.recent || 50;
  const select = isPlayer
    ? 'p.player_name AS name, p.minutes, p.goals, p.assists, p.shots_total AS shots, p.shots_on AS shots_on_target, p.fouls_committed, p.fouls_drawn, p.yellow_cards, p.red_cards'
    : 't.name AS name, CASE WHEN f.home_team_id=p.team_id THEN f.home_goals ELSE f.away_goals END AS goals, p.shots_total AS shots, p.shots_on AS shots_on_target, p.fouls AS fouls_committed, p.yellow_cards, p.red_cards, NULL AS minutes, NULL AS assists, NULL AS fouls_drawn';
  const rows = (await db.prepare(`
    SELECT f.id AS fixture_id, f.kickoff, f.round, f.season, c.name AS competition,
      CASE WHEN f.home_team_id=p.team_id THEN 'Home' ELSE 'Away' END AS venue,
      CASE WHEN f.home_team_id=p.team_id THEN at.name ELSE ht.name END AS opponent,
      CASE WHEN f.home_team_id=p.team_id THEN f.home_goals ELSE f.away_goals END AS goals_for,
      CASE WHEN f.home_team_id=p.team_id THEN f.away_goals ELSE f.home_goals END AS goals_against,
      ${select}
    FROM ${statTable} JOIN fixtures f ON f.id=p.fixture_id JOIN teams t ON t.id=p.team_id
    JOIN teams ht ON ht.id=f.home_team_id JOIN teams at ON at.id=f.away_team_id
    JOIN competitions c ON c.id=f.competition_id AND c.season=f.season
    WHERE ${where.join(' AND ')} ORDER BY f.kickoff DESC LIMIT ?
  `).bind(...binds, limit).all<Record<string, unknown>>()).results;
  return Response.json({ connected: true, kind: query.kind, rows: rows.map(matchRow) }, { headers: { 'Cache-Control': 'no-store' } });
}

function playerRow(row: Record<string, unknown>) {
  const minutes = number(row.minutes);
  return {
    id: number(row.id), name: text(row.name), teamId: number(row.team_id), team: text(row.team),
    competitionId: number(row.competition_id), competition: text(row.competition), season: number(row.season), position: text(row.position),
    matches: number(row.matches), minutes, goals: nullable(row.goals), assists: nullable(row.assists), shots: nullable(row.shots),
    shotsOnTarget: nullable(row.shots_on_target), foulsCommitted: nullable(row.fouls_committed), foulsDrawn: nullable(row.fouls_drawn),
    yellowCards: nullable(row.yellow_cards), redCards: nullable(row.red_cards), homeMatches: number(row.home_matches), awayMatches: number(row.away_matches),
    per90: per90(row, minutes, ['goals', 'assists', 'shots', 'shots_on_target', 'fouls_committed', 'fouls_drawn', 'yellow_cards', 'red_cards']),
  };
}

function teamRow(row: Record<string, unknown>) {
  const matches = number(row.matches);
  return {
    id: number(row.id), name: text(row.name), competitionId: number(row.competition_id), competition: text(row.competition), season: number(row.season),
    matches, goals: nullable(row.goals), shots: nullable(row.shots), shotsOnTarget: nullable(row.shots_on_target),
    foulsCommitted: nullable(row.fouls_committed), yellowCards: nullable(row.yellow_cards), redCards: nullable(row.red_cards),
    homeMatches: number(row.home_matches), awayMatches: number(row.away_matches),
    perMatch: per90(row, matches, ['goals', 'shots', 'shots_on_target', 'fouls_committed', 'yellow_cards', 'red_cards'], 1),
  };
}

function matchRow(row: Record<string, unknown>) {
  return {
    fixtureId: number(row.fixture_id), kickoff: text(row.kickoff), round: text(row.round), competition: text(row.competition), season: number(row.season),
    name: text(row.name), venue: text(row.venue), opponent: text(row.opponent), score: `${number(row.goals_for)}–${number(row.goals_against)}`,
    minutes: nullable(row.minutes), goals: nullable(row.goals), assists: nullable(row.assists), shots: nullable(row.shots), shotsOnTarget: nullable(row.shots_on_target),
    foulsCommitted: nullable(row.fouls_committed), foulsDrawn: nullable(row.fouls_drawn), yellowCards: nullable(row.yellow_cards), redCards: nullable(row.red_cards),
  };
}

function per90(row: Record<string, unknown>, denominator: number, keys: string[], scale = 90) {
  return Object.fromEntries(keys.map((key) => [camel(key), denominator > 0 && row[key] !== null ? Number((number(row[key]) * scale / denominator).toFixed(2)) : null]));
}

function page<T extends Record<string, unknown>>(rows: T[], total: number, current: number, limit: number) {
  return { rows, pagination: { page: current, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } };
}

function csv(rows: Array<Record<string, unknown>>, filename: string) {
  const flattened = rows.map((row) => ({ ...row, ...asRecord(row.per90), ...asRecord(row.perMatch) }));
  const columns = flattened.length ? Object.keys(flattened[0]).filter((key) => !['per90', 'perMatch'].includes(key)) : [];
  const escape = (value: unknown) => `"${printable(value).replaceAll('"', '""')}"`;
  const body = [columns.join(','), ...flattened.map((row) => columns.map((column) => escape(row[column])).join(','))].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' } });
}

function optionalInteger(value: string | null) { const parsed = Number(value); return value !== null && Number.isInteger(parsed) ? parsed : null; }
function number(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function nullable(value: unknown) { return value === null || value === undefined ? null : number(value); }
function text(value: unknown) { return typeof value === 'string' ? value : value === null || value === undefined ? null : printable(value); }
function camel(value: string) { return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()); }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function printable(value: unknown) { return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : value === null || value === undefined ? '' : JSON.stringify(value); }

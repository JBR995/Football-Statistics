import { ensureFootballSchema } from '@/db/football';

const API_URL = 'https://v3.football.api-sports.io/fixtures';
const COMPETITIONS = new Map([
  [39, { name: 'Premier League', country: 'England' }], [40, { name: 'EFL Championship', country: 'England' }],
  [41, { name: 'EFL League One', country: 'England' }], [42, { name: 'EFL League Two', country: 'England' }],
  [61, { name: 'Ligue 1', country: 'France' }], [140, { name: 'La Liga', country: 'Spain' }],
  [78, { name: 'Bundesliga', country: 'Germany' }], [135, { name: 'Serie A', country: 'Italy' }],
  [88, { name: 'Eredivisie', country: 'Netherlands' }], [2, { name: 'UEFA Champions League', country: 'UEFA' }],
  [3, { name: 'UEFA Europa League', country: 'UEFA' }], [848, { name: 'UEFA Conference League', country: 'UEFA' }],
]);

type ApiFixture = {
  fixture: { id: number; date: string; status: { short: string }; venue: { name: string | null } };
  league: { id: number; name: string; logo: string | null; season: number; round: string | null };
  teams: { home: { id: number; name: string; logo: string | null }; away: { id: number; name: string; logo: string | null } };
  goals: { home: number | null; away: number | null };
};

type FixtureRow = {
  id: number; kickoff: string; status: string; round: string | null; venue: string | null;
  home_team_id: number; home_name: string; home_logo: string | null;
  away_team_id: number; away_name: string; away_logo: string | null;
  home_goals: number | null; away_goals: number | null;
};

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const leagueId = Number(params.get('league') ?? 39);
  const season = Number(params.get('season') ?? 2026);
  const competition = COMPETITIONS.get(leagueId);
  if (!competition || !Number.isInteger(season)) return Response.json({ error: 'Unsupported competition or season.' }, { status: 400 });

  try {
    const db = await ensureFootballSchema();
    const existing = await db.prepare('SELECT COUNT(*) AS count FROM fixtures WHERE competition_id = ? AND season = ?').bind(leagueId, season).first<{ count: number }>();
    let synced = false;
    if (!existing?.count) {
      await syncCompetition(db, leagueId, season, competition);
      synced = true;
    }

    const rows = (await db.prepare(`
      SELECT f.id, f.kickoff, f.status, f.round, f.venue, f.home_team_id, ht.name AS home_name, ht.logo AS home_logo,
             f.away_team_id, at.name AS away_name, at.logo AS away_logo, f.home_goals, f.away_goals
      FROM fixtures f JOIN teams ht ON ht.id = f.home_team_id JOIN teams at ON at.id = f.away_team_id
      WHERE f.competition_id = ? AND f.season = ? ORDER BY f.kickoff ASC
    `).bind(leagueId, season).all<FixtureRow>()).results;
    const lastSync = await db.prepare(`SELECT finished_at, records FROM sync_runs WHERE competition_id = ? AND season = ? AND status = 'complete' ORDER BY id DESC LIMIT 1`).bind(leagueId, season).first<{ finished_at: string; records: number }>();

    const completeStatuses = new Set(['FT', 'AET', 'PEN']);
    const upcomingStatuses = new Set(['NS', 'TBD']);
    const completed = rows.filter((row) => completeStatuses.has(row.status));
    const upcoming = rows.filter((row) => upcomingStatuses.has(row.status)).slice(0, 12);
    const recent = [...completed].sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff)).slice(0, 8);
    const table = buildTable(completed);
    const totalGoals = completed.reduce((sum, row) => sum + (row.home_goals ?? 0) + (row.away_goals ?? 0), 0);

    return Response.json({
      connected: true,
      synced,
      competition: { id: leagueId, name: competition.name, country: competition.country, season },
      summary: { records: rows.length, completed: completed.length, upcoming: rows.filter((row) => upcomingStatuses.has(row.status)).length, goals: totalGoals, averageGoals: completed.length ? Number((totalGoals / completed.length).toFixed(2)) : 0, teams: table.length },
      standings: table,
      upcoming: upcoming.map(toFixture),
      recent: recent.map(toFixture),
      lastSyncedAt: lastSync?.finished_at ?? null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The competition database could not be loaded.';
    return Response.json({ connected: false, error: message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

async function syncCompetition(db: D1Database, leagueId: number, season: number, competition: { name: string; country: string }) {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) throw new Error('The football data source is not configured.');
  const startedAt = new Date().toISOString();
  const url = new URL(API_URL);
  url.searchParams.set('league', String(leagueId));
  url.searchParams.set('season', String(season));
  url.searchParams.set('timezone', 'Europe/London');
  const response = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
  if (!response.ok) throw new Error(`The data provider returned ${response.status}.`);
  const payload = await response.json() as { errors: Record<string, string> | string[]; response: ApiFixture[] };
  const errors = Array.isArray(payload.errors) ? payload.errors : Object.values(payload.errors ?? {});
  if (errors.length) throw new Error(errors[0]);
  if (!Array.isArray(payload.response) || !payload.response.length) throw new Error('The provider returned no season records.');

  const updatedAt = new Date().toISOString();
  const teams = new Map<number, { id: number; name: string; logo: string | null }>();
  for (const item of payload.response) {
    teams.set(item.teams.home.id, item.teams.home);
    teams.set(item.teams.away.id, item.teams.away);
  }
  const statements = [
    db.prepare(`INSERT INTO competitions (id, season, name, country, logo, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id, season) DO UPDATE SET name=excluded.name, country=excluded.country, logo=excluded.logo, updated_at=excluded.updated_at`).bind(leagueId, season, competition.name, competition.country, payload.response[0].league.logo, updatedAt),
    ...Array.from(teams.values()).map((team) => db.prepare(`INSERT INTO teams (id, name, logo, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, logo=excluded.logo, updated_at=excluded.updated_at`).bind(team.id, team.name, team.logo, updatedAt)),
    ...payload.response.map((item) => db.prepare(`INSERT INTO fixtures (id, competition_id, season, round, kickoff, status, venue, home_team_id, away_team_id, home_goals, away_goals, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET round=excluded.round, kickoff=excluded.kickoff, status=excluded.status, venue=excluded.venue, home_goals=excluded.home_goals, away_goals=excluded.away_goals, updated_at=excluded.updated_at`).bind(item.fixture.id, leagueId, season, item.league.round, item.fixture.date, item.fixture.status.short, item.fixture.venue.name, item.teams.home.id, item.teams.away.id, item.goals.home, item.goals.away, updatedAt)),
  ];
  for (let index = 0; index < statements.length; index += 75) await db.batch(statements.slice(index, index + 75));
  await db.prepare(`INSERT INTO sync_runs (competition_id, season, status, records, started_at, finished_at) VALUES (?, ?, 'complete', ?, ?, ?)`).bind(leagueId, season, payload.response.length, startedAt, updatedAt).run();
  await db.prepare('PRAGMA optimize').run();
}

function buildTable(rows: FixtureRow[]) {
  const teams = new Map<number, { id: number; name: string; logo: string | null; played: number; won: number; drawn: number; lost: number; gf: number; ga: number; points: number }>();
  const get = (id: number, name: string, logo: string | null) => {
    if (!teams.has(id)) teams.set(id, { id, name, logo, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 });
    return teams.get(id)!;
  };
  for (const row of rows) {
    const home = get(row.home_team_id, row.home_name, row.home_logo), away = get(row.away_team_id, row.away_name, row.away_logo);
    const hg = row.home_goals ?? 0, ag = row.away_goals ?? 0;
    home.played++; away.played++; home.gf += hg; home.ga += ag; away.gf += ag; away.ga += hg;
    if (hg > ag) { home.won++; home.points += 3; away.lost++; }
    else if (ag > hg) { away.won++; away.points += 3; home.lost++; }
    else { home.drawn++; away.drawn++; home.points++; away.points++; }
  }
  return Array.from(teams.values()).map((team) => ({ ...team, gd: team.gf - team.ga })).sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name)).map((team, index) => ({ position: index + 1, ...team }));
}

function toFixture(row: FixtureRow) {
  return { id: row.id, kickoff: row.kickoff, status: row.status, round: row.round, venue: row.venue, home: { id: row.home_team_id, name: row.home_name, logo: row.home_logo }, away: { id: row.away_team_id, name: row.away_name, logo: row.away_logo }, score: { home: row.home_goals, away: row.away_goals } };
}

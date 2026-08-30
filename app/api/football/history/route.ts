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
  league: { logo: string | null; round: string | null };
  teams: { home: ApiTeam; away: ApiTeam };
  goals: { home: number | null; away: number | null };
};
type ApiTeam = { id: number; name: string; logo: string | null };

export async function POST(request: Request) {
  try {
    const body = await request.json() as { league?: number; seasons?: number[] };
    const leagueId = Number(body.league);
    const competition = COMPETITIONS.get(leagueId);
    const seasons = Array.from(new Set(body.seasons ?? [])).filter((season) => Number.isInteger(season) && season >= 2010 && season <= new Date().getUTCFullYear()).sort((a, b) => a - b);
    if (!competition || !seasons.length || seasons.length > 5) {
      return Response.json({ connected: false, error: 'Choose a supported competition and between one and five valid seasons.' }, { status: 400 });
    }

    const db = await ensureFootballSchema();
    const results: Array<{ season: number; records: number; status: 'imported' | 'already-stored' }> = [];
    for (const season of seasons) {
      const existing = await db.prepare('SELECT COUNT(*) AS count FROM fixtures WHERE competition_id = ? AND season = ?').bind(leagueId, season).first<{ count: number }>();
      if (existing?.count) {
        results.push({ season, records: existing.count, status: 'already-stored' });
        continue;
      }
      const records = await importSeason(db, leagueId, season, competition);
      results.push({ season, records, status: 'imported' });
    }

    return Response.json({
      connected: true,
      competition: { id: leagueId, ...competition },
      seasons: results,
      records: results.reduce((sum, result) => sum + result.records, 0),
      imported: results.filter((result) => result.status === 'imported').length,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Historical data could not be imported.';
    return Response.json({ connected: false, error: message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

async function importSeason(db: D1Database, leagueId: number, season: number, competition: { name: string; country: string }) {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) throw new Error('The football data source is not configured.');
  const startedAt = new Date().toISOString();
  const url = new URL(API_URL);
  url.searchParams.set('league', String(leagueId));
  url.searchParams.set('season', String(season));
  url.searchParams.set('timezone', 'Europe/London');
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { 'x-apisports-key': apiKey, 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  });
  if (!response.ok) throw new Error(`The provider returned ${response.status} for season ${season}.`);
  const payload = await response.json() as { errors: Record<string, string> | string[]; response: ApiFixture[] };
  const errors = Array.isArray(payload.errors) ? payload.errors : Object.values(payload.errors ?? {});
  if (errors.length) throw new Error(`Season ${season}: ${errors[0]}`);
  if (!payload.response?.length) throw new Error(`No records were returned for season ${season}.`);

  const updatedAt = new Date().toISOString();
  const teams = new Map<number, ApiTeam>();
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
  return payload.response.length;
}

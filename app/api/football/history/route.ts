import { ensureFootballSchema } from '@/db/football';
import { isSupportedSeason, readSeasonState, recordFailedSeason, storeSeason, type SeasonFixture } from '@/db/history';
import { getCompetition, type Competition } from '@/lib/competitions';

const API_URL = 'https://v3.football.api-sports.io/fixtures';

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
    const competition = getCompetition(leagueId);
    const seasons = Array.from(new Set(body.seasons ?? [])).filter(isSupportedSeason).sort((a, b) => a - b);
    if (!competition || !seasons.length || seasons.length > 5) {
      return Response.json({ connected: false, error: 'Choose a supported competition and between one and five valid seasons.' }, { status: 400 });
    }

    const db = await ensureFootballSchema();
    const results: Array<{ season: number; records: number; status: 'imported' | 'already-stored' }> = [];
    for (const season of seasons) {
      const state = await readSeasonState(db, leagueId, season);
      if (state.complete) {
        results.push({ season, records: state.records, status: 'already-stored' });
        continue;
      }
      const records = await importSeason(db, leagueId, season, competition);
      results.push({ season, records, status: 'imported' });
    }

    return Response.json({
      connected: true,
      competition: { id: leagueId, name: competition.name, country: competition.country },
      seasons: results,
      records: results.reduce((sum, result) => sum + result.records, 0),
      imported: results.filter((result) => result.status === 'imported').length,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Historical data could not be imported.';
    return Response.json({ connected: false, error: message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

async function importSeason(db: D1Database, leagueId: number, season: number, competition: Competition) {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) throw new Error('The football data source is not configured.');
  const startedAt = new Date().toISOString();
  try {
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

    return await storeSeason(db, {
      competitionId: leagueId,
      season,
      competition,
      competitionLogo: payload.response[0].league.logo,
      fixtures: payload.response.map(toSeasonFixture),
      startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Historical data could not be imported.';
    await recordFailedSeason(db, leagueId, season, message, startedAt);
    throw error;
  }
}

function toSeasonFixture(item: ApiFixture): SeasonFixture {
  return {
    id: item.fixture.id,
    kickoff: item.fixture.date,
    status: item.fixture.status.short,
    round: item.league.round,
    venue: item.fixture.venue.name,
    homeTeamId: item.teams.home.id,
    homeTeamName: item.teams.home.name,
    homeTeamLogo: item.teams.home.logo,
    awayTeamId: item.teams.away.id,
    awayTeamName: item.teams.away.name,
    awayTeamLogo: item.teams.away.logo,
    homeGoals: item.goals.home,
    awayGoals: item.goals.away,
  };
}

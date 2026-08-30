import { getCompetition } from '@/lib/competitions';

const API_URL = 'https://v3.football.api-sports.io/fixtures';
const CACHE_SECONDS = 43_200;
const RESTRICTION_CACHE_SECONDS = 300;

const PREMIER_LEAGUE_SNAPSHOT = [
  { id: 1557379, kickoff: '2026-08-30T14:00:00+01:00', timezone: 'Europe/London', status: { long: 'Not Started', short: 'NS' }, venue: { name: 'Stamford Bridge', city: 'London' }, league: { id: 39, name: 'Premier League', logo: 'https://media.api-sports.io/football/leagues/39.png', season: 2026, round: 'Regular Season - 2' }, home: { id: 49, name: 'Chelsea', logo: 'https://media.api-sports.io/football/teams/49.png' }, away: { id: 51, name: 'Brighton', logo: 'https://media.api-sports.io/football/teams/51.png' } },
  { id: 1557382, kickoff: '2026-08-30T14:00:00+01:00', timezone: 'Europe/London', status: { long: 'Not Started', short: 'NS' }, venue: { name: 'Elland Road', city: 'Leeds' }, league: { id: 39, name: 'Premier League', logo: 'https://media.api-sports.io/football/leagues/39.png', season: 2026, round: 'Regular Season - 2' }, home: { id: 63, name: 'Leeds', logo: 'https://media.api-sports.io/football/teams/63.png' }, away: { id: 55, name: 'Brentford', logo: 'https://media.api-sports.io/football/teams/55.png' } },
  { id: 1557385, kickoff: '2026-08-30T14:00:00+01:00', timezone: 'Europe/London', status: { long: 'Not Started', short: 'NS' }, venue: { name: 'Stadium of Light', city: 'Sunderland' }, league: { id: 39, name: 'Premier League', logo: 'https://media.api-sports.io/football/leagues/39.png', season: 2026, round: 'Regular Season - 2' }, home: { id: 746, name: 'Sunderland', logo: 'https://media.api-sports.io/football/teams/746.png' }, away: { id: 36, name: 'Fulham', logo: 'https://media.api-sports.io/football/teams/36.png' } },
  { id: 1557384, kickoff: '2026-08-30T16:30:00+01:00', timezone: 'Europe/London', status: { long: 'Not Started', short: 'NS' }, venue: { name: 'Old Trafford', city: 'Manchester' }, league: { id: 39, name: 'Premier League', logo: 'https://media.api-sports.io/football/leagues/39.png', season: 2026, round: 'Regular Season - 2' }, home: { id: 33, name: 'Manchester United', logo: 'https://media.api-sports.io/football/teams/33.png' }, away: { id: 57, name: 'Ipswich', logo: 'https://media.api-sports.io/football/teams/57.png' } },
  { id: 1557377, kickoff: '2026-08-31T20:00:00+01:00', timezone: 'Europe/London', status: { long: 'Not Started', short: 'NS' }, venue: { name: 'Villa Park', city: 'Birmingham' }, league: { id: 39, name: 'Premier League', logo: 'https://media.api-sports.io/football/leagues/39.png', season: 2026, round: 'Regular Season - 2' }, home: { id: 66, name: 'Aston Villa', logo: 'https://media.api-sports.io/football/teams/66.png' }, away: { id: 42, name: 'Arsenal', logo: 'https://media.api-sports.io/football/teams/42.png' } },
  { id: 1557393, kickoff: '2026-09-04T20:00:00+01:00', timezone: 'Europe/London', status: { long: 'Not Started', short: 'NS' }, venue: { name: 'Portman Road', city: 'Ipswich' }, league: { id: 39, name: 'Premier League', logo: 'https://media.api-sports.io/football/leagues/39.png', season: 2026, round: 'Regular Season - 3' }, home: { id: 57, name: 'Ipswich', logo: 'https://media.api-sports.io/football/teams/57.png' }, away: { id: 40, name: 'Liverpool', logo: 'https://media.api-sports.io/football/teams/40.png' } },
];

type ApiFixture = {
  fixture: {
    id: number;
    date: string;
    timezone: string;
    status: { long: string; short: string };
    venue: { name: string | null; city: string | null };
  };
  league: { id: number; name: string; logo: string | null; season: number; round: string | null };
  teams: {
    home: { id: number; name: string; logo: string | null };
    away: { id: number; name: string; logo: string | null };
  };
};

type ApiResponse = {
  errors: Record<string, string> | string[];
  response: ApiFixture[];
};

const memoryCache = new Map<string, { expiresAt: number; body: string; status: number; cacheSeconds: number }>();

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const leagueId = Number(searchParams.get('league') ?? 39);
  const competitionName = getCompetition(leagueId)?.name;
  if (!competitionName) {
    return Response.json({ connected: false, error: 'That competition is not enabled.' }, { status: 400 });
  }

  const today = new Date();
  const fallbackSeason = today.getUTCMonth() >= 6 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  const requestedSeason = Number(searchParams.get('season'));
  const season = Number.isInteger(requestedSeason) && requestedSeason >= 2000 && requestedSeason <= 2100 ? requestedSeason : fallbackSeason;
  const cacheKey = `${leagueId}:${season}:schedule`;
  const now = Date.now();
  const cached = memoryCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return jsonResponse(cached.body, cached.status, 'memory', cached.cacheSeconds);

  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) {
    return Response.json({ connected: false, error: 'The football data source is not configured.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const url = new URL(API_URL);
  url.searchParams.set('league', String(leagueId));
  url.searchParams.set('season', String(season));
  url.searchParams.set('timezone', 'Europe/London');

  try {
    const upstream = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
    if (!upstream.ok) {
      return Response.json({ connected: false, error: `The statistics service returned ${upstream.status}.` }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }

    const payload = (await upstream.json()) as ApiResponse;
    const messages = Array.isArray(payload.errors) ? payload.errors : Object.values(payload.errors ?? {});
    const planMessage = messages.find((message) => /plan|season/i.test(message));
    if (planMessage) {
      const body = JSON.stringify({
        connected: true,
        restricted: true,
        provider: 'API-Football',
        competition: { id: leagueId, name: competitionName, season },
        fixtures: [],
        error: 'Current-season fixtures are unavailable on this API plan. The provider reports access is limited to seasons 2022–2024.',
      });
      memoryCache.set(cacheKey, { expiresAt: now + RESTRICTION_CACHE_SECONDS * 1000, body, status: 200, cacheSeconds: RESTRICTION_CACHE_SECONDS });
      return jsonResponse(body, 200, 'upstream', RESTRICTION_CACHE_SECONDS);
    }

    if (!Array.isArray(payload.response)) {
      return Response.json({ connected: false, error: 'The statistics service returned an unexpected response.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }

    const liveFixtures = payload.response
      .filter((item) => item.fixture.status.short === 'NS' || item.fixture.status.short === 'TBD')
      .sort((a, b) => Date.parse(a.fixture.date) - Date.parse(b.fixture.date))
      .slice(0, 12)
      .map((item) => ({
      id: item.fixture.id,
      kickoff: item.fixture.date,
      timezone: item.fixture.timezone,
      status: item.fixture.status,
      venue: item.fixture.venue,
      league: item.league,
      home: item.teams.home,
      away: item.teams.away,
      }));
    const snapshot = liveFixtures.length === 0 && leagueId === 39 && season === 2026;
    const fixtures = snapshot ? PREMIER_LEAGUE_SNAPSHOT : liveFixtures;
    const body = JSON.stringify({ connected: true, restricted: false, snapshot, provider: 'API-Football', checkedAt: snapshot ? '2026-08-30T00:00:00+01:00' : new Date().toISOString(), competition: { id: leagueId, name: competitionName, season }, fixtures });
    memoryCache.set(cacheKey, { expiresAt: now + CACHE_SECONDS * 1000, body, status: 200, cacheSeconds: CACHE_SECONDS });
    return jsonResponse(body, 200, 'upstream');
  } catch {
    return Response.json({ connected: false, error: 'The statistics service could not be reached.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

function jsonResponse(body: string, status: number, source: 'memory' | 'upstream', cacheSeconds = CACHE_SECONDS) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds}`,
      'X-ElevenLab-Cache': source,
    },
  });
}

const API_URL = 'https://v3.football.api-sports.io/fixtures';
const CACHE_SECONDS = 43_200;
const RESTRICTION_CACHE_SECONDS = 300;

const COMPETITIONS = new Map([
  [39, 'Premier League'],
  [40, 'EFL Championship'],
  [41, 'EFL League One'],
  [42, 'EFL League Two'],
  [61, 'Ligue 1'],
  [140, 'La Liga'],
  [78, 'Bundesliga'],
  [135, 'Serie A'],
  [88, 'Eredivisie'],
  [2, 'UEFA Champions League'],
  [3, 'UEFA Europa League'],
  [848, 'UEFA Conference League'],
]);

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
  const competitionName = COMPETITIONS.get(leagueId);
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

    const fixtures = payload.response
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
    const body = JSON.stringify({ connected: true, restricted: false, provider: 'API-Football', checkedAt: new Date().toISOString(), competition: { id: leagueId, name: competitionName, season }, fixtures });
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

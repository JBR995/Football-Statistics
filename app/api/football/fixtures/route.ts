const API_URL = 'https://v3.football.api-sports.io/fixtures';
const CACHE_SECONDS = 43_200;

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

const memoryCache = new Map<number, { expiresAt: number; body: string; status: number }>();

export async function GET(request: Request) {
  const leagueId = Number(new URL(request.url).searchParams.get('league') ?? 39);
  const competitionName = COMPETITIONS.get(leagueId);
  if (!competitionName) {
    return Response.json({ connected: false, error: 'That competition is not enabled.' }, { status: 400 });
  }

  const now = Date.now();
  const cached = memoryCache.get(leagueId);
  if (cached && cached.expiresAt > now) return jsonResponse(cached.body, cached.status, 'memory');

  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) {
    return Response.json({ connected: false, error: 'The football data source is not configured.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const today = new Date();
  const season = today.getUTCMonth() >= 6 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  const url = new URL(API_URL);
  url.searchParams.set('league', String(leagueId));
  url.searchParams.set('season', String(season));
  url.searchParams.set('next', '12');
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
      memoryCache.set(leagueId, { expiresAt: now + CACHE_SECONDS * 1000, body, status: 200 });
      return jsonResponse(body, 200, 'upstream');
    }

    if (!Array.isArray(payload.response)) {
      return Response.json({ connected: false, error: 'The statistics service returned an unexpected response.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }

    const fixtures = payload.response.map((item) => ({
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
    memoryCache.set(leagueId, { expiresAt: now + CACHE_SECONDS * 1000, body, status: 200 });
    return jsonResponse(body, 200, 'upstream');
  } catch {
    return Response.json({ connected: false, error: 'The statistics service could not be reached.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

function jsonResponse(body: string, status: number, source: 'memory' | 'upstream') {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=86400`,
      'X-ElevenLab-Cache': source,
    },
  });
}

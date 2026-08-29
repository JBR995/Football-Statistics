const API_URL = 'https://v3.football.api-sports.io/leagues?current=true';
const CACHE_SECONDS = 21_600;

const REQUESTED_COMPETITIONS = [
  { id: 39, displayName: 'Premier League', group: 'England' },
  { id: 40, displayName: 'EFL Championship', group: 'England' },
  { id: 41, displayName: 'EFL League One', group: 'England' },
  { id: 42, displayName: 'EFL League Two', group: 'England' },
  { id: 61, displayName: 'Ligue 1', group: 'France' },
  { id: 140, displayName: 'La Liga', group: 'Spain' },
  { id: 78, displayName: 'Bundesliga', group: 'Germany' },
  { id: 135, displayName: 'Serie A', group: 'Italy' },
  { id: 88, displayName: 'Eredivisie', group: 'Netherlands' },
  { id: 2, displayName: 'UEFA Champions League', group: 'UEFA' },
  { id: 3, displayName: 'UEFA Europa League', group: 'UEFA' },
  { id: 848, displayName: 'UEFA Conference League', group: 'UEFA' },
] as const;

type ApiSeason = {
  year: number;
  current: boolean;
  coverage: {
    fixtures: {
      events: boolean;
      lineups: boolean;
      statistics_fixtures: boolean;
      statistics_players: boolean;
    };
    injuries: boolean;
    predictions: boolean;
  };
};

type ApiLeague = {
  league: { id: number; name: string; logo: string | null };
  country: { name: string };
  seasons: ApiSeason[];
};

type ApiResponse = {
  errors: Record<string, string> | string[];
  response: ApiLeague[];
};

let memoryCache: { expiresAt: number; body: string } | null = null;

export async function GET() {
  const now = Date.now();
  if (memoryCache && memoryCache.expiresAt > now) {
    return jsonResponse(memoryCache.body, 'memory');
  }

  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) {
    return Response.json(
      { connected: false, error: 'API_FOOTBALL_KEY is not configured.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const upstream = await fetch(API_URL, {
      headers: { 'x-apisports-key': apiKey },
    });

    if (!upstream.ok) {
      return Response.json(
        { connected: false, error: `The statistics service returned ${upstream.status}.` },
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const payload = (await upstream.json()) as ApiResponse;
    if (!Array.isArray(payload.response)) {
      return Response.json(
        { connected: false, error: 'The statistics service returned an unexpected response.' },
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const byId = new Map(payload.response.map((entry) => [entry.league.id, entry]));
    const competitions = REQUESTED_COMPETITIONS.map((requested) => {
      const entry = byId.get(requested.id);
      const season = entry?.seasons.find((candidate) => candidate.current);
      return {
        id: requested.id,
        name: requested.displayName,
        group: requested.group,
        providerName: entry?.league.name ?? null,
        logo: entry?.league.logo ?? null,
        season: season?.year ?? null,
        available: Boolean(entry && season),
        coverage: {
          liveEvents: Boolean(season?.coverage.fixtures.events),
          fixtureStatistics: Boolean(season?.coverage.fixtures.statistics_fixtures),
          playerStatistics: Boolean(season?.coverage.fixtures.statistics_players),
          lineups: Boolean(season?.coverage.fixtures.lineups),
          predictions: Boolean(season?.coverage.predictions),
          injuries: Boolean(season?.coverage.injuries),
        },
      };
    });

    const body = JSON.stringify({
      connected: true,
      provider: 'API-Football',
      checkedAt: new Date().toISOString(),
      competitions,
      summary: {
        requested: REQUESTED_COMPETITIONS.length,
        available: competitions.filter((item) => item.available).length,
        liveEvents: competitions.filter((item) => item.coverage.liveEvents).length,
        fixtureStatistics: competitions.filter((item) => item.coverage.fixtureStatistics).length,
        playerStatistics: competitions.filter((item) => item.coverage.playerStatistics).length,
        injuries: competitions.filter((item) => item.coverage.injuries).length,
      },
    });

    memoryCache = { expiresAt: now + CACHE_SECONDS * 1000, body };
    return jsonResponse(body, 'upstream');
  } catch {
    return Response.json(
      { connected: false, error: 'The statistics service could not be reached.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

function jsonResponse(body: string, source: 'memory' | 'upstream') {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=43200`,
      'X-ElevenLab-Cache': source,
    },
  });
}

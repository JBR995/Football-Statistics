const API_ROOT = 'https://v3.football.api-sports.io/';
const ALLOWED_ENDPOINTS = new Set([
  'leagues', 'fixtures', 'fixtures/events', 'fixtures/lineups', 'fixtures/statistics', 'fixtures/players',
  'standings', 'teams', 'teams/statistics', 'players', 'players/squads', 'players/topscorers',
  'players/topassists', 'players/topyellowcards', 'players/topredcards', 'injuries', 'trophies',
]);
const ALLOWED_PARAMETERS = new Set([
  'id', 'ids', 'league', 'season', 'team', 'player', 'fixture', 'date', 'from', 'to', 'live', 'next', 'last',
  'round', 'status', 'venue', 'timezone', 'search', 'page', 'type', 'country', 'code', 'current', 'coach',
]);

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const endpoint = requestUrl.pathname.split('/api/football/widget/')[1]?.replace(/^\/+|\/+$/g, '');
  if (!endpoint || !ALLOWED_ENDPOINTS.has(endpoint)) {
    return Response.json({ errors: { endpoint: 'Unsupported widget endpoint.' }, results: 0, response: [] }, { status: 400 });
  }
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) return Response.json({ errors: { key: 'The football data source is not configured.' }, results: 0, response: [] }, { status: 503 });

  const providerUrl = new URL(endpoint, API_ROOT);
  for (const [key, value] of requestUrl.searchParams) if (ALLOWED_PARAMETERS.has(key)) providerUrl.searchParams.append(key, value);
  try {
    const response = await fetch(providerUrl, { headers: { 'x-apisports-key': apiKey } });
    const payload = await response.text();
    return new Response(payload, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
        'Cache-Control': endpoint === 'fixtures' && requestUrl.searchParams.has('live') ? 'public, s-maxage=15' : 'public, s-maxage=300, stale-while-revalidate=900',
      },
    });
  } catch {
    return Response.json({ errors: { network: 'The widget data source could not be reached.' }, results: 0, response: [] }, { status: 502 });
  }
}

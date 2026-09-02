#!/usr/bin/env node
// A stand-in for API-Football, in the response shapes the importers parse.
//
// It exists because the ingestion routes cannot otherwise be exercised without
// spending provider allowance, and because some environments cannot reach
// api-sports.io at all. Point an importer at it with --provider:
//
//   node scripts/dev/mock-provider.mjs &
//   node scripts/import-history.mjs --site http://localhost:8787 --token dev \
//     --provider http://localhost:8899 --leagues 39 --seasons 2025
//
// Kickoffs are generated relative to now rather than to the season asked for,
// so a single import produces both completed matches and upcoming ones — which
// is what the forecast-snapshot path needs. The scores are deterministic:
// team strength drives them, so a model fitted on this data finds real signal
// rather than noise, and two runs produce identical numbers.

import { createServer } from 'node:http';

const TEAMS = 20;
const DAY = 86_400_000;
const SIZES = new Map([[39, 380], [40, 552], [41, 552], [42, 552], [2, 125]]);

// Fixtures the provider should claim to have no data for, so the importers'
// empty-response handling can be exercised: MOCK_EMPTY=123,456
const EMPTY = new Set((process.env.MOCK_EMPTY ?? '').split(',').filter(Boolean));

export function createMockProvider(port = 8899) {
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const send = (payload) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(payload));
    };

    if (!request.headers['x-apisports-key']) {
      return send({ errors: { token: 'Invalid API key.' }, response: [] });
    }

    const fixture = Number(url.searchParams.get('fixture'));
    if (url.pathname !== '/fixtures' && EMPTY.has(String(fixture))) {
      return send({ errors: [], response: [] });
    }

    switch (url.pathname) {
      case '/fixtures':
        return send({ errors: [], response: season(Number(url.searchParams.get('league')), Number(url.searchParams.get('season'))) });
      case '/fixtures/statistics':
        return send({ errors: [], response: statistics(fixture) });
      case '/fixtures/players':
        return send({ errors: [], response: playerStatistics(fixture) });
      case '/fixtures/lineups':
        return send({ errors: [], response: lineups(fixture) });
      case '/injuries':
        return send({ errors: [], response: injuries(fixture) });
      case '/odds':
        return send({ errors: [], response: odds(fixture) });
      default:
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end('{"errors":["unknown endpoint"],"response":[]}');
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

function injuries(fixture) {
  if (fixture % 3) return [];
  const league = Math.floor(fixture / 10_000_000);
  return [{
    team: { id: teamId(league, fixture % TEAMS), name: `Team ${league}-${fixture % TEAMS}` },
    player: { id: fixture % 100_000, name: `Player ${fixture % 97}`, type: 'Missing Fixture', reason: 'Mock knock' },
  }];
}

function season(league, year) {
  const count = SIZES.get(league) ?? 300;
  const now = Date.now();
  // Four fifths of the season already played, the rest still to come.
  const played = Math.floor(count * 0.8);
  return Array.from({ length: count }, (_, index) => {
    const id = fixtureId(league, year, index);
    const home = index % TEAMS;
    const away = (index * 7 + 3) % TEAMS === home ? ((index * 7 + 4) % TEAMS) : ((index * 7 + 3) % TEAMS);
    const isPlayed = index < played;
    const kickoff = new Date(now + (isPlayed ? -(played - index) * DAY / 4 : (index - played) * DAY / 2 + DAY)).toISOString();
    return {
      fixture: { id, date: kickoff, status: { short: isPlayed ? 'FT' : 'NS' }, venue: { name: index % 7 ? `Ground ${home}` : null } },
      league: { id: league, season: year, logo: `https://media.api-sports.io/football/leagues/${league}.png`, round: `Regular Season - ${(index % 38) + 1}` },
      teams: {
        home: { id: teamId(league, home), name: `Team ${league}-${home}`, logo: null },
        away: { id: teamId(league, away), name: `Team ${league}-${away}`, logo: null },
      },
      goals: isPlayed ? goals(id, home, away) : { home: null, away: null },
    };
  });
}

// Deterministic per fixture: the same id always yields the same match.
function goals(id, home, away) {
  const rate = (attack, defence) => 1.35 * strength(attack) / strength(defence);
  return {
    home: poisson(id * 3, rate(home, away)),
    away: poisson(id * 5, rate(away, home) * 0.78),
  };
}

function strength(team) { return 0.7 + 0.9 * (team / (TEAMS - 1)); }
function teamId(league, team) { return league * 100 + team; }
function fixtureId(league, year, index) { return league * 10_000_000 + year * 1000 + index; }

function poisson(seed, lambda) {
  const limit = Math.exp(-lambda);
  let product = 1;
  let count = 0;
  let state = seed;
  do {
    count++;
    state = (state * 1103515245 + 12345) % 2147483648;
    product *= state / 2147483648;
  } while (product > limit && count < 12);
  return count - 1;
}

function statistics(fixture) {
  return teamsOf(fixture).map((id, side) => ({
    team: { id, name: `Team ${id}`, logo: null },
    statistics: [
      { type: 'Shots on Goal', value: 4 + side },
      { type: 'Shots off Goal', value: 6 },
      { type: 'Total Shots', value: 14 + side },
      { type: 'Blocked Shots', value: 3 },
      { type: 'Shots insidebox', value: 9 },
      { type: 'Shots outsidebox', value: 5 },
      { type: 'Fouls', value: 11 },
      { type: 'Corner Kicks', value: 6 - side },
      { type: 'Offsides', value: null },
      { type: 'Ball Possession', value: side ? '46%' : '54%' },
      { type: 'Yellow Cards', value: 2 },
      { type: 'Red Cards', value: null },
      { type: 'Goalkeeper Saves', value: 3 },
      { type: 'Total passes', value: 480 - side * 60 },
      { type: 'Passes accurate', value: 410 - side * 60 },
      { type: 'Passes %', value: '85%' },
      { type: 'expected_goals', value: side ? '0.94' : '1.62' },
    ],
  }));
}

function lineups(fixture) {
  return teamsOf(fixture).map((id) => ({
    team: { id, name: `Team ${id}` },
    formation: '4-3-3',
    coach: { id: 1, name: `Coach ${id}` },
    startXI: Array.from({ length: 11 }, (_, index) => ({
      player: { id: id * 100 + index, name: `Player ${id}-${index}`, number: index + 1, pos: ['G', 'D', 'M', 'F'][Math.min(3, Math.floor(index / 3))], grid: `${Math.floor(index / 3) + 1}:${(index % 3) + 1}` },
    })),
    substitutes: Array.from({ length: 7 }, (_, index) => ({
      player: { id: id * 100 + 50 + index, name: `Sub ${id}-${index}`, number: 12 + index, pos: 'M', grid: null },
    })),
  }));
}

function playerStatistics(fixture) {
  return teamsOf(fixture).map((id, side) => ({
    team: { id, name: `Team ${id}` },
    players: Array.from({ length: 14 }, (_, index) => ({
      player: { id: id * 100 + index, name: `Player ${id}-${index}` },
      statistics: [{
        games: { minutes: index < 11 ? 90 - (index % 3) * 5 : 15, position: ['G', 'D', 'M', 'F'][Math.min(3, Math.floor(index / 3))], rating: (6.1 + ((fixture + index) % 18) / 10).toFixed(1), captain: index === 1, substitute: index >= 11 },
        offsides: index > 8 ? index % 2 : null,
        shots: { total: index > 6 ? (index + side) % 4 : 0, on: index > 6 ? (index + fixture) % 3 : 0 },
        goals: { total: index === 9 ? 1 : 0, conceded: index === 0 ? 1 + side : 0, assists: index === 8 ? 1 : 0, saves: index === 0 ? 3 + side : 0 },
        passes: { total: 90 + index * 5, key: index > 5 ? index % 3 : 0, accuracy: 72 + index * 3 },
        tackles: { total: index < 9 ? index % 4 : 0, blocks: index < 5 ? index % 2 : 0, interceptions: index < 8 ? index % 3 : 0 },
        duels: { total: 3 + index % 7, won: 2 + index % 4 },
        dribbles: { attempts: index > 5 ? index % 4 : 0, success: index > 5 ? index % 3 : 0, past: index < 9 ? index % 2 : 0 },
        fouls: { drawn: index % 3, committed: (index + side) % 3 },
        cards: { yellow: index === 4 || index === 8 ? 1 : 0, red: index === 13 && fixture % 17 === 0 ? 1 : null },
        penalty: { won: 0, commited: 0, scored: 0, missed: 0, saved: 0 },
      }],
    })),
  }));
}

function odds(fixture) {
  return [{
    fixture: { id: fixture },
    bookmakers: [
      { id: 8, name: 'Bet365', bets: [
        { id: 1, name: 'Match Winner', values: [{ value: 'Home', odd: '1.95' }, { value: 'Draw', odd: '3.60' }, { value: 'Away', odd: '4.20' }] },
        { id: 5, name: 'Goals Over/Under', values: [{ value: 'Over 2.5', odd: '1.90' }, { value: 'Under 2.5', odd: '1.95' }, { value: 'Over 1.5', odd: '1.25' }] },
        { id: 8, name: 'Both Teams Score', values: [{ value: 'Yes', odd: '1.80' }, { value: 'No', odd: '2.00' }] },
      ] },
      { id: 6, name: 'Bwin', bets: [
        { id: 1, name: 'Match Winner', values: [{ value: 'Home', odd: '1.90' }, { value: 'Draw', odd: '3.70' }, { value: 'Away', odd: '4.33' }] },
      ] },
    ],
  }];
}

// The importers only ever ask for detail on fixtures the site already holds,
// so the team ids are recovered from the id the season generator built.
function teamsOf(fixture) {
  const league = Math.floor(fixture / 10_000_000);
  const index = fixture % 1000;
  const home = index % TEAMS;
  const away = (index * 7 + 3) % TEAMS === home ? ((index * 7 + 4) % TEAMS) : ((index * 7 + 3) % TEAMS);
  return [teamId(league, home), teamId(league, away)];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8899);
  await createMockProvider(port);
  console.log(`Mock API-Football on http://localhost:${port}`);
}

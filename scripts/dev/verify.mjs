#!/usr/bin/env node
// Exercises the ingestion, snapshot and detail paths end to end against a
// local worker, using scripts/dev/mock-provider.mjs in place of API-Football.
// No provider allowance is spent and no credential is needed.
//
//   pnpm build
//   npx wrangler dev --config dist/server/wrangler.json --port 8787 --local &
//   node scripts/dev/verify.mjs
//
//   --site <url>   The running worker (default http://localhost:8787).
//   --port <n>     Port for the mock provider (default 8899).
//
// It runs the real importer scripts rather than a copy of their logic, so a
// pass means the path a backfill actually takes is working. The checks are
// written as deltas, so a database with other seasons already in it still
// passes; only the reported counts differ.
//
// The local database lives at dist/server/.wrangler/state, beside the built
// worker config rather than at the project root — so `pnpm build` clears it,
// and that is also the path to delete for a genuinely empty run.

import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { createMockProvider } from './mock-provider.mjs';

const { values } = parseArgs({
  options: {
    site: { type: 'string', default: 'http://localhost:8787' },
    port: { type: 'string', default: '8899' },
  },
});

const site = values.site.replace(/\/+$/, '');
const port = Number(values.port);
const provider = `http://localhost:${port}`;
const LEAGUE = 39;
const SEASON = 2025;

const results = [];
let failures = 0;

function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  if (!passed) failures++;
  console.log(`${passed ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(path, init) {
  const response = await fetch(`${site}${path}`, init);
  return { status: response.status, body: await response.json().catch(() => null) };
}

function post(path, payload) {
  return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}

function runScript(script, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, API_FOOTBALL_KEY: 'mock-key' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('close', (code) => resolve({ code, output }));
  });
}

const server = await createMockProvider(port);
console.log(`Mock provider on ${provider}, checking ${site}\n`);

try {
  const reachable = await api('/api/football/imports');
  if (reachable.status !== 200) {
    console.error(`The worker at ${site} did not answer (status ${reachable.status}). Start it first.`);
    process.exit(2);
  }

  // --- season ingestion -----------------------------------------------------

  const importArgs = ['--site', site, '--token', 'dev', '--provider', provider, '--leagues', String(LEAGUE), '--seasons', String(SEASON), '--delay', '0'];
  const firstImport = await runScript('scripts/import-history.mjs', importArgs);
  check('season import succeeds', firstImport.code === 0, firstImport.output.trim().split('\n').at(-1));

  const stored = await api('/api/football/history/coverage');
  const season = stored.body?.seasons?.find((row) => row.competitionId === LEAGUE && row.season === SEASON);
  check('fixtures are stored', (season?.fixtures ?? 0) > 0, `${season?.fixtures} fixtures, ${season?.completed} played`);

  const repeat = await runScript('scripts/import-history.mjs', importArgs);
  check('re-import is a no-op', repeat.output.includes('0 to import'), 'completed seasons are skipped before any provider call');

  // --- upload validation ----------------------------------------------------

  const badPayloads = [
    { name: 'unsupported competition', payload: { league: 999, season: SEASON, fixtures: [validFixture()] } },
    { name: 'season out of range', payload: { league: LEAGUE, season: 1998, fixtures: [validFixture()] } },
    { name: 'empty fixture list', payload: { league: LEAGUE, season: SEASON, fixtures: [] } },
    { name: 'same team both sides', payload: { league: LEAGUE, season: SEASON, fixtures: [validFixture({ awayTeamId: 3901, homeTeamId: 3901 })] } },
    { name: 'impossible score', payload: { league: LEAGUE, season: SEASON, fixtures: [validFixture({ homeGoals: -1 })] } },
    { name: 'unparseable kickoff', payload: { league: LEAGUE, season: SEASON, fixtures: [validFixture({ kickoff: 'soon' })] } },
  ];
  const accepted = [];
  for (const { name, payload } of badPayloads) {
    const { status } = await post('/api/football/history/upload', payload);
    if (status !== 400) accepted.push(name);
  }
  check('bad season uploads are refused', accepted.length === 0, accepted.length ? `wrongly accepted: ${accepted.join(', ')}` : `${badPayloads.length} payloads refused`);

  // --- forecast snapshots ---------------------------------------------------

  const firstSnapshot = await post('/api/football/predictions/snapshot', { withinDays: 30 });
  check('forecasts are recorded', (firstSnapshot.body?.stored ?? 0) > 0, `${firstSnapshot.body?.stored} of ${firstSnapshot.body?.scanned} upcoming fixtures`);

  const secondSnapshot = await post('/api/football/predictions/snapshot', { withinDays: 30 });
  check('re-running stores no duplicates', secondSnapshot.body?.stored === 0 && secondSnapshot.body?.unchanged > 0, `${secondSnapshot.body?.unchanged} unchanged`);

  const record = await api('/api/football/predictions/snapshot?withinDays=30');
  check('coverage is reported', record.body?.coverage?.covered === record.body?.coverage?.upcoming, `${record.body?.coverage?.covered}/${record.body?.coverage?.upcoming} covered`);
  const scoredBefore = record.body?.performance?.matches ?? 0;
  check('new forecasts await a result', (record.body?.awaitingResult ?? 0) >= firstSnapshot.body?.scanned, `${record.body?.awaitingResult} awaiting, ${scoredBefore} already scored from earlier data`);

  // Settle the earliest upcoming fixtures and confirm they score.
  const settled = await settleSomeFixtures();
  check('results can be filed against forecasts', settled > 0, `${settled} fixtures marked complete`);

  const scored = await api('/api/football/predictions/snapshot?withinDays=30');
  const gained = (scored.body?.performance?.matches ?? 0) - scoredBefore;
  check('settled forecasts are scored', gained > 0, `${gained} newly scored (${scored.body?.performance?.matches} total), Brier ${scored.body?.performance?.brier}`);
  check('calibration waits for a sufficient sample', (scored.body?.calibration?.points ?? 0) > 0 && scored.body?.calibration?.eligible === false, `${scored.body?.calibration?.settledFixtures}/${scored.body?.calibration?.minimumFixtures} fixtures settled`);
  check('forecasts predate their kickoffs', (scored.body?.performance?.medianLeadHours ?? 0) > 0, `median lead ${scored.body?.performance?.medianLeadHours}h`);

  const windowed = await runScript('scripts/import-match-detail.mjs', [
    '--site', site, '--token', 'dev', '--provider', provider,
    '--leagues', String(LEAGUE), '--seasons', String(SEASON), '--include', 'odds',
    '--within-days', '30', '--budget', '500', '--dry-run', '--retry-empty',
  ]);
  check('recurring detail work is windowed', windowed.code === 0 && windowed.output.includes('in the next 30 days'), windowed.output.trim().split('\n')[0]);

  const availability = await runScript('scripts/import-match-detail.mjs', [
    '--site', site, '--token', 'dev', '--provider', provider,
    '--leagues', String(LEAGUE), '--seasons', String(SEASON), '--include', 'lineups,injuries',
    '--within-days', '30', '--budget', '500', '--batch', '20', '--delay', '0', '--retry-empty',
  ]);
  check('pre-kickoff availability imports', availability.code === 0, availability.output.trim().split('\n').filter((line) => line.includes('provider calls')).at(-1));

  // --- match detail ---------------------------------------------------------

  const detail = await runScript('scripts/import-match-detail.mjs', [
    '--site', site, '--token', 'dev', '--provider', provider,
    '--leagues', String(LEAGUE), '--seasons', String(SEASON),
    '--budget', '180', '--batch', '20', '--delay', '0', '--retry-empty',
  ]);
  check('match detail imports', detail.code === 0, detail.output.trim().split('\n').filter((line) => line.includes('provider calls')).at(-1));

  const coverage = await api('/api/football/history/coverage');
  const detailRow = coverage.body?.seasons?.find((row) => row.competitionId === LEAGUE && row.season === SEASON);
  check('statistics are stored', (detailRow?.statistics ?? 0) > 0, `${detailRow?.statistics} of ${detailRow?.completed} played matches`);
  check('line-ups are stored', (detailRow?.lineups ?? 0) > 0, `${detailRow?.lineups} matches`);
  check('odds are stored', (detailRow?.odds ?? 0) > 0, `${detailRow?.odds} matches`);
  check('availability snapshots are stored', (detailRow?.availability ?? 0) > 0, `${detailRow?.availability} fixtures captured before kickoff`);

  const features = await api('/api/football/features');
  check('pre-match feature rows are generated', features.body?.connected === true && (features.body?.summary?.eligibleRows ?? 0) > 0, `${features.body?.summary?.eligibleRows ?? 0} leakage-safe rows`);
  check('feature cutoff is enforced', features.body?.pipeline?.leakageSafe === true && features.body?.pipeline?.usesCurrentFixtureStatistics === false && features.body?.pipeline?.targetSeparatedFromFeatures === true, `window ${features.body?.pipeline?.rollingWindow}, minimum history ${features.body?.pipeline?.minimumTeamHistory}`);

  const odds = await runScript('scripts/import-match-detail.mjs', [
    '--site', site, '--token', 'dev', '--provider', provider,
    '--leagues', String(LEAGUE), '--seasons', String(SEASON), '--include', 'odds',
    '--budget', '500', '--batch', '50', '--delay', '0', '--retry-empty',
  ]);
  check('upcoming odds are stored', odds.code === 0, odds.output.trim().split('\n').filter((line) => line.includes('provider calls')).at(-1));

  const marketSnapshot = await post('/api/football/predictions/snapshot', { withinDays: 30 });
  check('market prices are frozen with forecasts', (marketSnapshot.body?.withMarket ?? 0) > 0, `${marketSnapshot.body?.withMarket} forecasts carry the pre-kickoff market`);
  const settledWithMarket = await settleSomeFixtures(20);
  const compared = await api('/api/football/predictions/snapshot?withinDays=30');
  check('model and market are scored together', (compared.body?.marketComparison?.matches ?? 0) > 0, `${compared.body?.marketComparison?.matches} matched results after settling ${settledWithMarket}`);
  check('v1, v2 and market use identical fixtures', (compared.body?.identicalFixtureComparison?.matches ?? 0) > 0 && compared.body?.identicalFixtureComparison?.entries?.length === 3, `${compared.body?.identicalFixtureComparison?.matches} shared fixtures`);

  const withDetail = await api(`/api/football/history/coverage?missing=statistics&league=${LEAGUE}&season=${SEASON}&limit=5`);
  check('outstanding work is listable', typeof withDetail.body?.remaining === 'number', `${withDetail.body?.remaining} fixtures still without statistics`);

  const sample = await firstFixtureWithStatistics();
  if (sample) {
    const match = await api(`/api/football/match?fixture=${sample}`);
    check('the match view reads stored detail', match.body?.statisticsSource === 'stored', `source: ${match.body?.statisticsSource}`);
    check('the market price is derived', Boolean(match.body?.market), match.body?.market ? `${match.body.market.probabilities.home}/${match.body.market.probabilities.draw}/${match.body.market.probabilities.away} at ${match.body.market.overround} overround` : 'no odds');
  } else {
    check('the match view reads stored detail', false, 'no fixture with statistics found');
  }

  const badDetail = await post('/api/football/history/upload/match', { fixtures: [{ fixtureId: 99_999_999, statistics: [{ teamId: 1, shotsOn: 3 }] }] });
  check('detail for unknown fixtures is refused', badDetail.status === 400, badDetail.body?.error);

  console.log(`\n${results.length - failures}/${results.length} checks passed.`);
  process.exit(failures ? 1 : 0);
} finally {
  server.close();
}

function validFixture(overrides = {}) {
  return {
    id: 990_000_001,
    kickoff: new Date().toISOString(),
    status: 'FT',
    homeTeamId: 3901,
    homeTeamName: 'Home',
    awayTeamId: 3902,
    awayTeamName: 'Away',
    homeGoals: 1,
    awayGoals: 0,
    ...overrides,
  };
}

// Re-uploads the season with its earliest upcoming fixtures marked complete,
// which is what a result sync would do the morning after a round.
async function settleSomeFixtures(skip = 0) {
  const response = await fetch(`${provider}/fixtures?league=${LEAGUE}&season=${SEASON}`, { headers: { 'x-apisports-key': 'mock-key' } });
  const { response: fixtures } = await response.json();
  let settled = 0;
  let upcomingSeen = 0;
  const payload = fixtures.map((item) => {
    const upcoming = item.fixture.status.short === 'NS';
    if (upcoming) upcomingSeen++;
    const settle = upcoming && upcomingSeen > skip && settled < 20 && ++settled;
    return {
      id: item.fixture.id,
      kickoff: item.fixture.date,
      status: settle ? 'FT' : item.fixture.status.short,
      round: item.league.round,
      venue: item.fixture.venue.name,
      homeTeamId: item.teams.home.id,
      homeTeamName: item.teams.home.name,
      awayTeamId: item.teams.away.id,
      awayTeamName: item.teams.away.name,
      homeGoals: settle ? 2 : item.goals.home,
      awayGoals: settle ? 1 : item.goals.away,
    };
  });
  await post('/api/football/history/upload', { league: LEAGUE, season: SEASON, fixtures: payload, replace: true });
  return settled;
}

async function firstFixtureWithStatistics() {
  const missing = await api(`/api/football/history/coverage?missing=statistics&league=${LEAGUE}&season=${SEASON}&limit=1000`);
  const without = new Set((missing.body?.fixtures ?? []).map((row) => row.id));
  const response = await fetch(`${provider}/fixtures?league=${LEAGUE}&season=${SEASON}`, { headers: { 'x-apisports-key': 'mock-key' } });
  const { response: fixtures } = await response.json();
  return fixtures.map((item) => item.fixture.id).find((id) => !without.has(id)) ?? null;
}

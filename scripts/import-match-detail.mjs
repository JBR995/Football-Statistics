#!/usr/bin/env node
// Backfills per-match detail — shot and possession statistics, line-ups and
// bookmaker odds, and pre-kickoff availability — for fixtures already stored
// in the hosted database.
//
// Like scripts/import-history.mjs, the provider calls run here and only the
// data is uploaded, because the hosted worker's outbound allowance is spent
// after roughly one historical request.
//
// This costs one provider call per fixture per data class, so it is budgeted
// and resumable rather than a single long run: the site reports which fixtures
// still lack each class, and this script works through them until the budget
// is spent. Run it again to continue.
//
// Usage:
//   node scripts/import-match-detail.mjs --site https://<host> --token <site-token>
//
//   --site <url>        Base URL of the deployed site. Required.
//   --token <token>     Bearer token for the owner-only site.
//                       Defaults to $SITES_BYPASS_TOKEN.
//   --env-file <path>   File holding API_FOOTBALL_KEY (default .env.local).
//   --leagues <ids>     Comma-separated competition ids (default: all 12).
//   --seasons <range>   e.g. 2021-2025 or 2021,2023 (default 2021-2025).
//   --include <classes> statistics, lineups, injuries, odds
//                       (default: statistics,lineups,odds).
//   --budget <n>        Maximum provider calls this run (default 1000).
//   --batch <n>         Fixtures per upload request (default 25, max 50).
//   --delay <ms>        Pause between provider calls (default 250).
//   --within-days <n>   Only inspect fixtures kicking off in the next n days.
//                       Intended for recurring odds and line-up collection.
//   --retry-empty       Re-ask for fixtures the provider had no data for.
//   --dry-run           Report the work outstanding, call nothing.
//   --provider <url>    Override the provider base URL. For pointing at
//                       scripts/dev/mock-provider.mjs; the key is sent to
//                       whatever this names, so leave it alone otherwise.
//
// Fixtures the provider returns nothing for are remembered in
// scripts/.match-detail-cache.json so a later run does not spend the budget
// asking again. Delete that file, or pass --retry-empty, to re-check them.

import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const PROVIDER = 'https://v3.football.api-sports.io';
const MAX_BATCH = 50;
const PROVIDER_RETRIES = 3;
const CACHE_PATH = new URL('./.match-detail-cache.json', import.meta.url);

const COMPETITIONS = [
  { id: 39, name: 'Premier League' },
  { id: 40, name: 'EFL Championship' },
  { id: 41, name: 'EFL League One' },
  { id: 42, name: 'EFL League Two' },
  { id: 61, name: 'Ligue 1' },
  { id: 140, name: 'La Liga' },
  { id: 78, name: 'Bundesliga' },
  { id: 135, name: 'Serie A' },
  { id: 88, name: 'Eredivisie' },
  { id: 2, name: 'UEFA Champions League' },
  { id: 3, name: 'UEFA Europa League' },
  { id: 848, name: 'UEFA Conference League' },
];

const CLASSES = {
  statistics: { path: '/fixtures/statistics', parse: parseStatistics },
  lineups: { path: '/fixtures/lineups', parse: parseLineups },
  injuries: { path: '/injuries', parse: parseInjuries },
  odds: { path: '/odds', parse: parseOdds },
};

const STATISTIC_KEYS = new Map([
  ['shots on goal', 'shotsOn'],
  ['shots off goal', 'shotsOff'],
  ['total shots', 'shotsTotal'],
  ['blocked shots', 'shotsBlocked'],
  ['shots insidebox', 'shotsInsideBox'],
  ['shots outsidebox', 'shotsOutsideBox'],
  ['fouls', 'fouls'],
  ['corner kicks', 'corners'],
  ['offsides', 'offsides'],
  ['ball possession', 'possession'],
  ['yellow cards', 'yellowCards'],
  ['red cards', 'redCards'],
  ['goalkeeper saves', 'saves'],
  ['total passes', 'passesTotal'],
  ['passes accurate', 'passesAccurate'],
  ['expected_goals', 'expectedGoals'],
]);

const { values } = parseArgs({
  options: {
    site: { type: 'string' },
    token: { type: 'string' },
    'env-file': { type: 'string', default: '.env.local' },
    leagues: { type: 'string' },
    seasons: { type: 'string', default: '2021-2025' },
    include: { type: 'string', default: 'statistics,lineups,odds' },
    budget: { type: 'string', default: '1000' },
    batch: { type: 'string', default: '25' },
    delay: { type: 'string', default: '250' },
    'within-days': { type: 'string' },
    'retry-empty': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    provider: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  const source = await readFile(new URL(import.meta.url), 'utf8');
  console.log(source.split('\n').filter((line) => line.startsWith('//')).map((line) => line.slice(3)).join('\n'));
  process.exit(0);
}

const providerUrl = (values.provider ?? PROVIDER).replace(/\/+$/, '');
const site = (values.site ?? process.env.SITE_URL ?? '').replace(/\/+$/, '');
if (!site) fail('Pass --site https://<host> (or set SITE_URL).');
const siteToken = values.token ?? process.env.SITES_BYPASS_TOKEN ?? '';
if (!siteToken) fail('Pass --token <site-token> (or set SITES_BYPASS_TOKEN).');

const include = values.include.split(',').map((value) => value.trim()).filter(Boolean);
for (const name of include) if (!CLASSES[name]) fail(`--include accepts ${Object.keys(CLASSES).join(', ')}; got "${name}".`);

const leagues = values.leagues
  ? values.leagues.split(',').map((value) => Number(value.trim()))
  : COMPETITIONS.map((competition) => competition.id);
for (const league of leagues) {
  if (!COMPETITIONS.some((competition) => competition.id === league)) fail(`Competition ${league} is not supported.`);
}

const seasons = parseSeasons(values.seasons);
const budget = positive(values.budget, 'budget');
const batchSize = Math.min(positive(values.batch, 'batch'), MAX_BATCH);
const delayMs = Number(values.delay);
if (!Number.isFinite(delayMs) || delayMs < 0) fail('--delay must be a number of milliseconds.');
const withinDays = values['within-days'] === undefined ? null : positive(values['within-days'], 'within-days');
const windowStart = new Date();
const windowEnd = withinDays === null ? null : new Date(windowStart.getTime() + withinDays * 86_400_000);

const apiKey = values['dry-run'] ? '' : await readProviderKey(values['env-file']);
const empties = values['retry-empty'] ? new Set() : await readCache();

// What is still outstanding, and what this run can afford to collect.
const work = new Map(); // fixtureId -> { league, season, classes: Set }
let outstanding = 0;
for (const league of leagues) {
  for (const season of seasons) {
    for (const name of include) {
      const report = await readMissing(name, league, season, withinDays !== null && (name === 'lineups' || name === 'injuries'));
      const fixtures = report.fixtures.filter((fixture) => inWindow(fixture.kickoff));
      outstanding += fixtures.length;
      for (const fixture of fixtures) {
        if (empties.has(`${fixture.id}:${name}`)) continue;
        const entry = work.get(fixture.id) ?? { league, season, classes: new Set() };
        entry.classes.add(name);
        work.set(fixture.id, entry);
      }
    }
  }
}

const plannedCalls = [...work.values()].reduce((sum, entry) => sum + entry.classes.size, 0);
console.log(`${outstanding} fixture-classes outstanding${withinDays === null ? '' : ` in the next ${withinDays} days`} across ${leagues.length} competitions and ${seasons.length} seasons.`);
console.log(`This run will make at most ${Math.min(plannedCalls, budget)} provider calls (budget ${budget}).`);
if (outstanding > budget) {
  console.log(`At ${budget} calls a run, finishing the rest takes about ${Math.ceil(outstanding / budget)} more runs.`);
}
if (values['dry-run'] || !work.size) process.exit(0);

let calls = 0;
let uploaded = 0;
const totals = { statistics: 0, lineups: 0, injuries: 0, odds: 0 };
const empty = { statistics: 0, lineups: 0, injuries: 0, odds: 0 };
const failures = [];
let pending = [];

for (const [fixtureId, entry] of work) {
  if (calls >= budget) break;
  const detail = { fixtureId, statistics: [], lineups: [], injuries: [], odds: [], observed: [] };
  let collected = false;

  for (const name of entry.classes) {
    if (calls >= budget) break;
    try {
      calls++;
      const parsed = await fetchClass(name, fixtureId);
      if (name === 'lineups' || name === 'injuries') detail.observed.push(name);
      if (parsed.length) {
        detail[name] = parsed;
        totals[name] += parsed.length;
        collected = true;
      } else {
        empty[name]++;
        empties.add(`${fixtureId}:${name}`);
      }
      if (name === 'lineups' || name === 'injuries') collected = true;
    } catch (error) {
      failures.push(`${nameOf(entry.league)} fixture ${fixtureId} ${name}: ${error.message}`);
    }
    if (delayMs) await sleep(delayMs);
  }

  if (collected) pending.push(detail);
  if (pending.length >= batchSize) pending = await flush(pending);
}
await flush(pending);

console.log(`\n${calls} provider calls, ${uploaded} fixtures uploaded.`);
console.log(`  statistics rows ${totals.statistics}, line-ups ${totals.lineups}, injuries ${totals.injuries}, odds rows ${totals.odds}`);
console.log(`  provider had nothing for: ${empty.statistics} statistics, ${empty.lineups} line-ups, ${empty.injuries} injuries, ${empty.odds} odds`);
if (failures.length) {
  console.log(`  ${failures.length} failed:`);
  for (const failure of failures.slice(0, 20)) console.log(`    ${failure}`);
}
await writeCache(empties);
process.exit(failures.length ? 1 : 0);

async function flush(details) {
  if (!details.length) return [];
  try {
    const response = await fetch(`${site}/api/football/history/upload/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'OAI-Sites-Authorization': `Bearer ${siteToken}` },
      body: JSON.stringify({ fixtures: details }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? `the site returned ${response.status}`);
    uploaded += body.fixtures ?? details.length;
    console.log(`  uploaded ${body.fixtures} fixtures (${body.statistics} statistics, ${body.lineups} line-ups, ${body.injuries ?? 0} injuries, ${body.odds} odds, ${body.availabilitySnapshots ?? 0} pre-kickoff snapshots)`);
  } catch (error) {
    failures.push(`upload of ${details.length} fixtures: ${error.message}`);
  }
  return [];
}

async function fetchClass(name, fixtureId) {
  const { path, parse } = CLASSES[name];
  const url = new URL(providerUrl + path);
  url.searchParams.set('fixture', String(fixtureId));

  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
    if (response.status === 429 && attempt <= PROVIDER_RETRIES) {
      await backoff(attempt);
      continue;
    }
    if (!response.ok) throw new Error(`the provider returned ${response.status}`);
    const payload = await response.json();
    const errors = Array.isArray(payload.errors) ? payload.errors : Object.values(payload.errors ?? {});
    if (errors.length) {
      const message = String(errors[0]);
      if (/limit/i.test(message) && attempt <= PROVIDER_RETRIES) {
        await backoff(attempt);
        continue;
      }
      throw new Error(message);
    }
    return parse(payload.response ?? []);
  }
}

function parseStatistics(response) {
  return response
    .filter((entry) => entry?.team?.id)
    .map((entry) => {
      const row = { teamId: entry.team.id };
      for (const item of entry.statistics ?? []) {
        const key = STATISTIC_KEYS.get(String(item?.type ?? '').toLowerCase());
        if (!key) continue;
        row[key] = number(item.value);
      }
      return row;
    })
    // A row of nothing but a team id is not a statistic worth storing.
    .filter((row) => Object.keys(row).length > 1);
}

function parseLineups(response) {
  return response
    .filter((entry) => entry?.team?.id)
    .map((entry) => ({
      teamId: entry.team.id,
      formation: entry.formation ?? null,
      coach: entry.coach?.name ?? null,
      starters: players(entry.startXI),
      substitutes: players(entry.substitutes),
    }))
    .filter((lineup) => lineup.formation || lineup.starters.length || lineup.substitutes.length);
}

function players(list) {
  return (list ?? [])
    .map((item) => item?.player)
    .filter((player) => player?.name)
    .map((player) => ({
      id: player.id ?? null,
      name: player.name,
      number: player.number ?? null,
      position: player.pos ?? null,
      grid: player.grid ?? null,
    }));
}

function parseOdds(response) {
  const books = [];
  for (const entry of response) {
    for (const bookmaker of entry?.bookmakers ?? []) {
      if (!bookmaker?.id || !bookmaker?.name) continue;
      const book = { bookmakerId: bookmaker.id, bookmaker: bookmaker.name };
      for (const bet of bookmaker.bets ?? []) {
        const values = new Map((bet?.values ?? []).map((value) => [String(value?.value ?? '').toLowerCase(), number(value?.odd)]));
        switch (String(bet?.name ?? '').toLowerCase()) {
          case 'match winner':
            book.home = values.get('home') ?? null;
            book.draw = values.get('draw') ?? null;
            book.away = values.get('away') ?? null;
            break;
          case 'goals over/under':
            book.over25 = values.get('over 2.5') ?? null;
            book.under25 = values.get('under 2.5') ?? null;
            break;
          case 'both teams score':
            book.bttsYes = values.get('yes') ?? null;
            book.bttsNo = values.get('no') ?? null;
            break;
        }
      }
      if (Object.keys(book).length > 2) books.push(book);
    }
  }
  return books;
}

// Provider values arrive as strings, percentages, or null.
function number(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(String(value).replace('%', '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

async function readMissing(name, league, season, repeatable = false) {
  let url = `${site}/api/football/history/coverage?missing=${name}&league=${league}&season=${season}&limit=1000`;
  if (repeatable) url += '&repeat=true';
  let response;
  try {
    response = await fetch(url, { headers: { 'OAI-Sites-Authorization': `Bearer ${siteToken}` } });
  } catch (error) {
    return fail(`Could not reach ${site}: ${error.message}. Check --site.`);
  }
  if (!response.ok) return fail(`Could not read coverage: the site returned ${response.status}. Check --site and --token.`);
  const payload = await response.json();
  return { remaining: payload.remaining ?? 0, fixtures: payload.fixtures ?? [] };
}

async function readCache() {
  try {
    return new Set(JSON.parse(await readFile(CACHE_PATH, 'utf8')));
  } catch {
    return new Set();
  }
}

async function writeCache(cache) {
  try {
    await writeFile(CACHE_PATH, JSON.stringify([...cache]));
  } catch { /* The cache only saves quota; losing it is not a failure. */ }
}

// Reads only API_FOOTBALL_KEY, and never prints it.
async function readProviderKey(path) {
  if (process.env.API_FOOTBALL_KEY) return process.env.API_FOOTBALL_KEY;
  let contents;
  try {
    contents = await readFile(path, 'utf8');
  } catch {
    return fail(`Could not read ${path}. Set API_FOOTBALL_KEY or pass --env-file.`);
  }
  const match = contents.match(/^\uFEFF?\s*(?:export\s+)?API_FOOTBALL_KEY\s*=\s*(.*?)\s*$/m);
  const value = match?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  if (value) return value;
  return fail(`${path} does not define API_FOOTBALL_KEY.`);
}

function parseInjuries(response) {
  return response
    .filter((entry) => entry?.team?.id && entry?.player?.name)
    .map((entry) => ({
      teamId: entry.team.id,
      playerId: entry.player.id ?? null,
      playerName: entry.player.name,
      injuryType: entry.player.type ?? entry.type ?? null,
      reason: entry.player.reason ?? entry.reason ?? null,
    }));
}

function parseSeasons(input) {
  const seasons = new Set();
  for (const part of input.split(',')) {
    const range = part.trim().match(/^(\d{4})-(\d{4})$/);
    if (range) {
      for (let season = Number(range[1]); season <= Number(range[2]); season += 1) seasons.add(season);
      continue;
    }
    const single = Number(part.trim());
    if (!Number.isInteger(single)) fail(`Could not read "${part}" as a season.`);
    seasons.add(single);
  }
  if (!seasons.size) fail('--seasons produced no seasons.');
  return [...seasons].sort((a, b) => a - b);
}

function positive(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) fail(`--${name} must be a positive whole number.`);
  return parsed;
}

async function backoff(attempt) {
  const wait = attempt * 20_000;
  console.log(`    provider rate limit, waiting ${wait / 1000}s`);
  await sleep(wait);
}

function nameOf(league) {
  return COMPETITIONS.find((competition) => competition.id === league)?.name ?? `Competition ${league}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inWindow(kickoff) {
  if (windowEnd === null) return true;
  const time = Date.parse(kickoff);
  return Number.isFinite(time) && time > windowStart.getTime() && time <= windowEnd.getTime();
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

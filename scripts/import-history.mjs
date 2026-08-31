#!/usr/bin/env node
// Backfills historical seasons into the hosted database from a local machine.
//
// The hosted worker shares an outbound address whose provider allowance runs
// out after roughly one historical request, so a bulk backfill cannot run
// there. This script makes the provider calls locally — where the account's
// own per-minute allowance applies — and posts each season's fixtures to
// POST /api/football/history/upload.
//
// The provider key never leaves this machine. Only fixture data is uploaded.
//
// Usage:
//   node scripts/import-history.mjs --site https://<host> --token <site-token>
//
//   --site <url>         Base URL of the deployed site. Required.
//   --token <token>      Bearer token for the owner-only site.
//                        Defaults to $SITES_BYPASS_TOKEN.
//   --env-file <path>    File holding API_FOOTBALL_KEY (default .env.local).
//                        $API_FOOTBALL_KEY is used if it is already set.
//   --leagues <ids>      Comma-separated competition ids (default: all 12).
//   --seasons <range>    e.g. 2021-2025 or 2021,2023 (default 2021-2025).
//   --replace            Re-import seasons already marked complete.
//   --delay <ms>         Pause between provider calls (default 1500).
//   --dry-run            Report what would be imported, call nothing.
//   --provider <url>     Override the provider base URL. For pointing at
//                        scripts/dev/mock-provider.mjs; the key is sent to
//                        whatever this names, so leave it alone otherwise.
//
// Exits non-zero if any season failed, so a wrapper can retry.

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const PROVIDER = 'https://v3.football.api-sports.io';
const MAX_FIXTURES = 700; // Must match the upload route's limit.
const PROVIDER_RETRIES = 3;

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

const { values } = parseArgs({
  options: {
    site: { type: 'string' },
    token: { type: 'string' },
    'env-file': { type: 'string', default: '.env.local' },
    leagues: { type: 'string' },
    seasons: { type: 'string', default: '2021-2025' },
    replace: { type: 'boolean', default: false },
    delay: { type: 'string', default: '1500' },
    'dry-run': { type: 'boolean', default: false },
    provider: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(await readFile(new URL(import.meta.url), 'utf8').then((text) =>
    text.split('\n').filter((line) => line.startsWith('//')).map((line) => line.slice(3)).join('\n')
  ));
  process.exit(0);
}

const providerUrl = `${(values.provider ?? PROVIDER).replace(/\/+$/, '')}/fixtures`;
const site = (values.site ?? process.env.SITE_URL ?? '').replace(/\/+$/, '');
if (!site) fail('Pass --site https://<host> (or set SITE_URL).');

const siteToken = values.token ?? process.env.SITES_BYPASS_TOKEN ?? '';
if (!siteToken) fail('Pass --token <site-token> (or set SITES_BYPASS_TOKEN).');

const delayMs = Number(values.delay);
if (!Number.isFinite(delayMs) || delayMs < 0) fail('--delay must be a number of milliseconds.');

const leagues = values.leagues
  ? values.leagues.split(',').map((value) => Number(value.trim()))
  : COMPETITIONS.map((competition) => competition.id);
for (const league of leagues) {
  if (!COMPETITIONS.some((competition) => competition.id === league)) fail(`Competition ${league} is not supported.`);
}

const seasons = parseSeasons(values.seasons);
if (!seasons.length) fail('--seasons produced no seasons.');

const apiKey = values['dry-run'] ? '' : await readProviderKey(values['env-file']);

const stored = await readStoredSeasons();
const wanted = leagues.flatMap((league) => seasons.map((season) => ({ league, season })));
const pending = values.replace ? wanted : wanted.filter(({ league, season }) => !stored.has(`${league}:${season}`));

console.log(`${wanted.length} competition-seasons requested, ${wanted.length - pending.length} already stored, ${pending.length} to import.`);
if (values['dry-run']) {
  for (const { league, season } of pending) console.log(`  would import ${nameOf(league)} ${season}`);
  process.exit(0);
}
if (!pending.length) process.exit(0);

let imported = 0;
let records = 0;
const failures = [];

for (const [index, { league, season }] of pending.entries()) {
  const label = `${nameOf(league)} ${season}`;
  const position = `[${index + 1}/${pending.length}]`;
  try {
    const fixtures = await fetchSeason(league, season);
    const result = await uploadSeason(league, season, fixtures);
    if (result.status === 'already-stored') {
      console.log(`${position} ${label}: already stored (${result.records} fixtures).`);
    } else {
      imported += 1;
      records += result.records;
      console.log(`${position} ${label}: stored ${result.records} fixtures.`);
    }
  } catch (error) {
    failures.push({ label, message: error.message });
    console.error(`${position} ${label}: ${error.message}`);
  }
  if (index < pending.length - 1) await sleep(delayMs);
}

console.log(`\nImported ${imported} seasons, ${records} fixtures. ${failures.length} failed.`);
for (const failure of failures) console.log(`  ${failure.label}: ${failure.message}`);
process.exit(failures.length ? 1 : 0);

async function fetchSeason(league, season) {
  const url = new URL(providerUrl);
  url.searchParams.set('league', String(league));
  url.searchParams.set('season', String(season));
  url.searchParams.set('timezone', 'Europe/London');

  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
    if (response.status === 429 && attempt <= PROVIDER_RETRIES) {
      const wait = attempt * 20_000;
      console.log(`    provider rate limit, waiting ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    if (!response.ok) throw new Error(`the provider returned ${response.status}`);

    const payload = await response.json();
    const errors = Array.isArray(payload.errors) ? payload.errors : Object.values(payload.errors ?? {});
    if (errors.length) {
      const message = String(errors[0]);
      if (/limit/i.test(message) && attempt <= PROVIDER_RETRIES) {
        const wait = attempt * 20_000;
        console.log(`    ${message}, waiting ${wait / 1000}s`);
        await sleep(wait);
        continue;
      }
      throw new Error(message);
    }
    if (!payload.response?.length) throw new Error('the provider returned no fixtures');
    if (payload.response.length > MAX_FIXTURES) {
      throw new Error(`${payload.response.length} fixtures exceeds the ${MAX_FIXTURES} upload limit`);
    }
    return payload.response;
  }
}

async function uploadSeason(league, season, fixtures) {
  const response = await fetch(`${site}/api/football/history/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${siteToken}` },
    body: JSON.stringify({
      league,
      season,
      replace: values.replace,
      competitionLogo: fixtures[0]?.league?.logo ?? null,
      fixtures: fixtures.map((item) => ({
        id: item.fixture.id,
        kickoff: item.fixture.date,
        status: item.fixture.status.short,
        round: item.league.round ?? null,
        venue: item.fixture.venue?.name ?? null,
        homeTeamId: item.teams.home.id,
        homeTeamName: item.teams.home.name,
        homeTeamLogo: item.teams.home.logo ?? null,
        awayTeamId: item.teams.away.id,
        awayTeamName: item.teams.away.name,
        awayTeamLogo: item.teams.away.logo ?? null,
        homeGoals: item.goals.home,
        awayGoals: item.goals.away,
      })),
    }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? `the site returned ${response.status}`);
  return body;
}

async function readStoredSeasons() {
  let response;
  try {
    response = await fetch(`${site}/api/football/imports`, {
      headers: { Authorization: `Bearer ${siteToken}` },
    });
  } catch (error) {
    return fail(`Could not reach ${site}: ${error.message}. Check --site.`);
  }
  if (!response.ok) {
    return fail(`Could not read import status: the site returned ${response.status}. Check --site and --token.`);
  }
  const payload = await response.json();
  const complete = new Set();
  for (const season of payload.seasons ?? []) {
    if (season.records > 0 && season.sync?.status === 'complete') {
      complete.add(`${season.competitionId}:${season.season}`);
    }
  }
  return complete;
}

// Reads only API_FOOTBALL_KEY, and never prints it.
async function readProviderKey(path) {
  if (process.env.API_FOOTBALL_KEY) return process.env.API_FOOTBALL_KEY;
  let contents;
  try {
    contents = await readFile(path, 'utf8');
  } catch {
    fail(`Could not read ${path}. Set API_FOOTBALL_KEY or pass --env-file.`);
  }
  for (const line of contents.split('\n')) {
    const match = line.match(/^\s*(?:export\s+)?API_FOOTBALL_KEY\s*=\s*(.*)$/);
    if (!match) continue;
    const value = match[1].trim().replace(/^['"]|['"]$/g, '');
    if (value) return value;
  }
  return fail(`${path} does not define API_FOOTBALL_KEY.`);
}

function parseSeasons(input) {
  const seasons = new Set();
  for (const part of input.split(',')) {
    const range = part.trim().match(/^(\d{4})-(\d{4})$/);
    if (range) {
      const [, from, to] = range;
      for (let season = Number(from); season <= Number(to); season += 1) seasons.add(season);
      continue;
    }
    const single = Number(part.trim());
    if (!Number.isInteger(single)) fail(`Could not read "${part}" as a season.`);
    seasons.add(single);
  }
  return [...seasons].sort((a, b) => a - b);
}

function nameOf(league) {
  return COMPETITIONS.find((competition) => competition.id === league)?.name ?? `Competition ${league}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

#!/usr/bin/env node
// Refreshes the active European season, captures near-term bookmaker odds,
// then records forecasts for the same upcoming window.
//
// Usage:
//   node scripts/refresh-current.mjs --site https://<host> --token <site-token>
//
//   --season <year>       Season start year (default: inferred; July starts a new season).
//   --within-days <n>     Odds and forecast horizon (default 14).
//   --odds-budget <n>     Maximum odds calls per run (default 600).
//   --env-file <path>     File holding API_FOOTBALL_KEY (default .env.local).
//   --dry-run             Show eligible work without provider calls or writes.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    site: { type: 'string' },
    token: { type: 'string' },
    season: { type: 'string' },
    'within-days': { type: 'string', default: '14' },
    'odds-budget': { type: 'string', default: '600' },
    'env-file': { type: 'string', default: '.env.local' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  const source = await readFile(new URL(import.meta.url), 'utf8');
  console.log(source.split('\n').filter((line) => line.startsWith('//')).map((line) => line.slice(3)).join('\n'));
  process.exit(0);
}

const site = (values.site ?? process.env.SITE_URL ?? '').replace(/\/+$/, '');
if (!site) fail('Pass --site https://<host> (or set SITE_URL).');
const siteToken = values.token ?? process.env.SITES_BYPASS_TOKEN ?? '';
if (!siteToken) fail('Pass --token <site-token> (or set SITES_BYPASS_TOKEN).');

const now = new Date();
const inferredSeason = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
const season = positive(values.season ?? String(inferredSeason), 'season');
const withinDays = positive(values['within-days'], 'within-days');
const oddsBudget = positive(values['odds-budget'], 'odds-budget');
const apiKey = values['dry-run'] ? '' : await readProviderKey(values['env-file']);
const scripts = dirname(fileURLToPath(import.meta.url));
const commonEnvironment = {
  ...process.env,
  API_FOOTBALL_KEY: apiKey,
  SITES_BYPASS_TOKEN: siteToken,
  SITE_URL: site,
};

console.log(`Refreshing season ${season}; odds and forecasts cover the next ${withinDays} days.`);

await run(join(scripts, 'import-history.mjs'), [
  '--seasons', String(season), '--replace', '--delay', '1500',
  ...(values['dry-run'] ? ['--dry-run'] : []),
]);

await run(join(scripts, 'import-match-detail.mjs'), [
  '--seasons', String(season), '--include', 'odds', '--within-days', String(withinDays),
  '--retry-empty', '--budget', String(oddsBudget), '--delay', '250',
  ...(values['dry-run'] ? ['--dry-run'] : []),
]);

if (!values['dry-run']) {
  const body = await recordForecasts();
  console.log(`${body.stored} forecasts stored, ${body.withMarket ?? 0} with a market benchmark, ${body.unchanged} unchanged.`);
}

async function recordForecasts() {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`${site}/api/football/predictions/snapshot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'OAI-Sites-Authorization': `Bearer ${siteToken}`,
        },
        body: JSON.stringify({ withinDays }),
      });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.connected) return body;
      lastError = new Error(body?.error ?? `Snapshot request returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) {
      console.warn(`Snapshot request failed on attempt ${attempt}; retrying.`);
      await sleep(attempt * 2_000);
    }
  }
  return fail(lastError instanceof Error ? lastError.message : 'Snapshot request failed.');
}

async function run(script, args) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      env: commonEnvironment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) process.exit(code);
}

async function readProviderKey(path) {
  if (process.env.API_FOOTBALL_KEY) return process.env.API_FOOTBALL_KEY;
  let contents;
  try {
    contents = await readFile(path, 'utf8');
  } catch {
    fail(`Could not read ${path}. Set API_FOOTBALL_KEY or pass --env-file.`);
  }
  const match = contents.match(/^\uFEFF?\s*(?:export\s+)?API_FOOTBALL_KEY\s*=\s*(.*?)\s*$/m);
  const value = match?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  if (value) return value;
  return fail(`${path} does not define API_FOOTBALL_KEY.`);
}

function positive(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) fail(`--${name} must be a positive integer.`);
  return number;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

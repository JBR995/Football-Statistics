import { ensureFootballSchema } from '@/db/football';
import { isSupportedSeason, maxSeason, MIN_SEASON, readSeasonState, recordFailedSeason, storeSeason, type SeasonFixture } from '@/db/history';
import { getCompetition } from '@/lib/competitions';

// Ingests one season of fixtures that a local importer has already collected
// from the provider, instead of fetching them from inside the worker.
//
// The hosted worker shares an outbound address whose per-minute allowance is
// exhausted after roughly one historical request, which makes `POST /history`
// unusable for a bulk backfill even though the provider subscription is
// healthy. `scripts/import-history.mjs` runs the provider calls from a machine
// with its own allowance and posts the results here. The provider credential
// stays on that machine; only fixture data crosses the wire.
//
// Writes are guarded by the site's owner-only access, exactly as `POST
// /history` is — this route reaches no third party and holds no credential of
// its own.

const MAX_FIXTURES = 700;
const MAX_GOALS = 99;

type UploadBody = {
  league?: unknown;
  season?: unknown;
  fixtures?: unknown;
  competitionLogo?: unknown;
  replace?: unknown;
};

export async function POST(request: Request) {
  let body: UploadBody;
  try {
    body = await request.json() as UploadBody;
  } catch {
    return badRequest('The request body must be JSON.');
  }

  const leagueId = Number(body.league);
  const competition = getCompetition(leagueId);
  if (!competition) return badRequest('That competition is not enabled.');

  const season = Number(body.season);
  if (!isSupportedSeason(season)) {
    return badRequest(`Choose a season between ${MIN_SEASON} and ${maxSeason()}.`);
  }

  if (!Array.isArray(body.fixtures) || !body.fixtures.length) {
    return badRequest('Send at least one fixture.');
  }
  if (body.fixtures.length > MAX_FIXTURES) {
    return badRequest(`A season upload is limited to ${MAX_FIXTURES} fixtures.`);
  }

  const fixtures: SeasonFixture[] = [];
  const seen = new Set<number>();
  for (const [index, entry] of body.fixtures.entries()) {
    const parsed = parseFixture(entry, index);
    if (typeof parsed === 'string') return badRequest(parsed);
    if (seen.has(parsed.id)) return badRequest(`Fixture ${parsed.id} appears more than once.`);
    seen.add(parsed.id);
    fixtures.push(parsed);
  }

  const startedAt = new Date().toISOString();
  let db: D1Database | null = null;
  try {
    db = await ensureFootballSchema();
    const state = await readSeasonState(db, leagueId, season);
    if (state.complete && body.replace !== true) {
      return Response.json({
        connected: true,
        competition: { id: leagueId, name: competition.name, country: competition.country },
        season,
        records: state.records,
        status: 'already-stored',
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const records = await storeSeason(db, {
      competitionId: leagueId,
      season,
      competition,
      competitionLogo: optionalText(body.competitionLogo, 300),
      fixtures,
      startedAt,
    });

    return Response.json({
      connected: true,
      competition: { id: leagueId, name: competition.name, country: competition.country },
      season,
      records,
      teams: new Set(fixtures.flatMap((fixture) => [fixture.homeTeamId, fixture.awayTeamId])).size,
      status: 'imported',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The upload could not be stored.';
    if (db) await recordFailedSeason(db, leagueId, season, message, startedAt);
    return Response.json({ connected: false, error: message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

// Returns the fixture, or a message naming the field and row that failed.
function parseFixture(entry: unknown, index: number): SeasonFixture | string {
  const at = `Fixture ${index + 1}`;
  if (!entry || typeof entry !== 'object') return `${at} is not an object.`;
  const row = entry as Record<string, unknown>;

  const id = identifier(row.id);
  if (id === null) return `${at} has no valid fixture id.`;
  const homeTeamId = identifier(row.homeTeamId);
  const awayTeamId = identifier(row.awayTeamId);
  if (homeTeamId === null || awayTeamId === null) return `${at} has an invalid team id.`;
  if (homeTeamId === awayTeamId) return `${at} lists the same team home and away.`;

  const homeTeamName = optionalText(row.homeTeamName, 120);
  const awayTeamName = optionalText(row.awayTeamName, 120);
  if (!homeTeamName || !awayTeamName) return `${at} is missing a team name.`;

  const kickoff = optionalText(row.kickoff, 40);
  if (!kickoff || !Number.isFinite(Date.parse(kickoff))) return `${at} has an invalid kickoff time.`;

  const status = optionalText(row.status, 10);
  if (!status) return `${at} has no status.`;

  const homeGoals = goals(row.homeGoals);
  const awayGoals = goals(row.awayGoals);
  if (homeGoals === false || awayGoals === false) return `${at} has an invalid score.`;

  return {
    id,
    kickoff,
    status,
    round: optionalText(row.round, 120),
    venue: optionalText(row.venue, 160),
    homeTeamId,
    homeTeamName,
    homeTeamLogo: optionalText(row.homeTeamLogo, 300),
    awayTeamId,
    awayTeamName,
    awayTeamLogo: optionalText(row.awayTeamLogo, 300),
    homeGoals,
    awayGoals,
  };
}

function identifier(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function optionalText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

// `false` marks an invalid score, which `null` cannot: an unplayed fixture
// legitimately has no goals.
function goals(value: unknown): number | null | false {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_GOALS) return false;
  return parsed;
}

function badRequest(error: string) {
  return Response.json({ connected: false, error }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
}

import { ensureFootballSchema } from '@/db/football';
import { readKnownFixtures, storeMatchDetail, type BookmakerOdds, type DetailImport, type LineupPlayer, type MatchDetail, type PlayerInjury, type PlayerStatistics, type TeamLineup, type TeamStatistics } from '@/db/match-detail';

// Per-match detail collected by a local importer: shot and possession counts,
// line-ups, and bookmaker prices. Like the season upload, the provider call
// happens on a machine with its own allowance and only the data arrives here.
//
// Detail is attached to fixtures that are already stored; a fixture id the
// database does not know is refused rather than creating a shell row.

const MAX_FIXTURES = 50;
const MAX_TEAMS = 2;
const MAX_BOOKMAKERS = 30;
const MAX_PLAYERS = 30;
const MAX_INJURIES = 80;
const MAX_PLAYER_STATISTICS = 80;
// Passing totals regularly exceed 500; 5,000 still rejects implausible or
// accidentally cumulative values while accommodating real match data.
const MAX_COUNT = 5000;
const MIN_ODDS = 1.01;
const MAX_ODDS = 1000;

export async function POST(request: Request) {
  let body: { fixtures?: unknown };
  try {
    body = await request.json() as { fixtures?: unknown };
  } catch {
    return badRequest('The request body must be JSON.');
  }

  if (!Array.isArray(body.fixtures) || !body.fixtures.length) return badRequest('Send at least one fixture.');
  if (body.fixtures.length > MAX_FIXTURES) return badRequest(`An upload is limited to ${MAX_FIXTURES} fixtures.`);

  const details: MatchDetail[] = [];
  const seen = new Set<number>();
  for (const [index, entry] of body.fixtures.entries()) {
    const parsed = parseDetail(entry, index);
    if (typeof parsed === 'string') return badRequest(parsed);
    if (seen.has(parsed.fixtureId)) return badRequest(`Fixture ${parsed.fixtureId} appears more than once.`);
    seen.add(parsed.fixtureId);
    details.push(parsed);
  }

  try {
    const db = await ensureFootballSchema();
    const known = await readKnownFixtures(db, [...seen]);
    const unknown = [...seen].filter((id) => !known.has(id));
    if (unknown.length) {
      return badRequest(`${unknown.length} fixture${unknown.length === 1 ? ' is' : 's are'} not in the database: ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? '…' : ''}. Import the season first.`);
    }

    const stored = await storeMatchDetail(db, details);
    return Response.json({ connected: true, ...stored }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({
      connected: false,
      error: error instanceof Error ? error.message : 'The match detail could not be stored.',
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

function parseDetail(entry: unknown, index: number): MatchDetail | string {
  const at = `Fixture ${index + 1}`;
  if (!entry || typeof entry !== 'object') return `${at} is not an object.`;
  const row = entry as Record<string, unknown>;

  const fixtureId = identifier(row.fixtureId);
  if (fixtureId === null) return `${at} has no valid fixture id.`;

  const statistics: TeamStatistics[] = [];
  const players: PlayerStatistics[] = [];
  const lineups: TeamLineup[] = [];
  const odds: BookmakerOdds[] = [];
  const injuries: PlayerInjury[] = [];
  const observed = parseObserved(row.observed);
  if (typeof observed === 'string') return `${at} ${observed}`;
  const imports = parseImports(row.imports);
  if (typeof imports === 'string') return `${at} ${imports}`;

  if (row.statistics !== undefined && row.statistics !== null) {
    if (!Array.isArray(row.statistics) || row.statistics.length > MAX_TEAMS) return `${at} must carry statistics for at most ${MAX_TEAMS} teams.`;
    for (const item of row.statistics) {
      const parsed = parseStatistics(item, at);
      if (typeof parsed === 'string') return parsed;
      statistics.push(parsed);
    }
  }

  if (row.lineups !== undefined && row.lineups !== null) {
    if (!Array.isArray(row.lineups) || row.lineups.length > MAX_TEAMS) return `${at} must carry line-ups for at most ${MAX_TEAMS} teams.`;
    for (const item of row.lineups) {
      const parsed = parseLineup(item, at);
      if (typeof parsed === 'string') return parsed;
      lineups.push(parsed);
    }
  }

  if (row.odds !== undefined && row.odds !== null) {
    if (!Array.isArray(row.odds) || row.odds.length > MAX_BOOKMAKERS) return `${at} must carry at most ${MAX_BOOKMAKERS} bookmakers.`;
    for (const item of row.odds) {
      const parsed = parseOdds(item, at);
      if (typeof parsed === 'string') return parsed;
      odds.push(parsed);
    }
  }

  if (row.players !== undefined && row.players !== null) {
    if (!Array.isArray(row.players) || row.players.length > MAX_PLAYER_STATISTICS) return `${at} must carry statistics for at most ${MAX_PLAYER_STATISTICS} players.`;
    for (const item of row.players) {
      const parsed = parsePlayerStatistics(item, at);
      if (typeof parsed === 'string') return parsed;
      players.push(parsed);
    }
  }

  if (row.injuries !== undefined && row.injuries !== null) {
    if (!Array.isArray(row.injuries) || row.injuries.length > MAX_INJURIES) return `${at} must carry at most ${MAX_INJURIES} injuries.`;
    for (const item of row.injuries) {
      const parsed = parseInjury(item, at);
      if (typeof parsed === 'string') return parsed;
      injuries.push(parsed);
    }
  }

  if (!statistics.length && !players.length && !lineups.length && !odds.length && !injuries.length && !observed.length && !imports.length) return `${at} carries no team statistics, player statistics, line-ups, injuries, odds or import outcomes.`;
  if (duplicateTeams(statistics)) return `${at} repeats a team in its statistics.`;
  if (duplicateTeams(lineups)) return `${at} repeats a team in its line-ups.`;
  if (new Set(players.map((player) => `${player.teamId}:${player.playerId}`)).size !== players.length) return `${at} repeats a player statistics row.`;
  if (new Set(odds.map((book) => book.bookmakerId)).size !== odds.length) return `${at} repeats a bookmaker.`;

  return { fixtureId, statistics, players, lineups, odds, injuries, observed, imports };
}

function parseImports(value: unknown): DetailImport[] | string {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 5) return 'has a malformed import-outcome list.';
  const classes = new Set(['statistics', 'players', 'lineups', 'injuries', 'odds']);
  const statuses = new Set(['stored', 'empty', 'failed']);
  const parsed: DetailImport[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return 'has a malformed import outcome.';
    const row = entry as Record<string, unknown>;
    const detailClass = typeof row.detailClass === 'string' ? row.detailClass : '';
    const status = typeof row.status === 'string' ? row.status : '';
    if (!classes.has(detailClass) || !statuses.has(status)) return 'has an unsupported import outcome.';
    parsed.push({ detailClass, status, message: optionalText(row.message, 240) } as DetailImport);
  }
  if (new Set(parsed.map((item) => item.detailClass)).size !== parsed.length) return 'repeats an import outcome.';
  return parsed;
}

function parsePlayerStatistics(entry: unknown, at: string): PlayerStatistics | string {
  if (!entry || typeof entry !== 'object') return `${at} has a malformed player statistics entry.`;
  const row = entry as Record<string, unknown>;
  const teamId = identifier(row.teamId);
  const playerId = identifier(row.playerId);
  const playerName = optionalText(row.playerName, 120);
  if (teamId === null || playerId === null) return `${at} has player statistics with an invalid team or player id.`;
  if (!playerName) return `${at} has player statistics with no player name.`;

  const parsed: Record<string, number | null> = {};
  for (const key of ['offsides', 'shotsTotal', 'shotsOn', 'goals', 'goalsConceded', 'assists', 'saves', 'passesTotal', 'passesKey', 'tackles', 'blocks', 'interceptions', 'duels', 'duelsWon', 'dribblesAttempts', 'dribblesSuccess', 'dribbledPast', 'foulsDrawn', 'foulsCommitted', 'yellowCards', 'redCards', 'penaltiesWon', 'penaltiesCommitted', 'penaltiesScored', 'penaltiesMissed', 'penaltiesSaved'] as const) {
    const value = count(row[key]);
    if (value === false) return `${at} has an invalid player ${key} value.`;
    parsed[key] = value;
  }
  const minutes = bounded(row.minutes, 0, 300);
  const rating = bounded(row.rating, 0, 10);
  // API-Football labels this field "accuracy", but fixture-player responses
  // contain an accurate-pass count rather than a bounded percentage.
  const passesAccuracy = count(row.passesAccuracy);
  if (minutes === false || rating === false || passesAccuracy === false) return `${at} has invalid player minutes, rating or accurate-pass count.`;
  const captain = optionalBoolean(row.captain);
  const substitute = optionalBoolean(row.substitute);
  if (captain === 'invalid' || substitute === 'invalid') return `${at} has invalid player role flags.`;
  return {
    teamId, playerId, playerName, position: optionalText(row.position, 20), minutes, rating,
    captain, substitute, passesAccuracy,
    ...(parsed as Omit<PlayerStatistics, 'teamId' | 'playerId' | 'playerName' | 'position' | 'minutes' | 'rating' | 'captain' | 'substitute' | 'passesAccuracy'>),
  };
}

function parseObserved(value: unknown): Array<'lineups' | 'injuries'> | string {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return 'has a malformed observed-class list.';
  const supported = new Set(['lineups', 'injuries']);
  const parsed = [...new Set(value.map(String))];
  if (parsed.some((item) => !supported.has(item))) return 'has an unsupported observed class.';
  return parsed as Array<'lineups' | 'injuries'>;
}

function parseInjury(entry: unknown, at: string): PlayerInjury | string {
  if (!entry || typeof entry !== 'object') return `${at} has a malformed injury entry.`;
  const row = entry as Record<string, unknown>;
  const teamId = identifier(row.teamId);
  if (teamId === null) return `${at} has an injury with an invalid team id.`;
  const playerName = optionalText(row.playerName, 120);
  if (!playerName) return `${at} has an injury with no player name.`;
  return {
    teamId,
    playerId: identifier(row.playerId),
    playerName,
    injuryType: optionalText(row.injuryType, 80),
    reason: optionalText(row.reason, 160),
  };
}

function parseStatistics(entry: unknown, at: string): TeamStatistics | string {
  if (!entry || typeof entry !== 'object') return `${at} has a malformed statistics entry.`;
  const row = entry as Record<string, unknown>;
  const teamId = identifier(row.teamId);
  if (teamId === null) return `${at} has statistics with an invalid team id.`;

  const counts = ['shotsTotal', 'shotsOn', 'shotsOff', 'shotsBlocked', 'shotsInsideBox', 'shotsOutsideBox', 'fouls', 'corners', 'offsides', 'yellowCards', 'redCards', 'saves', 'passesTotal', 'passesAccurate'] as const;
  const parsed: Record<string, number | null> = {};
  for (const key of counts) {
    const value = count(row[key]);
    if (value === false) return `${at} has an invalid ${key} value.`;
    parsed[key] = value;
  }

  const possession = bounded(row.possession, 0, 100);
  if (possession === false) return `${at} has an invalid possession value.`;
  const expectedGoals = bounded(row.expectedGoals, 0, 30);
  if (expectedGoals === false) return `${at} has an invalid expected goals value.`;

  return { teamId, ...(parsed as Omit<TeamStatistics, 'teamId' | 'possession' | 'expectedGoals'>), possession, expectedGoals };
}

function parseLineup(entry: unknown, at: string): TeamLineup | string {
  if (!entry || typeof entry !== 'object') return `${at} has a malformed line-up entry.`;
  const row = entry as Record<string, unknown>;
  const teamId = identifier(row.teamId);
  if (teamId === null) return `${at} has a line-up with an invalid team id.`;

  const starters = parsePlayers(row.starters, at);
  if (typeof starters === 'string') return starters;
  const substitutes = parsePlayers(row.substitutes, at);
  if (typeof substitutes === 'string') return substitutes;

  return {
    teamId,
    formation: optionalText(row.formation, 20),
    coach: optionalText(row.coach, 120),
    starters,
    substitutes,
  };
}

function parsePlayers(value: unknown, at: string): LineupPlayer[] | string {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return `${at} has a malformed player list.`;
  if (value.length > MAX_PLAYERS) return `${at} lists more than ${MAX_PLAYERS} players in one group.`;

  const players: LineupPlayer[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return `${at} has a malformed player entry.`;
    const row = entry as Record<string, unknown>;
    const name = optionalText(row.name, 120);
    if (!name) return `${at} has a player with no name.`;
    const number = bounded(row.number, 0, 99);
    if (number === false) return `${at} has a player with an invalid shirt number.`;
    players.push({
      id: identifier(row.id),
      name,
      number,
      position: optionalText(row.position, 20),
      grid: optionalText(row.grid, 10),
    });
  }
  return players;
}

function parseOdds(entry: unknown, at: string): BookmakerOdds | string {
  if (!entry || typeof entry !== 'object') return `${at} has a malformed odds entry.`;
  const row = entry as Record<string, unknown>;
  const bookmakerId = identifier(row.bookmakerId);
  if (bookmakerId === null) return `${at} has odds with an invalid bookmaker id.`;
  const bookmaker = optionalText(row.bookmaker, 80);
  if (!bookmaker) return `${at} has odds with no bookmaker name.`;

  const prices: Record<string, number | null> = {};
  for (const key of ['home', 'draw', 'away', 'over25', 'under25', 'bttsYes', 'bttsNo'] as const) {
    const value = bounded(row[key], MIN_ODDS, MAX_ODDS);
    if (value === false) return `${at} has an invalid ${key} price from ${bookmaker}.`;
    prices[key] = value;
  }

  return { bookmakerId, bookmaker, ...(prices as Omit<BookmakerOdds, 'bookmakerId' | 'bookmaker'>) };
}

function duplicateTeams(entries: Array<{ teamId: number }>) {
  return new Set(entries.map((entry) => entry.teamId)).size !== entries.length;
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

function optionalBoolean(value: unknown): boolean | null | 'invalid' {
  if (value === null || value === undefined) return null;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  return 'invalid';
}

// `false` marks an invalid value; `null` is a statistic the provider omitted.
function count(value: unknown): number | null | false {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_COUNT) return false;
  return parsed;
}

function bounded(value: unknown, minimum: number, maximum: number): number | null | false {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) return false;
  return parsed;
}

function badRequest(error: string) {
  return Response.json({ connected: false, error }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
}

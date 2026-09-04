import type { LineupPlayer, PlayerInjury, TeamLineup } from '@/db/match-detail';

// Reading side of the per-match detail tables. The statistics come back in the
// provider's {type, value} shape so a stored match and a live one render the
// same way.

type StatisticsRow = {
  team_id: number;
  shots_total: number | null;
  shots_on: number | null;
  shots_off: number | null;
  shots_blocked: number | null;
  shots_inside_box: number | null;
  shots_outside_box: number | null;
  fouls: number | null;
  corners: number | null;
  offsides: number | null;
  possession: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  saves: number | null;
  passes_total: number | null;
  passes_accurate: number | null;
  expected_goals: number | null;
};

type LineupRow = {
  team_id: number;
  formation: string | null;
  coach: string | null;
  starters: string;
  substitutes: string;
};

type PlayerStatisticsRow = {
  team_id: number;
  player_id: number;
  player_name: string;
  position: string | null;
  minutes: number | null;
  shots_total: number | null;
  shots_on: number | null;
  fouls_drawn: number | null;
  fouls_committed: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
};

type OddsRow = {
  bookmaker_id: number;
  bookmaker: string;
  home_odds: number | null;
  draw_odds: number | null;
  away_odds: number | null;
  over25_odds: number | null;
  under25_odds: number | null;
  btts_yes_odds: number | null;
  btts_no_odds: number | null;
};

type AvailabilityRow = {
  lineups: string;
  injuries: string;
  captured_at: string;
};

const LABELS: Array<[keyof StatisticsRow, string, 'count' | 'percent']> = [
  ['shots_total', 'Total Shots', 'count'],
  ['shots_on', 'Shots on Goal', 'count'],
  ['shots_off', 'Shots off Goal', 'count'],
  ['shots_blocked', 'Blocked Shots', 'count'],
  ['shots_inside_box', 'Shots insidebox', 'count'],
  ['shots_outside_box', 'Shots outsidebox', 'count'],
  ['expected_goals', 'expected_goals', 'count'],
  ['possession', 'Ball Possession', 'percent'],
  ['passes_total', 'Total passes', 'count'],
  ['passes_accurate', 'Passes accurate', 'count'],
  ['corners', 'Corner Kicks', 'count'],
  ['offsides', 'Offsides', 'count'],
  ['fouls', 'Fouls', 'count'],
  ['yellow_cards', 'Yellow Cards', 'count'],
  ['red_cards', 'Red Cards', 'count'],
  ['saves', 'Goalkeeper Saves', 'count'],
];

export async function readStoredStatistics(db: D1Database, fixtureId: number, teamOrder: number[]) {
  const rows = (await db
    .prepare('SELECT * FROM fixture_statistics WHERE fixture_id = ?')
    .bind(fixtureId)
    .all<StatisticsRow>()).results;
  return order(rows, teamOrder, (row) => row.team_id).map((row) => ({
    team: { id: row.team_id },
    statistics: LABELS
      .filter(([key]) => row[key] !== null)
      .map(([key, type, kind]) => ({ type, value: kind === 'percent' ? `${row[key]}%` : row[key] })),
  }));
}

export async function readStoredLineups(db: D1Database, fixtureId: number, teamOrder: number[]) {
  const rows = (await db
    .prepare('SELECT team_id, formation, coach, starters, substitutes FROM fixture_lineups WHERE fixture_id = ?')
    .bind(fixtureId)
    .all<LineupRow>()).results;
  return order(rows, teamOrder, (row) => row.team_id).map((row) => ({
    teamId: row.team_id,
    formation: row.formation,
    coach: row.coach,
    starters: parsePlayers(row.starters),
    substitutes: parsePlayers(row.substitutes),
  }));
}

export async function readStoredPlayerStatistics(db: D1Database, fixtureId: number, teamOrder: number[]) {
  const rows = (await db.prepare(`
    SELECT team_id, player_id, player_name, position, minutes, shots_total, shots_on,
           fouls_drawn, fouls_committed, yellow_cards, red_cards
    FROM fixture_player_statistics
    WHERE fixture_id = ?
    ORDER BY team_id, minutes DESC, player_name
  `).bind(fixtureId).all<PlayerStatisticsRow>()).results;
  return order(rows, teamOrder, (row) => row.team_id).map((row) => ({
    teamId: row.team_id,
    playerId: row.player_id,
    playerName: row.player_name,
    position: row.position,
    minutes: row.minutes,
    shotsTotal: row.shots_total,
    shotsOn: row.shots_on,
    foulsDrawn: row.fouls_drawn,
    foulsCommitted: row.fouls_committed,
    yellowCards: row.yellow_cards,
    redCards: row.red_cards,
  }));
}

export async function readStoredOdds(db: D1Database, fixtureId: number) {
  const rows = (await db
    .prepare('SELECT bookmaker_id, bookmaker, home_odds, draw_odds, away_odds, over25_odds, under25_odds, btts_yes_odds, btts_no_odds FROM fixture_odds WHERE fixture_id = ? ORDER BY bookmaker')
    .bind(fixtureId)
    .all<OddsRow>()).results;

  const books = rows.map((row) => ({
    bookmakerId: row.bookmaker_id,
    bookmaker: row.bookmaker,
    prices: { home: row.home_odds, draw: row.draw_odds, away: row.away_odds, over25: row.over25_odds, under25: row.under25_odds, bttsYes: row.btts_yes_odds, bttsNo: row.btts_no_odds },
  }));

  // The market's own view, with the bookmaker's margin divided out, averaged
  // across every book that quoted a complete 1X2 price.
  const complete = books.filter((book) => book.prices.home && book.prices.draw && book.prices.away);
  const implied = complete.map((book) => {
    const raw = [1 / book.prices.home!, 1 / book.prices.draw!, 1 / book.prices.away!];
    const overround = raw[0] + raw[1] + raw[2];
    return { probabilities: raw.map((value) => value / overround), overround };
  });

  return {
    bookmakers: books,
    market: implied.length ? {
      bookmakers: implied.length,
      overround: round(implied.reduce((sum, book) => sum + book.overround, 0) / implied.length, 4),
      probabilities: {
        home: percent(average(implied.map((book) => book.probabilities[0]))),
        draw: percent(average(implied.map((book) => book.probabilities[1]))),
        away: percent(average(implied.map((book) => book.probabilities[2]))),
      },
    } : null,
  };
}

export async function readLatestAvailability(db: D1Database, fixtureId: number, beforeKickoff: string) {
  const row = await db
    .prepare(`
      SELECT lineups, injuries, captured_at
      FROM fixture_availability_snapshots
      WHERE fixture_id = ? AND captured_at < ?
      ORDER BY captured_at DESC, id DESC
      LIMIT 1
    `)
    .bind(fixtureId, beforeKickoff)
    .first<AvailabilityRow>();
  if (!row) return null;
  return {
    capturedAt: row.captured_at,
    lineups: parseJsonArray<TeamLineup>(row.lineups),
    injuries: parseJsonArray<PlayerInjury>(row.injuries),
  };
}

// Home team first, then away, then anything else the provider supplied.
function order<T>(rows: T[], teamOrder: number[], teamId: (row: T) => number) {
  return [...rows].sort((a, b) => {
    const first = teamOrder.indexOf(teamId(a));
    const second = teamOrder.indexOf(teamId(b));
    return (first === -1 ? teamOrder.length : first) - (second === -1 ? teamOrder.length : second);
  });
}

function parsePlayers(value: string): LineupPlayer[] {
  return parseJsonArray<LineupPlayer>(value);
}

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function average(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function percent(value: number) { return round(value * 100, 1); }
function round(value: number, places: number) { return Number(value.toFixed(places)); }

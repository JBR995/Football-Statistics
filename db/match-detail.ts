// Per-match detail the fixtures table does not hold: shot and possession
// counts, the line-ups that produced them, and the market's price on the
// result. Each is keyed on a fixture that must already be stored, so nothing
// here can invent a match.

export type TeamStatistics = {
  teamId: number;
  shotsTotal: number | null;
  shotsOn: number | null;
  shotsOff: number | null;
  shotsBlocked: number | null;
  shotsInsideBox: number | null;
  shotsOutsideBox: number | null;
  fouls: number | null;
  corners: number | null;
  offsides: number | null;
  possession: number | null;
  yellowCards: number | null;
  redCards: number | null;
  saves: number | null;
  passesTotal: number | null;
  passesAccurate: number | null;
  expectedGoals: number | null;
};

export type TeamLineup = {
  teamId: number;
  formation: string | null;
  coach: string | null;
  starters: LineupPlayer[];
  substitutes: LineupPlayer[];
};

export type LineupPlayer = {
  id: number | null;
  name: string;
  number: number | null;
  position: string | null;
  grid: string | null;
};

export type PlayerInjury = {
  teamId: number;
  playerId: number | null;
  playerName: string;
  injuryType: string | null;
  reason: string | null;
};

export type BookmakerOdds = {
  bookmakerId: number;
  bookmaker: string;
  home: number | null;
  draw: number | null;
  away: number | null;
  over25: number | null;
  under25: number | null;
  bttsYes: number | null;
  bttsNo: number | null;
};

export type MatchDetail = {
  fixtureId: number;
  statistics: TeamStatistics[];
  lineups: TeamLineup[];
  odds: BookmakerOdds[];
  injuries: PlayerInjury[];
  observed: Array<'lineups' | 'injuries'>;
};

const BATCH_SIZE = 75;

export function statisticsStatements(db: D1Database, fixtureId: number, statistics: TeamStatistics[], updatedAt: string) {
  return statistics.map((team) => db.prepare(`
    INSERT INTO fixture_statistics (fixture_id, team_id, shots_total, shots_on, shots_off, shots_blocked, shots_inside_box, shots_outside_box, fouls, corners, offsides, possession, yellow_cards, red_cards, saves, passes_total, passes_accurate, expected_goals, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fixture_id, team_id) DO UPDATE SET
      shots_total=excluded.shots_total, shots_on=excluded.shots_on, shots_off=excluded.shots_off,
      shots_blocked=excluded.shots_blocked, shots_inside_box=excluded.shots_inside_box, shots_outside_box=excluded.shots_outside_box,
      fouls=excluded.fouls, corners=excluded.corners, offsides=excluded.offsides, possession=excluded.possession,
      yellow_cards=excluded.yellow_cards, red_cards=excluded.red_cards, saves=excluded.saves,
      passes_total=excluded.passes_total, passes_accurate=excluded.passes_accurate,
      expected_goals=excluded.expected_goals, updated_at=excluded.updated_at
  `).bind(
    fixtureId, team.teamId, team.shotsTotal, team.shotsOn, team.shotsOff, team.shotsBlocked,
    team.shotsInsideBox, team.shotsOutsideBox, team.fouls, team.corners, team.offsides, team.possession,
    team.yellowCards, team.redCards, team.saves, team.passesTotal, team.passesAccurate, team.expectedGoals, updatedAt,
  ));
}

export function lineupStatements(db: D1Database, fixtureId: number, lineups: TeamLineup[], updatedAt: string) {
  return lineups.map((team) => db.prepare(`
    INSERT INTO fixture_lineups (fixture_id, team_id, formation, coach, starters, substitutes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fixture_id, team_id) DO UPDATE SET
      formation=excluded.formation, coach=excluded.coach, starters=excluded.starters,
      substitutes=excluded.substitutes, updated_at=excluded.updated_at
  `).bind(fixtureId, team.teamId, team.formation, team.coach, JSON.stringify(team.starters), JSON.stringify(team.substitutes), updatedAt));
}

export function oddsStatements(db: D1Database, fixtureId: number, odds: BookmakerOdds[], updatedAt: string) {
  return odds.map((book) => db.prepare(`
    INSERT INTO fixture_odds (fixture_id, bookmaker_id, bookmaker, home_odds, draw_odds, away_odds, over25_odds, under25_odds, btts_yes_odds, btts_no_odds, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fixture_id, bookmaker_id) DO UPDATE SET
      bookmaker=excluded.bookmaker, home_odds=excluded.home_odds, draw_odds=excluded.draw_odds, away_odds=excluded.away_odds,
      over25_odds=excluded.over25_odds, under25_odds=excluded.under25_odds,
      btts_yes_odds=excluded.btts_yes_odds, btts_no_odds=excluded.btts_no_odds, updated_at=excluded.updated_at
  `).bind(
    fixtureId, book.bookmakerId, book.bookmaker, book.home, book.draw, book.away,
    book.over25, book.under25, book.bttsYes, book.bttsNo, updatedAt,
  ));
}

export async function storeMatchDetail(db: D1Database, details: MatchDetail[]) {
  const updatedAt = new Date().toISOString();
  const kickoffRows = details.length ? (await db
    .prepare(`SELECT id, kickoff FROM fixtures WHERE id IN (${details.map(() => '?').join(', ')})`)
    .bind(...details.map((detail) => detail.fixtureId))
    .all<{ id: number; kickoff: string }>()).results : [];
  const kickoffs = new Map(kickoffRows.map((row) => [row.id, row.kickoff]));
  const availability = details.filter((detail) => detail.observed.length && updatedAt < (kickoffs.get(detail.fixtureId) ?? ''));
  const statements = details.flatMap((detail) => [
    ...statisticsStatements(db, detail.fixtureId, detail.statistics, updatedAt),
    ...lineupStatements(db, detail.fixtureId, detail.lineups, updatedAt),
    ...oddsStatements(db, detail.fixtureId, detail.odds, updatedAt),
  ]).concat(availability.map((detail) => db.prepare(`
    INSERT INTO fixture_availability_snapshots (fixture_id, lineups, injuries, captured_at)
    VALUES (?, ?, ?, ?)
  `).bind(
    detail.fixtureId,
    JSON.stringify(detail.observed.includes('lineups') ? detail.lineups : []),
    JSON.stringify(detail.observed.includes('injuries') ? detail.injuries : []),
    updatedAt,
  )));
  for (let index = 0; index < statements.length; index += BATCH_SIZE) {
    await db.batch(statements.slice(index, index + BATCH_SIZE));
  }
  return {
    fixtures: details.length,
    statistics: details.reduce((sum, detail) => sum + detail.statistics.length, 0),
    lineups: details.reduce((sum, detail) => sum + detail.lineups.length, 0),
    odds: details.reduce((sum, detail) => sum + detail.odds.length, 0),
    injuries: details.reduce((sum, detail) => sum + detail.injuries.length, 0),
    availabilitySnapshots: availability.length,
  };
}

// Which of the given fixtures are stored at all. Detail for an unknown
// fixture is refused rather than orphaned.
export async function readKnownFixtures(db: D1Database, fixtureIds: number[]) {
  const known = new Set<number>();
  for (let index = 0; index < fixtureIds.length; index += BATCH_SIZE) {
    const slice = fixtureIds.slice(index, index + BATCH_SIZE);
    const rows = (await db
      .prepare(`SELECT id FROM fixtures WHERE id IN (${slice.map(() => '?').join(', ')})`)
      .bind(...slice)
      .all<{ id: number }>()).results;
    for (const row of rows) known.add(row.id);
  }
  return known;
}

export const ROLLING_WINDOW = 5;
export const MINIMUM_TEAM_HISTORY = 5;

export type TeamMatchStatistics = {
  shotsTotal: number | null;
  shotsOn: number | null;
  fouls: number | null;
  possession: number | null;
  corners: number | null;
  yellowCards: number | null;
  redCards: number | null;
  passesTotal: number | null;
  passesAccurate: number | null;
  expectedGoals: number | null;
};

export type FeatureMatch = {
  id: number;
  competitionId: number;
  season: number;
  kickoff: string;
  homeTeamId: number;
  awayTeamId: number;
  homeGoals: number;
  awayGoals: number;
  homeStatistics: TeamMatchStatistics | null;
  awayStatistics: TeamMatchStatistics | null;
};

type TeamObservation = {
  kickoffMs: number;
  goalsFor: number;
  goalsAgainst: number;
  shotsFor: number | null;
  shotsAgainst: number | null;
  shotsOnFor: number | null;
  shotsOnAgainst: number | null;
  possession: number | null;
  cornersFor: number | null;
  cornersAgainst: number | null;
  fouls: number | null;
  cardPoints: number | null;
  passAccuracy: number | null;
  expectedGoalsFor: number | null;
  expectedGoalsAgainst: number | null;
};

export type PreMatchFeatureRow = {
  fixtureId: number;
  competitionId: number;
  season: number;
  kickoff: string;
  homeTeamId: number;
  awayTeamId: number;
  rollingWindow: number;
  homeGoalsFor: number;
  homeGoalsAgainst: number;
  awayGoalsFor: number;
  awayGoalsAgainst: number;
  homeShotsFor: number;
  homeShotsAgainst: number;
  awayShotsFor: number;
  awayShotsAgainst: number;
  homeShotsOnFor: number;
  homeShotsOnAgainst: number;
  awayShotsOnFor: number;
  awayShotsOnAgainst: number;
  homePossession: number | null;
  awayPossession: number | null;
  homeCornersFor: number | null;
  homeCornersAgainst: number | null;
  awayCornersFor: number | null;
  awayCornersAgainst: number | null;
  homeFouls: number | null;
  awayFouls: number | null;
  homeCardPoints: number | null;
  awayCardPoints: number | null;
  homePassAccuracy: number | null;
  awayPassAccuracy: number | null;
  homeExpectedGoalsFor: number | null;
  homeExpectedGoalsAgainst: number | null;
  awayExpectedGoalsFor: number | null;
  awayExpectedGoalsAgainst: number | null;
  homeRestDays: number;
  awayRestDays: number;
  targetHomeGoals: number;
  targetAwayGoals: number;
  targetOutcome: 'H' | 'D' | 'A';
};

export type FeatureAudit = {
  matches: number;
  matchesWithStatistics: number;
  coreStatisticsMatches: number;
  eligibleRows: number;
  firstEligibleKickoff: string | null;
  lastEligibleKickoff: string | null;
  coverage: {
    statistics: number;
    core: number;
    possession: number;
    corners: number;
    fouls: number;
    yellowCards: number;
    redCards: number;
    passing: number;
    expectedGoals: number;
  };
};

export function buildPreMatchFeatures(matches: FeatureMatch[]) {
  const ordered = [...matches].sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.id - b.id);
  const histories = new Map<number, TeamObservation[]>();
  const rows: PreMatchFeatureRow[] = [];
  const availability = { statistics: 0, core: 0, possession: 0, corners: 0, fouls: 0, yellowCards: 0, redCards: 0, passing: 0, expectedGoals: 0 };

  for (const match of ordered) {
    countAvailability(match.homeStatistics, availability);
    countAvailability(match.awayStatistics, availability);

    const cutoff = Date.parse(match.kickoff);
    const homeHistory = (histories.get(match.homeTeamId) ?? []).filter((item) => item.kickoffMs < cutoff).slice(-ROLLING_WINDOW);
    const awayHistory = (histories.get(match.awayTeamId) ?? []).filter((item) => item.kickoffMs < cutoff).slice(-ROLLING_WINDOW);
    if (isEligible(homeHistory) && isEligible(awayHistory)) {
      rows.push(toFeatureRow(match, homeHistory, awayHistory));
    }

    append(histories, match.homeTeamId, observation(match, true));
    append(histories, match.awayTeamId, observation(match, false));
  }

  const expectedSides = ordered.length * 2;
  const percent = (count: number) => expectedSides ? Number((count * 100 / expectedSides).toFixed(1)) : 0;
  const audit: FeatureAudit = {
    matches: ordered.length,
    matchesWithStatistics: ordered.filter((match) => match.homeStatistics && match.awayStatistics).length,
    coreStatisticsMatches: ordered.filter((match) => hasCore(match.homeStatistics) && hasCore(match.awayStatistics)).length,
    eligibleRows: rows.length,
    firstEligibleKickoff: rows[0]?.kickoff ?? null,
    lastEligibleKickoff: rows.at(-1)?.kickoff ?? null,
    coverage: {
      statistics: percent(availability.statistics),
      core: percent(availability.core),
      possession: percent(availability.possession),
      corners: percent(availability.corners),
      fouls: percent(availability.fouls),
      yellowCards: percent(availability.yellowCards),
      redCards: percent(availability.redCards),
      passing: percent(availability.passing),
      expectedGoals: percent(availability.expectedGoals),
    },
  };
  return { rows, audit };
}

function toFeatureRow(match: FeatureMatch, home: TeamObservation[], away: TeamObservation[]): PreMatchFeatureRow {
  const kickoffMs = Date.parse(match.kickoff);
  return {
    fixtureId: match.id,
    competitionId: match.competitionId,
    season: match.season,
    kickoff: match.kickoff,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    rollingWindow: ROLLING_WINDOW,
    homeGoalsFor: averageRequired(home, 'goalsFor'),
    homeGoalsAgainst: averageRequired(home, 'goalsAgainst'),
    awayGoalsFor: averageRequired(away, 'goalsFor'),
    awayGoalsAgainst: averageRequired(away, 'goalsAgainst'),
    homeShotsFor: averageRequired(home, 'shotsFor'),
    homeShotsAgainst: averageRequired(home, 'shotsAgainst'),
    awayShotsFor: averageRequired(away, 'shotsFor'),
    awayShotsAgainst: averageRequired(away, 'shotsAgainst'),
    homeShotsOnFor: averageRequired(home, 'shotsOnFor'),
    homeShotsOnAgainst: averageRequired(home, 'shotsOnAgainst'),
    awayShotsOnFor: averageRequired(away, 'shotsOnFor'),
    awayShotsOnAgainst: averageRequired(away, 'shotsOnAgainst'),
    homePossession: averageOptional(home, 'possession'),
    awayPossession: averageOptional(away, 'possession'),
    homeCornersFor: averageOptional(home, 'cornersFor'),
    homeCornersAgainst: averageOptional(home, 'cornersAgainst'),
    awayCornersFor: averageOptional(away, 'cornersFor'),
    awayCornersAgainst: averageOptional(away, 'cornersAgainst'),
    homeFouls: averageOptional(home, 'fouls'),
    awayFouls: averageOptional(away, 'fouls'),
    homeCardPoints: averageOptional(home, 'cardPoints'),
    awayCardPoints: averageOptional(away, 'cardPoints'),
    homePassAccuracy: averageOptional(home, 'passAccuracy'),
    awayPassAccuracy: averageOptional(away, 'passAccuracy'),
    homeExpectedGoalsFor: averageOptional(home, 'expectedGoalsFor'),
    homeExpectedGoalsAgainst: averageOptional(home, 'expectedGoalsAgainst'),
    awayExpectedGoalsFor: averageOptional(away, 'expectedGoalsFor'),
    awayExpectedGoalsAgainst: averageOptional(away, 'expectedGoalsAgainst'),
    homeRestDays: restDays(kickoffMs, home.at(-1)!.kickoffMs),
    awayRestDays: restDays(kickoffMs, away.at(-1)!.kickoffMs),
    targetHomeGoals: match.homeGoals,
    targetAwayGoals: match.awayGoals,
    targetOutcome: match.homeGoals > match.awayGoals ? 'H' : match.homeGoals < match.awayGoals ? 'A' : 'D',
  };
}

function observation(match: FeatureMatch, home: boolean): TeamObservation {
  const own = home ? match.homeStatistics : match.awayStatistics;
  const opponent = home ? match.awayStatistics : match.homeStatistics;
  return {
    kickoffMs: Date.parse(match.kickoff),
    goalsFor: home ? match.homeGoals : match.awayGoals,
    goalsAgainst: home ? match.awayGoals : match.homeGoals,
    shotsFor: own?.shotsTotal ?? null,
    shotsAgainst: opponent?.shotsTotal ?? null,
    shotsOnFor: own?.shotsOn ?? null,
    shotsOnAgainst: opponent?.shotsOn ?? null,
    possession: own?.possession ?? null,
    cornersFor: own?.corners ?? null,
    cornersAgainst: opponent?.corners ?? null,
    fouls: own?.fouls ?? null,
    // Yellow cards are consistently supplied; red cards remain separately
    // nullable because the provider often omits the field when there was none.
    cardPoints: own?.yellowCards ?? null,
    passAccuracy: own && own.passesTotal !== null && own.passesTotal > 0 && own.passesAccurate !== null ? own.passesAccurate * 100 / own.passesTotal : null,
    expectedGoalsFor: own?.expectedGoals ?? null,
    expectedGoalsAgainst: opponent?.expectedGoals ?? null,
  };
}

function isEligible(history: TeamObservation[]) {
  return history.length === MINIMUM_TEAM_HISTORY && history.every((item) =>
    item.shotsFor !== null && item.shotsAgainst !== null && item.shotsOnFor !== null && item.shotsOnAgainst !== null);
}

function append(histories: Map<number, TeamObservation[]>, teamId: number, item: TeamObservation) {
  const history = histories.get(teamId) ?? [];
  history.push(item);
  histories.set(teamId, history.slice(-ROLLING_WINDOW));
}

function averageRequired(history: TeamObservation[], key: keyof TeamObservation) {
  return round(history.reduce((sum, item) => sum + Number(item[key]), 0) / history.length);
}

function averageOptional(history: TeamObservation[], key: keyof TeamObservation) {
  const values = history.map((item) => item[key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return values.length === history.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function restDays(kickoffMs: number, previousMs: number) {
  return round(Math.max(0, (kickoffMs - previousMs) / 86_400_000));
}

function round(value: number) {
  return Number(value.toFixed(3));
}

function countAvailability(statistics: TeamMatchStatistics | null, counts: Record<string, number>) {
  if (!statistics) return;
  counts.statistics++;
  if (statistics.shotsTotal !== null && statistics.shotsOn !== null) counts.core++;
  if (statistics.possession !== null) counts.possession++;
  if (statistics.corners !== null) counts.corners++;
  if (statistics.fouls !== null) counts.fouls++;
  if (statistics.yellowCards !== null) counts.yellowCards++;
  if (statistics.redCards !== null) counts.redCards++;
  if (statistics.passesTotal !== null && statistics.passesAccurate !== null) counts.passing++;
  if (statistics.expectedGoals !== null) counts.expectedGoals++;
}

function hasCore(statistics: TeamMatchStatistics | null): statistics is TeamMatchStatistics {
  return statistics !== null && statistics.shotsTotal !== null && statistics.shotsOn !== null;
}

// The prediction model. Kept apart from any route so the fixture view, the
// evaluation ledger and the snapshot writer all score the same way.

const COMPLETE_STATUSES = new Set(['FT', 'AET', 'PEN']);
const HOME_ADVANTAGE_ELO = 65;
const ELO_K = 24;
const SCORE_LIMIT = 7;

export const MODEL_NAME = 'Elo + Bayesian Poisson baseline';
export const MODEL_VERSION = '1.0';

export type FixtureRow = {
  id: number;
  competition_id: number;
  competition_name: string;
  season: number;
  kickoff: string;
  status: string;
  round: string | null;
  venue: string | null;
  home_team_id: number;
  home_name: string;
  home_logo: string | null;
  away_team_id: number;
  away_name: string;
  away_logo: string | null;
  home_goals: number | null;
  away_goals: number | null;
};

export type TeamTotals = {
  played: number;
  goalsFor: number;
  goalsAgainst: number;
  homePlayed: number;
  homeGoalsFor: number;
  homeGoalsAgainst: number;
  awayPlayed: number;
  awayGoalsFor: number;
  awayGoalsAgainst: number;
};

export type ModelOutput = {
  probabilities: { home: number; draw: number; away: number };
  expectedGoals: { home: number; away: number };
  markets: { over25: number; btts: number };
  scorelines: Array<{ score: string; probability: number }>;
  evidence: {
    homeElo: number;
    awayElo: number;
    homeMatches: number;
    awayMatches: number;
    leagueHomeGoals: number;
    leagueAwayGoals: number;
    homeAttack: number;
    awayAttack: number;
    homeDefence: number;
    awayDefence: number;
  };
};

// Everything a prediction needs from the training window. Fixtures sharing a
// window share this, so a batch of forecasts walks the history once.
export type ModelContext = {
  ratings: Map<number, number>;
  totals: Map<number, TeamTotals>;
  leagueHomeGoals: number;
  leagueAwayGoals: number;
  matches: number;
};

export function prepareModel(history: FixtureRow[]): ModelContext {
  const matches = Math.max(1, history.length);
  return {
    ratings: buildElo(history),
    totals: buildTeamTotals(history),
    leagueHomeGoals: history.length ? history.reduce((sum, row) => sum + (row.home_goals ?? 0), 0) / matches : 1.45,
    leagueAwayGoals: history.length ? history.reduce((sum, row) => sum + (row.away_goals ?? 0), 0) / matches : 1.15,
    matches: history.length,
  };
}

export function modelPrediction(target: FixtureRow, history: FixtureRow[]): ModelOutput {
  return predict(target, prepareModel(history));
}

export function predict(target: FixtureRow, context: ModelContext): ModelOutput {
  const { ratings, totals, leagueHomeGoals, leagueAwayGoals } = context;
  const home = totals.get(target.home_team_id) ?? emptyTotals();
  const away = totals.get(target.away_team_id) ?? emptyTotals();
  const priorMatches = 5;

  const homeAttack = smoothedRate(home.homeGoalsFor, home.homePlayed, leagueHomeGoals, priorMatches) / leagueHomeGoals;
  const homeDefence = smoothedRate(home.homeGoalsAgainst, home.homePlayed, leagueAwayGoals, priorMatches) / leagueAwayGoals;
  const awayAttack = smoothedRate(away.awayGoalsFor, away.awayPlayed, leagueAwayGoals, priorMatches) / leagueAwayGoals;
  const awayDefence = smoothedRate(away.awayGoalsAgainst, away.awayPlayed, leagueHomeGoals, priorMatches) / leagueHomeGoals;
  const homeElo = ratings.get(target.home_team_id) ?? 1500;
  const awayElo = ratings.get(target.away_team_id) ?? 1500;
  const eloEdge = homeElo + HOME_ADVANTAGE_ELO - awayElo;
  const homeEloFactor = clamp(10 ** (eloEdge / 900), 0.72, 1.38);
  const awayEloFactor = clamp(10 ** (-eloEdge / 900), 0.72, 1.38);
  const expectedHome = clamp(leagueHomeGoals * homeAttack * awayDefence * homeEloFactor, 0.2, 3.8);
  const expectedAway = clamp(leagueAwayGoals * awayAttack * homeDefence * awayEloFactor, 0.2, 3.8);

  const grid: Array<{ home: number; away: number; probability: number }> = [];
  let gridTotal = 0;
  for (let homeGoals = 0; homeGoals <= SCORE_LIMIT; homeGoals++) {
    for (let awayGoals = 0; awayGoals <= SCORE_LIMIT; awayGoals++) {
      const probability = poisson(homeGoals, expectedHome) * poisson(awayGoals, expectedAway);
      grid.push({ home: homeGoals, away: awayGoals, probability });
      gridTotal += probability;
    }
  }
  for (const cell of grid) cell.probability /= gridTotal;

  const homeProbability = grid.filter((cell) => cell.home > cell.away).reduce((sum, cell) => sum + cell.probability, 0);
  const drawProbability = grid.filter((cell) => cell.home === cell.away).reduce((sum, cell) => sum + cell.probability, 0);
  const awayProbability = 1 - homeProbability - drawProbability;
  const over25 = grid.filter((cell) => cell.home + cell.away >= 3).reduce((sum, cell) => sum + cell.probability, 0);
  const btts = grid.filter((cell) => cell.home > 0 && cell.away > 0).reduce((sum, cell) => sum + cell.probability, 0);

  return {
    probabilities: { home: percent(homeProbability), draw: percent(drawProbability), away: percent(awayProbability) },
    expectedGoals: { home: round(expectedHome, 2), away: round(expectedAway, 2) },
    markets: { over25: percent(over25), btts: percent(btts) },
    scorelines: [...grid].sort((a, b) => b.probability - a.probability).slice(0, 5).map((cell) => ({ score: `${cell.home}–${cell.away}`, probability: percent(cell.probability) })),
    evidence: {
      homeElo: Math.round(homeElo), awayElo: Math.round(awayElo), homeMatches: home.played, awayMatches: away.played,
      leagueHomeGoals: round(leagueHomeGoals, 2), leagueAwayGoals: round(leagueAwayGoals, 2),
      homeAttack: round(homeAttack, 2), awayAttack: round(awayAttack, 2), homeDefence: round(homeDefence, 2), awayDefence: round(awayDefence, 2),
    },
  };
}

export function backtest(history: FixtureRow[]) {
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  let matches = 0;
  const validationStart = Math.max(20, history.length - 100);
  for (let index = validationStart; index < history.length; index++) {
    const target = history[index];
    const output = modelPrediction(target, history.slice(0, index));
    const probabilities = [output.probabilities.home / 100, output.probabilities.draw / 100, output.probabilities.away / 100];
    const actualIndex = outcomeIndex(target.home_goals ?? 0, target.away_goals ?? 0);
    const predictedIndex = probabilities.indexOf(Math.max(...probabilities));
    if (predictedIndex === actualIndex) correct++;
    brier += probabilities.reduce((sum, probability, outcome) => sum + (probability - (outcome === actualIndex ? 1 : 0)) ** 2, 0);
    logLoss += -Math.log(Math.max(probabilities[actualIndex], 0.001));
    matches++;
  }
  return {
    matches,
    accuracy: matches ? percent(correct / matches) : 0,
    brier: matches ? round(brier / matches, 3) : null,
    logLoss: matches ? round(logLoss / matches, 3) : null,
    methodology: 'Walk-forward validation: each result is predicted using only matches completed earlier in the season.',
  };
}

// 0 home win, 1 draw, 2 away win — the order every probability triple uses.
export function outcomeIndex(homeGoals: number, awayGoals: number) {
  return homeGoals > awayGoals ? 0 : homeGoals === awayGoals ? 1 : 2;
}

export function isCompleted(fixture: Pick<FixtureRow, 'status' | 'home_goals' | 'away_goals'>) {
  return COMPLETE_STATUSES.has(fixture.status) && fixture.home_goals !== null && fixture.away_goals !== null;
}

function buildElo(history: FixtureRow[]) {
  const ratings = new Map<number, number>();
  for (const fixture of history) {
    const homeRating = ratings.get(fixture.home_team_id) ?? 1500;
    const awayRating = ratings.get(fixture.away_team_id) ?? 1500;
    const expectedHome = 1 / (1 + 10 ** ((awayRating - homeRating - HOME_ADVANTAGE_ELO) / 400));
    const actualHome = (fixture.home_goals ?? 0) > (fixture.away_goals ?? 0) ? 1 : (fixture.home_goals ?? 0) === (fixture.away_goals ?? 0) ? 0.5 : 0;
    const change = ELO_K * (actualHome - expectedHome);
    ratings.set(fixture.home_team_id, homeRating + change);
    ratings.set(fixture.away_team_id, awayRating - change);
  }
  return ratings;
}

function buildTeamTotals(history: FixtureRow[]) {
  const totals = new Map<number, TeamTotals>();
  const get = (id: number) => {
    if (!totals.has(id)) totals.set(id, emptyTotals());
    return totals.get(id)!;
  };
  for (const fixture of history) {
    const home = get(fixture.home_team_id);
    const away = get(fixture.away_team_id);
    const homeGoals = fixture.home_goals ?? 0;
    const awayGoals = fixture.away_goals ?? 0;
    home.played++; home.goalsFor += homeGoals; home.goalsAgainst += awayGoals;
    home.homePlayed++; home.homeGoalsFor += homeGoals; home.homeGoalsAgainst += awayGoals;
    away.played++; away.goalsFor += awayGoals; away.goalsAgainst += homeGoals;
    away.awayPlayed++; away.awayGoalsFor += awayGoals; away.awayGoalsAgainst += homeGoals;
  }
  return totals;
}

function emptyTotals(): TeamTotals {
  return { played: 0, goalsFor: 0, goalsAgainst: 0, homePlayed: 0, homeGoalsFor: 0, homeGoalsAgainst: 0, awayPlayed: 0, awayGoalsFor: 0, awayGoalsAgainst: 0 };
}

function smoothedRate(goals: number, matches: number, leagueRate: number, priorMatches: number) {
  return (goals + priorMatches * leagueRate) / (matches + priorMatches);
}

function poisson(goals: number, lambda: number) {
  return Math.exp(-lambda) * lambda ** goals / factorial(goals);
}

function factorial(value: number) {
  let result = 1;
  for (let number = 2; number <= value; number++) result *= number;
  return result;
}

export function percent(value: number) { return round(value * 100, 1); }
export function round(value: number, places: number) { return Number(value.toFixed(places)); }
export function clamp(value: number, minimum: number, maximum: number) { return Math.max(minimum, Math.min(maximum, value)); }

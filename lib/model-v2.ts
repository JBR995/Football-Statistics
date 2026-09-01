import {
  clamp,
  outcomeIndex,
  percent,
  prepareModel,
  round,
  type FixtureRow,
  type ModelContext,
  type ModelOutput,
} from '@/lib/model';

// A Dixon-Coles score model with exponentially decaying match weights. The
// attack and defence strengths are fitted without using anything after the
// target kickoff; rho is then selected from the low-score likelihood.
export const MODEL_V2_NAME = 'Dixon–Coles time-decayed baseline';
export const MODEL_V2_VERSION = '2.0';
export const TIME_DECAY_HALF_LIFE_DAYS = 180;

const SCORE_LIMIT = 10;
const FIT_ITERATIONS = 32;
const PRIOR_WEIGHT = 4;

export type DixonColesContext = {
  attack: Map<number, number>;
  defence: Map<number, number>;
  leagueHomeGoals: number;
  leagueAwayGoals: number;
  rho: number;
  matches: number;
  effectiveMatches: number;
  baseline: ModelContext;
};

export function prepareDixonColes(history: FixtureRow[]): DixonColesContext {
  const baseline = prepareModel(history);
  if (!history.length) {
    return {
      attack: new Map(), defence: new Map(), leagueHomeGoals: 1.45,
      leagueAwayGoals: 1.15, rho: 0, matches: 0, effectiveMatches: 0, baseline,
    };
  }

  const reference = Math.max(...history.map((fixture) => Date.parse(fixture.kickoff)).filter(Number.isFinite));
  const weights = history.map((fixture) => decayWeight(reference, Date.parse(fixture.kickoff)));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const leagueHomeGoals = weightedMean(history, weights, 'home_goals', 1.45);
  const leagueAwayGoals = weightedMean(history, weights, 'away_goals', 1.15);
  const teamIds = new Set(history.flatMap((fixture) => [fixture.home_team_id, fixture.away_team_id]));
  const attack = new Map([...teamIds].map((id) => [id, 1]));
  const defence = new Map([...teamIds].map((id) => [id, 1]));

  // Regularised weighted Poisson likelihood. Updating in log space keeps all
  // strengths positive, while centring prevents attack/defence drift.
  for (let iteration = 0; iteration < FIT_ITERATIONS; iteration++) {
    const attackGradient = zeroMap(teamIds);
    const defenceGradient = zeroMap(teamIds);
    const attackInformation = zeroMap(teamIds);
    const defenceInformation = zeroMap(teamIds);

    for (const [index, fixture] of history.entries()) {
      const weight = weights[index];
      const homeExpected = expected(leagueHomeGoals, attack, fixture.home_team_id, defence, fixture.away_team_id);
      const awayExpected = expected(leagueAwayGoals, attack, fixture.away_team_id, defence, fixture.home_team_id);
      const homeResidual = (fixture.home_goals ?? 0) - homeExpected;
      const awayResidual = (fixture.away_goals ?? 0) - awayExpected;
      add(attackGradient, fixture.home_team_id, weight * homeResidual);
      add(attackGradient, fixture.away_team_id, weight * awayResidual);
      add(defenceGradient, fixture.away_team_id, weight * homeResidual);
      add(defenceGradient, fixture.home_team_id, weight * awayResidual);
      add(attackInformation, fixture.home_team_id, weight * homeExpected);
      add(attackInformation, fixture.away_team_id, weight * awayExpected);
      add(defenceInformation, fixture.away_team_id, weight * homeExpected);
      add(defenceInformation, fixture.home_team_id, weight * awayExpected);
    }

    for (const id of teamIds) {
      const attackLog = Math.log(attack.get(id) ?? 1);
      const defenceLog = Math.log(defence.get(id) ?? 1);
      const attackStep = ((attackGradient.get(id) ?? 0) - PRIOR_WEIGHT * attackLog)
        / ((attackInformation.get(id) ?? 0) + PRIOR_WEIGHT);
      const defenceStep = ((defenceGradient.get(id) ?? 0) - PRIOR_WEIGHT * defenceLog)
        / ((defenceInformation.get(id) ?? 0) + PRIOR_WEIGHT);
      attack.set(id, Math.exp(attackLog + clamp(attackStep * 0.65, -0.22, 0.22)));
      defence.set(id, Math.exp(defenceLog + clamp(defenceStep * 0.65, -0.22, 0.22)));
    }
    centre(attack);
    centre(defence);
  }

  return {
    attack,
    defence,
    leagueHomeGoals,
    leagueAwayGoals,
    rho: fitRho(history, weights, attack, defence, leagueHomeGoals, leagueAwayGoals),
    matches: history.length,
    effectiveMatches: round(weightTotal, 1),
    baseline,
  };
}

export function dixonColesPrediction(target: FixtureRow, history: FixtureRow[]) {
  return predictDixonColes(target, prepareDixonColes(history));
}

export function predictDixonColes(target: FixtureRow, context: DixonColesContext): ModelOutput {
  const expectedHome = clamp(expected(context.leagueHomeGoals, context.attack, target.home_team_id, context.defence, target.away_team_id), 0.2, 4.5);
  const expectedAway = clamp(expected(context.leagueAwayGoals, context.attack, target.away_team_id, context.defence, target.home_team_id), 0.2, 4.5);
  const grid: Array<{ home: number; away: number; probability: number }> = [];
  let total = 0;
  for (let home = 0; home <= SCORE_LIMIT; home++) {
    for (let away = 0; away <= SCORE_LIMIT; away++) {
      const probability = poisson(home, expectedHome) * poisson(away, expectedAway)
        * lowScoreAdjustment(home, away, expectedHome, expectedAway, context.rho);
      grid.push({ home, away, probability });
      total += probability;
    }
  }
  for (const cell of grid) cell.probability /= total;

  const homeProbability = sumWhere(grid, (cell) => cell.home > cell.away);
  const drawProbability = sumWhere(grid, (cell) => cell.home === cell.away);
  const awayProbability = 1 - homeProbability - drawProbability;
  const homeTotals = context.baseline.totals.get(target.home_team_id);
  const awayTotals = context.baseline.totals.get(target.away_team_id);

  return {
    probabilities: { home: percent(homeProbability), draw: percent(drawProbability), away: percent(awayProbability) },
    expectedGoals: { home: round(expectedHome, 2), away: round(expectedAway, 2) },
    markets: {
      over25: percent(sumWhere(grid, (cell) => cell.home + cell.away >= 3)),
      btts: percent(sumWhere(grid, (cell) => cell.home > 0 && cell.away > 0)),
    },
    scorelines: [...grid].sort((a, b) => b.probability - a.probability).slice(0, 5)
      .map((cell) => ({ score: `${cell.home}–${cell.away}`, probability: percent(cell.probability) })),
    evidence: {
      homeElo: Math.round(context.baseline.ratings.get(target.home_team_id) ?? 1500),
      awayElo: Math.round(context.baseline.ratings.get(target.away_team_id) ?? 1500),
      homeMatches: homeTotals?.played ?? 0,
      awayMatches: awayTotals?.played ?? 0,
      leagueHomeGoals: round(context.leagueHomeGoals, 2),
      leagueAwayGoals: round(context.leagueAwayGoals, 2),
      homeAttack: round(context.attack.get(target.home_team_id) ?? 1, 2),
      awayAttack: round(context.attack.get(target.away_team_id) ?? 1, 2),
      homeDefence: round(context.defence.get(target.home_team_id) ?? 1, 2),
      awayDefence: round(context.defence.get(target.away_team_id) ?? 1, 2),
    },
  };
}

export function backtestDixonColes(history: FixtureRow[], maximumMatches = 60) {
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  let matches = 0;
  const validationStart = Math.max(20, history.length - maximumMatches);
  for (let index = validationStart; index < history.length; index++) {
    const target = history[index];
    const output = dixonColesPrediction(target, history.slice(0, index).filter((fixture) => fixture.kickoff < target.kickoff));
    const probabilities = [output.probabilities.home / 100, output.probabilities.draw / 100, output.probabilities.away / 100];
    const actual = outcomeIndex(target.home_goals ?? 0, target.away_goals ?? 0);
    if (probabilities.indexOf(Math.max(...probabilities)) === actual) correct++;
    brier += probabilities.reduce((sum, probability, outcome) => sum + (probability - (outcome === actual ? 1 : 0)) ** 2, 0);
    logLoss += -Math.log(Math.max(probabilities[actual], 0.001));
    matches++;
  }
  return {
    matches,
    accuracy: matches ? percent(correct / matches) : 0,
    brier: matches ? round(brier / matches, 3) : null,
    logLoss: matches ? round(logLoss / matches, 3) : null,
    methodology: `Walk-forward Dixon–Coles validation with a ${TIME_DECAY_HALF_LIFE_DAYS}-day half-life; every target uses only earlier results.`,
  };
}

export function backtestDixonColesOnFixtures(history: FixtureRow[], fixtureIds: Set<number>) {
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  let matches = 0;
  for (const target of history) {
    if (!fixtureIds.has(target.id)) continue;
    const earlier = history.filter((fixture) => fixture.kickoff < target.kickoff);
    if (earlier.length < 20) continue;
    const output = dixonColesPrediction(target, earlier);
    const probabilities = [output.probabilities.home / 100, output.probabilities.draw / 100, output.probabilities.away / 100];
    const actual = outcomeIndex(target.home_goals ?? 0, target.away_goals ?? 0);
    if (probabilities.indexOf(Math.max(...probabilities)) === actual) correct++;
    brier += probabilities.reduce((sum, probability, outcome) => sum + (probability - (outcome === actual ? 1 : 0)) ** 2, 0);
    logLoss += -Math.log(Math.max(probabilities[actual], 0.001));
    matches++;
  }
  return {
    matches,
    accuracy: matches ? percent(correct / matches) : 0,
    brier: matches ? round(brier / matches, 3) : null,
    logLoss: matches ? round(logLoss / matches, 3) : null,
    methodology: `Dixon–Coles scored on the feature model's exact fixtures, using only results with an earlier kickoff.`,
  };
}

function fitRho(history: FixtureRow[], weights: number[], attack: Map<number, number>, defence: Map<number, number>, homeRate: number, awayRate: number) {
  let bestRho = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let rho = -0.2; rho <= 0.2001; rho += 0.01) {
    let score = 0;
    let valid = true;
    for (const [index, fixture] of history.entries()) {
      const homeGoals = fixture.home_goals ?? 0;
      const awayGoals = fixture.away_goals ?? 0;
      if (homeGoals > 1 || awayGoals > 1) continue;
      const homeExpected = expected(homeRate, attack, fixture.home_team_id, defence, fixture.away_team_id);
      const awayExpected = expected(awayRate, attack, fixture.away_team_id, defence, fixture.home_team_id);
      const adjustment = lowScoreAdjustment(homeGoals, awayGoals, homeExpected, awayExpected, rho);
      if (adjustment <= 0) { valid = false; break; }
      score += weights[index] * Math.log(adjustment);
    }
    if (valid && score > bestScore) { bestScore = score; bestRho = rho; }
  }
  return round(bestRho, 2);
}

function lowScoreAdjustment(home: number, away: number, homeExpected: number, awayExpected: number, rho: number) {
  if (home === 0 && away === 0) return Math.max(0.001, 1 - homeExpected * awayExpected * rho);
  if (home === 0 && away === 1) return Math.max(0.001, 1 + homeExpected * rho);
  if (home === 1 && away === 0) return Math.max(0.001, 1 + awayExpected * rho);
  if (home === 1 && away === 1) return Math.max(0.001, 1 - rho);
  return 1;
}

function weightedMean(history: FixtureRow[], weights: number[], key: 'home_goals' | 'away_goals', fallback: number) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return total ? history.reduce((sum, fixture, index) => sum + (fixture[key] ?? 0) * weights[index], 0) / total : fallback;
}

function decayWeight(reference: number, kickoff: number) {
  if (!Number.isFinite(reference) || !Number.isFinite(kickoff)) return 1;
  const ageDays = Math.max(0, (reference - kickoff) / 86_400_000);
  return Math.exp(-Math.LN2 * ageDays / TIME_DECAY_HALF_LIFE_DAYS);
}

function expected(rate: number, attack: Map<number, number>, attackingTeam: number, defence: Map<number, number>, defendingTeam: number) {
  return rate * (attack.get(attackingTeam) ?? 1) * (defence.get(defendingTeam) ?? 1);
}

function centre(values: Map<number, number>) {
  if (!values.size) return;
  const meanLog = [...values.values()].reduce((sum, value) => sum + Math.log(value), 0) / values.size;
  for (const [id, value] of values) values.set(id, Math.exp(Math.log(value) - meanLog));
}

function zeroMap(ids: Set<number>) { return new Map([...ids].map((id) => [id, 0])); }
function add(map: Map<number, number>, id: number, value: number) { map.set(id, (map.get(id) ?? 0) + value); }
function sumWhere(grid: Array<{ home: number; away: number; probability: number }>, predicate: (cell: { home: number; away: number; probability: number }) => boolean) { return grid.filter(predicate).reduce((sum, cell) => sum + cell.probability, 0); }
function poisson(goals: number, lambda: number) { return Math.exp(-lambda) * lambda ** goals / factorial(goals); }
function factorial(value: number) { let result = 1; for (let number = 2; number <= value; number++) result *= number; return result; }

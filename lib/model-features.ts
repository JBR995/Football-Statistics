import { outcomeIndex, percent, round } from '@/lib/model';
import type { PreMatchFeatureRow } from '@/lib/features';

export const FEATURE_MODEL_NAME = 'Rolling-stat multinomial logistic regression';
export const FEATURE_MODEL_VERSION = '3.0-experimental';
export const BOOSTED_MODEL_NAME = 'Rolling-stat gradient-boosted trees';
export const BOOSTED_MODEL_VERSION = '3.1-experimental';
export const FEATURE_MODEL_MINIMUM_TRAINING_ROWS = 100;

const FIT_ITERATIONS = 360;
const REGULARISATION = 0.025;
const BOOSTING_ROUNDS = 48;
const BOOSTING_RATE = 0.18;
const BOOSTING_MINIMUM_LEAF = 30;
const BOOSTING_L2 = 8;

type FeatureDefinition = {
  key: string;
  label: string;
  value: (row: PreMatchFeatureRow) => number | null;
};

const FEATURES: FeatureDefinition[] = [
  { key: 'home_goals_for', label: 'Home goals for', value: (row) => row.homeGoalsFor },
  { key: 'home_goals_against', label: 'Home goals against', value: (row) => row.homeGoalsAgainst },
  { key: 'away_goals_for', label: 'Away goals for', value: (row) => row.awayGoalsFor },
  { key: 'away_goals_against', label: 'Away goals against', value: (row) => row.awayGoalsAgainst },
  { key: 'home_shot_balance', label: 'Home shot balance', value: (row) => row.homeShotsFor - row.homeShotsAgainst },
  { key: 'away_shot_balance', label: 'Away shot balance', value: (row) => row.awayShotsFor - row.awayShotsAgainst },
  { key: 'home_shots_on_balance', label: 'Home shots-on-target balance', value: (row) => row.homeShotsOnFor - row.homeShotsOnAgainst },
  { key: 'away_shots_on_balance', label: 'Away shots-on-target balance', value: (row) => row.awayShotsOnFor - row.awayShotsOnAgainst },
  { key: 'possession_edge', label: 'Possession edge', value: (row) => difference(row.homePossession, row.awayPossession) },
  { key: 'corner_balance_edge', label: 'Corner balance edge', value: (row) => difference(balance(row.homeCornersFor, row.homeCornersAgainst), balance(row.awayCornersFor, row.awayCornersAgainst)) },
  { key: 'foul_edge', label: 'Foul-count edge', value: (row) => difference(row.awayFouls, row.homeFouls) },
  { key: 'discipline_edge', label: 'Discipline edge', value: (row) => difference(row.awayCardPoints, row.homeCardPoints) },
  { key: 'passing_edge', label: 'Pass accuracy edge', value: (row) => difference(row.homePassAccuracy, row.awayPassAccuracy) },
  { key: 'xg_balance_edge', label: 'Expected-goals balance edge', value: (row) => difference(balance(row.homeExpectedGoalsFor, row.homeExpectedGoalsAgainst), balance(row.awayExpectedGoalsFor, row.awayExpectedGoalsAgainst)) },
  { key: 'rest_edge', label: 'Rest-day edge', value: (row) => Math.max(-14, Math.min(14, row.homeRestDays - row.awayRestDays)) },
];

type Scaler = { means: number[]; deviations: number[]; available: boolean[] };
type Model = { weights: number[][]; scaler: Scaler };
type TreeNode =
  | { type: 'leaf'; values: number[] }
  | { type: 'branch'; feature: number; threshold: number; gain: number; left: TreeNode; right: TreeNode };
type BoostedModel = { initialScores: number[]; trees: TreeNode[]; medians: number[]; featureGains: number[] };

export type FeatureModelEvaluation = {
  matches: number;
  trainingRows: number;
  accuracy: number;
  brier: number | null;
  logLoss: number | null;
  fixtureIds: number[];
  featureImportance: Array<{ key: string; label: string; importance: number }>;
  methodology: string;
};

export function backtestFeatureModel(rows: PreMatchFeatureRow[], maximumMatches = 60, minimumTrainingRows = FEATURE_MODEL_MINIMUM_TRAINING_ROWS): FeatureModelEvaluation {
  const ordered = [...rows].sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.fixtureId - b.fixtureId);
  const validationStart = Math.max(minimumTrainingRows, ordered.length - maximumMatches);
  if (validationStart >= ordered.length) return emptyEvaluation(Math.min(validationStart, ordered.length));

  const training = ordered.slice(0, validationStart);
  const model = fit(training);
  const featureImportance = importance(model.weights);
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  const fixtureIds: number[] = [];

  for (const target of ordered.slice(validationStart)) {
    const probabilities = predict(target, model);
    const actual = targetOutcomeIndex(target);
    if (probabilities.indexOf(Math.max(...probabilities)) === actual) correct++;
    brier += probabilities.reduce((sum, probability, outcome) => sum + (probability - (outcome === actual ? 1 : 0)) ** 2, 0);
    logLoss += -Math.log(Math.max(probabilities[actual], 0.001));
    fixtureIds.push(target.fixtureId);
    update(model, target, actual);
  }

  const matches = fixtureIds.length;
  return {
    matches,
    trainingRows: training.length,
    accuracy: matches ? percent(correct / matches) : 0,
    brier: matches ? round(brier / matches, 3) : null,
    logLoss: matches ? round(logLoss / matches, 3) : null,
    fixtureIds,
    featureImportance,
    methodology: `Chronological walk-forward validation. Coefficients and scaling start with ${training.length} earlier rows; each holdout is predicted before its result is used for one online update.`,
  };
}

export function backtestBoostedFeatureModel(rows: PreMatchFeatureRow[], maximumMatches = 60, minimumTrainingRows = FEATURE_MODEL_MINIMUM_TRAINING_ROWS): FeatureModelEvaluation {
  const ordered = [...rows].sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.fixtureId - b.fixtureId);
  const validationStart = Math.max(minimumTrainingRows, ordered.length - maximumMatches);
  if (validationStart >= ordered.length) return emptyBoostedEvaluation(Math.min(validationStart, ordered.length));

  const training = ordered.slice(0, validationStart);
  const model = fitBoosted(training);
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  const fixtureIds: number[] = [];
  for (const target of ordered.slice(validationStart)) {
    const probabilities = predictBoosted(target, model);
    const actual = targetOutcomeIndex(target);
    if (probabilities.indexOf(Math.max(...probabilities)) === actual) correct++;
    brier += probabilities.reduce((sum, probability, outcome) => sum + (probability - (outcome === actual ? 1 : 0)) ** 2, 0);
    logLoss += -Math.log(Math.max(probabilities[actual], 0.001));
    fixtureIds.push(target.fixtureId);
  }
  const matches = fixtureIds.length;
  return {
    matches,
    trainingRows: training.length,
    accuracy: matches ? percent(correct / matches) : 0,
    brier: matches ? round(brier / matches, 3) : null,
    logLoss: matches ? round(logLoss / matches, 3) : null,
    fixtureIds,
    featureImportance: gainImportance(model.featureGains),
    methodology: `Fixed-origin chronological holdout using ${BOOSTING_ROUNDS} vector-valued decision stumps. Medians, class priors, splits and leaf values are fitted only on the earlier training period.`,
  };
}

function fit(rows: PreMatchFeatureRow[]): Model {
  const raw = rows.map(rawVector);
  const scaler = prepareScaler(raw);
  const vectors = raw.map((values) => scale(values, scaler));
  const targets = rows.map(targetOutcomeIndex);
  const weights = Array.from({ length: 3 }, () => Array(FEATURES.length + 1).fill(0));
  const classCounts = [0, 0, 0];
  for (const target of targets) classCounts[target]++;
  for (let outcome = 0; outcome < 3; outcome++) weights[outcome][0] = Math.log((classCounts[outcome] + 1) / (targets.length + 3));

  for (let iteration = 0; iteration < FIT_ITERATIONS; iteration++) {
    const gradient = Array.from({ length: 3 }, () => Array(FEATURES.length + 1).fill(0));
    for (let rowIndex = 0; rowIndex < vectors.length; rowIndex++) {
      const vector = [1, ...vectors[rowIndex]];
      const probabilities = softmax(weights.map((outcomeWeights) => dot(outcomeWeights, vector)));
      for (let outcome = 0; outcome < 3; outcome++) {
        const error = probabilities[outcome] - (targets[rowIndex] === outcome ? 1 : 0);
        for (let feature = 0; feature < vector.length; feature++) gradient[outcome][feature] += error * vector[feature];
      }
    }
    const learningRate = 0.22 / Math.sqrt(1 + iteration / 45);
    for (let outcome = 0; outcome < 3; outcome++) {
      for (let feature = 0; feature < weights[outcome].length; feature++) {
        const penalty = feature === 0 ? 0 : REGULARISATION * weights[outcome][feature];
        weights[outcome][feature] -= learningRate * (gradient[outcome][feature] / rows.length + penalty);
      }
    }
  }
  return { weights, scaler };
}

function fitBoosted(rows: PreMatchFeatureRow[]): BoostedModel {
  const raw = rows.map(rawVector);
  const medians = FEATURES.map((_, index) => median(raw.map((row) => row[index])));
  const matrix = raw.map((values) => impute(values, medians));
  const targets = rows.map(targetOutcomeIndex);
  const classCounts = [0, 0, 0];
  for (const target of targets) classCounts[target]++;
  const initialScores = classCounts.map((count) => Math.log((count + 1) / (targets.length + 3)));
  const logits = matrix.map(() => [...initialScores]);
  const trees: TreeNode[] = [];
  const featureGains = FEATURES.map(() => 0);
  const indices = matrix.map((_, index) => index);
  const orders = FEATURES.map((_, feature) => [...indices].sort((left, right) => matrix[left][feature] - matrix[right][feature] || left - right));

  for (let roundIndex = 0; roundIndex < BOOSTING_ROUNDS; roundIndex++) {
    const residuals = logits.map((scores, index) => {
      const probabilities = softmax(scores);
      return probabilities.map((probability, outcome) => (targets[index] === outcome ? 1 : 0) - probability);
    });
    const tree = fitStump(matrix, residuals, indices, orders, featureGains);
    trees.push(tree);
    for (let index = 0; index < matrix.length; index++) {
      const values = treeValues(tree, matrix[index]);
      for (let outcome = 0; outcome < 3; outcome++) logits[index][outcome] += BOOSTING_RATE * values[outcome];
    }
  }
  return { initialScores, trees, medians, featureGains };
}

function fitStump(matrix: number[][], residuals: number[][], indices: number[], orders: number[][], featureGains: number[]): TreeNode {
  const totals = sumResiduals(residuals, indices);
  const parentScore = splitScore(totals, indices.length);
  let best: { feature: number; threshold: number; gain: number } | null = null;
  for (let feature = 0; feature < FEATURES.length; feature++) {
    const ordered = orders[feature];
    const leftSums = [0, 0, 0];
    for (let position = 0; position < ordered.length - 1; position++) {
      const index = ordered[position];
      for (let outcome = 0; outcome < 3; outcome++) leftSums[outcome] += residuals[index][outcome];
      const leftCount = position + 1;
      const rightCount = ordered.length - leftCount;
      if (leftCount < BOOSTING_MINIMUM_LEAF || rightCount < BOOSTING_MINIMUM_LEAF) continue;
      const value = matrix[index][feature];
      const nextValue = matrix[ordered[position + 1]][feature];
      if (value === nextValue) continue;
      const rightSums = totals.map((total, outcome) => total - leftSums[outcome]);
      const gain = splitScore(leftSums, leftCount) + splitScore(rightSums, rightCount) - parentScore;
      if (!best || gain > best.gain) best = { feature, threshold: (value + nextValue) / 2, gain };
    }
  }
  if (!best || best.gain <= 0) return leaf(residuals, indices);
  featureGains[best.feature] += best.gain;
  const left = indices.filter((index) => matrix[index][best.feature] <= best.threshold);
  const right = indices.filter((index) => matrix[index][best.feature] > best.threshold);
  return { type: 'branch', feature: best.feature, threshold: best.threshold, gain: best.gain, left: leaf(residuals, left), right: leaf(residuals, right) };
}

function leaf(residuals: number[][], indices: number[]): TreeNode {
  const totals = sumResiduals(residuals, indices);
  return { type: 'leaf', values: totals.map((total) => total / (indices.length + BOOSTING_L2)) };
}

function predictBoosted(row: PreMatchFeatureRow, model: BoostedModel) {
  const vector = impute(rawVector(row), model.medians);
  const scores = [...model.initialScores];
  for (const tree of model.trees) {
    const values = treeValues(tree, vector);
    for (let outcome = 0; outcome < 3; outcome++) scores[outcome] += BOOSTING_RATE * values[outcome];
  }
  return softmax(scores);
}

function treeValues(tree: TreeNode, vector: number[]): number[] {
  if (tree.type === 'leaf') return tree.values;
  return treeValues(vector[tree.feature] <= tree.threshold ? tree.left : tree.right, vector);
}

function sumResiduals(residuals: number[][], indices: number[]) {
  const sums = [0, 0, 0];
  for (const index of indices) for (let outcome = 0; outcome < 3; outcome++) sums[outcome] += residuals[index][outcome];
  return sums;
}

function splitScore(sums: number[], count: number) {
  return sums.reduce((score, value) => score + value ** 2, 0) / (count + BOOSTING_L2);
}

function predict(row: PreMatchFeatureRow, model: Model) {
  const vector = [1, ...scale(rawVector(row), model.scaler)];
  return softmax(model.weights.map((weights) => dot(weights, vector)));
}

function update(model: Model, row: PreMatchFeatureRow, actual: number) {
  const vector = [1, ...scale(rawVector(row), model.scaler)];
  for (let pass = 0; pass < 4; pass++) {
    const probabilities = softmax(model.weights.map((weights) => dot(weights, vector)));
    for (let outcome = 0; outcome < 3; outcome++) {
      const error = probabilities[outcome] - (actual === outcome ? 1 : 0);
      for (let feature = 0; feature < vector.length; feature++) {
        const penalty = feature === 0 ? 0 : REGULARISATION * model.weights[outcome][feature];
        model.weights[outcome][feature] -= 0.018 * (error * vector[feature] + penalty);
      }
    }
  }
}

function rawVector(row: PreMatchFeatureRow) {
  return FEATURES.map((feature) => feature.value(row));
}

function prepareScaler(rows: Array<Array<number | null>>): Scaler {
  const means = FEATURES.map((_, index) => mean(rows.map((row) => row[index])));
  const available = FEATURES.map((_, index) => rows.some((row) => finite(row[index])));
  const deviations = FEATURES.map((_, index) => {
    const values = rows.map((row) => row[index]).filter(finite);
    if (!values.length) return 1;
    const variance = values.reduce((sum, value) => sum + (value - means[index]) ** 2, 0) / values.length;
    return Math.sqrt(variance) || 1;
  });
  return { means, deviations, available };
}

function scale(values: Array<number | null>, scaler: Scaler) {
  return values.map((value, index) => !scaler.available[index] || value === null || !Number.isFinite(value) ? 0 : (value - scaler.means[index]) / scaler.deviations[index]);
}

function importance(weights: number[][]) {
  const values = FEATURES.map((feature, index) => ({
    key: feature.key,
    label: feature.label,
    raw: weights.reduce((sum, outcome) => sum + Math.abs(outcome[index + 1]), 0) / weights.length,
  }));
  const total = values.reduce((sum, value) => sum + value.raw, 0) || 1;
  return values.map((value) => ({ key: value.key, label: value.label, importance: round(value.raw * 100 / total, 1) }))
    .sort((a, b) => b.importance - a.importance);
}

function gainImportance(gains: number[]) {
  const total = gains.reduce((sum, value) => sum + value, 0) || 1;
  return FEATURES.map((feature, index) => ({ key: feature.key, label: feature.label, importance: round(gains[index] * 100 / total, 1) }))
    .sort((a, b) => b.importance - a.importance);
}

function emptyEvaluation(trainingRows: number): FeatureModelEvaluation {
  return {
    matches: 0,
    trainingRows,
    accuracy: 0,
    brier: null,
    logLoss: null,
    fixtureIds: [],
    featureImportance: [],
    methodology: `At least ${FEATURE_MODEL_MINIMUM_TRAINING_ROWS} eligible rows are required before a chronological holdout is scored.`,
  };
}

function emptyBoostedEvaluation(trainingRows: number): FeatureModelEvaluation {
  return {
    ...emptyEvaluation(trainingRows),
    methodology: `At least ${FEATURE_MODEL_MINIMUM_TRAINING_ROWS} eligible rows are required before boosted-tree training begins.`,
  };
}

function targetOutcomeIndex(row: PreMatchFeatureRow) {
  return outcomeIndex(row.targetHomeGoals, row.targetAwayGoals);
}

function softmax(scores: number[]) {
  const largest = Math.max(...scores);
  const exponentials = scores.map((score) => Math.exp(score - largest));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

function dot(left: number[], right: number[]) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function difference(left: number | null, right: number | null) {
  return left === null || right === null ? null : left - right;
}

function balance(forValue: number | null, againstValue: number | null) {
  return forValue === null || againstValue === null ? null : forValue - againstValue;
}

function mean(values: Array<number | null>) {
  const available = values.filter(finite);
  return available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : 0;
}

function median(values: Array<number | null>) {
  const available = values.filter(finite).sort((left, right) => left - right);
  if (!available.length) return 0;
  const middle = Math.floor(available.length / 2);
  return available.length % 2 ? available[middle] : (available[middle - 1] + available[middle]) / 2;
}

function impute(values: Array<number | null>, medians: number[]) {
  return values.map((value, index) => value === null || !Number.isFinite(value) ? medians[index] : value);
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

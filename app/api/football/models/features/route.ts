import { ensureFootballSchema } from '@/db/football';
import { readFeatureHistory } from '@/db/features';
import { readCompletedHistory } from '@/db/fixtures';
import { buildPreMatchFeatures } from '@/lib/features';
import { backtestDixonColesOnFixtures, MODEL_V2_NAME, MODEL_V2_VERSION } from '@/lib/model-v2';
import {
  backtestBoostedFeatureModel,
  backtestFeatureModel,
  BOOSTED_MODEL_NAME,
  BOOSTED_MODEL_VERSION,
  FEATURE_MODEL_MINIMUM_TRAINING_ROWS,
  FEATURE_MODEL_NAME,
  FEATURE_MODEL_VERSION,
} from '@/lib/model-features';

type CompetitionRow = { id: number; name: string; latest_season: number };
type Score = { matches: number; accuracy: number; brier: number | null; logLoss: number | null };
type Evaluation = {
  competitionId: number;
  competition: string;
  latestSeason: number;
  eligibleRows: number;
  trainingRows: number;
  matches: number;
  featureModel: Score;
  boostedModel: Score;
  dixonColes: Score;
  featureImportance: Array<{ key: string; label: string; importance: number }>;
};

export async function GET() {
  try {
    const db = await ensureFootballSchema();
    const competitions = (await db.prepare(`
      SELECT id, MAX(name) AS name, MAX(season) AS latest_season
      FROM competitions
      GROUP BY id
      ORDER BY name
    `).all<CompetitionRow>()).results;

    const evaluations: Evaluation[] = [];
    for (const competition of competitions) {
      const options = { competitionId: competition.id, fromSeason: competition.latest_season - 5, toSeason: competition.latest_season };
      const featureHistory = await readFeatureHistory(db, options);
      const { rows } = buildPreMatchFeatures(featureHistory);
      if (rows.length <= FEATURE_MODEL_MINIMUM_TRAINING_ROWS) continue;

      const featureModel = backtestFeatureModel(rows, 60);
      if (!featureModel.matches) continue;
      const boostedModel = backtestBoostedFeatureModel(rows, 60);
      if (boostedModel.fixtureIds.join(',') !== featureModel.fixtureIds.join(',')) continue;
      const resultHistory = await readCompletedHistory(db, options);
      const dixonColes = backtestDixonColesOnFixtures(resultHistory, new Set(featureModel.fixtureIds));
      if (dixonColes.matches !== featureModel.matches) continue;
      evaluations.push({
        competitionId: competition.id,
        competition: competition.name,
        latestSeason: competition.latest_season,
        eligibleRows: rows.length,
        trainingRows: featureModel.trainingRows,
        matches: featureModel.matches,
        featureModel: score(featureModel),
        boostedModel: score(boostedModel),
        dixonColes: score(dixonColes),
        featureImportance: boostedModel.featureImportance,
      });
    }

    const matches = evaluations.reduce((sum, evaluation) => sum + evaluation.matches, 0);
    const aggregate = (model: 'featureModel' | 'boostedModel' | 'dixonColes') => ({
      matches,
      accuracy: weighted(evaluations, model, 'accuracy', matches, 1),
      brier: weighted(evaluations, model, 'brier', matches, 3),
      logLoss: weighted(evaluations, model, 'logLoss', matches, 3),
    });
    const featureScore = aggregate('featureModel');
    const boostedScore = aggregate('boostedModel');
    const dixonColesScore = aggregate('dixonColes');

    return Response.json({
      connected: true,
      model: {
        name: BOOSTED_MODEL_NAME,
        version: BOOSTED_MODEL_VERSION,
        status: 'experimental',
        minimumTrainingRows: FEATURE_MODEL_MINIMUM_TRAINING_ROWS,
        usesFutureData: false,
      },
      summary: {
        competitions: evaluations.length,
        eligibleRows: evaluations.reduce((sum, evaluation) => sum + evaluation.eligibleRows, 0),
        validationMatches: matches,
        featureModel: featureScore,
        boostedModel: boostedScore,
        dixonColes: dixonColesScore,
        brierDifference: difference(featureScore.brier, dixonColesScore.brier),
        boostedBrierDifference: difference(boostedScore.brier, dixonColesScore.brier),
        logLossDifference: difference(featureScore.logLoss, dixonColesScore.logLoss),
        boostedLogLossDifference: difference(boostedScore.logLoss, dixonColesScore.logLoss),
      },
      comparison: {
        matches,
        entries: [
          { name: MODEL_V2_NAME, version: MODEL_V2_VERSION, ...dixonColesScore },
          { name: FEATURE_MODEL_NAME, version: FEATURE_MODEL_VERSION, ...featureScore },
          { name: BOOSTED_MODEL_NAME, version: BOOSTED_MODEL_VERSION, ...boostedScore },
        ],
      },
      evaluations,
      featureImportance: aggregateImportance(evaluations),
      methodology: `All three models are scored on the same last 60 eligible fixtures per competition. Logistic regression uses training-only scaling and online updates after each scored holdout. The boosted model is a fixed-origin ensemble of depth-two trees with training-period median imputation. Dixon–Coles uses only results with an earlier kickoff. Both feature models remain experimental until they beat Dixon–Coles on probability quality and forward validation.`,
      checkedAt: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=86400' } });
  } catch (error) {
    return Response.json({
      connected: false,
      error: error instanceof Error ? error.message : 'The feature-model experiment could not be evaluated.',
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

function score(value: Score) {
  return { matches: value.matches, accuracy: value.accuracy, brier: value.brier, logLoss: value.logLoss };
}

function weighted(evaluations: Evaluation[], model: 'featureModel' | 'boostedModel' | 'dixonColes', key: 'accuracy' | 'brier' | 'logLoss', matches: number, places: number) {
  if (!matches) return null;
  const value = evaluations.reduce((sum, evaluation) => sum + Number(evaluation[model][key] ?? 0) * evaluation.matches, 0) / matches;
  return Number(value.toFixed(places));
}

function difference(left: number | null, right: number | null) {
  return left === null || right === null ? null : Number((left - right).toFixed(3));
}

function aggregateImportance(evaluations: Evaluation[]) {
  const weights = new Map<string, { label: string; total: number }>();
  let matches = 0;
  for (const evaluation of evaluations) {
    matches += evaluation.matches;
    for (const feature of evaluation.featureImportance) {
      const value = weights.get(feature.key) ?? { label: feature.label, total: 0 };
      value.total += feature.importance * evaluation.matches;
      weights.set(feature.key, value);
    }
  }
  return [...weights.entries()].map(([key, value]) => ({
    key,
    label: value.label,
    importance: matches ? Number((value.total / matches).toFixed(1)) : 0,
  })).sort((a, b) => b.importance - a.importance);
}

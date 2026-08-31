import { ensureFootballSchema } from '@/db/football';
import { readCompletedHistory } from '@/db/fixtures';
import { backtest, MODEL_NAME, MODEL_VERSION } from '@/lib/model';
import { backtestDixonColes, MODEL_V2_NAME, MODEL_V2_VERSION, TIME_DECAY_HALF_LIFE_DAYS } from '@/lib/model-v2';

type CompetitionRow = { id: number; name: string; latest_season: number };

export async function GET() {
  try {
    const db = await ensureFootballSchema();
    const competitions = (await db.prepare(`
      SELECT id, MAX(name) AS name, MAX(season) AS latest_season
      FROM competitions
      GROUP BY id
      ORDER BY name
    `).all<CompetitionRow>()).results;

    const evaluations = [];
    for (const competition of competitions) {
      const history = await readCompletedHistory(db, {
        competitionId: competition.id,
        fromSeason: competition.latest_season - 5,
        toSeason: competition.latest_season,
      });
      if (!history.length) continue;
      const baselineV1 = backtest(history, 60);
      const validation = backtestDixonColes(history, 60);
      evaluations.push({
        competitionId: competition.id,
        competition: competition.name,
        latestSeason: competition.latest_season,
        trainingMatches: history.length,
        seasons: new Set(history.map((fixture) => fixture.season)).size,
        trainedThrough: history.at(-1)?.kickoff ?? null,
        validation,
        baselineV1,
      });
    }

    const validated = evaluations.filter((evaluation) => evaluation.validation.matches > 0);
    const validationMatches = validated.reduce((sum, evaluation) => sum + evaluation.validation.matches, 0);
    const weighted = (key: 'accuracy' | 'brier' | 'logLoss') => validationMatches
      ? validated.reduce((sum, evaluation) => sum + Number(evaluation.validation[key] ?? 0) * evaluation.validation.matches, 0) / validationMatches
      : null;

    return Response.json({
      connected: true,
      model: { name: MODEL_V2_NAME, version: MODEL_V2_VERSION, usesFutureData: false },
      models: [
        { name: MODEL_NAME, version: MODEL_VERSION },
        { name: MODEL_V2_NAME, version: MODEL_V2_VERSION, halfLifeDays: TIME_DECAY_HALF_LIFE_DAYS },
      ],
      summary: {
        competitions: evaluations.length,
        trainingMatches: evaluations.reduce((sum, evaluation) => sum + evaluation.trainingMatches, 0),
        validationMatches,
        accuracy: roundNullable(weighted('accuracy'), 1),
        brier: roundNullable(weighted('brier'), 3),
        logLoss: roundNullable(weighted('logLoss'), 3),
      },
      evaluations,
      comparison: aggregateComparison(evaluations),
      methodology: `V1 and v2 are evaluated on the same last 60 fixtures per competition. Every match is predicted using only earlier results; v2 applies Dixon–Coles low-score correction and a ${TIME_DECAY_HALF_LIFE_DAYS}-day time-decay half-life.`,
      checkedAt: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } });
  } catch (error) {
    return Response.json({
      connected: false,
      error: error instanceof Error ? error.message : 'Model evaluation could not be loaded.',
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

function aggregateComparison(evaluations: Array<{ validation: ReturnType<typeof backtestDixonColes>; baselineV1: ReturnType<typeof backtest> }>) {
  const matches = evaluations.reduce((sum, evaluation) => sum + evaluation.validation.matches, 0);
  const mean = (key: 'accuracy' | 'brier' | 'logLoss', model: 'validation' | 'baselineV1') => matches
    ? evaluations.reduce((sum, evaluation) => sum + Number(evaluation[model][key] ?? 0) * evaluation[model].matches, 0) / matches
    : null;
  return {
    matches,
    entries: [
      { name: MODEL_NAME, version: MODEL_VERSION, accuracy: roundNullable(mean('accuracy', 'baselineV1'), 1), brier: roundNullable(mean('brier', 'baselineV1'), 3), logLoss: roundNullable(mean('logLoss', 'baselineV1'), 3) },
      { name: MODEL_V2_NAME, version: MODEL_V2_VERSION, accuracy: roundNullable(mean('accuracy', 'validation'), 1), brier: roundNullable(mean('brier', 'validation'), 3), logLoss: roundNullable(mean('logLoss', 'validation'), 3) },
    ],
  };
}

function roundNullable(value: number | null, places: number) {
  return value === null ? null : Number(value.toFixed(places));
}

import { ensureFootballSchema } from '@/db/football';
import { readCompletedHistory } from '@/db/fixtures';
import { backtest, MODEL_NAME, MODEL_VERSION } from '@/lib/model';

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
      const validation = backtest(history);
      evaluations.push({
        competitionId: competition.id,
        competition: competition.name,
        latestSeason: competition.latest_season,
        trainingMatches: history.length,
        seasons: new Set(history.map((fixture) => fixture.season)).size,
        trainedThrough: history.at(-1)?.kickoff ?? null,
        validation,
      });
    }

    const validated = evaluations.filter((evaluation) => evaluation.validation.matches > 0);
    const validationMatches = validated.reduce((sum, evaluation) => sum + evaluation.validation.matches, 0);
    const weighted = (key: 'accuracy' | 'brier' | 'logLoss') => validationMatches
      ? validated.reduce((sum, evaluation) => sum + Number(evaluation.validation[key] ?? 0) * evaluation.validation.matches, 0) / validationMatches
      : null;

    return Response.json({
      connected: true,
      model: { name: MODEL_NAME, version: MODEL_VERSION, usesFutureData: false },
      summary: {
        competitions: evaluations.length,
        trainingMatches: evaluations.reduce((sum, evaluation) => sum + evaluation.trainingMatches, 0),
        validationMatches,
        accuracy: roundNullable(weighted('accuracy'), 1),
        brier: roundNullable(weighted('brier'), 3),
        logLoss: roundNullable(weighted('logLoss'), 3),
      },
      evaluations,
      methodology: 'Walk-forward validation: every match is predicted using only fixtures completed earlier in time. Competition results are weighted by validation sample size.',
      checkedAt: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } });
  } catch (error) {
    return Response.json({
      connected: false,
      error: error instanceof Error ? error.message : 'Model evaluation could not be loaded.',
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

function roundNullable(value: number | null, places: number) {
  return value === null ? null : Number(value.toFixed(places));
}

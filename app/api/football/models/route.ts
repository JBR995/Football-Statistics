import { ensureFootballSchema } from '@/db/football';
import { backtest, type FixtureRow } from '@/app/api/football/prediction/route';

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
      const history = (await db.prepare(`
        SELECT f.id, f.competition_id, c.name AS competition_name, f.season, f.kickoff, f.status, f.round, f.venue,
               f.home_team_id, ht.name AS home_name, ht.logo AS home_logo,
               f.away_team_id, at.name AS away_name, at.logo AS away_logo,
               f.home_goals, f.away_goals
        FROM fixtures f
        JOIN competitions c ON c.id = f.competition_id AND c.season = f.season
        JOIN teams ht ON ht.id = f.home_team_id
        JOIN teams at ON at.id = f.away_team_id
        WHERE f.competition_id = ? AND f.season >= ? AND f.season <= ?
          AND f.status IN ('FT', 'AET', 'PEN')
          AND f.home_goals IS NOT NULL AND f.away_goals IS NOT NULL
        ORDER BY f.kickoff ASC, f.id ASC
      `).bind(competition.id, competition.latest_season - 5, competition.latest_season).all<FixtureRow>()).results;
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
      model: { name: 'Elo + Bayesian Poisson baseline', version: '1.0', usesFutureData: false },
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

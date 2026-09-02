import { ensureFootballSchema } from '@/db/football';
import { readFeatureHistory } from '@/db/features';
import { buildPreMatchFeatures, MINIMUM_TEAM_HISTORY, ROLLING_WINDOW, type FeatureAudit } from '@/lib/features';

type CompetitionRow = { id: number; name: string; latest_season: number };
type ReadinessRow = FeatureAudit & {
  competitionId: number;
  competition: string;
  latestSeason: number;
  state: 'ready' | 'building' | 'awaiting-statistics';
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

    const readiness: ReadinessRow[] = [];
    for (const competition of competitions) {
      const matches = await readFeatureHistory(db, {
        competitionId: competition.id,
        fromSeason: competition.latest_season - 5,
        toSeason: competition.latest_season,
      });
      const { audit } = buildPreMatchFeatures(matches);
      const state: ReadinessRow['state'] = audit.eligibleRows >= 100 ? 'ready' : audit.coreStatisticsMatches > 0 ? 'building' : 'awaiting-statistics';
      readiness.push({
        competitionId: competition.id,
        competition: competition.name,
        latestSeason: competition.latest_season,
        ...audit,
        state,
      });
    }

    const matches = readiness.reduce((sum, item) => sum + item.matches, 0);
    const eligibleRows = readiness.reduce((sum, item) => sum + item.eligibleRows, 0);
    const weightedCoverage = (key: keyof (typeof readiness)[number]['coverage']) => matches
      ? readiness.reduce((sum, item) => sum + item.coverage[key] * item.matches, 0) / matches
      : 0;

    return Response.json({
      connected: true,
      pipeline: {
        leakageSafe: true,
        usesCurrentFixtureStatistics: false,
        targetSeparatedFromFeatures: true,
        rollingWindow: ROLLING_WINDOW,
        minimumTeamHistory: MINIMUM_TEAM_HISTORY,
      },
      summary: {
        competitions: readiness.length,
        readyCompetitions: readiness.filter((item) => item.state === 'ready').length,
        matches,
        eligibleRows,
        coverage: {
          core: round(weightedCoverage('core')),
          possession: round(weightedCoverage('possession')),
          corners: round(weightedCoverage('corners')),
          fouls: round(weightedCoverage('fouls')),
          yellowCards: round(weightedCoverage('yellowCards')),
          redCards: round(weightedCoverage('redCards')),
          passing: round(weightedCoverage('passing')),
          expectedGoals: round(weightedCoverage('expectedGoals')),
        },
      },
      readiness,
      methodology: `Each training row is frozen at kickoff. Its predictors are ${ROLLING_WINDOW}-match rolling averages built only from earlier fixtures for both teams; the current result is stored separately as the target. A row is eligible after both teams have ${MINIMUM_TEAM_HISTORY} prior matches with shots and shots-on-target data.`,
      checkedAt: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=86400' } });
  } catch (error) {
    return Response.json({
      connected: false,
      error: error instanceof Error ? error.message : 'Feature readiness could not be loaded.',
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

function round(value: number) {
  return Number(value.toFixed(1));
}

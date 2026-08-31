import { ensureFootballSchema } from '@/db/football';
import { readCompletedHistory, readFixture } from '@/db/fixtures';
import { readStoredOdds } from '@/db/match-detail-read';
import { readLatestSnapshot } from '@/db/snapshots';
import { backtest, MODEL_NAME, MODEL_VERSION, modelPrediction, type FixtureRow } from '@/lib/model';

export async function GET(request: Request) {
  const fixtureId = Number(new URL(request.url).searchParams.get('fixture'));
  if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
    return Response.json({ connected: false, error: 'A valid fixture ID is required.' }, { status: 400 });
  }

  try {
    const db = await ensureFootballSchema();
    const target = await readFixture(db, fixtureId);
    if (!target) return Response.json({ connected: false, error: 'This fixture is not in the competition database.' }, { status: 404 });

    const history = await readCompletedHistory(db, {
      competitionId: target.competition_id,
      fromSeason: target.season - 5,
      toSeason: target.season,
      beforeKickoff: target.kickoff,
    });

    const prediction = modelPrediction(target, history);
    const validation = backtest(history);
    const [snapshot, storedOdds] = await Promise.all([
      readLatestSnapshot(db, fixtureId),
      readStoredOdds(db, fixtureId),
    ]);
    const minimumTeamSample = Math.min(prediction.evidence.homeMatches, prediction.evidence.awayMatches);
    const confidence = Math.round(clamp(30 + minimumTeamSample * 5 + Math.min(validation.matches, 20), 30, 78));
    const sampleWarning = minimumTeamSample < 5
      ? `Low sample: one or both teams have fewer than five completed league matches (${prediction.evidence.homeMatches} and ${prediction.evidence.awayMatches}). Probabilities are strongly regularised toward league averages.`
      : validation.matches < 30
        ? `Limited validation: only ${validation.matches} earlier matches can be backtested without future-data leakage.`
        : 'The model has a usable in-season sample, but probabilities remain estimates rather than guarantees.';

    return Response.json({
      connected: true,
      fixture: toFixture(target),
      model: {
        name: MODEL_NAME,
        version: MODEL_VERSION,
        trainedThrough: history.at(-1)?.kickoff ?? null,
        trainingMatches: history.length,
        usesFutureData: false,
      },
      ...prediction,
      confidence,
      sampleWarning,
      validation,
      market: storedOdds.market,
      // What was forecast before kickoff, so a live view cannot quietly
      // replace the record this fixture will be scored against.
      snapshot: snapshot ? {
        recordedAt: snapshot.created_at,
        probabilities: {
          home: percent(snapshot.home_probability),
          draw: percent(snapshot.draw_probability),
          away: percent(snapshot.away_probability),
        },
        expectedGoals: { home: snapshot.expected_home_goals, away: snapshot.expected_away_goals },
        trainingMatches: snapshot.training_matches,
        modelVersion: snapshot.model_version,
        market: snapshot.market_home_probability === null || snapshot.market_draw_probability === null || snapshot.market_away_probability === null ? null : {
          bookmakers: snapshot.market_bookmakers,
          probabilities: {
            home: percent(snapshot.market_home_probability),
            draw: percent(snapshot.market_draw_probability),
            away: percent(snapshot.market_away_probability),
          },
        },
      } : null,
    }, { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The prediction model could not be loaded.';
    return Response.json({ connected: false, error: message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

function toFixture(row: FixtureRow) {
  return {
    id: row.id, competition: row.competition_name, season: row.season, kickoff: row.kickoff, round: row.round, venue: row.venue,
    home: { id: row.home_team_id, name: row.home_name, logo: row.home_logo },
    away: { id: row.away_team_id, name: row.away_name, logo: row.away_logo },
  };
}

function percent(value: number) { return Number((value * 100).toFixed(1)); }
function clamp(value: number, minimum: number, maximum: number) { return Math.max(minimum, Math.min(maximum, value)); }

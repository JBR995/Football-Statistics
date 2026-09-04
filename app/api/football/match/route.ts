import { ensureFootballSchema } from '@/db/football';
import { readLatestAvailability, readStoredLineups, readStoredOdds, readStoredPlayerStatistics, readStoredStatistics } from '@/db/match-detail-read';

type MatchRow = { id: number; competition_id: number; season: number; kickoff: string; status: string; round: string | null; venue: string | null; home_team_id: number; home_name: string; home_logo: string | null; away_team_id: number; away_name: string; away_logo: string | null; home_goals: number | null; away_goals: number | null };
type PlayerEvidenceRow = { team_id: number; player_id: number; player_name: string; position: string | null; matches: number; minutes: number; shots: number; shots_on: number; goals: number; assists: number; fouls_committed: number; yellow_cards: number; red_cards: number; observed_shot_matches: number };

export async function GET(request: Request) {
  const fixtureId = Number(new URL(request.url).searchParams.get('fixture'));
  if (!Number.isInteger(fixtureId)) return Response.json({ error: 'A valid fixture is required.' }, { status: 400 });
  try {
    const db = await ensureFootballSchema();
    const match = await db.prepare(`SELECT f.id, f.competition_id, f.season, f.kickoff, f.status, f.round, f.venue, f.home_team_id, ht.name AS home_name, ht.logo AS home_logo, f.away_team_id, at.name AS away_name, at.logo AS away_logo, f.home_goals, f.away_goals FROM fixtures f JOIN teams ht ON ht.id=f.home_team_id JOIN teams at ON at.id=f.away_team_id WHERE f.id=?`).bind(fixtureId).first<MatchRow>();
    if (!match) return Response.json({ error: 'The fixture is not in the database.' }, { status: 404 });
    const prior = (await db.prepare(`SELECT f.id, f.kickoff, f.home_team_id, ht.name AS home_name, f.away_team_id, at.name AS away_name, f.home_goals, f.away_goals FROM fixtures f JOIN teams ht ON ht.id=f.home_team_id JOIN teams at ON at.id=f.away_team_id WHERE f.competition_id=? AND f.season=? AND f.kickoff<? AND f.status IN ('FT','AET','PEN') AND (f.home_team_id IN (?,?) OR f.away_team_id IN (?,?)) ORDER BY f.kickoff DESC`).bind(match.competition_id, match.season, match.kickoff, match.home_team_id, match.away_team_id, match.home_team_id, match.away_team_id).all<{ id: number; kickoff: string; home_team_id: number; home_name: string; away_team_id: number; away_name: string; home_goals: number; away_goals: number }>()).results;
    const form = (teamId: number) => prior.filter((row) => row.home_team_id === teamId || row.away_team_id === teamId).slice(0, 5).map((row) => { const home = row.home_team_id === teamId, gf = home ? row.home_goals : row.away_goals, ga = home ? row.away_goals : row.home_goals; return { id: row.id, opponent: home ? row.away_name : row.home_name, gf, ga, result: gf > ga ? 'W' : gf === ga ? 'D' : 'L' }; });
    const h2h = (await db.prepare(`
      SELECT f.id, f.season, f.kickoff, f.home_team_id, ht.name AS home_name,
             f.away_team_id, at.name AS away_name, f.home_goals, f.away_goals
      FROM fixtures f
      JOIN teams ht ON ht.id = f.home_team_id
      JOIN teams at ON at.id = f.away_team_id
      WHERE f.competition_id = ? AND f.season BETWEEN ? AND ? AND f.kickoff < ?
        AND f.status IN ('FT','AET','PEN')
        AND ((f.home_team_id = ? AND f.away_team_id = ?) OR (f.home_team_id = ? AND f.away_team_id = ?))
      ORDER BY f.kickoff DESC
      LIMIT 8
    `).bind(match.competition_id, match.season - 4, match.season, match.kickoff, match.home_team_id, match.away_team_id, match.away_team_id, match.home_team_id)
      .all<{ id: number; season: number; kickoff: string; home_team_id: number; home_name: string; away_team_id: number; away_name: string; home_goals: number; away_goals: number }>()).results;
    // Stored detail is preferred over a live call: it is what the models are
    // trained on, it costs no provider allowance, and it stays available for
    // seasons the provider no longer serves.
    const teamOrder = [match.home_team_id, match.away_team_id];
    type ProviderStatistics = Array<{ team: { id: number; name?: string; logo?: string | null }; statistics: Array<{ type: string; value: string | number | null }> }>;
    let statistics: ProviderStatistics = await readStoredStatistics(db, fixtureId, teamOrder);
    let statisticsSource: 'stored' | 'provider' | null = statistics.length ? 'stored' : null;
    if (!statistics.length && ['FT', 'AET', 'PEN'].includes(match.status) && process.env.API_FOOTBALL_KEY) {
      const response = await fetch(`https://v3.football.api-sports.io/fixtures/statistics?fixture=${fixtureId}`, { headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY } });
      if (response.ok) statistics = ((await response.json()) as { response?: ProviderStatistics }).response ?? [];
      if (statistics.length) statisticsSource = 'provider';
    }
    const [lineups, players, odds, availability, playerEvidenceRows] = await Promise.all([
      readStoredLineups(db, fixtureId, teamOrder),
      readStoredPlayerStatistics(db, fixtureId, teamOrder),
      readStoredOdds(db, fixtureId),
      readLatestAvailability(db, fixtureId, match.kickoff),
      db.prepare(`
        SELECT ps.team_id, ps.player_id, MAX(ps.player_name) AS player_name,
               MAX(ps.position) AS position, COUNT(DISTINCT ps.fixture_id) AS matches,
               SUM(COALESCE(ps.minutes, 0)) AS minutes,
               SUM(COALESCE(ps.shots_total, 0)) AS shots,
               SUM(COALESCE(ps.shots_on, 0)) AS shots_on,
               SUM(COALESCE(ps.goals, 0)) AS goals,
               SUM(COALESCE(ps.assists, 0)) AS assists,
               SUM(COALESCE(ps.fouls_committed, 0)) AS fouls_committed,
               SUM(COALESCE(ps.yellow_cards, 0)) AS yellow_cards,
               SUM(COALESCE(ps.red_cards, 0)) AS red_cards,
               SUM(CASE WHEN ps.shots_total IS NOT NULL THEN 1 ELSE 0 END) AS observed_shot_matches
        FROM fixture_player_statistics ps
        JOIN fixtures f ON f.id = ps.fixture_id
        WHERE f.competition_id = ? AND f.season = ? AND f.kickoff < ?
          AND f.status IN ('FT','AET','PEN') AND ps.team_id IN (?, ?)
        GROUP BY ps.team_id, ps.player_id
        HAVING SUM(COALESCE(ps.minutes, 0)) > 0
      `).bind(match.competition_id, match.season, match.kickoff, match.home_team_id, match.away_team_id).all<PlayerEvidenceRow>(),
    ]);
    const playerEvidence = summarizePlayerEvidence(playerEvidenceRows.results, teamOrder);

    return Response.json({ connected: true, match: { id: match.id, kickoff: match.kickoff, status: match.status, round: match.round, venue: match.venue, home: { id: match.home_team_id, name: match.home_name, logo: match.home_logo }, away: { id: match.away_team_id, name: match.away_name, logo: match.away_logo }, score: { home: match.home_goals, away: match.away_goals } }, form: { home: form(match.home_team_id), away: form(match.away_team_id) }, h2h, statistics, statisticsSource, players, lineups, availability, playerEvidence, odds: odds.bookmakers, market: odds.market }, { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800' } });
  } catch {
    return Response.json({ connected: false, error: 'Match analysis could not be loaded.' }, { status: 500 });
  }
}

function summarizePlayerEvidence(rows: PlayerEvidenceRow[], teamOrder: number[]) {
  return teamOrder.flatMap((teamId) => {
    const players = rows.filter((row) => row.team_id === teamId).map((row) => {
      const minutes = Number(row.minutes);
      const attackWeight = Number(row.shots) * 0.5 + Number(row.shots_on) + Number(row.goals) * 2 + Number(row.assists) * 1.5;
      return {
        teamId,
        playerId: row.player_id,
        name: row.player_name,
        position: row.position,
        matches: Number(row.matches),
        minutes,
        totals: { shots: Number(row.shots), shotsOn: Number(row.shots_on), goals: Number(row.goals), assists: Number(row.assists), foulsCommitted: Number(row.fouls_committed), yellowCards: Number(row.yellow_cards), redCards: Number(row.red_cards) },
        per90: { shots: rate(row.shots, minutes), shotsOn: rate(row.shots_on, minutes), goals: rate(row.goals, minutes), assists: rate(row.assists, minutes), foulsCommitted: rate(row.fouls_committed, minutes) },
        observedShotMatches: Number(row.observed_shot_matches),
        attackWeight,
      };
    });
    const teamWeight = players.reduce((sum, player) => sum + player.attackWeight, 0);
    return players
      .map(({ attackWeight, ...player }) => ({ ...player, attackShare: teamWeight ? round(attackWeight / teamWeight, 4) : 0 }))
      .sort((a, b) => b.attackShare - a.attackShare || b.minutes - a.minutes)
      .slice(0, 8);
  });
}

function rate(value: number, minutes: number) { return minutes ? round(Number(value) * 90 / minutes, 2) : 0; }
function round(value: number, places: number) { return Number(value.toFixed(places)); }

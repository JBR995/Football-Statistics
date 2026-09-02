import { ensureFootballSchema } from '@/db/football';
import { readStoredLineups, readStoredOdds, readStoredPlayerStatistics, readStoredStatistics } from '@/db/match-detail-read';

type MatchRow = { id: number; competition_id: number; season: number; kickoff: string; status: string; round: string | null; venue: string | null; home_team_id: number; home_name: string; home_logo: string | null; away_team_id: number; away_name: string; away_logo: string | null; home_goals: number | null; away_goals: number | null };

export async function GET(request: Request) {
  const fixtureId = Number(new URL(request.url).searchParams.get('fixture'));
  if (!Number.isInteger(fixtureId)) return Response.json({ error: 'A valid fixture is required.' }, { status: 400 });
  try {
    const db = await ensureFootballSchema();
    const match = await db.prepare(`SELECT f.id, f.competition_id, f.season, f.kickoff, f.status, f.round, f.venue, f.home_team_id, ht.name AS home_name, ht.logo AS home_logo, f.away_team_id, at.name AS away_name, at.logo AS away_logo, f.home_goals, f.away_goals FROM fixtures f JOIN teams ht ON ht.id=f.home_team_id JOIN teams at ON at.id=f.away_team_id WHERE f.id=?`).bind(fixtureId).first<MatchRow>();
    if (!match) return Response.json({ error: 'The fixture is not in the database.' }, { status: 404 });
    const prior = (await db.prepare(`SELECT f.id, f.kickoff, f.home_team_id, ht.name AS home_name, f.away_team_id, at.name AS away_name, f.home_goals, f.away_goals FROM fixtures f JOIN teams ht ON ht.id=f.home_team_id JOIN teams at ON at.id=f.away_team_id WHERE f.competition_id=? AND f.season=? AND f.kickoff<? AND f.status IN ('FT','AET','PEN') AND (f.home_team_id IN (?,?) OR f.away_team_id IN (?,?)) ORDER BY f.kickoff DESC`).bind(match.competition_id, match.season, match.kickoff, match.home_team_id, match.away_team_id, match.home_team_id, match.away_team_id).all<{ id: number; kickoff: string; home_team_id: number; home_name: string; away_team_id: number; away_name: string; home_goals: number; away_goals: number }>()).results;
    const form = (teamId: number) => prior.filter((row) => row.home_team_id === teamId || row.away_team_id === teamId).slice(0, 5).map((row) => { const home = row.home_team_id === teamId, gf = home ? row.home_goals : row.away_goals, ga = home ? row.away_goals : row.home_goals; return { id: row.id, opponent: home ? row.away_name : row.home_name, gf, ga, result: gf > ga ? 'W' : gf === ga ? 'D' : 'L' }; });
    const h2h = prior.filter((row) => [row.home_team_id, row.away_team_id].includes(match.home_team_id) && [row.home_team_id, row.away_team_id].includes(match.away_team_id)).slice(0, 5);
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
    const [lineups, players, odds] = await Promise.all([
      readStoredLineups(db, fixtureId, teamOrder),
      readStoredPlayerStatistics(db, fixtureId, teamOrder),
      readStoredOdds(db, fixtureId),
    ]);

    return Response.json({ connected: true, match: { id: match.id, kickoff: match.kickoff, status: match.status, round: match.round, venue: match.venue, home: { id: match.home_team_id, name: match.home_name, logo: match.home_logo }, away: { id: match.away_team_id, name: match.away_name, logo: match.away_logo }, score: { home: match.home_goals, away: match.away_goals } }, form: { home: form(match.home_team_id), away: form(match.away_team_id) }, h2h, statistics, statisticsSource, players, lineups, odds: odds.bookmakers, market: odds.market }, { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800' } });
  } catch {
    return Response.json({ connected: false, error: 'Match analysis could not be loaded.' }, { status: 500 });
  }
}

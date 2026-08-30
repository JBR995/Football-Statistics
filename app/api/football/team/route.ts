import { ensureFootballSchema } from '@/db/football';

type Row = { id: number; kickoff: string; status: string; venue: string | null; home_team_id: number; home_name: string; home_logo: string | null; away_team_id: number; away_name: string; away_logo: string | null; home_goals: number | null; away_goals: number | null };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const teamId = Number(params.get('team'));
  const leagueId = Number(params.get('league') ?? 39);
  const season = Number(params.get('season') ?? 2026);
  if (!Number.isInteger(teamId)) return Response.json({ error: 'A valid team is required.' }, { status: 400 });
  try {
    const db = await ensureFootballSchema();
    const team = await db.prepare('SELECT id, name, logo FROM teams WHERE id = ?').bind(teamId).first<{ id: number; name: string; logo: string | null }>();
    if (!team) return Response.json({ error: 'The team is not in the competition database.' }, { status: 404 });
    const rows = (await db.prepare(`SELECT f.id, f.kickoff, f.status, f.venue, f.home_team_id, ht.name AS home_name, ht.logo AS home_logo, f.away_team_id, at.name AS away_name, at.logo AS away_logo, f.home_goals, f.away_goals FROM fixtures f JOIN teams ht ON ht.id=f.home_team_id JOIN teams at ON at.id=f.away_team_id WHERE f.competition_id=? AND f.season=? AND (f.home_team_id=? OR f.away_team_id=?) ORDER BY f.kickoff ASC`).bind(leagueId, season, teamId, teamId).all<Row>()).results;
    const completed = rows.filter((row) => ['FT', 'AET', 'PEN'].includes(row.status));
    const home = completed.filter((row) => row.home_team_id === teamId), away = completed.filter((row) => row.away_team_id === teamId);
    const summarize = (matches: Row[]) => matches.reduce((acc, row) => {
      const isHome = row.home_team_id === teamId, gf = (isHome ? row.home_goals : row.away_goals) ?? 0, ga = (isHome ? row.away_goals : row.home_goals) ?? 0;
      acc.played++; acc.gf += gf; acc.ga += ga; if (gf > ga) acc.won++; else if (gf === ga) acc.drawn++; else acc.lost++; if (!ga) acc.cleanSheets++; if (gf && ga) acc.btts++; if (gf + ga > 2) acc.over25++;
      return acc;
    }, { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, cleanSheets: 0, btts: 0, over25: 0 });
    const form = [...completed].sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff)).slice(0, 6).map((row) => {
      const isHome = row.home_team_id === teamId, gf = (isHome ? row.home_goals : row.away_goals) ?? 0, ga = (isHome ? row.away_goals : row.home_goals) ?? 0;
      return { id: row.id, kickoff: row.kickoff, opponent: isHome ? row.away_name : row.home_name, location: isHome ? 'Home' : 'Away', gf, ga, result: gf > ga ? 'W' : gf === ga ? 'D' : 'L' };
    });
    const next = rows.find((row) => ['NS', 'TBD'].includes(row.status));
    return Response.json({ connected: true, team, season, overall: summarize(completed), home: summarize(home), away: summarize(away), form, next: next ? { id: next.id, kickoff: next.kickoff, opponent: next.home_team_id === teamId ? next.away_name : next.home_name, location: next.home_team_id === teamId ? 'Home' : 'Away', venue: next.venue } : null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ connected: false, error: 'Team analysis could not be loaded.' }, { status: 500 });
  }
}

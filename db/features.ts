import type { FeatureMatch, TeamMatchStatistics } from '@/lib/features';

type FeatureMatchRow = {
  id: number;
  competition_id: number;
  season: number;
  kickoff: string;
  home_team_id: number;
  away_team_id: number;
  home_goals: number;
  away_goals: number;
  home_statistics_team_id: number | null;
  away_statistics_team_id: number | null;
  home_shots_total: number | null;
  away_shots_total: number | null;
  home_shots_on: number | null;
  away_shots_on: number | null;
  home_fouls: number | null;
  away_fouls: number | null;
  home_possession: number | null;
  away_possession: number | null;
  home_corners: number | null;
  away_corners: number | null;
  home_yellow_cards: number | null;
  away_yellow_cards: number | null;
  home_red_cards: number | null;
  away_red_cards: number | null;
  home_passes_total: number | null;
  away_passes_total: number | null;
  home_passes_accurate: number | null;
  away_passes_accurate: number | null;
  home_expected_goals: number | null;
  away_expected_goals: number | null;
};

export async function readFeatureHistory(db: D1Database, options: { competitionId: number; fromSeason: number; toSeason: number }) {
  const rows = (await db.prepare(`
    SELECT
      f.id, f.competition_id, f.season, f.kickoff, f.home_team_id, f.away_team_id,
      f.home_goals, f.away_goals,
      hs.team_id AS home_statistics_team_id, ast.team_id AS away_statistics_team_id,
      hs.shots_total AS home_shots_total, ast.shots_total AS away_shots_total,
      hs.shots_on AS home_shots_on, ast.shots_on AS away_shots_on,
      hs.fouls AS home_fouls, ast.fouls AS away_fouls,
      hs.possession AS home_possession, ast.possession AS away_possession,
      hs.corners AS home_corners, ast.corners AS away_corners,
      hs.yellow_cards AS home_yellow_cards, ast.yellow_cards AS away_yellow_cards,
      hs.red_cards AS home_red_cards, ast.red_cards AS away_red_cards,
      hs.passes_total AS home_passes_total, ast.passes_total AS away_passes_total,
      hs.passes_accurate AS home_passes_accurate, ast.passes_accurate AS away_passes_accurate,
      hs.expected_goals AS home_expected_goals, ast.expected_goals AS away_expected_goals
    FROM fixtures f
    LEFT JOIN fixture_statistics hs ON hs.fixture_id = f.id AND hs.team_id = f.home_team_id
    LEFT JOIN fixture_statistics ast ON ast.fixture_id = f.id AND ast.team_id = f.away_team_id
    WHERE f.competition_id = ? AND f.season BETWEEN ? AND ?
      AND f.status IN ('FT', 'AET', 'PEN')
      AND f.home_goals IS NOT NULL AND f.away_goals IS NOT NULL
    ORDER BY f.kickoff, f.id
  `).bind(options.competitionId, options.fromSeason, options.toSeason).all<FeatureMatchRow>()).results;

  return rows.map((row): FeatureMatch => ({
    id: row.id,
    competitionId: row.competition_id,
    season: row.season,
    kickoff: row.kickoff,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
    homeGoals: row.home_goals,
    awayGoals: row.away_goals,
    homeStatistics: statistics(row, 'home'),
    awayStatistics: statistics(row, 'away'),
  }));
}

function statistics(row: FeatureMatchRow, side: 'home' | 'away'): TeamMatchStatistics | null {
  if (row[`${side}_statistics_team_id`] === null) return null;
  return {
    shotsTotal: row[`${side}_shots_total`],
    shotsOn: row[`${side}_shots_on`],
    fouls: row[`${side}_fouls`],
    possession: row[`${side}_possession`],
    corners: row[`${side}_corners`],
    yellowCards: row[`${side}_yellow_cards`],
    redCards: row[`${side}_red_cards`],
    passesTotal: row[`${side}_passes_total`],
    passesAccurate: row[`${side}_passes_accurate`],
    expectedGoals: row[`${side}_expected_goals`],
  };
}

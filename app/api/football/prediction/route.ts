import { ensureFootballSchema } from '@/db/football';

const COMPLETE_STATUSES = new Set(['FT', 'AET', 'PEN']);
const HOME_ADVANTAGE_ELO = 65;
const ELO_K = 24;
const SCORE_LIMIT = 7;

type FixtureRow = {
  id: number;
  competition_id: number;
  competition_name: string;
  season: number;
  kickoff: string;
  status: string;
  round: string | null;
  venue: string | null;
  home_team_id: number;
  home_name: string;
  home_logo: string | null;
  away_team_id: number;
  away_name: string;
  away_logo: string | null;
  home_goals: number | null;
  away_goals: number | null;
};

type TeamTotals = {
  played: number;
  goalsFor: number;
  goalsAgainst: number;
  homePlayed: number;
  homeGoalsFor: number;
  homeGoalsAgainst: number;
  awayPlayed: number;
  awayGoalsFor: number;
  awayGoalsAgainst: number;
};

type ModelOutput = {
  probabilities: { home: number; draw: number; away: number };
  expectedGoals: { home: number; away: number };
  markets: { over25: number; btts: number };
  scorelines: Array<{ score: string; probability: number }>;
  evidence: {
    homeElo: number;
    awayElo: number;
    homeMatches: number;
    awayMatches: number;
    leagueHomeGoals: number;
    leagueAwayGoals: number;
    homeAttack: number;
    awayAttack: number;
    homeDefence: number;
    awayDefence: number;
  };
};

export async function GET(request: Request) {
  const fixtureId = Number(new URL(request.url).searchParams.get('fixture'));
  if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
    return Response.json({ connected: false, error: 'A valid fixture ID is required.' }, { status: 400 });
  }

  try {
    const db = await ensureFootballSchema();
    const target = await db.prepare(`
      SELECT f.id, f.competition_id, c.name AS competition_name, f.season, f.kickoff, f.status, f.round, f.venue,
             f.home_team_id, ht.name AS home_name, ht.logo AS home_logo,
             f.away_team_id, at.name AS away_name, at.logo AS away_logo,
             f.home_goals, f.away_goals
      FROM fixtures f
      JOIN competitions c ON c.id = f.competition_id AND c.season = f.season
      JOIN teams ht ON ht.id = f.home_team_id
      JOIN teams at ON at.id = f.away_team_id
      WHERE f.id = ?
    `).bind(fixtureId).first<FixtureRow>();

    if (!target) return Response.json({ connected: false, error: 'This fixture is not in the competition database.' }, { status: 404 });

    const rows = (await db.prepare(`
      SELECT f.id, f.competition_id, c.name AS competition_name, f.season, f.kickoff, f.status, f.round, f.venue,
             f.home_team_id, ht.name AS home_name, ht.logo AS home_logo,
             f.away_team_id, at.name AS away_name, at.logo AS away_logo,
             f.home_goals, f.away_goals
      FROM fixtures f
      JOIN competitions c ON c.id = f.competition_id AND c.season = f.season
      JOIN teams ht ON ht.id = f.home_team_id
      JOIN teams at ON at.id = f.away_team_id
      WHERE f.competition_id = ? AND f.season = ? AND f.kickoff < ?
      ORDER BY f.kickoff ASC, f.id ASC
    `).bind(target.competition_id, target.season, target.kickoff).all<FixtureRow>()).results;

    const history = rows.filter(isCompleted);
    const prediction = modelPrediction(target, history);
    const validation = backtest(history);
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
        name: 'Elo + Bayesian Poisson baseline',
        version: '1.0',
        trainedThrough: history.at(-1)?.kickoff ?? null,
        trainingMatches: history.length,
        usesFutureData: false,
      },
      ...prediction,
      confidence,
      sampleWarning,
      validation,
    }, { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The prediction model could not be loaded.';
    return Response.json({ connected: false, error: message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

function modelPrediction(target: FixtureRow, history: FixtureRow[]): ModelOutput {
  const ratings = buildElo(history);
  const totals = buildTeamTotals(history);
  const home = totals.get(target.home_team_id) ?? emptyTotals();
  const away = totals.get(target.away_team_id) ?? emptyTotals();
  const matches = Math.max(1, history.length);
  const leagueHomeGoals = history.length
    ? history.reduce((sum, row) => sum + (row.home_goals ?? 0), 0) / matches
    : 1.45;
  const leagueAwayGoals = history.length
    ? history.reduce((sum, row) => sum + (row.away_goals ?? 0), 0) / matches
    : 1.15;
  const priorMatches = 5;

  const homeAttack = smoothedRate(home.homeGoalsFor, home.homePlayed, leagueHomeGoals, priorMatches) / leagueHomeGoals;
  const homeDefence = smoothedRate(home.homeGoalsAgainst, home.homePlayed, leagueAwayGoals, priorMatches) / leagueAwayGoals;
  const awayAttack = smoothedRate(away.awayGoalsFor, away.awayPlayed, leagueAwayGoals, priorMatches) / leagueAwayGoals;
  const awayDefence = smoothedRate(away.awayGoalsAgainst, away.awayPlayed, leagueHomeGoals, priorMatches) / leagueHomeGoals;
  const homeElo = ratings.get(target.home_team_id) ?? 1500;
  const awayElo = ratings.get(target.away_team_id) ?? 1500;
  const eloEdge = homeElo + HOME_ADVANTAGE_ELO - awayElo;
  const homeEloFactor = clamp(10 ** (eloEdge / 900), 0.72, 1.38);
  const awayEloFactor = clamp(10 ** (-eloEdge / 900), 0.72, 1.38);
  const expectedHome = clamp(leagueHomeGoals * homeAttack * awayDefence * homeEloFactor, 0.2, 3.8);
  const expectedAway = clamp(leagueAwayGoals * awayAttack * homeDefence * awayEloFactor, 0.2, 3.8);

  const grid: Array<{ home: number; away: number; probability: number }> = [];
  let gridTotal = 0;
  for (let homeGoals = 0; homeGoals <= SCORE_LIMIT; homeGoals++) {
    for (let awayGoals = 0; awayGoals <= SCORE_LIMIT; awayGoals++) {
      const probability = poisson(homeGoals, expectedHome) * poisson(awayGoals, expectedAway);
      grid.push({ home: homeGoals, away: awayGoals, probability });
      gridTotal += probability;
    }
  }
  for (const cell of grid) cell.probability /= gridTotal;

  const homeProbability = grid.filter((cell) => cell.home > cell.away).reduce((sum, cell) => sum + cell.probability, 0);
  const drawProbability = grid.filter((cell) => cell.home === cell.away).reduce((sum, cell) => sum + cell.probability, 0);
  const awayProbability = 1 - homeProbability - drawProbability;
  const over25 = grid.filter((cell) => cell.home + cell.away >= 3).reduce((sum, cell) => sum + cell.probability, 0);
  const btts = grid.filter((cell) => cell.home > 0 && cell.away > 0).reduce((sum, cell) => sum + cell.probability, 0);

  return {
    probabilities: { home: percent(homeProbability), draw: percent(drawProbability), away: percent(awayProbability) },
    expectedGoals: { home: round(expectedHome, 2), away: round(expectedAway, 2) },
    markets: { over25: percent(over25), btts: percent(btts) },
    scorelines: [...grid].sort((a, b) => b.probability - a.probability).slice(0, 5).map((cell) => ({ score: `${cell.home}–${cell.away}`, probability: percent(cell.probability) })),
    evidence: {
      homeElo: Math.round(homeElo), awayElo: Math.round(awayElo), homeMatches: home.played, awayMatches: away.played,
      leagueHomeGoals: round(leagueHomeGoals, 2), leagueAwayGoals: round(leagueAwayGoals, 2),
      homeAttack: round(homeAttack, 2), awayAttack: round(awayAttack, 2), homeDefence: round(homeDefence, 2), awayDefence: round(awayDefence, 2),
    },
  };
}

function backtest(history: FixtureRow[]) {
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  let matches = 0;
  for (let index = 5; index < history.length; index++) {
    const target = history[index];
    const output = modelPrediction(target, history.slice(0, index));
    const probabilities = [output.probabilities.home / 100, output.probabilities.draw / 100, output.probabilities.away / 100];
    const actualIndex = (target.home_goals ?? 0) > (target.away_goals ?? 0) ? 0 : (target.home_goals ?? 0) === (target.away_goals ?? 0) ? 1 : 2;
    const predictedIndex = probabilities.indexOf(Math.max(...probabilities));
    if (predictedIndex === actualIndex) correct++;
    brier += probabilities.reduce((sum, probability, outcome) => sum + (probability - (outcome === actualIndex ? 1 : 0)) ** 2, 0);
    logLoss += -Math.log(Math.max(probabilities[actualIndex], 0.001));
    matches++;
  }
  return {
    matches,
    accuracy: matches ? percent(correct / matches) : 0,
    brier: matches ? round(brier / matches, 3) : null,
    logLoss: matches ? round(logLoss / matches, 3) : null,
    methodology: 'Walk-forward validation: each result is predicted using only matches completed earlier in the season.',
  };
}

function buildElo(history: FixtureRow[]) {
  const ratings = new Map<number, number>();
  for (const fixture of history) {
    const homeRating = ratings.get(fixture.home_team_id) ?? 1500;
    const awayRating = ratings.get(fixture.away_team_id) ?? 1500;
    const expectedHome = 1 / (1 + 10 ** ((awayRating - homeRating - HOME_ADVANTAGE_ELO) / 400));
    const actualHome = (fixture.home_goals ?? 0) > (fixture.away_goals ?? 0) ? 1 : (fixture.home_goals ?? 0) === (fixture.away_goals ?? 0) ? 0.5 : 0;
    const change = ELO_K * (actualHome - expectedHome);
    ratings.set(fixture.home_team_id, homeRating + change);
    ratings.set(fixture.away_team_id, awayRating - change);
  }
  return ratings;
}

function buildTeamTotals(history: FixtureRow[]) {
  const totals = new Map<number, TeamTotals>();
  const get = (id: number) => {
    if (!totals.has(id)) totals.set(id, emptyTotals());
    return totals.get(id)!;
  };
  for (const fixture of history) {
    const home = get(fixture.home_team_id);
    const away = get(fixture.away_team_id);
    const homeGoals = fixture.home_goals ?? 0;
    const awayGoals = fixture.away_goals ?? 0;
    home.played++; home.goalsFor += homeGoals; home.goalsAgainst += awayGoals;
    home.homePlayed++; home.homeGoalsFor += homeGoals; home.homeGoalsAgainst += awayGoals;
    away.played++; away.goalsFor += awayGoals; away.goalsAgainst += homeGoals;
    away.awayPlayed++; away.awayGoalsFor += awayGoals; away.awayGoalsAgainst += homeGoals;
  }
  return totals;
}

function emptyTotals(): TeamTotals {
  return { played: 0, goalsFor: 0, goalsAgainst: 0, homePlayed: 0, homeGoalsFor: 0, homeGoalsAgainst: 0, awayPlayed: 0, awayGoalsFor: 0, awayGoalsAgainst: 0 };
}

function isCompleted(fixture: FixtureRow) {
  return COMPLETE_STATUSES.has(fixture.status) && fixture.home_goals !== null && fixture.away_goals !== null;
}

function smoothedRate(goals: number, matches: number, leagueRate: number, priorMatches: number) {
  return (goals + priorMatches * leagueRate) / (matches + priorMatches);
}

function poisson(goals: number, lambda: number) {
  return Math.exp(-lambda) * lambda ** goals / factorial(goals);
}

function factorial(value: number) {
  let result = 1;
  for (let number = 2; number <= value; number++) result *= number;
  return result;
}

function toFixture(row: FixtureRow) {
  return {
    id: row.id, competition: row.competition_name, season: row.season, kickoff: row.kickoff, round: row.round, venue: row.venue,
    home: { id: row.home_team_id, name: row.home_name, logo: row.home_logo },
    away: { id: row.away_team_id, name: row.away_name, logo: row.away_logo },
  };
}

function percent(value: number) { return round(value * 100, 1); }
function round(value: number, places: number) { return Number(value.toFixed(places)); }
function clamp(value: number, minimum: number, maximum: number) { return Math.max(minimum, Math.min(maximum, value)); }

import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const competitions = sqliteTable('competitions', {
  id: integer('id').notNull(),
  season: integer('season').notNull(),
  name: text('name').notNull(),
  country: text('country'),
  logo: text('logo'),
  updatedAt: text('updated_at').notNull(),
}, (table) => [primaryKey({ columns: [table.id, table.season] })]);

export const teams = sqliteTable('teams', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  logo: text('logo'),
  updatedAt: text('updated_at').notNull(),
});

export const fixtures = sqliteTable('fixtures', {
  id: integer('id').primaryKey(),
  competitionId: integer('competition_id').notNull(),
  season: integer('season').notNull(),
  round: text('round'),
  kickoff: text('kickoff').notNull(),
  status: text('status').notNull(),
  venue: text('venue'),
  homeTeamId: integer('home_team_id').notNull(),
  awayTeamId: integer('away_team_id').notNull(),
  homeGoals: integer('home_goals'),
  awayGoals: integer('away_goals'),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_fixtures_competition_season_kickoff').on(table.competitionId, table.season, table.kickoff),
  index('idx_fixtures_home_team').on(table.homeTeamId),
  index('idx_fixtures_away_team').on(table.awayTeamId),
]);

export const syncRuns = sqliteTable('sync_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  competitionId: integer('competition_id').notNull(),
  season: integer('season').notNull(),
  status: text('status').notNull(),
  records: integer('records').notNull().default(0),
  error: text('error'),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
}, (table) => [index('idx_sync_runs_competition_season').on(table.competitionId, table.season)]);

export const predictionSnapshots = sqliteTable('prediction_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fixtureId: integer('fixture_id').notNull(),
  competitionId: integer('competition_id').notNull(),
  season: integer('season').notNull(),
  kickoff: text('kickoff').notNull(),
  modelName: text('model_name').notNull(),
  modelVersion: text('model_version').notNull(),
  homeProbability: real('home_probability').notNull(),
  drawProbability: real('draw_probability').notNull(),
  awayProbability: real('away_probability').notNull(),
  expectedHomeGoals: real('expected_home_goals').notNull(),
  expectedAwayGoals: real('expected_away_goals').notNull(),
  over25Probability: real('over25_probability').notNull(),
  bttsProbability: real('btts_probability').notNull(),
  marketHomeProbability: real('market_home_probability'),
  marketDrawProbability: real('market_draw_probability'),
  marketAwayProbability: real('market_away_probability'),
  marketBookmakers: integer('market_bookmakers'),
  trainingMatches: integer('training_matches').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_prediction_snapshots_fixture').on(table.fixtureId, table.modelVersion, table.id),
  index('idx_prediction_snapshots_kickoff').on(table.kickoff),
]);

export const fixtureStatistics = sqliteTable('fixture_statistics', {
  fixtureId: integer('fixture_id').notNull(),
  teamId: integer('team_id').notNull(),
  shotsTotal: integer('shots_total'),
  shotsOn: integer('shots_on'),
  shotsOff: integer('shots_off'),
  shotsBlocked: integer('shots_blocked'),
  shotsInsideBox: integer('shots_inside_box'),
  shotsOutsideBox: integer('shots_outside_box'),
  fouls: integer('fouls'),
  corners: integer('corners'),
  offsides: integer('offsides'),
  possession: real('possession'),
  yellowCards: integer('yellow_cards'),
  redCards: integer('red_cards'),
  saves: integer('saves'),
  passesTotal: integer('passes_total'),
  passesAccurate: integer('passes_accurate'),
  expectedGoals: real('expected_goals'),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.fixtureId, table.teamId] }),
  index('idx_fixture_statistics_fixture').on(table.fixtureId),
]);

export const fixtureLineups = sqliteTable('fixture_lineups', {
  fixtureId: integer('fixture_id').notNull(),
  teamId: integer('team_id').notNull(),
  formation: text('formation'),
  coach: text('coach'),
  starters: text('starters').notNull(),
  substitutes: text('substitutes').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.fixtureId, table.teamId] }),
  index('idx_fixture_lineups_fixture').on(table.fixtureId),
]);

export const fixturePlayerStatistics = sqliteTable('fixture_player_statistics', {
  fixtureId: integer('fixture_id').notNull(),
  teamId: integer('team_id').notNull(),
  playerId: integer('player_id').notNull(),
  playerName: text('player_name').notNull(),
  position: text('position'),
  minutes: integer('minutes'),
  rating: real('rating'),
  captain: integer('captain', { mode: 'boolean' }),
  substitute: integer('substitute', { mode: 'boolean' }),
  offsides: integer('offsides'),
  shotsTotal: integer('shots_total'),
  shotsOn: integer('shots_on'),
  goals: integer('goals'),
  goalsConceded: integer('goals_conceded'),
  assists: integer('assists'),
  saves: integer('saves'),
  passesTotal: integer('passes_total'),
  passesKey: integer('passes_key'),
  passesAccuracy: real('passes_accuracy'),
  tackles: integer('tackles'),
  blocks: integer('blocks'),
  interceptions: integer('interceptions'),
  duels: integer('duels'),
  duelsWon: integer('duels_won'),
  dribblesAttempts: integer('dribbles_attempts'),
  dribblesSuccess: integer('dribbles_success'),
  dribbledPast: integer('dribbled_past'),
  foulsDrawn: integer('fouls_drawn'),
  foulsCommitted: integer('fouls_committed'),
  yellowCards: integer('yellow_cards'),
  redCards: integer('red_cards'),
  penaltiesWon: integer('penalties_won'),
  penaltiesCommitted: integer('penalties_committed'),
  penaltiesScored: integer('penalties_scored'),
  penaltiesMissed: integer('penalties_missed'),
  penaltiesSaved: integer('penalties_saved'),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.fixtureId, table.teamId, table.playerId] }),
  index('idx_fixture_player_statistics_fixture').on(table.fixtureId),
  index('idx_fixture_player_statistics_player').on(table.playerId, table.fixtureId),
]);

export const fixtureDetailImports = sqliteTable('fixture_detail_imports', {
  fixtureId: integer('fixture_id').notNull(),
  detailClass: text('detail_class').notNull(),
  status: text('status').notNull(),
  message: text('message'),
  attemptedAt: text('attempted_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.fixtureId, table.detailClass] }),
  index('idx_fixture_detail_imports_class_status').on(table.detailClass, table.status),
]);

export const fixtureAvailabilitySnapshots = sqliteTable('fixture_availability_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fixtureId: integer('fixture_id').notNull(),
  lineups: text('lineups').notNull(),
  injuries: text('injuries').notNull(),
  capturedAt: text('captured_at').notNull(),
}, (table) => [
  index('idx_fixture_availability_fixture_captured').on(table.fixtureId, table.capturedAt),
]);

export const fixtureOdds = sqliteTable('fixture_odds', {
  fixtureId: integer('fixture_id').notNull(),
  bookmakerId: integer('bookmaker_id').notNull(),
  bookmaker: text('bookmaker').notNull(),
  homeOdds: real('home_odds'),
  drawOdds: real('draw_odds'),
  awayOdds: real('away_odds'),
  over25Odds: real('over25_odds'),
  under25Odds: real('under25_odds'),
  bttsYesOdds: real('btts_yes_odds'),
  bttsNoOdds: real('btts_no_odds'),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.fixtureId, table.bookmakerId] }),
  index('idx_fixture_odds_fixture').on(table.fixtureId),
]);

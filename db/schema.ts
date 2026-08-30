import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

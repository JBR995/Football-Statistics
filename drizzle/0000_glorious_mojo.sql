CREATE TABLE `competitions` (
	`id` integer NOT NULL,
	`season` integer NOT NULL,
	`name` text NOT NULL,
	`country` text,
	`logo` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`id`, `season`)
);
--> statement-breakpoint
CREATE TABLE `fixtures` (
	`id` integer PRIMARY KEY NOT NULL,
	`competition_id` integer NOT NULL,
	`season` integer NOT NULL,
	`round` text,
	`kickoff` text NOT NULL,
	`status` text NOT NULL,
	`venue` text,
	`home_team_id` integer NOT NULL,
	`away_team_id` integer NOT NULL,
	`home_goals` integer,
	`away_goals` integer,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_fixtures_competition_season_kickoff` ON `fixtures` (`competition_id`,`season`,`kickoff`);--> statement-breakpoint
CREATE INDEX `idx_fixtures_home_team` ON `fixtures` (`home_team_id`);--> statement-breakpoint
CREATE INDEX `idx_fixtures_away_team` ON `fixtures` (`away_team_id`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competition_id` integer NOT NULL,
	`season` integer NOT NULL,
	`status` text NOT NULL,
	`records` integer DEFAULT 0 NOT NULL,
	`error` text,
	`started_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_sync_runs_competition_season` ON `sync_runs` (`competition_id`,`season`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`logo` text,
	`updated_at` text NOT NULL
);

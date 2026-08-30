CREATE TABLE `prediction_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fixture_id` integer NOT NULL,
	`competition_id` integer NOT NULL,
	`season` integer NOT NULL,
	`kickoff` text NOT NULL,
	`model_name` text NOT NULL,
	`model_version` text NOT NULL,
	`home_probability` real NOT NULL,
	`draw_probability` real NOT NULL,
	`away_probability` real NOT NULL,
	`expected_home_goals` real NOT NULL,
	`expected_away_goals` real NOT NULL,
	`over25_probability` real NOT NULL,
	`btts_probability` real NOT NULL,
	`training_matches` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_prediction_snapshots_fixture` ON `prediction_snapshots` (`fixture_id`,`model_version`,`id`);--> statement-breakpoint
CREATE INDEX `idx_prediction_snapshots_kickoff` ON `prediction_snapshots` (`kickoff`);
CREATE TABLE `fixture_lineups` (
	`fixture_id` integer NOT NULL,
	`team_id` integer NOT NULL,
	`formation` text,
	`coach` text,
	`starters` text NOT NULL,
	`substitutes` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`fixture_id`, `team_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_fixture_lineups_fixture` ON `fixture_lineups` (`fixture_id`);--> statement-breakpoint
CREATE TABLE `fixture_odds` (
	`fixture_id` integer NOT NULL,
	`bookmaker_id` integer NOT NULL,
	`bookmaker` text NOT NULL,
	`home_odds` real,
	`draw_odds` real,
	`away_odds` real,
	`over25_odds` real,
	`under25_odds` real,
	`btts_yes_odds` real,
	`btts_no_odds` real,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`fixture_id`, `bookmaker_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_fixture_odds_fixture` ON `fixture_odds` (`fixture_id`);--> statement-breakpoint
CREATE TABLE `fixture_statistics` (
	`fixture_id` integer NOT NULL,
	`team_id` integer NOT NULL,
	`shots_total` integer,
	`shots_on` integer,
	`shots_off` integer,
	`shots_blocked` integer,
	`shots_inside_box` integer,
	`shots_outside_box` integer,
	`fouls` integer,
	`corners` integer,
	`offsides` integer,
	`possession` real,
	`yellow_cards` integer,
	`red_cards` integer,
	`saves` integer,
	`passes_total` integer,
	`passes_accurate` integer,
	`expected_goals` real,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`fixture_id`, `team_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_fixture_statistics_fixture` ON `fixture_statistics` (`fixture_id`);
CREATE TABLE `fixture_availability_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fixture_id` integer NOT NULL,
	`lineups` text NOT NULL,
	`injuries` text NOT NULL,
	`captured_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_fixture_availability_fixture_captured` ON `fixture_availability_snapshots` (`fixture_id`,`captured_at`);
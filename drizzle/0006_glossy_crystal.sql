CREATE TABLE `fixture_detail_imports` (
	`fixture_id` integer NOT NULL,
	`detail_class` text NOT NULL,
	`status` text NOT NULL,
	`message` text,
	`attempted_at` text NOT NULL,
	PRIMARY KEY(`fixture_id`, `detail_class`)
);
--> statement-breakpoint
CREATE INDEX `idx_fixture_detail_imports_class_status` ON `fixture_detail_imports` (`detail_class`,`status`);
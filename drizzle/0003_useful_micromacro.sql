ALTER TABLE `prediction_snapshots` ADD `market_home_probability` real;--> statement-breakpoint
ALTER TABLE `prediction_snapshots` ADD `market_draw_probability` real;--> statement-breakpoint
ALTER TABLE `prediction_snapshots` ADD `market_away_probability` real;--> statement-breakpoint
ALTER TABLE `prediction_snapshots` ADD `market_bookmakers` integer;
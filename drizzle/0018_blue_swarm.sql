CREATE TABLE `tracked_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`external_id` text NOT NULL,
	`scope_key` text NOT NULL,
	`project_id` integer,
	`title` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`payload` text NOT NULL,
	`upstream_state` text DEFAULT 'open' NOT NULL,
	`disposition` text DEFAULT 'none' NOT NULL,
	`closed_reason` text,
	`first_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`source_created_at` integer,
	`last_activity_at` integer,
	`closed_at` integer,
	`reopened_at` integer,
	`reopen_count` integer DEFAULT 0 NOT NULL,
	`snoozed_until` integer,
	`last_user_action_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tracked_items_scope_idx` ON `tracked_items` (`source`,`kind`,`scope_key`);--> statement-breakpoint
CREATE INDEX `tracked_items_state_idx` ON `tracked_items` (`upstream_state`,`disposition`);--> statement-breakpoint
CREATE UNIQUE INDEX `tracked_items_source_external_unique` ON `tracked_items` (`source`,`external_id`);
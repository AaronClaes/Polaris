CREATE TABLE `email_thread_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account` text NOT NULL,
	`thread_id` text NOT NULL,
	`dismissed_message_at` integer NOT NULL,
	`dismissed_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_thread_state_account_thread_unique` ON `email_thread_state` (`account`,`thread_id`);
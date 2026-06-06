CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`repo_owner` text,
	`repo_name` text,
	`local_path` text,
	`staging_url` text,
	`production_url` text,
	`hosting_url` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);

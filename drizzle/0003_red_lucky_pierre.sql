CREATE TABLE `project_repos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`repo_id` integer NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`description` text,
	`url` text NOT NULL,
	`default_branch` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_repos_project_owner_name_unique` ON `project_repos` (`project_id`,`owner`,`name`);
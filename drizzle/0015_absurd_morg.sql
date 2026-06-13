PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_todos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer,
	`title` text DEFAULT '' NOT NULL,
	`due_date` integer,
	`completed` integer DEFAULT false NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_todos`("id", "project_id", "title", "due_date", "completed", "completed_at", "created_at", "updated_at") SELECT "id", "project_id", "title", "due_date", "completed", "completed_at", "created_at", "updated_at" FROM `todos`;--> statement-breakpoint
DROP TABLE `todos`;--> statement-breakpoint
ALTER TABLE `__new_todos` RENAME TO `todos`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
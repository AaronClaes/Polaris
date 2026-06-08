ALTER TABLE `action_groups` ADD `pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `project_actions` ADD `pinned` integer DEFAULT false NOT NULL;
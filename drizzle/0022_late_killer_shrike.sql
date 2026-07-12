ALTER TABLE `project_repos` ADD `setup_commands` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_repos` ADD `last_setup_command` text;
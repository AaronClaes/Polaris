ALTER TABLE `projects` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Seed the manual order from the previous newest-first sort so existing
-- projects keep their current arrangement: newest gets the lowest sort_order.
WITH ranked AS (
	SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC, id DESC) - 1 AS rn
	FROM `projects`
)
UPDATE `projects`
SET `sort_order` = (SELECT rn FROM ranked WHERE ranked.id = `projects`.id);
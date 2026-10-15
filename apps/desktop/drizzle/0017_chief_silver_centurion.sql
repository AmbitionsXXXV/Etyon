CREATE TABLE `media_tasks` (
	`cost_text` text,
	`created_at` text NOT NULL,
	`error` text,
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`local_paths_json` text,
	`model` text NOT NULL,
	`output_urls_json` text,
	`owner_json` text NOT NULL,
	`project_path` text NOT NULL,
	`provider` text NOT NULL,
	`request_json` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `media_tasks_status_idx` ON `media_tasks` (`status`);
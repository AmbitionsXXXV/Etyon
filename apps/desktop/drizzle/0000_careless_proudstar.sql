CREATE TABLE `chat_sessions` (
	`created_at` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`last_opened_at` text NOT NULL,
	`project_path` text NOT NULL,
	`title` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_sessions_last_opened_at_idx` ON `chat_sessions` (`last_opened_at`);--> statement-breakpoint
CREATE INDEX `chat_sessions_project_path_idx` ON `chat_sessions` (`project_path`);
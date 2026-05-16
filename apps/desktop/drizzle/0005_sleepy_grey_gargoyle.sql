CREATE TABLE `memory_entries` (
	`access_count` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`last_accessed_at` text,
	`project_path` text,
	`scope` text NOT NULL,
	`session_id` text,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_entries_project_path_idx` ON `memory_entries` (`project_path`);--> statement-breakpoint
CREATE INDEX `memory_entries_session_id_idx` ON `memory_entries` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_entries_source_id_idx` ON `memory_entries` (`source`,`source_id`);--> statement-breakpoint
CREATE INDEX `memory_entries_updated_at_idx` ON `memory_entries` (`updated_at`);
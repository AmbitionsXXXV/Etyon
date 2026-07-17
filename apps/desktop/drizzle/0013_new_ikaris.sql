CREATE TABLE `chat_session_plans` (
	`created_at` text NOT NULL,
	`decided_at` text,
	`plan_markdown` text NOT NULL,
	`session_id` text PRIMARY KEY NOT NULL,
	`source_run_id` text,
	`source_tool_call_id` text,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);

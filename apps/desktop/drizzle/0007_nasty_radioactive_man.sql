CREATE TABLE `agent_events` (
	`created_at` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`payload_json` text NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_events_run_sequence_idx` ON `agent_events` (`run_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`chat_session_id` text NOT NULL,
	`error_message` text,
	`finished_at` text,
	`id` text PRIMARY KEY NOT NULL,
	`model_id` text,
	`parent_run_id` text,
	`profile_id` text NOT NULL,
	`started_at` text NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`chat_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_runs_chat_session_idx` ON `agent_runs` (`chat_session_id`);--> statement-breakpoint
CREATE INDEX `agent_runs_parent_run_idx` ON `agent_runs` (`parent_run_id`);--> statement-breakpoint
CREATE INDEX `agent_runs_status_idx` ON `agent_runs` (`status`);--> statement-breakpoint
CREATE TABLE `agent_tool_calls` (
	`approval_state` text NOT NULL,
	`error_message` text,
	`finished_at` text,
	`id` text PRIMARY KEY NOT NULL,
	`input_json` text NOT NULL,
	`output_json` text,
	`parent_tool_call_id` text,
	`run_id` text NOT NULL,
	`started_at` text NOT NULL,
	`state` text NOT NULL,
	`tool_name` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_tool_calls_run_state_idx` ON `agent_tool_calls` (`run_id`,`state`);--> statement-breakpoint
CREATE INDEX `agent_tool_calls_run_tool_idx` ON `agent_tool_calls` (`run_id`,`tool_name`);
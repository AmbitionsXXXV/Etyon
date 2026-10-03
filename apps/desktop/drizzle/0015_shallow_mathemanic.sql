CREATE TABLE `agent_invocations` (
	`created_at` text NOT NULL,
	`error` text,
	`id` text PRIMARY KEY NOT NULL,
	`input_hash` text NOT NULL,
	`output_json` text,
	`run_id` text,
	`session_id` text NOT NULL,
	`state` text NOT NULL,
	`summary_json` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_invocations_call_idx` ON `agent_invocations` (`session_id`,`tool_call_id`);--> statement-breakpoint
CREATE INDEX `agent_invocations_session_idx` ON `agent_invocations` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_invocations_state_idx` ON `agent_invocations` (`state`);
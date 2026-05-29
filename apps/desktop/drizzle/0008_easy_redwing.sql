CREATE TABLE `agent_artifacts` (
	`byte_length` integer,
	`created_at` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`metadata_json` text NOT NULL,
	`path` text NOT NULL,
	`run_id` text NOT NULL,
	`tool_call_id` text,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_artifacts_run_idx` ON `agent_artifacts` (`run_id`);--> statement-breakpoint
CREATE INDEX `agent_artifacts_run_tool_idx` ON `agent_artifacts` (`run_id`,`tool_call_id`);
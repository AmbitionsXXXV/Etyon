CREATE TABLE `agent_approvals` (
	`created_at` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`responded_at` text,
	`response_json` text,
	`run_id` text NOT NULL,
	`state` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`tool_call_row_id` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tool_call_row_id`) REFERENCES `agent_tool_calls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_approvals_run_state_idx` ON `agent_approvals` (`run_id`,`state`);--> statement-breakpoint
CREATE INDEX `agent_approvals_run_tool_idx` ON `agent_approvals` (`run_id`,`tool_call_id`);--> statement-breakpoint
CREATE INDEX `agent_approvals_tool_call_row_idx` ON `agent_approvals` (`tool_call_row_id`);
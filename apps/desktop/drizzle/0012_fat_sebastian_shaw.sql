CREATE TABLE `agent_checkpoints` (
	`created_at` text NOT NULL,
	`files_json` text NOT NULL,
	`git_snapshot_ref` text,
	`id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`parent_id` text,
	`project_hash` text NOT NULL,
	`run_id` text NOT NULL,
	`tool_call_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_checkpoints_project_created_at_idx` ON `agent_checkpoints` (`project_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_checkpoints_run_tool_idx` ON `agent_checkpoints` (`run_id`,`tool_call_id`);
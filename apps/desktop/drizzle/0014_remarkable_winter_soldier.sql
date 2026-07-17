ALTER TABLE `agent_runs` ADD `parent_tool_call_id` text;--> statement-breakpoint
CREATE INDEX `agent_runs_parent_tool_call_idx` ON `agent_runs` (`parent_tool_call_id`);
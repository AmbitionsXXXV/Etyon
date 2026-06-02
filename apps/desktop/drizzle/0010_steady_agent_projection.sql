ALTER TABLE `chat_messages` ADD `agent_projection_run_id` text;--> statement-breakpoint
CREATE INDEX `chat_messages_agent_projection_run_idx` ON `chat_messages` (`agent_projection_run_id`);--> statement-breakpoint
UPDATE `chat_messages`
SET `agent_projection_run_id` = json_extract(`metadata_json`, '$.agentProjection.runId')
WHERE `role` = 'assistant'
  AND `metadata_json` IS NOT NULL
  AND json_valid(`metadata_json`)
  AND json_extract(`metadata_json`, '$.agentProjection.source') = 'agent_events'
  AND typeof(json_extract(`metadata_json`, '$.agentProjection.runId')) = 'text';

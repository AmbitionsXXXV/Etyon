CREATE TABLE `automation_runs` (
	`agent_run_id` text,
	`error` text,
	`finished_at` text,
	`id` text PRIMARY KEY NOT NULL,
	`notification_error` text,
	`notified_at` text,
	`session_id` text NOT NULL,
	`started_at` text NOT NULL,
	`status` text NOT NULL,
	`summary` text,
	`task_id` text NOT NULL,
	`trigger` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `automation_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_runs_active_session_idx` ON `automation_runs` (`session_id`) WHERE "automation_runs"."status" in ('running', 'suspended');--> statement-breakpoint
CREATE INDEX `automation_runs_status_idx` ON `automation_runs` (`status`);--> statement-breakpoint
CREATE INDEX `automation_runs_task_started_idx` ON `automation_runs` (`task_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `automation_tasks` (
	`created_at` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`model_id` text,
	`name` text NOT NULL,
	`next_run_at` text,
	`notify_desktop` integer DEFAULT true NOT NULL,
	`notify_telegram` integer DEFAULT false NOT NULL,
	`permission_mode` text NOT NULL,
	`profile_id` text,
	`prompt` text NOT NULL,
	`schedule_json` text NOT NULL,
	`session_id` text NOT NULL,
	`timeout_minutes` integer DEFAULT 30 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `automation_tasks_due_idx` ON `automation_tasks` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `automation_tasks_session_idx` ON `automation_tasks` (`session_id`);
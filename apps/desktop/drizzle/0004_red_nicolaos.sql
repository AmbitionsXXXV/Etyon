CREATE TABLE `chat_messages` (
	`created_at` text NOT NULL,
	`message_id` text NOT NULL,
	`metadata_json` text,
	`parts_json` text NOT NULL,
	`role` text NOT NULL,
	`sequence` integer NOT NULL,
	`session_id` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`session_id`, `message_id`),
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_messages_session_sequence_idx` ON `chat_messages` (`session_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `chat_session_memories` (
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`message_count` integer NOT NULL,
	`session_id` text PRIMARY KEY NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);

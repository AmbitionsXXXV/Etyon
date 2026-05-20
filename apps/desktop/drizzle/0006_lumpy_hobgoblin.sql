CREATE TABLE `memory_embeddings` (
	`content_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`dimensions` integer NOT NULL,
	`memory_id` text NOT NULL,
	`model` text NOT NULL,
	`updated_at` text NOT NULL,
	`vector_json` text NOT NULL,
	PRIMARY KEY(`memory_id`, `model`),
	FOREIGN KEY (`memory_id`) REFERENCES `memory_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_embeddings_model_idx` ON `memory_embeddings` (`model`);
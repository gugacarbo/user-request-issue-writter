CREATE TABLE `requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`body_hash` text NOT NULL,
	`delivery_id` text,
	`repo` text NOT NULL,
	`owner` text NOT NULL,
	`requester_name` text NOT NULL,
	`requester_email` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`issue_number` integer,
	`issue_url` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requests_body_hash_unique` ON `requests` (`body_hash`);
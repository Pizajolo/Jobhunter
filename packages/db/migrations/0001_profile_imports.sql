CREATE TABLE `profile_imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`filename` text NOT NULL,
	`file_path` text,
	`text` text NOT NULL,
	`extracted` text,
	`status` text DEFAULT 'extracting' NOT NULL,
	`error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);

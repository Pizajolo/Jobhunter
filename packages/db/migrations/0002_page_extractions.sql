CREATE TABLE `page_extractions` (
	`url` text NOT NULL,
	`content_hash` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`url`, `content_hash`)
);

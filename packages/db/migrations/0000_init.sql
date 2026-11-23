CREATE TABLE `applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`status` text DEFAULT 'found' NOT NULL,
	`applied_at` text,
	`channel` text,
	`auto_submitted` integer DEFAULT false NOT NULL,
	`sender_domains` text DEFAULT '[]' NOT NULL,
	`ats_ref_ids` text DEFAULT '[]' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status_changed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`last_email_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applications_job` ON `applications` (`job_id`);--> statement-breakpoint
CREATE INDEX `applications_status` ON `applications` (`status`);--> statement-breakpoint
CREATE TABLE `apply_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`level` text NOT NULL,
	`status` text NOT NULL,
	`stop_reason` text,
	`filler` text,
	`fields` text,
	`screenshot_path` text,
	`url` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `apply_runs_application` ON `apply_runs` (`application_id`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`proposal` text,
	`proposal_status` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_thread` ON `chat_messages` (`thread`,`id`);--> statement-breakpoint
CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`norm_name` text NOT NULL,
	`website` text,
	`careers_url` text,
	`ats_type` text,
	`ats_slug` text,
	`source` text DEFAULT 'user' NOT NULL,
	`watch_status` text DEFAULT 'watching' NOT NULL,
	`discovery_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_norm_name` ON `companies` (`norm_name`);--> statement-breakpoint
CREATE INDEX `companies_watch` ON `companies` (`watch_status`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`type` text NOT NULL,
	`language` text NOT NULL,
	`template` text,
	`content` text NOT NULL,
	`html` text,
	`pdf_path` text,
	`facts_used` text DEFAULT '[]' NOT NULL,
	`warnings` text DEFAULT '[]' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`approved_at` text,
	`model` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `documents_application` ON `documents` (`application_id`,`type`);--> statement-breakpoint
CREATE TABLE `domain_budget` (
	`domain` text NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`domain`, `day`)
);
--> statement-breakpoint
CREATE TABLE `emails` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`provider_message_id` text NOT NULL,
	`thread_id` text,
	`from_address` text NOT NULL,
	`from_domain` text NOT NULL,
	`subject` text NOT NULL,
	`received_at` text NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`body_hash` text NOT NULL,
	`prefilter` text,
	`classification` text,
	`confidence` real,
	`key_sentence` text,
	`company` text,
	`role` text,
	`application_id` integer,
	`match_confidence` real,
	`review_status` text DEFAULT 'none' NOT NULL,
	`labels_applied` text DEFAULT '[]' NOT NULL,
	`processed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `emails_provider_msg` ON `emails` (`provider`,`provider_message_id`);--> statement-breakpoint
CREATE INDEX `emails_application` ON `emails` (`application_id`);--> statement-breakpoint
CREATE INDEX `emails_review` ON `emails` (`review_status`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer,
	`actor` text NOT NULL,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`details` text,
	`screenshot_path` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_application` ON `events` (`application_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `http_cache` (
	`url` text PRIMARY KEY NOT NULL,
	`status` integer NOT NULL,
	`etag` text,
	`last_modified` text,
	`content_type` text,
	`body` text NOT NULL,
	`content_hash` text NOT NULL,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `interview_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`state` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer,
	`company_id` integer,
	`company` text NOT NULL,
	`norm_company` text NOT NULL,
	`title` text NOT NULL,
	`norm_title` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`norm_location` text DEFAULT '' NOT NULL,
	`remote` text DEFAULT 'unknown' NOT NULL,
	`salary` text,
	`language` text,
	`description` text DEFAULT '' NOT NULL,
	`url` text NOT NULL,
	`canonical_url` text NOT NULL,
	`apply_url` text,
	`ats_type` text NOT NULL,
	`ats_job_id` text,
	`department` text,
	`employment_type` text,
	`posted_at` text,
	`first_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`last_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`closed_at` text,
	`content_hash` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `jobs_content_hash` ON `jobs` (`content_hash`);--> statement-breakpoint
CREATE INDEX `jobs_company_title` ON `jobs` (`norm_company`,`norm_title`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_ats_id` ON `jobs` (`ats_type`,`ats_job_id`);--> statement-breakpoint
CREATE INDEX `jobs_canonical_url` ON `jobs` (`canonical_url`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`score` integer NOT NULL,
	`reasons` text NOT NULL,
	`gaps` text NOT NULL,
	`model` text,
	`prefilter_passed` integer DEFAULT true NOT NULL,
	`prefilter_reason` text,
	`profile_version` integer DEFAULT 0 NOT NULL,
	`search_version` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matches_job` ON `matches` (`job_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`link` text,
	`urgent` integer DEFAULT false NOT NULL,
	`read_at` text,
	`delivered_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profile_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`source` text NOT NULL,
	`category` text,
	`ref_id` text,
	`confirmed_at` text,
	`deleted_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `profile_facts_confirmed` ON `profile_facts` (`confirmed_at`);--> statement-breakpoint
CREATE TABLE `profile_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` integer NOT NULL,
	`data` text NOT NULL,
	`diff` text,
	`source` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_versions_version` ON `profile_versions` (`version`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`endpoint` text PRIMARY KEY NOT NULL,
	`keys` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scan_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`sources_total` integer DEFAULT 0 NOT NULL,
	`sources_failed` integer DEFAULT 0 NOT NULL,
	`jobs_seen` integer DEFAULT 0 NOT NULL,
	`jobs_new` integer DEFAULT 0 NOT NULL,
	`matches_new` integer DEFAULT 0 NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE TABLE `scheduler_state` (
	`job` text PRIMARY KEY NOT NULL,
	`last_run_at` text,
	`last_status` text
);
--> statement-breakpoint
CREATE TABLE `search_profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`config` text NOT NULL,
	`company_id` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`last_run_at` text,
	`last_success_at` text,
	`last_error_at` text,
	`last_error` text,
	`last_job_count` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sources_company` ON `sources` (`company_id`);--> statement-breakpoint
CREATE TABLE `style_edits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer,
	`language` text NOT NULL,
	`before` text NOT NULL,
	`after` text NOT NULL,
	`processed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `style_profile` (
	`language` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `style_samples` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`language` text NOT NULL,
	`text` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task` text NOT NULL,
	`status` text NOT NULL,
	`model` text,
	`runner` text,
	`attempts` integer DEFAULT 1 NOT NULL,
	`error` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`application_id` integer,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `task_runs_task` ON `task_runs` (`task`,`started_at`);--> statement-breakpoint
CREATE INDEX `task_runs_started` ON `task_runs` (`started_at`);
import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
const createdAt = () => text('created_at').notNull().default(now);
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: json<unknown>('value').notNull(),
  updatedAt: text('updated_at').notNull().default(now),
});

export const profile = sqliteTable('profile', {
  id: integer('id').primaryKey(), // always 1
  data: json<unknown>('data').notNull(),
  version: integer('version').notNull().default(1),
  updatedAt: text('updated_at').notNull().default(now),
});

export const profileVersions = sqliteTable(
  'profile_versions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    version: integer('version').notNull(),
    data: json<unknown>('data').notNull(),
    diff: json<unknown>('diff'),
    source: text('source').notNull(), // cv | interview | manual | chat
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('profile_versions_version').on(t.version)],
);

export const profileFacts = sqliteTable(
  'profile_facts',
  {
    id: text('id').primaryKey(),
    text: text('text').notNull(),
    source: text('source').notNull(), // cv | interview | manual | linkedin_pdf
    category: text('category'),
    refId: text('ref_id'),
    confirmedAt: text('confirmed_at'),
    deletedAt: text('deleted_at'),
    createdAt: createdAt(),
  },
  (t) => [index('profile_facts_confirmed').on(t.confirmedAt)],
);

export const styleProfile = sqliteTable('style_profile', {
  language: text('language').primaryKey(),
  data: json<unknown>('data').notNull(),
  updatedAt: text('updated_at').notNull().default(now),
});

export const styleSamples = sqliteTable('style_samples', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  language: text('language').notNull(),
  text: text('text').notNull(),
  source: text('source').notNull(), // pasted | upload | sent_email
  createdAt: createdAt(),
});

export const styleEdits = sqliteTable('style_edits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  documentId: integer('document_id').references(() => documents.id, { onDelete: 'cascade' }),
  language: text('language').notNull(),
  before: text('before').notNull(),
  after: text('after').notNull(),
  processedAt: text('processed_at'),
  createdAt: createdAt(),
});

export const searchProfile = sqliteTable('search_profile', {
  id: integer('id').primaryKey(), // always 1
  data: json<unknown>('data').notNull(),
  version: integer('version').notNull().default(1),
  updatedAt: text('updated_at').notNull().default(now),
});

export const companies = sqliteTable(
  'companies',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    normName: text('norm_name').notNull(),
    website: text('website'),
    careersUrl: text('careers_url'),
    atsType: text('ats_type'),
    atsSlug: text('ats_slug'),
    source: text('source').notNull().default('user'), // user | discovered
    watchStatus: text('watch_status').notNull().default('watching'), // watching | suggested | rejected | paused
    discoveryReason: text('discovery_reason'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('companies_norm_name').on(t.normName), index('companies_watch').on(t.watchStatus)],
);

export const sources = sqliteTable(
  'sources',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind').notNull(), // adapter id
    name: text('name').notNull(),
    config: json<Record<string, unknown>>('config').notNull(),
    companyId: integer('company_id').references(() => companies.id, { onDelete: 'cascade' }),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    lastRunAt: text('last_run_at'),
    lastSuccessAt: text('last_success_at'),
    lastErrorAt: text('last_error_at'),
    lastError: text('last_error'),
    lastJobCount: integer('last_job_count'),
    createdAt: createdAt(),
  },
  (t) => [index('sources_company').on(t.companyId)],
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: integer('source_id').references(() => sources.id, { onDelete: 'set null' }),
    companyId: integer('company_id').references(() => companies.id, { onDelete: 'set null' }),
    company: text('company').notNull(),
    normCompany: text('norm_company').notNull(),
    title: text('title').notNull(),
    normTitle: text('norm_title').notNull(),
    location: text('location').notNull().default(''),
    normLocation: text('norm_location').notNull().default(''),
    remote: text('remote').notNull().default('unknown'),
    salary: json<unknown>('salary'),
    language: text('language'),
    description: text('description').notNull().default(''),
    url: text('url').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    applyUrl: text('apply_url'),
    atsType: text('ats_type').notNull(),
    atsJobId: text('ats_job_id'),
    department: text('department'),
    employmentType: text('employment_type'),
    postedAt: text('posted_at'),
    firstSeenAt: text('first_seen_at').notNull().default(now),
    lastSeenAt: text('last_seen_at').notNull().default(now),
    closedAt: text('closed_at'),
    contentHash: text('content_hash').notNull(),
  },
  (t) => [
    index('jobs_content_hash').on(t.contentHash),
    index('jobs_company_title').on(t.normCompany, t.normTitle),
    uniqueIndex('jobs_ats_id').on(t.atsType, t.atsJobId),
    index('jobs_canonical_url').on(t.canonicalUrl),
  ],
);

export const matches = sqliteTable(
  'matches',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    reasons: json<string[]>('reasons').notNull(),
    gaps: json<string[]>('gaps').notNull(),
    model: text('model'),
    prefilterPassed: integer('prefilter_passed', { mode: 'boolean' }).notNull().default(true),
    prefilterReason: text('prefilter_reason'),
    profileVersion: integer('profile_version').notNull().default(0),
    searchVersion: integer('search_version').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('matches_job').on(t.jobId)],
);

export const applications = sqliteTable(
  'applications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('found'),
    appliedAt: text('applied_at'),
    channel: text('channel'), // agent | manual | email
    autoSubmitted: integer('auto_submitted', { mode: 'boolean' }).notNull().default(false),
    senderDomains: json<string[]>('sender_domains').notNull().default(sql`'[]'`),
    atsRefIds: json<string[]>('ats_ref_ids').notNull().default(sql`'[]'`),
    notes: text('notes').notNull().default(''),
    statusChangedAt: text('status_changed_at').notNull().default(now),
    lastEmailAt: text('last_email_at'),
    createdAt: createdAt(),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [uniqueIndex('applications_job').on(t.jobId), index('applications_status').on(t.status)],
);

export const documents = sqliteTable(
  'documents',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    applicationId: integer('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // cv | cover_letter | form_answers
    language: text('language').notNull(),
    template: text('template'),
    content: json<unknown>('content').notNull(), // structured content (TailoredCv | CoverLetter | FormAnswer[])
    html: text('html'),
    pdfPath: text('pdf_path'),
    factsUsed: json<string[]>('facts_used').notNull().default(sql`'[]'`),
    warnings: json<string[]>('warnings').notNull().default(sql`'[]'`),
    version: integer('version').notNull().default(1),
    approvedAt: text('approved_at'),
    model: text('model'),
    createdAt: createdAt(),
  },
  (t) => [index('documents_application').on(t.applicationId, t.type)],
);

export const emails = sqliteTable(
  'emails',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    provider: text('provider').notNull(), // gmail_api | imap
    providerMessageId: text('provider_message_id').notNull(),
    threadId: text('thread_id'),
    fromAddress: text('from_address').notNull(),
    fromDomain: text('from_domain').notNull(),
    subject: text('subject').notNull(),
    receivedAt: text('received_at').notNull(),
    snippet: text('snippet').notNull().default(''),
    bodyHash: text('body_hash').notNull(),
    prefilter: text('prefilter'), // why it passed the prefilter
    classification: text('classification'),
    confidence: real('confidence'),
    keySentence: text('key_sentence'),
    company: text('company'),
    role: text('role'),
    applicationId: integer('application_id').references(() => applications.id, { onDelete: 'set null' }),
    matchConfidence: real('match_confidence'),
    reviewStatus: text('review_status').notNull().default('none'), // none | auto | pending | assigned | ignored
    labelsApplied: json<string[]>('labels_applied').notNull().default(sql`'[]'`),
    processedAt: text('processed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('emails_provider_msg').on(t.provider, t.providerMessageId),
    index('emails_application').on(t.applicationId),
    index('emails_review').on(t.reviewStatus),
  ],
);

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    applicationId: integer('application_id').references(() => applications.id, { onDelete: 'cascade' }),
    actor: text('actor').notNull(), // user | agent | email | system
    type: text('type').notNull(),
    message: text('message').notNull(),
    details: json<Record<string, unknown>>('details'),
    screenshotPath: text('screenshot_path'),
    createdAt: createdAt(),
  },
  (t) => [index('events_application').on(t.applicationId, t.createdAt)],
);

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    thread: text('thread').notNull(), // global | interview:<id> | search
    role: text('role').notNull(), // user | assistant
    content: text('content').notNull(),
    proposal: json<unknown>('proposal'), // a pending confirmed-diff change
    proposalStatus: text('proposal_status'), // pending | applied | rejected
    createdAt: createdAt(),
  },
  (t) => [index('chat_thread').on(t.thread, t.id)],
);

export const interviewSessions = sqliteTable('interview_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  status: text('status').notNull().default('active'), // active | summarizing | completed | abandoned
  state: json<unknown>('state').notNull(),
  createdAt: createdAt(),
  updatedAt: text('updated_at').notNull().default(now),
});

export const taskRuns = sqliteTable(
  'task_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    task: text('task').notNull(),
    status: text('status').notNull(), // running | succeeded | failed | skipped
    model: text('model'),
    runner: text('runner'),
    attempts: integer('attempts').notNull().default(1),
    error: text('error'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    durationMs: integer('duration_ms'),
    applicationId: integer('application_id'),
    startedAt: text('started_at').notNull().default(now),
    finishedAt: text('finished_at'),
  },
  (t) => [index('task_runs_task').on(t.task, t.startedAt), index('task_runs_started').on(t.startedAt)],
);

export const httpCache = sqliteTable('http_cache', {
  url: text('url').primaryKey(),
  status: integer('status').notNull(),
  etag: text('etag'),
  lastModified: text('last_modified'),
  contentType: text('content_type'),
  body: text('body').notNull(),
  contentHash: text('content_hash').notNull(),
  fetchedAt: text('fetched_at').notNull().default(now),
});

export const domainBudget = sqliteTable(
  'domain_budget',
  {
    domain: text('domain').notNull(),
    day: text('day').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.domain, t.day] })],
);

export const scanRuns = sqliteTable('scan_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  trigger: text('trigger').notNull(), // schedule | manual | catchup
  status: text('status').notNull(), // running | succeeded | partial | failed
  sourcesTotal: integer('sources_total').notNull().default(0),
  sourcesFailed: integer('sources_failed').notNull().default(0),
  jobsSeen: integer('jobs_seen').notNull().default(0),
  jobsNew: integer('jobs_new').notNull().default(0),
  matchesNew: integer('matches_new').notNull().default(0),
  startedAt: text('started_at').notNull().default(now),
  finishedAt: text('finished_at'),
});

export const schedulerState = sqliteTable('scheduler_state', {
  job: text('job').primaryKey(),
  lastRunAt: text('last_run_at'),
  lastStatus: text('last_status'),
});

export const applyRuns = sqliteTable(
  'apply_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    applicationId: integer('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    level: text('level').notNull(), // prepare | submit
    status: text('status').notNull(), // running | prepared | submitted | handover | failed
    stopReason: text('stop_reason'),
    filler: text('filler'),
    fields: json<unknown>('fields'),
    screenshotPath: text('screenshot_path'),
    url: text('url'),
    createdAt: createdAt(),
    finishedAt: text('finished_at'),
  },
  (t) => [index('apply_runs_application').on(t.applicationId)],
);

export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').notNull(), // scan_summary | drafts_ready | interview | rejection | budget | handover | digest
  title: text('title').notNull(),
  body: text('body').notNull(),
  link: text('link'),
  urgent: integer('urgent', { mode: 'boolean' }).notNull().default(false),
  readAt: text('read_at'),
  deliveredAt: text('delivered_at'),
  createdAt: createdAt(),
});

export const authSessions = sqliteTable('auth_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  createdAt: createdAt(),
  expiresAt: text('expires_at').notNull(),
});

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  endpoint: text('endpoint').primaryKey(),
  keys: json<{ p256dh: string; auth: string }>('keys').notNull(),
  createdAt: createdAt(),
});

export const profileImports = sqliteTable('profile_imports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').notNull(), // cv | linkedin_pdf
  filename: text('filename').notNull(),
  filePath: text('file_path'),
  text: text('text').notNull(),
  extracted: json<unknown>('extracted'),
  status: text('status').notNull().default('extracting'), // extracting | review | applied | discarded | failed
  error: text('error'),
  createdAt: createdAt(),
});

/** Cache of model extractions of careers pages, keyed by URL + content hash (spec §5.3). */
export const pageExtractions = sqliteTable('page_extractions', {
  url: text('url').notNull(),
  contentHash: text('content_hash').notNull(),
  result: json<unknown>('result').notNull(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.url, t.contentHash] })]);

import { z } from 'zod';
import { UI_LANGUAGES, PERMANENT_AUTO_APPLY_EXCLUSIONS } from './constants.js';

/** Every model-backed task. Each has its own prompt file and routing entry (spec §3.4). */
export const TASK_NAMES = [
  'profile_extract',
  'cv_interview',
  'interview_summary',
  'style_analyze',
  'style_rules',
  'search_profile_chat',
  'chat',
  'job_extract',
  'match_score',
  'company_discovery',
  'cv_tailor',
  'cover_letter',
  'form_answers',
  'form_fill',
  'email_classify',
  'alert_parse',
] as const;
export const TaskNameSchema = z.enum(TASK_NAMES);
export type TaskName = z.infer<typeof TaskNameSchema>;

export const MODEL_TIERS = ['small', 'strong', 'strongest'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export const TASK_TIER: Record<TaskName, ModelTier> = {
  profile_extract: 'strong',
  cv_interview: 'strong',
  interview_summary: 'strong',
  style_analyze: 'strong',
  style_rules: 'strong',
  search_profile_chat: 'strong',
  chat: 'strong',
  job_extract: 'small',
  match_score: 'small',
  company_discovery: 'strong',
  cv_tailor: 'strongest',
  cover_letter: 'strongest',
  form_answers: 'strong',
  form_fill: 'strong',
  email_classify: 'small',
  alert_parse: 'small',
};

/** Tasks that keep running when the monthly budget is reached (spec §3.4). */
export const ESSENTIAL_TASKS: ReadonlySet<TaskName> = new Set<TaskName>([
  'email_classify',
  'chat',
  'cv_interview',
  'interview_summary',
  'profile_extract',
  'cv_tailor',
  'cover_letter',
  'form_answers',
  'form_fill',
  'search_profile_chat',
]);

export const DEFAULT_TIER_MODELS: Record<ModelTier, string> = {
  small: 'claude-haiku-5-5',
  strong: 'claude-sonnet-5-5',
  strongest: 'claude-opus-5-5',
};

/** USD per million tokens. Editable in settings; used only for estimates. */
export const ModelPriceSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative().optional(),
  cacheWrite: z.number().nonnegative().optional(),
});
export type ModelPrice = z.infer<typeof ModelPriceSchema>;
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 },
};

export const AUTH_MODES = ['subscription', 'api_key', 'compatible', 'openai_proxy'] as const;
export const AuthModeSchema = z.enum(AUTH_MODES);
export type AuthMode = z.infer<typeof AuthModeSchema>;

export const AUTO_APPLY_LEVELS = ['off', 'prepare', 'submit'] as const;
export type AutoApplyLevel = (typeof AUTO_APPLY_LEVELS)[number];

export const CV_TEMPLATES = ['harvard', 'modern', 'european', 'compact'] as const;
export type CvTemplate = (typeof CV_TEMPLATES)[number];
export const CV_COUNTRIES = ['CH', 'DE', 'PT', 'ES', 'FR', 'UK', 'US', 'MX'] as const;
export type CvCountry = (typeof CV_COUNTRIES)[number];

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u, 'HH:MM');

export const SettingsSchema = z.object({
  language: z.enum(UI_LANGUAGES).default('en'),
  /** posting | ui | fixed:<code> */
  applicationLanguage: z
    .string()
    .regex(/^(posting|ui|fixed:[a-z]{2})$/u)
    .default('posting'),
  scan: z
    .object({
      time: timeOfDay.default('07:00'),
      enabled: z.boolean().default(true),
    })
    .prefault({}),
  matchThresholdShow: z.number().min(0).max(100).default(60),
  /** null = off */
  matchThresholdAutoShortlist: z.number().min(0).max(100).nullable().default(null),
  discovery: z
    .object({
      enabled: z.boolean().default(true),
      frequency: z.enum(['weekly', 'off']).default('weekly'),
      autoAdd: z.boolean().default(false),
    })
    .prefault({}),
  autoApply: z
    .object({
      level: z.enum(AUTO_APPLY_LEVELS).default('prepare'),
      minScore: z.number().min(0).max(100).default(85),
      dailyCap: z.number().int().min(0).max(50).default(5),
      autoApprovePackages: z.boolean().default(false),
      excludedDomains: z.array(z.string()).default([...PERMANENT_AUTO_APPLY_EXCLUSIONS]),
    })
    .prefault({}),
  noResponseAfterDays: z.number().int().min(1).max(365).default(21),
  emailReviewConfidence: z.number().min(0).max(1).default(0.8),
  /** null = no budget */
  monthlyBudgetUsd: z.number().positive().nullable().default(null),
  voice: z.enum(['off', 'local_whisper', 'browser']).default('off'),
  tts: z.boolean().default(false),
  auth: z
    .object({
      mode: AuthModeSchema.default('subscription'),
      compatibleBaseUrl: z.string().url().nullable().default(null),
    })
    .prefault({}),
  modelRouting: z.partialRecord(TaskNameSchema, z.string().min(1)).default({}),
  tierModels: z
    .object({
      small: z.string().default(DEFAULT_TIER_MODELS.small),
      strong: z.string().default(DEFAULT_TIER_MODELS.strong),
      strongest: z.string().default(DEFAULT_TIER_MODELS.strongest),
    })
    .prefault({}),
  prices: z.record(z.string(), ModelPriceSchema).default(DEFAULT_PRICES),
  notifications: z
    .object({
      newMatches: z.boolean().default(true),
      draftsReady: z.boolean().default(true),
      interviews: z.boolean().default(true),
      rejectionsInDigest: z.boolean().default(true),
    })
    .prefault({}),
  cv: z
    .object({
      template: z.enum(CV_TEMPLATES).default('modern'),
      country: z.enum(CV_COUNTRIES).default('CH'),
      paper: z.enum(['A4', 'Letter']).default('A4'),
      photo: z.boolean().default(false),
      pages: z.union([z.literal(1), z.literal(2)]).default(2),
    })
    .prefault({}),
  scraping: z
    .object({
      minIntervalMs: z.number().int().min(1000).default(5000),
      maxPagesPerDomainPerDay: z.number().int().min(1).default(60),
    })
    .prefault({}),
  email: z
    .object({
      provider: z.enum(['none', 'gmail_api', 'imap']).default('none'),
      address: z.string().nullable().default(null),
      imapHost: z.string().default('imap.gmail.com'),
      imapPort: z.number().int().default(993),
      gmailClientId: z.string().nullable().default(null),
      syncIntervalMinutes: z.number().int().min(1).default(15),
      applyLabels: z.boolean().default(true),
      sampleSentForStyle: z.boolean().default(false),
    })
    .prefault({}),
  onboardingCompleted: z.boolean().default(false),
});
export type Settings = z.infer<typeof SettingsSchema>;
export type SettingsInput = z.input<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

export function modelForTask(settings: Settings, task: TaskName): string {
  return settings.modelRouting[task] ?? settings.tierModels[TASK_TIER[task]];
}

/** Excluded domains always include the permanent ones, whatever the user saved. */
export function effectiveExclusions(settings: Settings): string[] {
  return [...new Set([...PERMANENT_AUTO_APPLY_EXCLUSIONS, ...settings.autoApply.excludedDomains])];
}

export function estimateCostUsd(
  prices: Record<string, ModelPrice>,
  model: string,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number },
): number {
  const p = prices[model];
  if (!p) return 0;
  const m = 1_000_000;
  return (
    (usage.inputTokens * p.input) / m +
    (usage.outputTokens * p.output) / m +
    ((usage.cacheReadTokens ?? 0) * (p.cacheRead ?? p.input)) / m +
    ((usage.cacheWriteTokens ?? 0) * (p.cacheWrite ?? p.input)) / m
  );
}

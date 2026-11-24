import { z } from 'zod';
import type { ApplicationStatusSchema } from './status.js';

// ---------- Master profile (JSON Resume + extensions) ----------

export const ProfileWorkSchema = z.object({
  id: z.string(),
  name: z.string(), // employer
  position: z.string(),
  location: z.string().optional(),
  url: z.string().optional(),
  startDate: z.string().optional(), // YYYY-MM or YYYY-MM-DD
  endDate: z.string().optional(), // empty = current
  summary: z.string().optional(),
  highlights: z.array(z.string()).default([]),
});
export const ProfileEducationSchema = z.object({
  id: z.string(),
  institution: z.string(),
  area: z.string().optional(),
  studyType: z.string().optional(),
  location: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  score: z.string().optional(),
  courses: z.array(z.string()).default([]),
  highlights: z.array(z.string()).default([]),
});
export const ProfileSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  level: z.string().optional(),
  keywords: z.array(z.string()).default([]),
});
export const ProfileLanguageSchema = z.object({
  id: z.string(),
  language: z.string(),
  fluency: z.string().optional(),
});
export const ProfileProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  url: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  highlights: z.array(z.string()).default([]),
});
export const ProfileAchievementSchema = z.object({
  id: z.string(),
  text: z.string(),
  metric: z.string().optional(),
  workId: z.string().optional(),
});
export const ProfileCertificateSchema = z.object({
  id: z.string(),
  name: z.string(),
  issuer: z.string().optional(),
  date: z.string().optional(),
});

export const ProfileSchema = z.object({
  basics: z
    .object({
      name: z.string().default(''),
      label: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      url: z.string().optional(),
      summary: z.string().optional(),
      location: z
        .object({ city: z.string().optional(), countryCode: z.string().optional(), region: z.string().optional() })
        .optional(),
      profiles: z.array(z.object({ network: z.string(), url: z.string() })).default([]),
      photoPath: z.string().optional(),
      dateOfBirth: z.string().optional(),
      nationality: z.string().optional(),
    })
    .prefault({}),
  work: z.array(ProfileWorkSchema).default([]),
  education: z.array(ProfileEducationSchema).default([]),
  skills: z.array(ProfileSkillSchema).default([]),
  languages: z.array(ProfileLanguageSchema).default([]),
  projects: z.array(ProfileProjectSchema).default([]),
  achievements: z.array(ProfileAchievementSchema).default([]),
  certificates: z.array(ProfileCertificateSchema).default([]),
  interests: z.array(z.string()).default([]),
  preferences: z
    .object({
      workAuthorization: z.string().optional(),
      salaryExpectation: z.string().optional(),
      noticePeriod: z.string().optional(),
      willingToRelocate: z.boolean().optional(),
      motivation: z.string().optional(),
    })
    .prefault({}),
});
export type Profile = z.infer<typeof ProfileSchema>;
export const EMPTY_PROFILE: Profile = ProfileSchema.parse({});

export const FactSourceSchema = z.enum(['cv', 'interview', 'manual', 'linkedin_pdf']);
export const ProfileFactSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  source: FactSourceSchema,
  category: z.string().optional(), // work | education | skill | achievement | preference | ...
  refId: z.string().optional(), // id in the profile JSON this fact belongs to
  confirmedAt: z.string().nullable(),
});
export type ProfileFact = z.infer<typeof ProfileFactSchema>;

// ---------- Style profile ----------

export const StyleProfileSchema = z.object({
  language: z.string(),
  tone: z.string().default(''),
  formality: z.string().default(''),
  sentenceLength: z.string().default(''),
  typicalPhrases: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
  rules: z.array(z.string()).default([]),
  examples: z.array(z.string()).default([]),
  description: z.string().default(''),
});
export type StyleProfile = z.infer<typeof StyleProfileSchema>;

// ---------- Search profile ----------

export const SearchProfileSchema = z.object({
  roles: z.array(z.string()).default([]),
  seniority: z.array(z.string()).default([]),
  locations: z.array(z.string()).default([]),
  remotePolicy: z.enum(['any', 'remote_only', 'hybrid_ok', 'onsite_ok']).default('any'),
  minSalary: z
    .object({ amount: z.number().nonnegative(), currency: z.string().length(3) })
    .nullable()
    .default(null),
  industries: z.array(z.string()).default([]),
  mustHave: z.array(z.string()).default([]),
  niceToHave: z.array(z.string()).default([]),
  exclusions: z.array(z.string()).default([]),
  excludedCompanies: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
});
export type SearchProfile = z.infer<typeof SearchProfileSchema>;
export const EMPTY_SEARCH_PROFILE: SearchProfile = SearchProfileSchema.parse({});

// ---------- Jobs ----------

export const ATS_TYPES = [
  'greenhouse',
  'lever',
  'ashby',
  'smartrecruiters',
  'workable',
  'recruitee',
  'personio',
  'workday',
  'generic',
  'rss',
  'email_alert',
] as const;
export const AtsTypeSchema = z.enum(ATS_TYPES);
export type AtsType = z.infer<typeof AtsTypeSchema>;

export const RemoteSchema = z.enum(['remote', 'hybrid', 'onsite', 'unknown']);
export type Remote = z.infer<typeof RemoteSchema>;

export const SalarySchema = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
  currency: z.string().nullable(),
  period: z.enum(['year', 'month', 'day', 'hour']).nullable(),
});

/** What a source adapter returns. */
export const RawJobSchema = z.object({
  sourceJobId: z.string().min(1),
  title: z.string().min(1),
  company: z.string().min(1),
  location: z.string().default(''),
  remote: RemoteSchema.default('unknown'),
  salary: SalarySchema.nullable().default(null),
  language: z.string().nullable().default(null),
  description: z.string().default(''),
  url: z.string().url(),
  applyUrl: z.string().url().nullable().default(null),
  postedAt: z.string().nullable().default(null),
  department: z.string().nullable().default(null),
  employmentType: z.string().nullable().default(null),
});
export type RawJob = z.infer<typeof RawJobSchema>;
export type RawJobInput = z.input<typeof RawJobSchema>;

export const MatchResultSchema = z.object({
  score: z.number().int().min(0).max(100),
  reasons: z.array(z.string()).max(8),
  gaps: z.array(z.string()).max(8),
});
export type MatchResult = z.infer<typeof MatchResultSchema>;

// ---------- Email ----------

export const EMAIL_CLASSES = [
  'application_received',
  'rejection',
  'interview_invite',
  'assessment',
  'offer',
  'recruiter_outreach',
  'job_alert',
  'other',
] as const;
export const EmailClassSchema = z.enum(EMAIL_CLASSES);
export type EmailClass = z.infer<typeof EmailClassSchema>;

export const EmailClassificationSchema = z.object({
  classification: EmailClassSchema,
  company: z.string().nullable(),
  role: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  keySentence: z.string().nullable(),
  referenceIds: z.array(z.string()).default([]),
});
export type EmailClassification = z.infer<typeof EmailClassificationSchema>;

export const EMAIL_CLASS_TO_STATUS: Partial<Record<EmailClass, z.infer<typeof ApplicationStatusSchema>>> = {
  application_received: 'applied',
  rejection: 'rejected',
  interview_invite: 'interview',
  assessment: 'assessment',
  offer: 'offer',
};

// ---------- Documents ----------

export const DocumentTypeSchema = z.enum(['cv', 'cover_letter', 'form_answers']);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const FormAnswerSchema = z.object({
  question: z.string(),
  answer: z.string(),
  factIds: z.array(z.string()).default([]),
  /** true when the profile lacks the information: never invented (spec §2.4) */
  gap: z.boolean().default(false),
});
export type FormAnswer = z.infer<typeof FormAnswerSchema>;

/** Tailored CV content (rendered into a template). */
export const TailoredCvSchema = z.object({
  headline: z.string().nullish(),
  summary: z.string().nullish(),
  summaryFactIds: z.array(z.string()).default([]),
  sections: z.array(
    z.object({
      kind: z.enum(['experience', 'education', 'skills', 'projects', 'languages', 'certificates', 'additional']),
      title: z.string(),
      items: z.array(
        z.object({
          refId: z.string().nullish(),
          heading: z.string(),
          subheading: z.string().nullish(),
          location: z.string().nullish(),
          dates: z.string().nullish(),
          bullets: z.array(z.object({ text: z.string(), factIds: z.array(z.string()).min(1) })).default([]),
        }),
      ),
    }),
  ),
  gaps: z.array(z.string()).default([]),
});
export type TailoredCv = z.infer<typeof TailoredCvSchema>;

export const CoverLetterSchema = z.object({
  greeting: z.string(),
  paragraphs: z.array(z.object({ text: z.string(), factIds: z.array(z.string()).default([]) })).min(1),
  closing: z.string(),
  gaps: z.array(z.string()).default([]),
});
export type CoverLetter = z.infer<typeof CoverLetterSchema>;

// ---------- Events ----------

export const EventSchema = z.object({
  id: z.number(),
  applicationId: z.number().nullable(),
  actor: z.enum(['user', 'agent', 'email', 'system']),
  type: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).nullable(),
  screenshotPath: z.string().nullable(),
  createdAt: z.string(),
});
export type AppEvent = z.infer<typeof EventSchema>;

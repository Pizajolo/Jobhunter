export const APP_NAME = 'Jobhunter';
export const APP_ID = 'jobhunter';
export const APP_VERSION = '0.1.0';
export const REPO_URL = 'https://github.com/Pizajolo/Jobhunter';
/** Honest user agent for every outbound HTTP request (spec §2.6). */
export const USER_AGENT = `${APP_NAME}/${APP_VERSION} (+${REPO_URL}; personal job-search assistant)`;
/** Gmail label prefix, e.g. "Jobhunter/Rejected". */
export const LABEL_PREFIX = APP_NAME;
export const UI_LANGUAGES = ['en', 'de', 'pt', 'es', 'fr'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];
/** Sites that may never be auto-applied to, regardless of settings (spec §2.3). */
export const PERMANENT_AUTO_APPLY_EXCLUSIONS = ['linkedin.com'] as const;

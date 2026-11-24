import type { TaskDef } from '../agent/types.js';
import { connectionTestTask } from './connection-test.js';
import { coverLetterTask, cvTailorTask, formAnswersTask, styleRulesTask } from './documents.js';
import { formFillTask } from './apply.js';
import { companyDiscoveryTask } from './discovery.js';
import { alertParseTask, emailClassifyTask } from './email.js';
import { chatTask, jobExtractTask, matchScoreTask, searchProfileChatTask } from './scan.js';
import { cvInterviewTask, interviewSummaryTask, profileExtractTask, styleAnalyzeTask } from './profile.js';

/** Every task definition, for the prompt harness and diagnostics. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous registry; each entry is validated by its own schemas
export const TASKS: Record<string, TaskDef<any, any>> = {
  connection_test: connectionTestTask,
  profile_extract: profileExtractTask,
  cv_interview: cvInterviewTask,
  interview_summary: interviewSummaryTask,
  style_analyze: styleAnalyzeTask,
  job_extract: jobExtractTask,
  match_score: matchScoreTask,
  chat: chatTask,
  search_profile_chat: searchProfileChatTask,
  cv_tailor: cvTailorTask,
  cover_letter: coverLetterTask,
  form_answers: formAnswersTask,
  style_rules: styleRulesTask,
  email_classify: emailClassifyTask,
  alert_parse: alertParseTask,
  form_fill: formFillTask,
  company_discovery: companyDiscoveryTask,
};

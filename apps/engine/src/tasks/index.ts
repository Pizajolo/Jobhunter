import type { TaskDef } from '../agent/types.js';
import { connectionTestTask } from './connection-test.js';
import { cvInterviewTask, interviewSummaryTask, profileExtractTask, styleAnalyzeTask } from './profile.js';

/** Every task definition, for the prompt harness and diagnostics. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous registry; each entry is validated by its own schemas
export const TASKS: Record<string, TaskDef<any, any>> = {
  connection_test: connectionTestTask,
  profile_extract: profileExtractTask,
  cv_interview: cvInterviewTask,
  interview_summary: interviewSummaryTask,
  style_analyze: styleAnalyzeTask,
};

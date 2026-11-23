import { z } from 'zod';

export const APPLICATION_STATUSES = [
  'found',
  'shortlisted',
  'drafting',
  'ready',
  'applied',
  'interview',
  'assessment',
  'offer',
  'rejected',
  'no_response',
  'withdrawn',
  'dismissed',
] as const;
export const ApplicationStatusSchema = z.enum(APPLICATION_STATUSES);
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;

export const ACTORS = ['user', 'agent', 'email', 'system'] as const;
export type Actor = (typeof ACTORS)[number];

/** Board columns (spec §5.7) and which statuses each column holds. */
export const BOARD_COLUMNS = [
  { id: 'found', statuses: ['found'] },
  { id: 'shortlisted', statuses: ['shortlisted', 'drafting'] },
  { id: 'ready', statuses: ['ready'] },
  { id: 'applied', statuses: ['applied'] },
  { id: 'interview', statuses: ['interview', 'assessment', 'offer'] },
  { id: 'closed', statuses: ['rejected', 'no_response', 'withdrawn'] },
] as const satisfies readonly { id: string; statuses: readonly ApplicationStatus[] }[];
export type BoardColumnId = (typeof BOARD_COLUMNS)[number]['id'];

/** Status a card gets when the user drops it on a column. */
export const COLUMN_DROP_STATUS: Record<BoardColumnId, ApplicationStatus> = {
  found: 'found',
  shortlisted: 'shortlisted',
  ready: 'ready',
  applied: 'applied',
  interview: 'interview',
  closed: 'rejected',
};

export function columnForStatus(status: ApplicationStatus): BoardColumnId | null {
  for (const col of BOARD_COLUMNS) {
    if ((col.statuses as readonly ApplicationStatus[]).includes(status)) return col.id;
  }
  return null; // dismissed: hidden from the board
}

const PRE_APPLY: ApplicationStatus[] = ['found', 'shortlisted', 'drafting', 'ready'];
const POST_APPLY: ApplicationStatus[] = ['applied', 'interview', 'assessment', 'offer'];

/**
 * Transitions automation may make. The user may make any transition (manual override),
 * but automation follows these rules so it can never jump the pipeline in surprising ways.
 */
const AUTOMATED: Record<Exclude<Actor, 'user'>, Partial<Record<ApplicationStatus, ApplicationStatus[]>>> = {
  agent: {
    found: ['shortlisted', 'dismissed'],
    shortlisted: ['drafting'],
    drafting: ['ready', 'shortlisted'],
    ready: ['applied', 'drafting'],
  },
  email: {
    // An email can tell us the user applied (confirmation), or move an applied job forward.
    found: ['applied', 'rejected', 'interview', 'assessment', 'offer'],
    shortlisted: ['applied', 'rejected', 'interview', 'assessment', 'offer'],
    drafting: ['applied', 'rejected', 'interview', 'assessment', 'offer'],
    ready: ['applied', 'rejected', 'interview', 'assessment', 'offer'],
    applied: ['rejected', 'interview', 'assessment', 'offer'],
    interview: ['rejected', 'assessment', 'offer', 'interview'],
    assessment: ['rejected', 'interview', 'offer'],
    offer: ['rejected'],
    no_response: ['applied', 'rejected', 'interview', 'assessment', 'offer'],
  },
  system: {
    applied: ['no_response'],
  },
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus, actor: Actor): boolean {
  if (from === to) return actor === 'email' && to === 'interview'; // repeated invites are fine
  if (actor === 'user') return true;
  return AUTOMATED[actor][from]?.includes(to) ?? false;
}

export function isPreApply(s: ApplicationStatus): boolean {
  return PRE_APPLY.includes(s);
}
export function isPostApply(s: ApplicationStatus): boolean {
  return POST_APPLY.includes(s);
}
export function isClosed(s: ApplicationStatus): boolean {
  return s === 'rejected' || s === 'no_response' || s === 'withdrawn' || s === 'dismissed';
}

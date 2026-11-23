import { z } from 'zod';
import type { ApplicationStatus } from './status.js';
import type { AtsType, Remote } from './domain.js';

/** Live update pushed over the WebSocket: the UI refetches the named query keys. */
export const WsMessageSchema = z.object({
  type: z.literal('invalidate'),
  keys: z.array(z.string()),
});
export type WsMessage = z.infer<typeof WsMessageSchema>;

export interface BoardCard {
  applicationId: number;
  jobId: number;
  company: string;
  title: string;
  location: string;
  remote: Remote;
  source: AtsType | string;
  score: number | null;
  status: ApplicationStatus;
  tag: string;
  tagKind: 'new' | 'info' | 'warn' | 'muted';
  updatedAt: string;
  firstSeenAt: string;
  appliedAt: string | null;
}

export interface HealthResponse {
  ok: true;
  version: string;
  mode: 'desktop' | 'server' | 'dev';
  dbPath: string;
  uptimeSec: number;
}

export interface ClaudeStatus {
  mode: string;
  connected: boolean;
  detail: string;
  account?: { email?: string; subscriptionType?: string; organization?: string };
  loginCommand?: string;
}

export interface TaskRunSummary {
  id: number;
  task: string;
  status: 'running' | 'succeeded' | 'failed' | 'skipped';
  model: string | null;
  error: string | null;
  costUsd: number;
  startedAt: string;
  finishedAt: string | null;
}

export const ApiErrorSchema = z.object({ error: z.string(), details: z.unknown().optional() });
export type ApiError = z.infer<typeof ApiErrorSchema>;

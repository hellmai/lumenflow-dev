/**
 * Agent Session (WU-2541)
 *
 * Session management for LumenFlow agents.
 *
 * @module @lumenflow/agent/session
 */

import { z } from 'zod';

/**
 * Agent session states
 */
export const SESSION_STATES = [
  'starting',
  'active',
  'paused',
  'completed',
  'failed',
] as const;

export type SessionState = (typeof SESSION_STATES)[number];

/**
 * Session patterns
 */
export const SESSION_PATTERNS = {
  SESSION_ID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  WU_ID: /^WU-\d+$/,
} as const;

const ERROR_MESSAGES = {
  SESSION_ID: 'Session ID must be a valid UUID',
  WU_ID: 'WU ID must match pattern WU-XXX',
  STATE_INVALID: 'State must be one of: starting, active, paused, completed, failed',
  PID_INVALID: 'PID must be a positive integer',
} as const;

export const AgentSessionSchema = z.object({
  id: z.string().regex(SESSION_PATTERNS.SESSION_ID, { message: ERROR_MESSAGES.SESSION_ID }),
  wuId: z.string().regex(SESSION_PATTERNS.WU_ID, { message: ERROR_MESSAGES.WU_ID }),
  state: z.enum(SESSION_STATES, {
    errorMap: () => ({ message: ERROR_MESSAGES.STATE_INVALID }),
  }),
  pid: z.number().int().positive({ message: ERROR_MESSAGES.PID_INVALID }),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lane: z.string().min(1),
  worktreePath: z.string().optional(),
  baselineSha: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type AgentSession = z.infer<typeof AgentSessionSchema>;

export function validateAgentSession(data: unknown): z.SafeParseReturnType<AgentSession, AgentSession> {
  return AgentSessionSchema.safeParse(data);
}

export function createSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? 
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
}

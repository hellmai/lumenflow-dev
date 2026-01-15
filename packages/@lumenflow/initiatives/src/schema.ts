/**
 * Initiative Schema (WU-2541)
 *
 * Zod schemas for initiative validation.
 * Defines initiative types, phases, and statuses.
 *
 * @module @lumenflow/initiatives/schema
 */

import { z } from 'zod';

/**
 * Initiative statuses
 */
export const INITIATIVE_STATUSES = [
  'draft',
  'ready',
  'in_progress',
  'blocked',
  'complete',
  'cancelled',
] as const;

export type InitiativeStatus = (typeof INITIATIVE_STATUSES)[number];

/**
 * Phase statuses
 */
export const PHASE_STATUSES = [
  'pending',
  'in_progress',
  'complete',
  'blocked',
] as const;

export type PhaseStatus = (typeof PHASE_STATUSES)[number];

/**
 * Regex patterns for initiative validation
 */
export const INITIATIVE_PATTERNS = {
  INIT_ID: /^INIT-\d{3}$/,
  WU_ID: /^WU-\d+$/,
} as const;

const ERROR_MESSAGES = {
  INIT_ID: 'Initiative ID must match pattern INIT-XXX (3 digits)',
  WU_ID: 'WU ID must match pattern WU-XXX (e.g., WU-1570)',
  TITLE_REQUIRED: 'Title is required',
  DESCRIPTION_REQUIRED: 'Description is required',
  STATUS_INVALID: 'Status must be one of: draft, ready, in_progress, blocked, complete, cancelled',
  PHASE_STATUS_INVALID: 'Phase status must be one of: pending, in_progress, complete, blocked',
} as const;

export const PhaseSchema = z.object({
  number: z.number().int().min(0),
  name: z.string().min(1, { message: 'Phase name is required' }),
  status: z.enum(PHASE_STATUSES, {
    errorMap: () => ({ message: ERROR_MESSAGES.PHASE_STATUS_INVALID }),
  }),
  wus: z.array(z.string().regex(INITIATIVE_PATTERNS.WU_ID, { message: ERROR_MESSAGES.WU_ID })),
  description: z.string().optional(),
});

export const InitiativeSchema = z.object({
  id: z.string().regex(INITIATIVE_PATTERNS.INIT_ID, { message: ERROR_MESSAGES.INIT_ID }),
  title: z.string().min(1, { message: ERROR_MESSAGES.TITLE_REQUIRED }),
  description: z.string().min(1, { message: ERROR_MESSAGES.DESCRIPTION_REQUIRED }),
  status: z.enum(INITIATIVE_STATUSES, {
    errorMap: () => ({ message: ERROR_MESSAGES.STATUS_INVALID }),
  }),
  phases: z.array(PhaseSchema),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
  owner: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type Phase = z.infer<typeof PhaseSchema>;
export type Initiative = z.infer<typeof InitiativeSchema>;

export function validateInitiative(data: unknown): z.SafeParseReturnType<Initiative, Initiative> {
  return InitiativeSchema.safeParse(data);
}

export function validatePhase(data: unknown): z.SafeParseReturnType<Phase, Phase> {
  return PhaseSchema.safeParse(data);
}

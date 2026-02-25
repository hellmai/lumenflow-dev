// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU State Schema (WU-1570)
 *
 * Zod schemas for WU state event validation.
 * Defines event types for WU lifecycle: create, claim, block, unblock, complete.
 *
 * @see {@link packages/@lumenflow/cli/src/lib/__tests__/wu-state-store.test.ts} - Tests
 */

import { z } from 'zod';

/**
 * WU event types
 *
 * - create: WU created (transitions to ready)
 * - claim: WU claimed (transitions to in_progress)
 * - block: WU blocked (transitions to blocked)
 * - unblock: WU unblocked (transitions back to in_progress)
 * - complete: WU completed (transitions to done)
 * - checkpoint: Progress checkpoint (WU-1748: cross-agent visibility)
 * - delegation: WU delegated from parent (WU-1947: parent-child relationships)
 * - release: WU released (WU-1080: transitions from in_progress to ready for orphan recovery)
 */
export const WU_EVENT_TYPES = [
  'create',
  'claim',
  'block',
  'unblock',
  'complete',
  'checkpoint',
  'delegation',
  'release',
] as const;

/** Type for WU event types */
export type WUEventType = (typeof WU_EVENT_TYPES)[number];

/**
 * WU Event Type constant object (WU-2044)
 *
 * Named constants for event type strings, analogous to WU_STATUS.
 * Use WU_EVENT_TYPE.CLAIM instead of raw 'claim' strings.
 */
export const WU_EVENT_TYPE = Object.freeze({
  CREATE: 'create' as const,
  CLAIM: 'claim' as const,
  BLOCK: 'block' as const,
  UNBLOCK: 'unblock' as const,
  COMPLETE: 'complete' as const,
  CHECKPOINT: 'checkpoint' as const,
  DELEGATION: 'delegation' as const,
  RELEASE: 'release' as const,
});

/**
 * WU status values (matches LumenFlow state machine)
 */
export const WU_STATUSES = ['ready', 'in_progress', 'blocked', 'waiting', 'done'] as const;

/** Type for WU status values */
export type WUStatus = (typeof WU_STATUSES)[number];

/**
 * Regex patterns for WU validation
 */
export const WU_PATTERNS = {
  /** WU ID format: WU-{digits} */
  WU_ID: /^WU-\d+$/,
};

/**
 * Error messages for schema validation
 */
const ERROR_MESSAGES = {
  EVENT_TYPE: `Event type must be one of: ${WU_EVENT_TYPES.join(', ')}`,
  WU_ID: 'WU ID must match pattern WU-XXX (e.g., WU-1570)',
  LANE_REQUIRED: 'Lane is required',
  TITLE_REQUIRED: 'Title is required',
  REASON_REQUIRED: 'Reason is required',
  TIMESTAMP_REQUIRED: 'Timestamp is required',
};

/**
 * Base event schema (common fields for all events)
 */
const BaseEventSchema = z.object({
  /** Event type */
  type: z.enum(WU_EVENT_TYPES, {
    error: ERROR_MESSAGES.EVENT_TYPE,
  }),

  /** WU ID */
  wuId: z.string().regex(WU_PATTERNS.WU_ID, { message: ERROR_MESSAGES.WU_ID }),

  /** Event timestamp (ISO 8601 datetime) */
  timestamp: z.string().datetime({ message: ERROR_MESSAGES.TIMESTAMP_REQUIRED }),
});

/**
 * Create event schema
 */
export const CreateEventSchema = BaseEventSchema.extend({
  type: z.literal('create'),
  lane: z.string().min(1, { message: ERROR_MESSAGES.LANE_REQUIRED }),
  title: z.string().min(1, { message: ERROR_MESSAGES.TITLE_REQUIRED }),
});

/**
 * Claim event schema
 */
export const ClaimEventSchema = BaseEventSchema.extend({
  type: z.literal('claim'),
  lane: z.string().min(1, { message: ERROR_MESSAGES.LANE_REQUIRED }),
  title: z.string().min(1, { message: ERROR_MESSAGES.TITLE_REQUIRED }),
});

/**
 * Block event schema
 */
export const BlockEventSchema = BaseEventSchema.extend({
  type: z.literal('block'),
  reason: z.string().min(1, { message: ERROR_MESSAGES.REASON_REQUIRED }),
});

/**
 * Unblock event schema
 */
export const UnblockEventSchema = BaseEventSchema.extend({
  type: z.literal('unblock'),
});

/**
 * Complete event schema
 */
export const CompleteEventSchema = BaseEventSchema.extend({
  type: z.literal('complete'),
});

/**
 * Checkpoint event schema (WU-1748: cross-agent visibility)
 * Records progress checkpoints for abandoned WU detection
 */
export const CheckpointEventSchema = BaseEventSchema.extend({
  type: z.literal('checkpoint'),
  /** Checkpoint note/description */
  note: z.string().min(1, { message: 'Checkpoint note is required' }),
  /** Optional session ID */
  sessionId: z.string().optional(),
  /** Optional progress summary */
  progress: z.string().optional(),
  /** Optional next steps */
  nextSteps: z.string().optional(),
});

/**
 * Delegation event schema (WU-1947: parent-child relationships)
 * Records WU delegation relationships for tracking parent-child WUs
 */
export const DelegationEventSchema = BaseEventSchema.extend({
  type: z.literal('delegation'),
  /** Parent WU ID that delegated this WU */
  parentWuId: z
    .string()
    .regex(WU_PATTERNS.WU_ID, { message: 'Parent WU ID must match pattern WU-XXX' }),
  /** Unique delegation identifier */
  delegationId: z.string().min(1, { message: 'Delegation ID is required' }),
});

/**
 * Release event schema (WU-1080: orphan recovery)
 * Releases an in_progress WU back to ready state when agent is interrupted.
 * Allows another agent to reclaim the orphaned WU.
 */
export const ReleaseEventSchema = BaseEventSchema.extend({
  type: z.literal('release'),
  /** Reason for releasing the WU */
  reason: z.string().min(1, { message: ERROR_MESSAGES.REASON_REQUIRED }),
});

/**
 * Union schema for all event types
 */
export const WUEventSchema = z.discriminatedUnion('type', [
  CreateEventSchema,
  ClaimEventSchema,
  BlockEventSchema,
  UnblockEventSchema,
  CompleteEventSchema,
  CheckpointEventSchema,
  DelegationEventSchema,
  ReleaseEventSchema,
]);

/**
 * TypeScript types inferred from schemas
 */
export type CreateEvent = z.infer<typeof CreateEventSchema>;
export type ClaimEvent = z.infer<typeof ClaimEventSchema>;
export type BlockEvent = z.infer<typeof BlockEventSchema>;
export type UnblockEvent = z.infer<typeof UnblockEventSchema>;
export type CompleteEvent = z.infer<typeof CompleteEventSchema>;
export type CheckpointEvent = z.infer<typeof CheckpointEventSchema>;
export type DelegationEvent = z.infer<typeof DelegationEventSchema>;
export type ReleaseEvent = z.infer<typeof ReleaseEventSchema>;
export type WUEvent = z.infer<typeof WUEventSchema>;

/**
 * Validates WU event data against schema
 *
 * @param {unknown} data - Data to validate
 * @returns {z.SafeParseReturnType<WUEvent, WUEvent>} Validation result
 *
 * @example
 * const result = validateWUEvent(eventData);
 * if (!result.success) {
 *   result.error.issues.forEach(issue => {
 *     console.error(`${issue.path.join('.')}: ${issue.message}`);
 *   });
 * }
 */
export function validateWUEvent(data: unknown) {
  return WUEventSchema.safeParse(data);
}

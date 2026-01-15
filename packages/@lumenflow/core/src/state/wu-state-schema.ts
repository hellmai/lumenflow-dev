/**
 * WU State Schema (WU-2537)
 *
 * Zod schemas for WU state event validation.
 * Defines event types for WU lifecycle: create, claim, block, unblock, complete.
 *
 * @module @lumenflow/core/state
 */

import { z } from 'zod';

/**
 * WU event types
 */
export const WU_EVENT_TYPES = [
  'create',
  'claim',
  'block',
  'unblock',
  'complete',
  'checkpoint',
  'spawn',
] as const;

export type WUEventType = (typeof WU_EVENT_TYPES)[number];

/**
 * WU status values (matches LumenFlow state machine)
 */
export const WU_STATUSES = ['ready', 'in_progress', 'blocked', 'waiting', 'done'] as const;

export type WUStatusValue = (typeof WU_STATUSES)[number];

/**
 * Regex patterns for WU validation
 */
export const WU_PATTERNS = {
  WU_ID: /^WU-\d+$/,
} as const;

const ERROR_MESSAGES = {
  EVENT_TYPE: 'Event type must be one of: create, claim, block, unblock, complete, checkpoint, spawn',
  WU_ID: 'WU ID must match pattern WU-XXX (e.g., WU-1570)',
  LANE_REQUIRED: 'Lane is required',
  TITLE_REQUIRED: 'Title is required',
  REASON_REQUIRED: 'Reason is required',
  TIMESTAMP_REQUIRED: 'Timestamp is required',
} as const;

const BaseEventSchema = z.object({
  type: z.enum(WU_EVENT_TYPES, {
    errorMap: () => ({ message: ERROR_MESSAGES.EVENT_TYPE }),
  }),
  wuId: z.string().regex(WU_PATTERNS.WU_ID, { message: ERROR_MESSAGES.WU_ID }),
  timestamp: z.string().datetime({ message: ERROR_MESSAGES.TIMESTAMP_REQUIRED }),
});

export const CreateEventSchema = BaseEventSchema.extend({
  type: z.literal('create'),
  lane: z.string().min(1, { message: ERROR_MESSAGES.LANE_REQUIRED }),
  title: z.string().min(1, { message: ERROR_MESSAGES.TITLE_REQUIRED }),
});

export const ClaimEventSchema = BaseEventSchema.extend({
  type: z.literal('claim'),
  lane: z.string().min(1, { message: ERROR_MESSAGES.LANE_REQUIRED }),
  title: z.string().min(1, { message: ERROR_MESSAGES.TITLE_REQUIRED }),
});

export const BlockEventSchema = BaseEventSchema.extend({
  type: z.literal('block'),
  reason: z.string().min(1, { message: ERROR_MESSAGES.REASON_REQUIRED }),
});

export const UnblockEventSchema = BaseEventSchema.extend({
  type: z.literal('unblock'),
});

export const CompleteEventSchema = BaseEventSchema.extend({
  type: z.literal('complete'),
});

export const CheckpointEventSchema = BaseEventSchema.extend({
  type: z.literal('checkpoint'),
  note: z.string().min(1, { message: 'Checkpoint note is required' }),
  sessionId: z.string().optional(),
  progress: z.string().optional(),
  nextSteps: z.string().optional(),
});

export const SpawnEventSchema = BaseEventSchema.extend({
  type: z.literal('spawn'),
  parentWuId: z.string().regex(WU_PATTERNS.WU_ID, { message: 'Parent WU ID must match pattern WU-XXX' }),
  spawnId: z.string().min(1, { message: 'Spawn ID is required' }),
});

export const WUEventSchema = z.discriminatedUnion('type', [
  CreateEventSchema,
  ClaimEventSchema,
  BlockEventSchema,
  UnblockEventSchema,
  CompleteEventSchema,
  CheckpointEventSchema,
  SpawnEventSchema,
]);

export type CreateEvent = z.infer<typeof CreateEventSchema>;
export type ClaimEvent = z.infer<typeof ClaimEventSchema>;
export type BlockEvent = z.infer<typeof BlockEventSchema>;
export type UnblockEvent = z.infer<typeof UnblockEventSchema>;
export type CompleteEvent = z.infer<typeof CompleteEventSchema>;
export type CheckpointEvent = z.infer<typeof CheckpointEventSchema>;
export type SpawnEvent = z.infer<typeof SpawnEventSchema>;
export type WUEvent = z.infer<typeof WUEventSchema>;

export function validateWUEvent(data: unknown): z.SafeParseReturnType<WUEvent, WUEvent> {
  return WUEventSchema.safeParse(data);
}

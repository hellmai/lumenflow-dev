/**
 * Spawn Registry Schema (WU-2539)
 *
 * Zod schemas for spawn event validation.
 * Defines schema for tracking sub-agent spawns by orchestrators.
 *
 * @module @lumenflow/core/spawn
 */

import { z } from 'zod';
import * as crypto from 'node:crypto';

/**
 * Spawn status values.
 */
export const SpawnStatus = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  TIMEOUT: 'timeout',
  CRASHED: 'crashed',
  ESCALATED: 'escalated',
} as const;

export type SpawnStatus = (typeof SpawnStatus)[keyof typeof SpawnStatus];

/**
 * Array of valid spawn statuses.
 */
export const SPAWN_STATUSES: readonly SpawnStatus[] = Object.values(SpawnStatus);

/**
 * Regex patterns for spawn validation.
 */
export const SPAWN_PATTERNS = {
  SPAWN_ID: /^spawn-[0-9a-f]{4}$/,
  WU_ID: /^WU-\d+$/,
} as const;
/**
 * Spawn Event Schema.
 */
export const SpawnEventSchema = z.object({
  id: z
    .string()
    .regex(SPAWN_PATTERNS.SPAWN_ID, { message: 'Spawn ID must match pattern spawn-XXXX' }),
  parentWuId: z
    .string()
    .regex(SPAWN_PATTERNS.WU_ID, { message: 'WU ID must match pattern WU-XXX' }),
  targetWuId: z
    .string()
    .regex(SPAWN_PATTERNS.WU_ID, { message: 'WU ID must match pattern WU-XXX' }),
  lane: z.string().min(1, { message: 'Lane is required' }),
  spawnedAt: z.string().datetime({ message: 'Timestamp is required' }),
  status: z.enum(SPAWN_STATUSES as unknown as readonly [string, ...string[]]),
  completedAt: z.string().datetime().nullable(),
});

export type SpawnEvent = z.infer<typeof SpawnEventSchema>;

/**
 * Validates spawn event data against schema.
 *
 * @param data - Data to validate
 * @returns Validation result
 */
export function validateSpawnEvent(data: unknown): z.SafeParseReturnType<SpawnEvent, SpawnEvent> {
  return SpawnEventSchema.safeParse(data);
}

/**
 * Generates a unique spawn ID from parent WU, target WU, and timestamp.
 *
 * @param parentWuId - Parent WU ID
 * @param targetWuId - Target WU ID
 * @returns Spawn ID in format spawn-XXXX
 */
export function generateSpawnId(parentWuId: string, targetWuId: string): string {
  const timestamp = Date.now().toString();
  const randomBytes = crypto.randomBytes(4).toString('hex');
  const input = `${parentWuId}:${targetWuId}:${timestamp}:${randomBytes}`;

  const hash = crypto.createHash('sha256').update(input).digest('hex');

  return `spawn-${hash.slice(0, 4)}`;
}

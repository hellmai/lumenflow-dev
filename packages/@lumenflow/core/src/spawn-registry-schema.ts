/**
 * Spawn Registry Schema (WU-1944)
 *
 * Zod schemas for spawn event validation.
 * Defines schema for tracking sub-agent spawns by orchestrators.
 *
 * @see {@link packages/@lumenflow/cli/src/lib/__tests__/spawn-registry-store.test.ts} - Tests
 * @see {@link packages/@lumenflow/cli/src/lib/spawn-registry-store.ts} - Store implementation
 */

import { z } from 'zod';
import crypto from 'node:crypto';

/**
 * Spawn status values
 */
export const SpawnStatus = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  TIMEOUT: 'timeout',
  CRASHED: 'crashed',
  /** WU-1967: Spawn escalated to orchestrator (signal sent, prevents duplicates) */
  ESCALATED: 'escalated',
} as const;

/** Type for spawn status values */
export type SpawnStatusValue = (typeof SpawnStatus)[keyof typeof SpawnStatus];

/**
 * Array of valid spawn statuses
 */
export const SPAWN_STATUSES = ['pending', 'completed', 'timeout', 'crashed', 'escalated'] as const;

/**
 * Optional spawn intent source values.
 *
 * WU-1604: Explicit delegation intent should be distinguishable from legacy
 * spawn-style records when present.
 */
export const SpawnIntent = {
  DELEGATION: 'delegation',
  LEGACY_SPAWN: 'legacy-spawn',
} as const;

/** Type for spawn intent values */
export type SpawnIntentValue = (typeof SpawnIntent)[keyof typeof SpawnIntent];

/** Array of valid spawn intent values */
export const SPAWN_INTENTS = ['delegation', 'legacy-spawn'] as const;

/**
 * Regex patterns for spawn validation
 */
export const SPAWN_PATTERNS = {
  /** Spawn ID format: spawn-{4 hex chars} */
  SPAWN_ID: /^spawn-[0-9a-f]{4}$/,
  /** WU ID format: WU-{digits} */
  WU_ID: /^WU-\d+$/,
};

/**
 * Error messages for schema validation
 */
const ERROR_MESSAGES = {
  SPAWN_ID: 'Spawn ID must match pattern spawn-XXXX (e.g., spawn-a1b2)',
  WU_ID: 'WU ID must match pattern WU-XXX (e.g., WU-1000)',
  LANE_REQUIRED: 'Lane is required',
  STATUS: `Status must be one of: ${SPAWN_STATUSES.join(', ')}`,
  INTENT: `Intent must be one of: ${SPAWN_INTENTS.join(', ')}`,
  TIMESTAMP_REQUIRED: 'Timestamp is required',
};

/**
 * Spawn Event Schema
 *
 * Defines the structure for spawn registry events.
 * Uses append-only JSONL storage with event replay for state reconstruction.
 */
export const SpawnEventSchema = z.object({
  /** Unique spawn ID in format spawn-XXXX (4 hex chars from SHA hash) */
  id: z.string().regex(SPAWN_PATTERNS.SPAWN_ID, { message: ERROR_MESSAGES.SPAWN_ID }),

  /** Parent WU ID (the orchestrator that spawned this agent) */
  parentWuId: z.string().regex(SPAWN_PATTERNS.WU_ID, { message: ERROR_MESSAGES.WU_ID }),

  /** Target WU ID (the WU being executed by the spawned agent) */
  targetWuId: z.string().regex(SPAWN_PATTERNS.WU_ID, { message: ERROR_MESSAGES.WU_ID }),

  /** Lane for the spawned work */
  lane: z.string().min(1, { message: ERROR_MESSAGES.LANE_REQUIRED }),

  /** Optional intent source (delegation or legacy spawn path) */
  intent: z.enum(SPAWN_INTENTS, { error: ERROR_MESSAGES.INTENT }).optional(),

  /** ISO 8601 timestamp when spawn was recorded */
  spawnedAt: z.string().datetime({ message: ERROR_MESSAGES.TIMESTAMP_REQUIRED }),

  /** Current status of the spawned agent */
  status: z.enum(SPAWN_STATUSES, {
    error: ERROR_MESSAGES.STATUS,
  }),

  /** ISO 8601 timestamp when spawn completed (null if pending) */
  completedAt: z.string().datetime().nullable(),
});

/**
 * TypeScript type inferred from schema
 */
export type SpawnEvent = z.infer<typeof SpawnEventSchema>;

/**
 * Validates spawn event data against schema
 *
 * @param {unknown} data - Data to validate
 * @returns Validation result
 *
 * @example
 * const result = validateSpawnEvent(eventData);
 * if (!result.success) {
 *   result.error.issues.forEach(issue => {
 *     console.error(`${issue.path.join('.')}: ${issue.message}`);
 *   });
 * }
 */
export function validateSpawnEvent(data: unknown) {
  return SpawnEventSchema.safeParse(data);
}

/**
 * Generates a unique spawn ID from parent WU, target WU, and timestamp
 *
 * Format: spawn-XXXX (4 hex characters from SHA-256 hash)
 *
 * @param {string} parentWuId - Parent WU ID
 * @param {string} targetWuId - Target WU ID
 * @returns {string} Spawn ID in format spawn-XXXX
 *
 * @example
 * const id = generateSpawnId('WU-1000', 'WU-1001');
 * // Returns: 'spawn-a1b2'
 */
export function generateSpawnId(parentWuId: string, targetWuId: string): string {
  // Include timestamp and random bytes for uniqueness
  const timestamp = Date.now().toString();
  const randomBytes = crypto.randomBytes(4).toString('hex');
  const input = `${parentWuId}:${targetWuId}:${timestamp}:${randomBytes}`;

  const hash = crypto.createHash('sha256').update(input).digest('hex');

  // Take first 4 hex chars
  return `spawn-${hash.slice(0, 4)}`;
}

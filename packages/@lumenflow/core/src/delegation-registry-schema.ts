// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Delegation Registry Schema (WU-1674)
 *
 * Canonical delegation schema and helpers for delegation lifecycle records.
 */

import crypto from 'node:crypto';
import { z } from 'zod';
import { WU_STATUS } from './wu-constants.js';

/**
 * Delegation status values.
 */
export const DelegationStatus = {
  PENDING: 'pending',
  COMPLETED: WU_STATUS.COMPLETED,
  TIMEOUT: 'timeout',
  CRASHED: 'crashed',
  ESCALATED: 'escalated',
} as const;

/** Type for delegation status values */
export type DelegationStatusValue = (typeof DelegationStatus)[keyof typeof DelegationStatus];

/** Array of valid delegation statuses */
export const DELEGATION_STATUSES = [
  DelegationStatus.PENDING,
  DelegationStatus.COMPLETED,
  DelegationStatus.TIMEOUT,
  DelegationStatus.CRASHED,
  DelegationStatus.ESCALATED,
] as const;

/**
 * Optional delegation intent source values.
 */
export const DelegationIntent = {
  DELEGATION: 'delegation',
  LEGACY_SPAWN: 'legacy-spawn',
} as const;

/** Type for delegation intent values */
export type DelegationIntentValue = (typeof DelegationIntent)[keyof typeof DelegationIntent];

/** Array of valid delegation intent values */
export const DELEGATION_INTENTS = [
  DelegationIntent.DELEGATION,
  DelegationIntent.LEGACY_SPAWN,
] as const;

/**
 * Regex patterns for delegation validation.
 */
export const DELEGATION_PATTERNS = {
  DELEGATION_ID: /^dlg-[0-9a-f]{4}$/,
  WU_ID: /^WU-\d+$/,
};

/**
 * Error messages for schema validation.
 */
const ERROR_MESSAGES = {
  DELEGATION_ID: 'Delegation ID must match pattern dlg-XXXX (e.g., dlg-a1b2)',
  WU_ID: 'WU ID must match pattern WU-XXX (e.g., WU-1000)',
  LANE_REQUIRED: 'Lane is required',
  STATUS: `Status must be one of: ${DELEGATION_STATUSES.join(', ')}`,
  INTENT: `Intent must be one of: ${DELEGATION_INTENTS.join(', ')}`,
  TIMESTAMP_REQUIRED: 'Timestamp is required',
  PICKUP_BY_REQUIRED: 'pickedUpBy must be a non-empty string when pickup is recorded',
  BRIEF_HASH: 'briefAttestation.promptHash must be a 64-character lowercase sha256 hex digest',
  BRIEF_ALGORITHM: 'briefAttestation.algorithm must be sha256',
  BRIEF_CLIENT_REQUIRED: 'briefAttestation.clientName must be a non-empty string',
} as const;

const SHA256_HEX_256_REGEX = /^[a-f0-9]{64}$/;

/**
 * Optional wu:brief prompt attestation captured by wu:delegate.
 */
export const DelegationBriefAttestationSchema = z.object({
  algorithm: z.literal('sha256', { error: ERROR_MESSAGES.BRIEF_ALGORITHM }),
  promptHash: z.string().regex(SHA256_HEX_256_REGEX, { message: ERROR_MESSAGES.BRIEF_HASH }),
  promptLength: z.number().int().nonnegative(),
  generatedAt: z.string().datetime({ message: ERROR_MESSAGES.TIMESTAMP_REQUIRED }),
  clientName: z.string().min(1, { message: ERROR_MESSAGES.BRIEF_CLIENT_REQUIRED }),
});

/**
 * Delegation event schema.
 */
export const DelegationEventSchema = z.object({
  id: z.string().regex(DELEGATION_PATTERNS.DELEGATION_ID, {
    message: ERROR_MESSAGES.DELEGATION_ID,
  }),
  parentWuId: z.string().regex(DELEGATION_PATTERNS.WU_ID, { message: ERROR_MESSAGES.WU_ID }),
  targetWuId: z.string().regex(DELEGATION_PATTERNS.WU_ID, { message: ERROR_MESSAGES.WU_ID }),
  lane: z.string().min(1, { message: ERROR_MESSAGES.LANE_REQUIRED }),
  intent: z.enum(DELEGATION_INTENTS, { error: ERROR_MESSAGES.INTENT }).optional(),
  delegatedAt: z.string().datetime({ message: ERROR_MESSAGES.TIMESTAMP_REQUIRED }),
  status: z.enum(DELEGATION_STATUSES, { error: ERROR_MESSAGES.STATUS }),
  completedAt: z.string().datetime().nullable(),
  pickedUpAt: z.string().datetime().optional(),
  pickedUpBy: z.string().min(1, { message: ERROR_MESSAGES.PICKUP_BY_REQUIRED }).optional(),
  briefAttestation: DelegationBriefAttestationSchema.optional(),
});

/** TypeScript type inferred from schema */
export type DelegationEvent = z.infer<typeof DelegationEventSchema>;
export type DelegationBriefAttestation = z.infer<typeof DelegationBriefAttestationSchema>;

/**
 * Validates delegation event data against schema.
 */
export function validateDelegationEvent(data: unknown) {
  return DelegationEventSchema.safeParse(data);
}

/**
 * Generates a unique delegation ID.
 */
export function generateDelegationId(parentWuId: string, targetWuId: string): string {
  const timestamp = Date.now().toString();
  const randomBytes = crypto.randomBytes(4).toString('hex');
  const input = `${parentWuId}:${targetWuId}:${timestamp}:${randomBytes}`;
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  return `dlg-${hash.slice(0, 4)}`;
}

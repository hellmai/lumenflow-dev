// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU (Work Unit) Configuration Schema
 *
 * Settings for WU ID patterns, description constraints, and defaults.
 *
 * @module schemas/wu-config
 */

import { z } from 'zod';

/**
 * wu:brief policy modes used by wu:claim automation.
 */
export const WuBriefPolicyModeSchema = z.enum(['off', 'manual', 'auto', 'required']);

/**
 * WU brief automation configuration.
 */
export const WuBriefConfigSchema = z.object({
  /** Claim-time wu:brief policy mode (default: 'auto') */
  policyMode: WuBriefPolicyModeSchema.default('auto'),
});

/**
 * WU (Work Unit) configuration
 */
export const WuConfigSchema = z.object({
  /** WU ID pattern (regex string, default: '^WU-\\d+$') */
  idPattern: z.string().default('^WU-\\d+$'),

  /** Minimum description length (default: 50) */
  minDescriptionLength: z.number().int().nonnegative().default(50),

  /** Maximum commit subject length (default: 100) */
  maxCommitSubject: z.number().int().positive().default(100),

  /** Default priority (default: 'P2') */
  defaultPriority: z.string().default('P2'),

  /** Default status (default: 'ready') */
  defaultStatus: z.string().default('ready'),

  /** Default type (default: 'feature') */
  defaultType: z.string().default('feature'),

  /** wu:brief policy configuration */
  brief: WuBriefConfigSchema.default(() => WuBriefConfigSchema.parse({})),
});

export type WuBriefPolicyMode = z.infer<typeof WuBriefPolicyModeSchema>;
export type WuBriefConfig = z.infer<typeof WuBriefConfigSchema>;
export type WuConfig = z.infer<typeof WuConfigSchema>;

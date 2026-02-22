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
});

export type WuConfig = z.infer<typeof WuConfigSchema>;

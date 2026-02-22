// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Lanes Configuration Schemas
 *
 * Lane definitions, enforcement rules, lock policies, and lifecycle status.
 *
 * @module schemas/lanes-config
 */

import { z } from 'zod';

/**
 * WU-1325: Lock policy for lane-level WIP enforcement
 *
 * Controls how lane locks behave:
 * - 'all' (default): Lock acquired on claim, held through block, released on done
 * - 'active': Lock acquired on claim, released on block, re-acquired on unblock
 * - 'none': No lock files created, WIP checking disabled
 *
 * @example
 * ```yaml
 * lanes:
 *   definitions:
 *     - name: 'Content: Documentation'
 *       wip_limit: 4
 *       lock_policy: 'none'  # Docs don't need lock coordination
 * ```
 */
export const LockPolicySchema = z.enum(['all', 'active', 'none']).default('all');

/** WU-1325: TypeScript type for lock policy */
export type LockPolicy = z.infer<typeof LockPolicySchema>;

/**
 * WU-1345: Lane enforcement configuration schema
 *
 * Controls how lane format validation behaves.
 */
export const LanesEnforcementSchema = z.object({
  /**
   * When true, lanes MUST use "Parent: Sublane" format if parent has taxonomy.
   * @default true
   */
  require_parent: z.boolean().default(true),

  /**
   * When false, only lanes in the taxonomy are allowed.
   * When true, custom lanes can be used.
   * @default false
   */
  allow_custom: z.boolean().default(false),
});

/**
 * WU-1748: Explicit lane lifecycle status for deferred lane process
 */
export const LaneLifecycleStatusSchema = z.enum(['unconfigured', 'draft', 'locked']);

/** WU-1748: Lane lifecycle metadata */
export const LaneLifecycleSchema = z.object({
  status: LaneLifecycleStatusSchema,
  updated_at: z.string().optional(),
  migrated_at: z.string().optional(),
  migration_reason: z.string().optional(),
});

/**
 * WU-1322: Lane definition schema for workspace.yaml
 *
 * Extends the existing lane configuration with lock_policy field.
 * Compatible with WU-1016 (wip_limit) and WU-1187 (wip_justification).
 */
export const LaneDefinitionSchema = z.object({
  /** Lane name in "Parent: Sublane" format (e.g., "Framework: Core") */
  name: z.string(),

  /** WU-1016: Maximum WUs allowed in progress concurrently for this lane */
  wip_limit: z.number().int().positive().optional(),

  /** WU-1187: Required justification when wip_limit > 1 */
  wip_justification: z.string().optional(),

  /**
   * WU-1322: Lock policy for this lane.
   * - 'all': Lock lane for all other agents (default)
   * - 'active': Lock only for agents with overlapping code_paths
   * - 'none': No locking (suitable for documentation lanes)
   *
   * @default 'all'
   *
   * @example
   * ```yaml
   * lanes:
   *   definitions:
   *     - name: 'Content: Documentation'
   *       wip_limit: 4
   *       lock_policy: 'none'  # Docs can be worked in parallel
   * ```
   */
  lock_policy: LockPolicySchema.default('all'),

  /** Code paths associated with this lane (glob patterns) */
  code_paths: z.array(z.string()).optional(),
});

/**
 * WU-1345: Complete lanes configuration schema
 *
 * Supports three formats:
 * 1. definitions array (recommended)
 * 2. engineering + business arrays (legacy/alternate)
 * 3. flat array (simple format - parsed as definitions)
 *
 * @example
 * ```yaml
 * lanes:
 *   enforcement:
 *     require_parent: true
 *     allow_custom: false
 *   definitions:
 *     - name: 'Framework: Core'
 *       wip_limit: 1
 *       code_paths:
 *         - 'packages/@lumenflow/core/**'
 * ```
 */
export const LanesConfigSchema = z.object({
  /** Lane enforcement configuration (validation rules) */
  enforcement: LanesEnforcementSchema.optional(),

  /** WU-1748: Deferred lane lifecycle state */
  lifecycle: LaneLifecycleSchema.optional(),

  /** Primary lane definitions array (recommended format) */
  definitions: z.array(LaneDefinitionSchema).optional(),

  /** Engineering lanes (alternate format) */
  engineering: z.array(LaneDefinitionSchema).optional(),

  /** Business lanes (alternate format) */
  business: z.array(LaneDefinitionSchema).optional(),
});

// WU-1322: Lane definition type (LockPolicy already exported by WU-1325)
export type LaneDefinition = z.infer<typeof LaneDefinitionSchema>;
// WU-1345: Lanes configuration types
export type LanesEnforcement = z.infer<typeof LanesEnforcementSchema>;
export type LaneLifecycleStatus = z.infer<typeof LaneLifecycleStatusSchema>;
export type LaneLifecycle = z.infer<typeof LaneLifecycleSchema>;
export type LanesConfig = z.infer<typeof LanesConfigSchema>;

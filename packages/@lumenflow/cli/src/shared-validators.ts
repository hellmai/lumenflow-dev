/**
 * @file shared-validators.ts
 * @description CLI integration for shared schema validators (WU-1454)
 *
 * This module re-exports the shared validators from @lumenflow/core so CLI
 * commands can validate arguments using the same schemas as MCP tools.
 *
 * Usage in CLI commands:
 *   import { validateWuBlockArgs } from './shared-validators.js';
 *
 *   const result = validateWuBlockArgs({ id, reason });
 *   if (!result.valid) {
 *     die(result.errors.join(', '));
 *   }
 *   // Use result.normalized for validated + typed data
 *
 * These validators ensure CLI and MCP validate inputs identically.
 * The schemas are the single source of truth in @lumenflow/core.
 */

import {
  validateInitiativeEditArgs as validateInitiativeEditSchemaArgs,
  validateWuValidateArgs as validateWuValidateSchemaArgs,
  type ArgValidationResult,
} from '@lumenflow/core';

// WU-1431: Original 5 command validators
export {
  validateWuCreateArgs,
  validateWuClaimArgs,
  validateWuStatusArgs,
  validateWuDoneArgs,
  validateGatesArgs,
} from '@lumenflow/core';

export type { ArgValidationResult } from '@lumenflow/core';

// WU-1454: 16 lifecycle command validators
export {
  validateWuBlockArgs,
  validateWuUnblockArgs,
  validateWuEditArgs,
  validateWuReleaseArgs,
  validateWuRecoverArgs,
  validateWuRepairArgs,
  validateWuDepsArgs,
  validateWuPrepArgs,
  validateWuPreflightArgs,
  validateWuPruneArgs,
  validateWuDeleteArgs,
  validateWuCleanupArgs,
  validateWuSpawnArgs,
  validateWuValidateArgs,
  validateWuInferLaneArgs,
  validateWuUnlockLaneArgs,
} from '@lumenflow/core';

// WU-1455: 8 initiative command validators
export {
  validateInitiativeCreateArgs,
  validateInitiativeEditArgs,
  validateInitiativeListArgs,
  validateInitiativeStatusArgs,
  validateInitiativeAddWuArgs,
  validateInitiativeRemoveWuArgs,
  validateInitiativeBulkAssignArgs,
  validateInitiativePlanArgs,
} from '@lumenflow/core';

type InitiativeEditCliArgs = {
  id?: string;
  status?: string;
  blockedBy?: string;
  blockedReason?: string;
  unblock?: boolean;
  addLane?: string[];
  removeLane?: string[];
  notes?: string;
  description?: string;
  addPhase?: string[];
  addSuccessMetric?: string[];
  removeSuccessMetric?: string[];
  phaseId?: string;
  phaseStatus?: string;
  phaseTitle?: string;
  created?: string;
};

type WuValidateCliArgs = {
  id?: string;
  noStrict?: boolean;
};

type WuProtoCliArgs = {
  lane?: string;
  title?: string;
  description?: string;
  codePaths?: string[];
  labels?: string[];
  assignedTo?: string;
};

type WuProtoNormalized = {
  lane?: string;
  title?: string;
  description?: string;
  code_paths?: string[];
  labels?: string[];
  assigned_to?: string;
};

export function normalizeInitiativeEditCliArgs(
  args: InitiativeEditCliArgs,
): Record<string, unknown> {
  return {
    id: args.id,
    status: args.status,
    blocked_by: args.blockedBy,
    blocked_reason: args.blockedReason,
    unblock: args.unblock,
    add_lane: args.addLane,
    remove_lane: args.removeLane,
    notes: args.notes,
    description: args.description,
    add_phase: args.addPhase,
    add_success_metric: args.addSuccessMetric,
    remove_success_metric: args.removeSuccessMetric,
    phase_id: args.phaseId,
    phase_status: args.phaseStatus,
    phase_title: args.phaseTitle,
    created: args.created,
  };
}

export function validateInitiativeEditCliArgs(
  args: InitiativeEditCliArgs,
): ReturnType<typeof validateInitiativeEditSchemaArgs> {
  return validateInitiativeEditSchemaArgs(normalizeInitiativeEditCliArgs(args));
}

export function validateWuValidateCliArgs(
  args: WuValidateCliArgs,
): ReturnType<typeof validateWuValidateSchemaArgs> {
  return validateWuValidateSchemaArgs({
    id: args.id,
    no_strict: args.noStrict,
  });
}

export function validateWuProtoCliArgs(
  args: WuProtoCliArgs,
): ArgValidationResult<WuProtoNormalized> {
  const normalized: WuProtoNormalized = {
    lane: args.lane,
    title: args.title,
    description: args.description,
    code_paths: args.codePaths,
    labels: args.labels,
    assigned_to: args.assignedTo,
  };
  const errors: string[] = [];
  if (!normalized.lane || normalized.lane.trim() === '') {
    errors.push('lane is required');
  }
  if (!normalized.title || normalized.title.trim() === '') {
    errors.push('title is required');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
    normalized,
  };
}

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

// WU-1431: Original 5 command validators
export {
  validateWuCreateArgs,
  validateWuClaimArgs,
  validateWuStatusArgs,
  validateWuDoneArgs,
  validateGatesArgs,
  type ArgValidationResult,
} from '@lumenflow/core';

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

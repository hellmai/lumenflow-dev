// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Consistency Checker — Barrel Re-export (WU-2015)
 *
 * WU-2015: This file was decomposed from a 1255-line monolith into
 * three single-responsibility modules. It now serves as a backward-compatible
 * barrel re-exporting all public API from their domain modules.
 *
 * Domain modules:
 * - wu-consistency-detector.ts: Error detection logic (checkWUConsistency, checkAllWUConsistency, checkLaneForOrphanDoneWU)
 * - wu-inconsistency-repairer.ts: Repair orchestration (repairWUInconsistency)
 * - wu-consistency-file-repairs.ts: File-level stamp/YAML/markdown repairs
 *
 * @see {@link ./wu-consistency-detector.ts} Detection logic
 * @see {@link ./wu-inconsistency-repairer.ts} Repair orchestration
 * @see {@link ./wu-consistency-file-repairs.ts} File-level repairs
 * @see {@link ../wu-repair.ts} CLI interface
 */

// Detection logic
export {
  checkWUConsistency,
  checkAllWUConsistency,
  checkLaneForOrphanDoneWU,
} from './wu-consistency-detector.js';

export type { CheckWUConsistencyOptions, ConsistencyError } from './wu-consistency-detector.js';

// Repair orchestration
export {
  repairWUInconsistency,
  FILE_REPAIR_STRATEGIES,
  GIT_REPAIR_STRATEGIES,
} from './wu-inconsistency-repairer.js';

export type {
  RepairWUInconsistencyOptions,
  FileRepairStrategy,
  GitRepairStrategy,
} from './wu-inconsistency-repairer.js';

// File-level repairs (exported for direct use by callers needing fine-grained control)
export type { RepairResult } from './wu-consistency-file-repairs.js';

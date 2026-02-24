// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Inconsistency Repairer (WU-2015, WU-2018)
 *
 * Repair orchestration for WU state inconsistencies. Coordinates micro-worktree
 * isolation for file-based repairs and direct execution for git-only repairs.
 *
 * WU-2018: Replaced switch-based dispatch with strategy maps for OCP compliance.
 * Adding a new repair type requires only a new map entry — no modification to
 * existing dispatch logic.
 *
 * Extracted from wu-consistency-checker.ts to isolate repair orchestration
 * from detection and file manipulation concerns.
 *
 * @see {@link ./wu-consistency-detector.ts} Detection logic
 * @see {@link ./wu-consistency-file-repairs.ts} File-level repairs
 */

import { CONSISTENCY_TYPES, LOG_PREFIX } from './wu-constants.js';
import { createWuPaths } from './wu-paths.js';
import { withMicroWorktree } from './micro-worktree.js';
import type { ConsistencyError } from './wu-consistency-detector.js';
import type { WUConsistencyRepairResult } from './wu-consistency-file-repairs.js';
import {
  createStampInWorktree,
  updateYamlToDoneInWorktree,
  removeWUFromSectionInWorktree,
  removeOrphanWorktree,
} from './wu-consistency-file-repairs.js';

/**
 * Options for repairing WU inconsistencies
 */
export interface RepairWUInconsistencyOptions {
  /** If true, don't actually repair */
  dryRun?: boolean;
  /** Project root directory */
  projectRoot?: string;
}

/**
 * Strategy for repairing a file-based consistency error inside a worktree.
 *
 * Each handler receives the error, the worktree path (where files are written),
 * and the project root (where source files are read from).
 *
 * To add a new file-based repair type:
 *   1. Add the type constant to CONSISTENCY_TYPES in wu-domain-constants.ts
 *   2. Add a handler to FILE_REPAIR_STRATEGIES below
 */
export type FileRepairStrategy = (
  error: ConsistencyError,
  worktreePath: string,
  projectRoot: string,
) => Promise<WUConsistencyRepairResult>;

/**
 * Strategy for repairing a git-only consistency error (no micro-worktree needed).
 *
 * To add a new git-only repair type:
 *   1. Add the type constant to CONSISTENCY_TYPES in wu-domain-constants.ts
 *   2. Add a handler to GIT_REPAIR_STRATEGIES below
 */
export type GitRepairStrategy = (
  error: ConsistencyError,
  projectRoot: string,
) => Promise<WUConsistencyRepairResult>;

/**
 * Strategy map for file-based repairs (WU-2018).
 *
 * Each entry maps a CONSISTENCY_TYPES value to a handler function.
 * File-based repairs run inside a micro-worktree for atomic commits.
 */
export const FILE_REPAIR_STRATEGIES: Record<string, FileRepairStrategy> = {
  [CONSISTENCY_TYPES.YAML_DONE_NO_STAMP]: async (error, worktreePath, projectRoot) => {
    const files = await createStampInWorktree(
      error.wuId,
      error.title || `WU ${error.wuId}`,
      worktreePath,
      projectRoot,
    );
    return { success: true, files };
  },

  [CONSISTENCY_TYPES.YAML_DONE_STATUS_IN_PROGRESS]: async (error, worktreePath, projectRoot) => {
    const paths = createWuPaths({ projectRoot });
    const files = await removeWUFromSectionInWorktree(
      paths.STATUS(),
      error.wuId,
      '## In Progress',
      worktreePath,
      projectRoot,
    );
    return { success: true, files };
  },

  [CONSISTENCY_TYPES.BACKLOG_DUAL_SECTION]: async (error, worktreePath, projectRoot) => {
    const paths = createWuPaths({ projectRoot });
    const files = await removeWUFromSectionInWorktree(
      paths.BACKLOG(),
      error.wuId,
      '## \uD83D\uDD27 In progress',
      worktreePath,
      projectRoot,
    );
    return { success: true, files };
  },

  [CONSISTENCY_TYPES.STAMP_EXISTS_YAML_NOT_DONE]: async (error, worktreePath, projectRoot) => {
    const files = await updateYamlToDoneInWorktree(error.wuId, worktreePath, projectRoot);
    return { success: true, files };
  },
};

/**
 * Strategy map for git-only repairs (WU-2018).
 *
 * Each entry maps a CONSISTENCY_TYPES value to a handler function.
 * Git-only repairs (worktree/branch cleanup) run directly without micro-worktree.
 */
export const GIT_REPAIR_STRATEGIES: Record<string, GitRepairStrategy> = {
  [CONSISTENCY_TYPES.ORPHAN_WORKTREE_DONE]: async (error, projectRoot) => {
    if (!error.lane) {
      return { skipped: true, reason: 'Missing lane metadata for orphan worktree cleanup' };
    }
    return await removeOrphanWorktree(error.wuId, error.lane, projectRoot);
  },
};

/**
 * Categorize errors into file-based repairs (need micro-worktree) and git-only repairs.
 *
 * Uses the strategy maps to determine categorization — an error type present in
 * GIT_REPAIR_STRATEGIES is git-only, one in FILE_REPAIR_STRATEGIES is file-based.
 */
function categorizeErrors(errors: ConsistencyError[]): {
  fileRepairs: ConsistencyError[];
  gitOnlyRepairs: ConsistencyError[];
  nonRepairable: ConsistencyError[];
} {
  const fileRepairs: ConsistencyError[] = [];
  const gitOnlyRepairs: ConsistencyError[] = [];
  const nonRepairable: ConsistencyError[] = [];

  for (const error of errors) {
    if (!error.canAutoRepair) {
      nonRepairable.push(error);
      continue;
    }

    // Git-only repairs: worktree/branch cleanup doesn't need micro-worktree
    if (error.type in GIT_REPAIR_STRATEGIES) {
      gitOnlyRepairs.push(error);
    } else {
      // All file-based repairs need micro-worktree isolation
      fileRepairs.push(error);
    }
  }

  return { fileRepairs, gitOnlyRepairs, nonRepairable };
}

/**
 * Repair a single file-based error inside a micro-worktree (WU-1078, WU-2018)
 *
 * This function performs file modifications inside the worktree path,
 * which is then committed and pushed atomically by withMicroWorktree.
 *
 * Uses FILE_REPAIR_STRATEGIES map for dispatch — no switch statement.
 *
 * @param {ConsistencyError} error - Error object from checkWUConsistency()
 * @param {string} worktreePath - Path to the micro-worktree
 * @param {string} projectRoot - Original project root (for reading source files)
 * @returns {Promise<RepairResult>} Result with success, skipped, reason, and files modified
 */
async function repairSingleErrorInWorktree(
  error: ConsistencyError,
  worktreePath: string,
  projectRoot: string,
): Promise<WUConsistencyRepairResult> {
  const strategy = FILE_REPAIR_STRATEGIES[error.type];
  if (!strategy) {
    return { skipped: true, reason: `Unknown error type: ${error.type}` };
  }
  return strategy(error, worktreePath, projectRoot);
}

/**
 * Repair git-only errors (worktree/branch cleanup) without micro-worktree (WU-2018)
 *
 * These operations don't modify files in the repo, they only manage git worktrees
 * and branches, so they can run directly.
 *
 * Uses GIT_REPAIR_STRATEGIES map for dispatch — no switch statement.
 *
 * @param {ConsistencyError} error - Error object
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<RepairResult>} Result with success, skipped, and reason
 */
async function repairGitOnlyError(
  error: ConsistencyError,
  projectRoot: string,
): Promise<WUConsistencyRepairResult> {
  const strategy = GIT_REPAIR_STRATEGIES[error.type];
  if (!strategy) {
    return { skipped: true, reason: `Unknown git-only error type: ${error.type}` };
  }
  return strategy(error, projectRoot);
}

/**
 * Repair WU inconsistencies using micro-worktree isolation (WU-1078)
 *
 * All file modifications (stamps, YAML, markdown) are made atomically
 * in a micro-worktree, then committed and pushed to origin/main.
 * This prevents direct writes to the main checkout.
 *
 * WU-1370: When projectRoot is explicitly provided (not process.cwd()), the caller
 * is already inside a micro-worktree context (e.g., handleOrphanCheck during wu:claim).
 * In this case, skip creating a nested micro-worktree and work directly in projectRoot.
 * This prevents local main drift from nested micro-worktrees merging before pushing.
 *
 * @param {object} report - Report from checkWUConsistency()
 * @param {RepairWUInconsistencyOptions} [options={}] - Repair options
 * @returns {Promise<object>} Result with repaired, skipped, and failed counts
 */
export async function repairWUInconsistency(
  report: { valid: boolean; errors: ConsistencyError[] },
  options: RepairWUInconsistencyOptions = {},
) {
  const { dryRun = false, projectRoot } = options;

  // WU-1370: Detect if projectRoot was explicitly provided
  // If provided, we're inside a micro-worktree and should work directly in projectRoot
  const isInsideMicroWorktree = projectRoot !== undefined;
  const effectiveProjectRoot = projectRoot ?? process.cwd();

  if (report.valid) {
    return { repaired: 0, skipped: 0, failed: 0 };
  }

  const { fileRepairs, gitOnlyRepairs, nonRepairable } = categorizeErrors(report.errors);

  let repaired = 0;
  let skipped = nonRepairable.length;
  let failed = 0;

  // Dry run mode: just count
  if (dryRun) {
    return {
      repaired: fileRepairs.length + gitOnlyRepairs.length,
      skipped,
      failed: 0,
    };
  }

  // Step 1: Process file-based repairs
  if (fileRepairs.length > 0) {
    // WU-1370: When projectRoot is provided, we're already in a micro-worktree context
    // (e.g., called from handleOrphanCheck during wu:claim). Work directly in projectRoot
    // instead of creating a nested micro-worktree.
    if (isInsideMicroWorktree) {
      // Direct repair mode: work in the provided projectRoot
      for (const error of fileRepairs) {
        try {
          // When inside a micro-worktree, worktreePath === projectRoot
          // We're both reading from and writing to the same location
          const result = await repairSingleErrorInWorktree(
            error,
            effectiveProjectRoot,
            effectiveProjectRoot,
          );
          if (result.success && result.files) {
            repaired++;
          } else if (result.skipped) {
            skipped++;
            if (result.reason) {
              console.warn(`${LOG_PREFIX.REPAIR} Skipped ${error.type}: ${result.reason}`);
            }
          } else {
            failed++;
          }
        } catch (err) {
          const errMessage = err instanceof Error ? err.message : String(err);
          console.error(`${LOG_PREFIX.REPAIR} Failed to repair ${error.type}: ${errMessage}`);
          failed++;
        }
      }
    } else {
      // Standard mode: create micro-worktree for isolation
      try {
        // Generate a batch ID from the WU IDs being repaired
        const batchId = `batch-${fileRepairs.map((e) => e.wuId).join('-')}`.slice(0, 50);

        await withMicroWorktree({
          operation: 'wu-repair',
          id: batchId,
          logPrefix: LOG_PREFIX.REPAIR,
          execute: async ({ worktreePath }) => {
            const filesModified: string[] = [];

            for (const error of fileRepairs) {
              try {
                const result = await repairSingleErrorInWorktree(error, worktreePath, worktreePath);
                if (result.success && result.files) {
                  filesModified.push(...result.files);
                  repaired++;
                } else if (result.skipped) {
                  skipped++;
                  if (result.reason) {
                    console.warn(`${LOG_PREFIX.REPAIR} Skipped ${error.type}: ${result.reason}`);
                  }
                } else {
                  failed++;
                }
              } catch (err) {
                const errMessage = err instanceof Error ? err.message : String(err);
                console.error(`${LOG_PREFIX.REPAIR} Failed to repair ${error.type}: ${errMessage}`);
                failed++;
              }
            }

            // Deduplicate files
            const uniqueFiles = [...new Set(filesModified)];

            return {
              commitMessage: `fix: repair ${repaired} WU inconsistencies`,
              files: uniqueFiles,
            };
          },
        });
      } catch (err) {
        // If micro-worktree fails, mark all file repairs as failed
        const errMessage = err instanceof Error ? err.message : String(err);
        console.error(`${LOG_PREFIX.REPAIR} Micro-worktree operation failed: ${errMessage}`);
        failed += fileRepairs.length - repaired;
      }
    }
  }

  // Step 2: Process git-only repairs (worktree/branch cleanup) directly
  for (const error of gitOnlyRepairs) {
    try {
      const result = await repairGitOnlyError(error, effectiveProjectRoot);
      if (result.success) {
        repaired++;
      } else if (result.skipped) {
        skipped++;
        if (result.reason) {
          console.warn(`${LOG_PREFIX.REPAIR} Skipped ${error.type}: ${result.reason}`);
        }
      } else {
        failed++;
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_PREFIX.REPAIR} Failed to repair ${error.type}: ${errMessage}`);
      failed++;
    }
  }

  return { repaired, skipped, failed };
}

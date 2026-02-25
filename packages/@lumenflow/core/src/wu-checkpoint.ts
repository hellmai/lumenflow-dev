// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-1747: WU Checkpoint Module
 *
 * Provides checkpoint-based gate resumption for wu:done operations.
 * Allows failed wu:done to resume from checkpoint without re-running gates
 * if nothing has changed since the checkpoint was created.
 *
 * Features:
 * - Pre-gates checkpoint creation with worktree state
 * - SHA-based change detection
 * - Schema versioning for forward compatibility
 * - Automatic stale checkpoint cleanup
 *
 * @module wu-checkpoint
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { LOG_PREFIX, EMOJI, LUMENFLOW_PATHS } from './wu-constants.js';
import { MS_PER_DAY } from './constants/duration-constants.js';
import { GIT_DIRECTORY_NAME } from './config-contract.js';

/**
 * Schema version for checkpoint files
 * Increment when checkpoint format changes
 */
export const CHECKPOINT_SCHEMA_VERSION = 1;

/**
 * Checkpoint directory within .lumenflow
 */
const CHECKPOINT_DIR = 'checkpoints';

/**
 * Maximum age for a checkpoint before it's considered stale (24 hours)
 * WU-2044: Uses canonical MS_PER_DAY from duration-constants.ts
 */
const CHECKPOINT_MAX_AGE_MS = MS_PER_DAY;

/**
 * @typedef {Object} Checkpoint
 * @property {number} schemaVersion - Checkpoint format version
 * @property {string} checkpointId - Unique checkpoint identifier
 * @property {string} wuId - WU ID this checkpoint is for
 * @property {string} worktreePath - Path to worktree when checkpoint was created
 * @property {string} branchName - Lane branch name
 * @property {string} worktreeHeadSha - Git HEAD SHA of worktree at checkpoint time
 * @property {string} createdAt - ISO timestamp when checkpoint was created
 * @property {boolean} gatesPassed - Whether gates passed at this checkpoint
 * @property {string} [gatesPassedAt] - ISO timestamp when gates passed
 */

/**
 * Options for checkpoint operations
 */
interface CheckpointBaseDirOptions {
  /** Base directory (defaults to cwd) */
  baseDir?: string;
}

/**
 * Get the path to a checkpoint file
 *
 * @param {string} wuId - WU ID
 * @param {CheckpointBaseDirOptions} [options]
 * @returns {string} Path to checkpoint file
 */
function getCheckpointPath(wuId: string, options: CheckpointBaseDirOptions = {}) {
  const baseDir = options.baseDir || process.cwd();
  return path.join(baseDir, LUMENFLOW_PATHS.BASE, CHECKPOINT_DIR, `${wuId}.checkpoint.json`);
}

/**
 * Ensure checkpoint directory exists
 *
 * @param {CheckpointBaseDirOptions} [options]
 */
function ensureCheckpointDir(options: CheckpointBaseDirOptions = {}) {
  const baseDir = options.baseDir || process.cwd();
  const checkpointDir = path.join(baseDir, LUMENFLOW_PATHS.BASE, CHECKPOINT_DIR);
  if (!existsSync(checkpointDir)) {
    mkdirSync(checkpointDir, { recursive: true });
  }
}

/**
 * Generate a unique checkpoint ID
 *
 * @returns {string} Unique checkpoint ID
 */
function generateCheckpointId() {
  return `ckpt-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Get the current HEAD SHA from a git directory
 * Falls back to placeholder if git operations fail
 *
 * @param {string} dir - Directory to get HEAD SHA from
 * @returns {string} HEAD SHA or placeholder
 */
function getHeadSha(dir: string): string {
  try {
    // Try to read .git/HEAD directly for speed
    const gitDir = path.join(dir, GIT_DIRECTORY_NAME);
    if (existsSync(gitDir)) {
      const headPath = path.join(gitDir, 'HEAD');
      if (existsSync(headPath)) {
        const headContent = readFileSync(headPath, 'utf8').trim();
        // If it's a ref, read the ref file
        if (headContent.startsWith('ref: ')) {
          const refPath = path.join(gitDir, headContent.slice(5));
          if (existsSync(refPath)) {
            return readFileSync(refPath, 'utf8').trim();
          }
        }
        // It's a direct SHA
        return headContent;
      }
    }

    // For worktrees, .git is a file pointing to the main repo
    const gitFile = path.join(dir, GIT_DIRECTORY_NAME);
    if (existsSync(gitFile)) {
      const gitFileContent = readFileSync(gitFile, 'utf8').trim();
      if (gitFileContent.startsWith('gitdir: ')) {
        const worktreeGitDir = gitFileContent.slice(8);
        const headPath = path.join(worktreeGitDir, 'HEAD');
        if (existsSync(headPath)) {
          const headContent = readFileSync(headPath, 'utf8').trim();
          if (headContent.startsWith('ref: ')) {
            // Need to resolve from main repo's refs
            const mainGitDir = path.resolve(worktreeGitDir, '..', '..');
            const refPath = path.join(mainGitDir, headContent.slice(5));
            if (existsSync(refPath)) {
              return readFileSync(refPath, 'utf8').trim();
            }
          }
          return headContent;
        }
      }
    }

    return 'unknown-sha';
  } catch {
    return 'unknown-sha';
  }
}

/**
 * Options for creating pre-gates checkpoint
 */
export interface CreatePreGatesCheckpointOptions extends CheckpointBaseDirOptions {
  /** Whether gates already passed (for testing) */
  gatesPassed?: boolean;
}

/**
 * Create a checkpoint before running gates
 *
 * @param {Object} params - Checkpoint parameters
 * @param {string} params.wuId - WU ID
 * @param {string} params.worktreePath - Path to worktree
 * @param {string} params.branchName - Lane branch name
 * @param {CreatePreGatesCheckpointOptions} [options]
 * @returns {Promise<Checkpoint>} Created checkpoint
 */
/** Parameters for creating a pre-gates checkpoint */
interface PreGatesCheckpointParams {
  wuId: string;
  worktreePath: string;
  branchName: string;
  gatesPassed?: boolean;
}

export async function createPreGatesCheckpoint(
  params: PreGatesCheckpointParams,
  options: CreatePreGatesCheckpointOptions = {},
) {
  const { wuId, worktreePath, branchName, gatesPassed = false } = params;
  const { baseDir } = options;

  ensureCheckpointDir({ baseDir });

  const checkpoint = {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    checkpointId: generateCheckpointId(),
    wuId,
    worktreePath,
    branchName,
    worktreeHeadSha: getHeadSha(worktreePath),
    createdAt: new Date().toISOString(),
    gatesPassed,
    gatesPassedAt: gatesPassed ? new Date().toISOString() : null,
  };

  const checkpointPath = getCheckpointPath(wuId, { baseDir });
  writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));

  console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Created pre-gates checkpoint for ${wuId}`);

  return checkpoint;
}

/**
 * Mark a checkpoint as having passed gates
 *
 * @param {string} wuId - WU ID
 * @param {CheckpointBaseDirOptions} [options]
 * @returns {boolean} True if checkpoint was updated
 */
export function markGatesPassed(wuId: string, options: CheckpointBaseDirOptions = {}) {
  const checkpoint = getCheckpoint(wuId, options);
  if (!checkpoint) {
    return false;
  }

  checkpoint.gatesPassed = true;
  checkpoint.gatesPassedAt = new Date().toISOString();

  const checkpointPath = getCheckpointPath(wuId, options);
  writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));

  console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Marked gates passed for ${wuId}`);

  return true;
}

/**
 * Get a checkpoint for a WU
 *
 * @param {string} wuId - WU ID
 * @param {CheckpointBaseDirOptions} [options]
 * @returns {Checkpoint|null} Checkpoint or null if not found
 */
export function getCheckpoint(wuId: string, options: CheckpointBaseDirOptions = {}) {
  const checkpointPath = getCheckpointPath(wuId, options);

  if (!existsSync(checkpointPath)) {
    return null;
  }

  try {
    const content = readFileSync(checkpointPath, 'utf8');
    return JSON.parse(content);
  } catch {
    // Corrupted checkpoint - treat as non-existent
    return null;
  }
}

/**
 * Clear a checkpoint for a WU
 *
 * @param {string} wuId - WU ID
 * @param {CheckpointBaseDirOptions} [options]
 */
export function clearCheckpoint(wuId: string, options: CheckpointBaseDirOptions = {}) {
  const checkpointPath = getCheckpointPath(wuId, options);

  if (existsSync(checkpointPath)) {
    unlinkSync(checkpointPath);
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Cleared checkpoint for ${wuId}`);
  }
}

/**
 * @typedef {Object} CanSkipResult
 * @property {boolean} canSkip - Whether gates can be skipped
 * @property {string} [reason] - Reason if canSkip is false
 * @property {Checkpoint} [checkpoint] - Checkpoint if canSkip is true
 */

/**
 * Check if gates can be skipped based on checkpoint
 *
 * Gates can be skipped if:
 * 1. A valid checkpoint exists
 * 2. Schema version matches
 * 3. Gates already passed at checkpoint
 * 4. Worktree HEAD SHA hasn't changed
 * 5. Checkpoint isn't stale
 *
 * @param {string} wuId - WU ID
 * @param {CanSkipGatesOptions} [options]
 * @returns {CanSkipResult} Result indicating if gates can be skipped
 */
export interface CanSkipGatesOptions extends CheckpointBaseDirOptions {
  /** Current worktree HEAD SHA to compare */
  currentHeadSha?: string;
}

export function canSkipGates(wuId: string, options: CanSkipGatesOptions = {}) {
  const { baseDir, currentHeadSha } = options;

  const checkpoint = getCheckpoint(wuId, { baseDir });

  // No checkpoint exists
  if (!checkpoint) {
    return { canSkip: false, reason: 'No checkpoint exists' };
  }

  // Schema version mismatch
  if (checkpoint.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) {
    return {
      canSkip: false,
      reason: `Checkpoint schema version mismatch (got ${checkpoint.schemaVersion}, expected ${CHECKPOINT_SCHEMA_VERSION})`,
    };
  }

  // Gates didn't pass at checkpoint
  if (!checkpoint.gatesPassed) {
    return { canSkip: false, reason: 'Gates did not pass at checkpoint' };
  }

  // Check if checkpoint is stale
  const checkpointAge = Date.now() - new Date(checkpoint.createdAt).getTime();
  if (checkpointAge > CHECKPOINT_MAX_AGE_MS) {
    return { canSkip: false, reason: 'Checkpoint is stale (older than 24 hours)' };
  }

  // SHA has changed since checkpoint
  if (currentHeadSha && currentHeadSha !== checkpoint.worktreeHeadSha) {
    return {
      canSkip: false,
      reason: 'Worktree has changed since checkpoint (SHA mismatch)',
    };
  }

  // All checks passed - gates can be skipped
  console.log(
    `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Gates can be skipped - checkpoint valid (${checkpoint.checkpointId})`,
  );

  return { canSkip: true, checkpoint };
}

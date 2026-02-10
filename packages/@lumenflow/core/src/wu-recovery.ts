/**
 * WU Recovery Module
 *
 * Handles zombie state recovery (status=done but worktree still exists)
 * Fixes WU-1159 gap by ensuring status.md AND backlog.md are updated
 *
 * Zombie states occur when wu:done crashes mid-execution:
 * - WU YAML updated to status=done
 * - But cleanup incomplete (worktree exists, docs not updated, etc.)
 *
 * Recovery mode is idempotent - safe to run multiple times
 *
 * NOTE (WU-1826): Core recovery functions are now re-exported from
 * tools/lib/wu-repair-core.ts for use by the unified wu:repair command.
 * This module remains the canonical implementation used by wu-done.ts.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { RECOVERY } from './wu-done-messages.js';
import { createStamp } from './stamp-utils.js';
import { WU_PATHS } from './wu-paths.js';
import { writeWU } from './wu-yaml.js';
import { updateStatusRemoveInProgress, addToStatusCompleted } from './wu-status-updater.js';
import { moveWUToDoneBacklog } from './wu-backlog-updater.js';
import { getGitForCwd } from './git-adapter.js';
import { createError, ErrorCodes } from './error-handler.js';
import { rollbackFiles } from './rollback-utils.js';
import { LOG_PREFIX, EMOJI, WU_STATUS, getProjectRoot, LUMENFLOW_PATHS } from './wu-constants.js';

import { RETRY_PRESETS } from './retry-strategy.js';

/**
 * WU-1335: Maximum number of recovery attempts before escalating to manual intervention
 * WU-1747: Now derived from the recovery retry preset for consistency
 */
export const MAX_RECOVERY_ATTEMPTS = RETRY_PRESETS.recovery.maxAttempts;

/**
 * WU-1335: Recovery marker subdirectory within .lumenflow
 */
const RECOVERY_MARKER_DIR = 'recovery';

/**
 * WU-1335: Get the path to the recovery marker file for a WU
 *
 * @param {string} id - WU ID
 * @param {string} [baseDir=process.cwd()] - Base directory for .lumenflow
 * @returns {string} Path to recovery marker file
 */
export function getRecoveryMarkerPath(id, baseDir = process.cwd()) {
  return join(baseDir, LUMENFLOW_PATHS.BASE, RECOVERY_MARKER_DIR, `${id}.recovery`);
}

/**
 * WU-1335: Get the current recovery attempt count for a WU
 *
 * @param {string} id - WU ID
 * @param {string} [baseDir=process.cwd()] - Base directory for .lumenflow
 * @returns {number} Current attempt count (0 if no marker exists)
 */
export function getRecoveryAttemptCount(id, baseDir = process.cwd()) {
  const markerPath = getRecoveryMarkerPath(id, baseDir);
  if (!existsSync(markerPath)) {
    return 0;
  }
  try {
    const data = JSON.parse(readFileSync(markerPath, { encoding: 'utf-8' }));
    return data.attempts || 0;
  } catch {
    // Corrupted file - treat as 0
    return 0;
  }
}

/**
 * WU-1335: Increment recovery attempt count for a WU
 *
 * @param {string} id - WU ID
 * @param {string} [baseDir=process.cwd()] - Base directory for .lumenflow
 * @returns {number} New attempt count
 */
export function incrementRecoveryAttempt(id, baseDir = process.cwd()) {
  const markerPath = getRecoveryMarkerPath(id, baseDir);
  const markerDir = join(baseDir, LUMENFLOW_PATHS.BASE, RECOVERY_MARKER_DIR);

  // Ensure directory exists
  if (!existsSync(markerDir)) {
    mkdirSync(markerDir, { recursive: true });
  }

  const currentCount = getRecoveryAttemptCount(id, baseDir);
  const newCount = currentCount + 1;

  const data = {
    attempts: newCount,
    lastAttempt: new Date().toISOString(),
    wuId: id,
  };

  writeFileSync(markerPath, JSON.stringify(data, null, 2));
  return newCount;
}

/**
 * WU-1335: Clear recovery attempts for a WU (called on successful recovery)
 *
 * @param {string} id - WU ID
 * @param {string} [baseDir=process.cwd()] - Base directory for .lumenflow
 */
export function clearRecoveryAttempts(id, baseDir = process.cwd()) {
  const markerPath = getRecoveryMarkerPath(id, baseDir);
  if (existsSync(markerPath)) {
    unlinkSync(markerPath);
  }
}

/**
 * WU-1335: Check if recovery should escalate to manual intervention
 *
 * @param {number} attempts - Current attempt count
 * @returns {boolean} True if should escalate
 */
export function shouldEscalateToManualIntervention(attempts) {
  return attempts >= MAX_RECOVERY_ATTEMPTS;
}

/**
 * Record initial state for atomic rollback (WU-1303)
 *
 * @param {object} paths - Object containing file paths
 * @param {string} paths.wuPath - Path to WU YAML
 * @param {string} paths.statusPath - Path to status.md
 * @param {string} paths.backlogPath - Path to backlog.md
 * @param {string} paths.stampPath - Path to stamp file
 * @returns {object} Transaction state for rollback
 */
function recordRecoveryState(paths) {
  const { wuPath, statusPath, backlogPath, stampPath } = paths;
  return {
    wuContent: existsSync(wuPath) ? readFileSync(wuPath, { encoding: 'utf-8' }) : null,
    statusContent: existsSync(statusPath) ? readFileSync(statusPath, { encoding: 'utf-8' }) : null,
    backlogContent: existsSync(backlogPath)
      ? readFileSync(backlogPath, { encoding: 'utf-8' })
      : null,
    stampExisted: existsSync(stampPath),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Rollback recovery transaction on failure (WU-1303)
 *
 * @param {object} state - Transaction state from recordRecoveryState
 * @param {object} paths - Object containing file paths
 */
function rollbackRecoveryTransaction(state, paths) {
  const { wuPath, statusPath, backlogPath, stampPath } = paths;

  console.log(`${LOG_PREFIX.DONE} ${EMOJI.WARNING} Rolling back recovery transaction...`);

  // Build list of files to restore
  const filesToRestore = [];

  if (state.wuContent !== null) {
    filesToRestore.push({ name: 'WU YAML', path: wuPath, content: state.wuContent });
  }
  if (state.statusContent !== null) {
    filesToRestore.push({ name: 'status.md', path: statusPath, content: state.statusContent });
  }
  if (state.backlogContent !== null) {
    filesToRestore.push({ name: 'backlog.md', path: backlogPath, content: state.backlogContent });
  }

  // Restore files
  if (filesToRestore.length > 0) {
    const result = rollbackFiles(filesToRestore);
    for (const name of result.restored) {
      console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Restored ${name}`);
    }
    for (const err of result.errors) {
      console.error(
        `${LOG_PREFIX.DONE} ${EMOJI.FAILURE} Failed to restore ${err.name}: ${err.error}`,
      );
    }
  }

  // Remove stamp if it was created during recovery
  if (!state.stampExisted && existsSync(stampPath)) {
    try {
      unlinkSync(stampPath);
      console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Removed stamp file`);
    } catch (err) {
      console.error(`${LOG_PREFIX.DONE} ${EMOJI.FAILURE} Failed to remove stamp: ${err.message}`);
    }
  }

  console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Rollback complete - main checkout is clean`);
}

/**
 * Detect zombie state
 *
 * @param {object} doc - WU YAML document
 * @param {string|null} worktreePath - Path to worktree
 * @returns {boolean} True if zombie state detected
 */
export function detectZombieState(doc, worktreePath) {
  return doc.status === WU_STATUS.DONE && worktreePath && existsSync(worktreePath);
}

/**
 * WU-1440: Reset worktree WU YAML to in_progress for recovery
 *
 * Instead of committing directly to main (old recovery mode), this function
 * resets the worktree YAML so the normal wu:done merge flow can proceed.
 *
 * Removes completion markers:
 * - status → in_progress
 * - locked → removed
 * - completed_at → removed
 *
 * Preserves all other fields (description, acceptance, code_paths, etc.)
 *
 * @param {object} params - Recovery parameters
 * @param {string} params.worktreePath - Path to worktree root
 * @param {string} params.id - WU ID
 * @param {object} params.doc - WU YAML document (will be mutated)
 * @returns {{ reset: boolean }} Reset result
 */
export function resetWorktreeYAMLForRecovery({ worktreePath, id, doc }) {
  const projectRoot = getProjectRoot(import.meta.url);
  const resolvedWorktreeRoot = isAbsolute(worktreePath)
    ? worktreePath
    : join(projectRoot, worktreePath);
  const wtWUPath = join(resolvedWorktreeRoot, WU_PATHS.WU(id));

  // Reset status to in_progress
  doc.status = WU_STATUS.IN_PROGRESS;

  // Remove completion markers (delete from object)
  delete doc.locked;
  delete doc.completed_at;

  // Write updated YAML to worktree
  writeWU(wtWUPath, doc);

  console.log(
    `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Reset worktree YAML to in_progress for recovery`,
  );

  return { reset: true };
}

// Note: updateBacklogMd removed (WU-1163) - now uses shared moveWUToDoneBacklog from wu-backlog-updater.ts

/**
 * Recover from zombie state
 *
 * THE COMPLETE FIX for WU-1159 gap:
 * - Ensures stamp exists
 * - Ensures YAML completion markers
 * - Ensures status.md updated (THE FIX)
 * - Ensures backlog.md updated (THE FIX)
 *
 * All operations are idempotent - safe to run multiple times
 *
 * WU-1303: Added atomic rollback - if any operation fails, all files are
 * restored to their original state to prevent leaving main checkout dirty.
 *
 * @param {object} params - Recovery parameters
 * @param {string} params.id - WU ID
 * @param {object} params.doc - WU YAML document
 * @param {string} params.worktreePath - Path to worktree
 * @param {object} params.args - Command-line args
 * @returns {object} Recovery results
 */
export async function recoverZombieState({ id, doc, _worktreePath, _args }) {
  console.log(`\n${RECOVERY.DETECTED}`);
  console.log(RECOVERY.RESUMING);
  console.log(RECOVERY.EXPLANATION);

  const results: {
    stamp: { created: boolean; path: string; reason?: string } | null;
    yaml: { updated: boolean; reason?: string } | null;
    docs: { status: unknown | null; backlog: unknown | null };
    commit?: { committed: boolean; reason?: string };
  } = {
    stamp: null,
    yaml: null,
    docs: { status: null, backlog: null },
  };

  // WU-1303: Record file state BEFORE any modifications for atomic rollback
  const wuPath = WU_PATHS.WU(id);
  const statusPath = WU_PATHS.STATUS();
  const backlogPath = WU_PATHS.BACKLOG();
  const stampPath = WU_PATHS.STAMP(id);

  const paths = { wuPath, statusPath, backlogPath, stampPath };
  const initialState = recordRecoveryState(paths);

  try {
    // 1. Ensure stamp exists (idempotent)
    console.log(RECOVERY.CREATING_STAMP);
    results.stamp = createStamp({ id, title: doc.title });
    console.log(RECOVERY.STAMP_CREATED);

    // 2. Ensure YAML completion markers (idempotent)
    console.log(RECOVERY.UPDATING_YAML);
    let yamlUpdated = false;
    if (doc.locked !== true) {
      doc.locked = true;
      yamlUpdated = true;
    }
    if (!doc.completed_at && !doc.completed) {
      doc.completed_at = new Date().toISOString();
      yamlUpdated = true;
    }
    if (yamlUpdated) {
      writeWU(wuPath, doc);
      results.yaml = { updated: true };
    } else {
      results.yaml = { updated: false, reason: 'already_complete' };
    }
    console.log(RECOVERY.YAML_UPDATED);

    // 3. **FIX WU-1159 GAP**: Update status.md and backlog.md (idempotent)
    console.log(RECOVERY.UPDATING_DOCS);

    updateStatusRemoveInProgress(statusPath, id);
    addToStatusCompleted(statusPath, id, doc.title);
    results.docs.status = { updated: true };

    await moveWUToDoneBacklog(backlogPath, id, doc.title);
    results.docs.backlog = { updated: true };

    console.log(RECOVERY.DOCS_UPDATED);

    // 4. **FIX WU-1201**: Commit recovery changes to prevent data loss
    // Check if git status is dirty (files were updated)
    const git = getGitForCwd();
    const statusOutput = await git.getStatus();
    if (statusOutput && statusOutput.trim()) {
      console.log(RECOVERY.COMMITTING);

      try {
        await git.add([stampPath, wuPath, statusPath, backlogPath]);
        // WU-1383: Set recovery mode env var to bypass stamp existence check in validate.ts
        // During recovery, stamp and status=done are committed atomically, but pre-commit
        // hooks run mid-commit when both files are staged but validation sees inconsistent state
        process.env.WU_RECOVERY_ID = id;
        try {
          await git.commit(`chore(recovery): complete wu:done metadata for ${id}`);
        } finally {
          // Always clean up env var (WU-1383)
          delete process.env.WU_RECOVERY_ID;
        }
        results.commit = { committed: true };
        console.log(RECOVERY.COMMIT_SUCCESS);
      } catch (commitError) {
        // Commit failed - rollback all changes (WU-1303)
        console.warn(RECOVERY.COMMIT_FAILED(commitError.message));
        rollbackRecoveryTransaction(initialState, paths);

        throw createError(
          ErrorCodes.GIT_ERROR,
          `Recovery commit failed: ${commitError.message}\nFiles rolled back to clean state. Re-run wu:done to retry.`,
          { originalError: commitError.message, wuId: id },
        );
      }
    } else {
      results.commit = { committed: false, reason: 'no_changes' };
    }

    console.log(RECOVERY.MARKERS_VERIFIED);
    console.log(RECOVERY.PROCEEDING_CLEANUP);

    return results;
  } catch (error) {
    // WU-1303: Atomic rollback on ANY failure (not just commit)
    // Re-throw if it's already a structured error (from commit phase)
    if (error.code === ErrorCodes.GIT_ERROR) {
      throw error;
    }

    // Rollback file changes for non-commit errors
    console.error(`${LOG_PREFIX.DONE} ${EMOJI.FAILURE} Recovery failed: ${error.message}`);
    rollbackRecoveryTransaction(initialState, paths);

    throw createError(
      ErrorCodes.RECOVERY_ERROR,
      `Recovery operation failed: ${error.message}\nFiles rolled back to clean state. Re-run wu:done to retry.`,
      { originalError: error.message, wuId: id },
    );
  }
}

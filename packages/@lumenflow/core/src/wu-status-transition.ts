/**
 * WU Status Transition Module
 *
 * Shared logic for block/unblock status transitions.
 * Eliminates 90% code duplication between wu-block.ts and wu-unblock.ts.
 *
 * Responsibilities:
 * - Validate state transitions (via state-machine)
 * - Update WU YAML status and notes
 * - Sync backlog.md and status.md
 * - Handle worktree creation/removal
 *
 * Created: WU-1340 (2025-11-29)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { assertTransition } from './state-machine.js';
// WU-1574: Removed BacklogManager - using state store + generator
import { WUStateStore } from './wu-state-store.js';
import { generateBacklog } from './backlog-generator.js';
import { writeFile } from 'node:fs/promises';
// backlog-parser imports removed (dead code after WU-1574 state store refactor)
import { createError, ErrorCodes } from './error-handler.js';
import { todayISO } from './date-utils.js';
import { getStateStoreDirFromBacklog, WU_PATHS } from './wu-paths.js';
import { readWU, writeWU, appendNote } from './wu-yaml.js';
import { toKebab, REMOTES, BRANCHES, WU_STATUS, STRING_LITERALS } from './wu-constants.js';

/**
 * Direction type for status transitions
 * @typedef {'block' | 'unblock'} TransitionDirection
 */

/**
 * Transition WU status between blocked and in_progress states
 *
 * @param {object} options - Transition options
 * @param {string} options.id - WU ID (e.g., 'WU-100')
 * @param {TransitionDirection} options.direction - Transition direction: 'block' or 'unblock'
 * @param {string} [options.reason] - Reason for transition (optional)
 * @param {string} [options.worktreeOverride] - Custom worktree path (optional)
 * @param {boolean} [options.removeWorktree] - Remove worktree after blocking (default: false)
 * @param {boolean} [options.createWorktree] - Create worktree after unblocking (default: false)
 * @param {object} [options.gitAdapter] - Git adapter for testing (optional, defaults to getGitForCwd())
 * @returns {{id: string, fromStatus: string, toStatus: string}} Transition result
 * @throws {Error} If state transition is invalid or files not found
 *
 * @example
 * // Block a WU
 * transitionWUStatus({
 *   id: 'WU-100',
 *   direction: 'block',
 *   reason: 'Blocked by WU-200',
 *   removeWorktree: true
 * });
 *
 * @example
 * // Unblock a WU
 * transitionWUStatus({
 *   id: 'WU-100',
 *   direction: 'unblock',
 *   reason: 'Blocker resolved',
 *   createWorktree: true
 * });
 */
// WU-1574: Made async for updateBacklogAndStatus
export async function transitionWUStatus({
  id,
  direction,
  reason,
  worktreeOverride,
  removeWorktree = false,
  createWorktree = false,
  gitAdapter,
}) {
  // Validate inputs
  if (!id) {
    throw createError(ErrorCodes.VALIDATION_ERROR, 'WU ID is required');
  }
  if (!direction || !['block', 'unblock'].includes(direction)) {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      `Invalid direction: ${direction}. Must be 'block' or 'unblock'`,
    );
  }

  // Resolve paths
  const paths = {
    wu: WU_PATHS.WU(id),
    status: WU_PATHS.STATUS(),
    backlog: WU_PATHS.BACKLOG(),
  };

  // Validate files exist
  if (!existsSync(paths.wu)) {
    throw createError(ErrorCodes.FILE_NOT_FOUND, `WU file not found: ${paths.wu}`, {
      path: paths.wu,
      id,
    });
  }
  if (!existsSync(paths.backlog)) {
    throw createError(ErrorCodes.FILE_NOT_FOUND, `Missing ${paths.backlog}`, {
      path: paths.backlog,
    });
  }
  if (!existsSync(paths.status)) {
    throw createError(ErrorCodes.FILE_NOT_FOUND, `Missing ${paths.status}`, {
      path: paths.status,
    });
  }

  // Read WU document
  const doc = readWU(paths.wu, id);
  const title = doc.title || '';
  const currentStatus = doc.status || WU_STATUS.IN_PROGRESS;

  // Determine target status
  const toStatus = direction === 'block' ? WU_STATUS.BLOCKED : WU_STATUS.IN_PROGRESS;

  // Validate state transition (may throw if invalid)
  try {
    assertTransition(currentStatus, toStatus, id);
  } catch (error) {
    // If already in target state, make operation idempotent (don't throw)
    if (currentStatus === toStatus) {
      console.warn(
        `[wu-status-transition] WU ${id} already ${toStatus}, skipping transition (idempotent)`,
      );
      return { id, fromStatus: currentStatus, toStatus };
    }
    // Re-throw validation errors
    throw createError(
      ErrorCodes.STATE_ERROR,
      `State transition validation failed: ${error.message}`,
      { id, fromStatus: currentStatus, toStatus, originalError: error.message },
    );
  }

  // Update WU YAML
  doc.status = toStatus;
  const noteLine = createNoteEntry(direction, reason);
  appendNote(doc, noteLine);
  writeWU(paths.wu, doc);

  // Update backlog.md and status.md (WU-1574: now async)
  await updateBacklogAndStatus(paths, id, title, currentStatus, toStatus, direction, reason);

  // Handle worktree operations (only if gitAdapter provided)
  if (gitAdapter) {
    if (direction === 'block' && removeWorktree) {
      handleWorktreeRemoval(doc, worktreeOverride, gitAdapter);
    } else if (direction === 'unblock' && createWorktree) {
      handleWorktreeCreation(doc, worktreeOverride, gitAdapter);
    }
  }

  return {
    id,
    fromStatus: currentStatus,
    toStatus,
  };
}

/**
 * Create note entry for transition
 *
 * @private
 * @param {TransitionDirection} direction - Transition direction
 * @param {string} [reason] - Transition reason
 * @returns {string} Note text
 */
function createNoteEntry(direction, reason) {
  const action = direction === 'block' ? 'Blocked' : 'Unblocked';
  const date = todayISO();
  return reason ? `${action} (${date}): ${reason}` : `${action} (${date})`;
}

/**
 * Update backlog.md and status.md files
 *
 * @private
 * @param {object} paths - File paths
 * @param {string} id - WU ID
 * @param {string} title - WU title
 * @param {string} fromStatus - Current status
 * @param {string} toStatus - Target status
 * @param {TransitionDirection} direction - Transition direction
 * @param {string} [reason] - Transition reason
 */
// WU-1574: Made async for generateBacklog
async function updateBacklogAndStatus(paths, id, title, fromStatus, toStatus, direction, reason) {
  // WU-1574: Section variables removed - backlog is now fully regenerated from state store

  // WU-1574: Regenerate backlog.md from state store (replaces BacklogManager)
  const stateDir = getStateStoreDirFromBacklog(paths.backlog);
  const store = new WUStateStore(stateDir);
  await store.load();
  const content = await generateBacklog(store);
  await writeFile(paths.backlog, content, 'utf-8');

  // Update status.md
  updateStatusFile(paths.status, id, title, direction, reason);
}

/**
 * Update status.md file
 *
 * @private
 * @param {string} statusPath - Path to status.md
 * @param {string} id - WU ID
 * @param {string} title - WU title
 * @param {TransitionDirection} direction - Transition direction
 * @param {string} [reason] - Transition reason
 */
function updateStatusFile(statusPath, id, title, direction, reason) {
  const rel = `wu/${id}.yaml`;
  const lines = readFileSync(statusPath, { encoding: 'utf-8' }).split(/\r?\n/);

  const findHeader = (h) => lines.findIndex((l) => l.trim().toLowerCase() === h.toLowerCase());
  const inProgIdx = findHeader('## in progress');
  const blockedIdx = findHeader('## blocked');

  if (direction === 'block') {
    // Remove from In Progress
    removeFromSection(lines, inProgIdx, rel, id);

    // Add to Blocked
    if (blockedIdx !== -1) {
      const reasonSuffix = reason ? ` — ${reason}` : '';
      const bullet = `- [${id} — ${title}](${rel})${reasonSuffix}`;
      const sectionStart = blockedIdx + 1;

      // Check if already exists (idempotent)
      if (!lines.slice(sectionStart).some((l) => l.includes(rel))) {
        lines.splice(sectionStart, 0, '', bullet);
      }
    }
  } else {
    // Remove from Blocked
    removeFromSection(lines, blockedIdx, rel, id);

    // Add to In Progress
    if (inProgIdx !== -1) {
      const bullet = `- [${id} — ${title}](${rel})`;
      const sectionStart = inProgIdx + 1;

      // Remove "No items" placeholder if present
      let endIdx = lines.slice(sectionStart).findIndex((l) => l.startsWith('## '));
      if (endIdx === -1) endIdx = lines.length - sectionStart;
      else endIdx = sectionStart + endIdx;

      for (let i = sectionStart; i < endIdx; i++) {
        if (lines[i] && lines[i].includes('No items currently in progress')) {
          lines.splice(i, 1);
          endIdx--;
          break;
        }
      }

      // Check if already exists (idempotent)
      if (!lines.slice(sectionStart, endIdx).some((l) => l.includes(rel))) {
        lines.splice(sectionStart, 0, '', bullet);
      }
    }
  }

  writeFileSync(statusPath, lines.join(STRING_LITERALS.NEWLINE), { encoding: 'utf-8' });
}

/**
 * Remove WU entry from section in status.md
 *
 * @private
 * @param {string[]} lines - File lines
 * @param {number} sectionIdx - Section header index
 * @param {string} rel - Relative WU path
 * @param {string} id - WU ID
 */
function removeFromSection(lines, sectionIdx, rel, id) {
  if (sectionIdx === -1) return;

  let i = sectionIdx + 1;
  while (i < lines.length) {
    if (lines[i].startsWith('## ')) break;
    if (lines[i].includes(rel) || lines[i].includes(`[${id}`)) {
      lines.splice(i, 1);
      continue;
    }
    i++;
  }
}

/**
 * Handle worktree removal after blocking
 *
 * @private
 * @param {object} doc - WU document
 * @param {string} [worktreeOverride] - Custom worktree path
 * @param {object} gitAdapter - Git adapter
 */
function handleWorktreeRemoval(doc, worktreeOverride, gitAdapter) {
  const wt = worktreeOverride || defaultWorktreeFrom(doc);

  if (wt && existsSync(wt)) {
    try {
      gitAdapter.removeWorktree(wt);
    } catch (e) {
      console.warn(`[wu-status-transition] Could not remove worktree ${wt}: ${e.message}`);
    }
  } else if (wt) {
    console.warn('[wu-status-transition] Worktree path not found; skipping removal');
  } else {
    console.warn('[wu-status-transition] No worktree path specified; skipping removal');
  }
}

/**
 * Handle worktree creation after unblocking
 *
 * @private
 * @param {object} doc - WU document
 * @param {string} [worktreeOverride] - Custom worktree path
 * @param {object} gitAdapter - Git adapter
 */
function handleWorktreeCreation(doc, worktreeOverride, gitAdapter) {
  const worktreePath = worktreeOverride || defaultWorktreeFrom(doc);
  const branchName = defaultBranchFrom(doc);

  if (!branchName) {
    console.warn('[wu-status-transition] Cannot derive branch name; skipping worktree creation');
    return;
  }

  if (!worktreePath) {
    console.warn('[wu-status-transition] Worktree path required; skipping creation');
    return;
  }

  if (existsSync(worktreePath)) {
    console.warn(
      `[wu-status-transition] Worktree ${worktreePath} already exists; skipping creation`,
    );
    return;
  }

  gitAdapter.run(`git fetch ${REMOTES.ORIGIN} ${BRANCHES.MAIN}`);

  if (branchExists(branchName, gitAdapter)) {
    gitAdapter.run(
      `git worktree add ${JSON.stringify(worktreePath)} ${JSON.stringify(branchName)}`,
    );
  } else {
    gitAdapter.run(
      `git worktree add ${JSON.stringify(worktreePath)} -b ${JSON.stringify(branchName)} ${REMOTES.ORIGIN}/${BRANCHES.MAIN}`,
    );
  }
}

/**
 * Derive default worktree path from WU document
 *
 * @private
 * @param {object} doc - WU document
 * @returns {string | null} Worktree path
 */
function defaultWorktreeFrom(doc) {
  const lane = (doc.lane || '').toString();
  const laneK = lane
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const idK = (doc.id || '').toLowerCase();
  if (!laneK || !idK) return null;
  return `worktrees/${laneK}-${idK}`;
}

/**
 * Derive default branch name from WU document
 *
 * @private
 * @param {object} doc - WU document
 * @returns {string | null} Branch name
 */
function defaultBranchFrom(doc) {
  const lane = (doc.lane || '').toString();
  const laneK = toKebab(lane);
  const idK = (doc.id || '').toLowerCase();
  if (!laneK || !idK) return null;
  return `lane/${laneK}/${idK}`;
}

/**
 * Check if git branch exists
 *
 * @private
 * @param {string} branch - Branch name
 * @param {object} gitAdapter - Git adapter
 * @returns {boolean} True if branch exists
 */
function branchExists(branch, gitAdapter) {
  try {
    gitAdapter.run(`git rev-parse --verify ${JSON.stringify(branch)}`);
    return true;
  } catch {
    return false;
  }
}

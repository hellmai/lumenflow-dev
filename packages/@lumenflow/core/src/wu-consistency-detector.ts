// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Consistency Detector (WU-2015)
 *
 * Error detection logic for WU state inconsistencies.
 * Detects five types of inconsistencies without performing any repairs.
 *
 * Extracted from wu-consistency-checker.ts to isolate detection from
 * repair orchestration and file manipulation.
 *
 * @see {@link ./wu-inconsistency-repairer.ts} Repair orchestration
 * @see {@link ./wu-consistency-file-repairs.ts} File-level repairs
 */

import { readFile, readdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { parseYAML } from './wu-yaml.js';
import { createWuPaths } from './wu-paths.js';
import { CONSISTENCY_TYPES, CONSISTENCY_MESSAGES, WU_STATUS } from './wu-constants.js';
import { createGitForPath } from './git-adapter.js';
import { listTrackedWUStampIds } from './stamp-tracking.js';

/**
 * Options for checking a single WU's consistency
 */
export interface CheckWUConsistencyOptions {
  trackedStampIds?: Set<string> | null;
  activeWorktreeIds?: Set<string> | null;
}

/**
 * Error object structure from checkWUConsistency()
 */
export interface ConsistencyError {
  type: string;
  wuId: string;
  title?: string;
  lane?: string;
  description?: string;
  repairAction?: string;
  canAutoRepair: boolean;
}

/**
 * Check a single WU for state inconsistencies
 *
 * @param {string} id - WU ID (e.g., 'WU-123')
 * @param {string} [projectRoot=process.cwd()] - Project root directory
 * @param {CheckWUConsistencyOptions} [options] - Optional precomputed context
 * @returns {Promise<object>} Consistency report with valid, errors, and stats
 */
export async function checkWUConsistency(
  id: string,
  projectRoot = process.cwd(),
  options: CheckWUConsistencyOptions = {},
) {
  const errors: ConsistencyError[] = [];
  const paths = createWuPaths({ projectRoot });
  const wuPath = path.join(projectRoot, paths.WU(id));
  const stampPath = path.join(projectRoot, paths.STAMP(id));
  const backlogPath = path.join(projectRoot, paths.BACKLOG());
  const statusPath = path.join(projectRoot, paths.STATUS());

  // Handle missing WU YAML gracefully
  try {
    await access(wuPath, constants.R_OK);
  } catch {
    return { valid: true, errors: [], stats: { wuExists: false } };
  }

  const wuContent = await readFile(wuPath, { encoding: 'utf-8' });
  const wuDoc = parseYAML(wuContent) as {
    status?: string;
    lane?: string;
    title?: string;
    worktree_path?: string;
  } | null;
  const yamlStatus = wuDoc?.status || 'unknown';
  const lane = wuDoc?.lane || '';
  const title = wuDoc?.title || '';
  const worktreePathFromYaml = wuDoc?.worktree_path || '';

  // Check stamp existence (guard against untracked local stamp artifacts)
  let hasStampFile: boolean;
  try {
    await access(stampPath, constants.R_OK);
    hasStampFile = true;
  } catch {
    hasStampFile = false;
  }
  const trackedStampIds =
    options.trackedStampIds ??
    (await listTrackedWUStampIds({ projectRoot, stampsDir: paths.STAMPS_DIR() }));
  const hasStamp = hasStampFile && (trackedStampIds === null || trackedStampIds.has(id));

  // Parse backlog sections
  let backlogContent: string;
  try {
    backlogContent = await readFile(backlogPath, { encoding: 'utf-8' });
  } catch {
    backlogContent = '';
  }
  const { inDone: backlogInDone, inProgress: backlogInProgress } = parseBacklogSections(
    backlogContent,
    id,
  );

  // Parse status.md sections
  let statusContent: string;
  try {
    statusContent = await readFile(statusPath, { encoding: 'utf-8' });
  } catch {
    statusContent = '';
  }
  const { inProgress: statusInProgress } = parseStatusSections(statusContent, id);

  // Check for worktree
  const normalizedId = id.toUpperCase();
  const hasWorktree =
    options.activeWorktreeIds !== undefined
      ? options.activeWorktreeIds !== null && options.activeWorktreeIds.has(normalizedId)
      : await checkWorktreeExists(id, projectRoot);
  const worktreePathExists = await checkWorktreePathExists(worktreePathFromYaml);

  // Detection logic

  // 1. YAML done but in status.md In Progress
  if (yamlStatus === WU_STATUS.DONE && statusInProgress) {
    errors.push({
      type: CONSISTENCY_TYPES.YAML_DONE_STATUS_IN_PROGRESS,
      wuId: id,
      description: `WU ${id} has status '${WU_STATUS.DONE}' in YAML but still appears in status.md In Progress section`,
      repairAction: 'Remove from status.md In Progress section',
      canAutoRepair: true,
    });
  }

  // 2. Backlog dual section (Done AND In Progress)
  if (backlogInDone && backlogInProgress) {
    errors.push({
      type: CONSISTENCY_TYPES.BACKLOG_DUAL_SECTION,
      wuId: id,
      description: `WU ${id} appears in both Done and In Progress sections of backlog.md`,
      repairAction: 'Remove from In Progress section (Done wins)',
      canAutoRepair: true,
    });
  }

  // 3. YAML done but no stamp
  if (yamlStatus === WU_STATUS.DONE && !hasStamp) {
    errors.push({
      type: CONSISTENCY_TYPES.YAML_DONE_NO_STAMP,
      wuId: id,
      title,
      description: `WU ${id} has status '${WU_STATUS.DONE}' but no stamp file exists`,
      repairAction: 'Create stamp file',
      canAutoRepair: true,
    });
  }

  // 4. Orphan worktree for done WU
  if (yamlStatus === WU_STATUS.DONE && hasWorktree) {
    errors.push({
      type: CONSISTENCY_TYPES.ORPHAN_WORKTREE_DONE,
      wuId: id,
      lane,
      description: `WU ${id} has status '${WU_STATUS.DONE}' but still has an associated worktree`,
      repairAction: 'Remove orphan worktree and lane branch',
      canAutoRepair: true,
    });
  }

  // 5. Stamp exists but YAML not done (inverse of YAML_DONE_NO_STAMP)
  // This catches partial wu:done failures where stamp was created but YAML update failed
  if (hasStamp && yamlStatus !== WU_STATUS.DONE) {
    errors.push({
      type: CONSISTENCY_TYPES.STAMP_EXISTS_YAML_NOT_DONE,
      wuId: id,
      title,
      description: `WU ${id} has stamp file but YAML status is '${yamlStatus}' (not done)`,
      repairAction: 'Update YAML to done+locked+completed',
      canAutoRepair: true,
    });
  }

  // 6. Claimed WU missing worktree directory
  if (
    worktreePathFromYaml &&
    !worktreePathExists &&
    (yamlStatus === WU_STATUS.IN_PROGRESS || yamlStatus === WU_STATUS.BLOCKED)
  ) {
    errors.push({
      type: CONSISTENCY_TYPES.MISSING_WORKTREE_CLAIMED,
      wuId: id,
      title,
      description: CONSISTENCY_MESSAGES.MISSING_WORKTREE_CLAIMED(
        id,
        yamlStatus,
        worktreePathFromYaml,
      ),
      repairAction: CONSISTENCY_MESSAGES.MISSING_WORKTREE_CLAIMED_REPAIR,
      canAutoRepair: false,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      yamlStatus,
      hasStamp,
      backlogInDone,
      backlogInProgress,
      statusInProgress,
      hasWorktree,
      worktreePathExists,
    },
  };
}

/**
 * Check all WUs for consistency
 *
 * @param {string} [projectRoot=process.cwd()] - Project root directory
 * @returns {Promise<object>} Aggregated report with valid, errors, and checked count
 */
export async function checkAllWUConsistency(projectRoot = process.cwd()) {
  const paths = createWuPaths({ projectRoot });
  const wuDir = path.join(projectRoot, paths.WU_DIR());
  try {
    await access(wuDir, constants.R_OK);
  } catch {
    return { valid: true, errors: [], checked: 0 };
  }

  const allErrors: ConsistencyError[] = [];
  const wuFiles = (await readdir(wuDir)).filter((f) => /^WU-\d+\.yaml$/.test(f));
  const trackedStampIds = await listTrackedWUStampIds({
    projectRoot,
    stampsDir: paths.STAMPS_DIR(),
  });
  const activeWorktreeIds = await listActiveWorktreeIds(projectRoot);

  for (const file of wuFiles) {
    const id = file.replace('.yaml', '');
    const report = await checkWUConsistency(id, projectRoot, {
      trackedStampIds,
      activeWorktreeIds,
    });
    allErrors.push(...report.errors);
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    checked: wuFiles.length,
  };
}

/**
 * Check lane for orphan done WUs (pre-flight for wu:claim)
 *
 * @param {string} lane - Lane name to check
 * @param {string} excludeId - WU ID to exclude from check (the one being claimed)
 * @param {string} [projectRoot=process.cwd()] - Project root directory
 * @returns {Promise<object>} Result with valid, orphans list, and reports
 */
export async function checkLaneForOrphanDoneWU(
  lane: string,
  excludeId: string,
  projectRoot = process.cwd(),
) {
  const paths = createWuPaths({ projectRoot });
  const wuDir = path.join(projectRoot, paths.WU_DIR());
  const trackedStampIds = await listTrackedWUStampIds({
    projectRoot,
    stampsDir: paths.STAMPS_DIR(),
  });
  try {
    await access(wuDir, constants.R_OK);
  } catch {
    return { valid: true, orphans: [] };
  }

  const orphans: Array<{ id: string; errors: ConsistencyError[] }> = [];
  const wuFiles = (await readdir(wuDir)).filter((f) => /^WU-\d+\.yaml$/.test(f));

  for (const file of wuFiles) {
    const id = file.replace('.yaml', '');
    if (id === excludeId) continue;

    const wuPath = path.join(wuDir, file);
    let wuContent;
    try {
      wuContent = await readFile(wuPath, { encoding: 'utf-8' });
    } catch {
      // Skip unreadable files
      continue;
    }

    let wuDoc;
    try {
      wuDoc = parseYAML(wuContent);
    } catch {
      // Skip malformed YAML files - they're a separate issue
      continue;
    }

    if (wuDoc?.lane === lane && wuDoc?.status === WU_STATUS.DONE) {
      const report = await checkWUConsistency(id, projectRoot, { trackedStampIds });
      if (!report.valid) {
        orphans.push({ id, errors: report.errors });
      }
    }
  }

  return {
    valid: orphans.length === 0,
    orphans: orphans.map((o) => o.id),
    reports: orphans,
  };
}

// Internal helpers

/**
 * Parse backlog.md to find which sections contain a WU ID
 *
 * @param {string} content - Backlog file content
 * @param {string} id - WU ID to search for
 * @returns {object} Object with inDone and inProgress booleans
 */
function parseBacklogSections(content: string, id: string) {
  const lines = content.split(/\r?\n/);
  let inDone = false;
  let inProgress = false;
  let currentSection = null;
  // Match exact WU YAML filename to prevent substring false positives
  // e.g., WU-208 should not match lines containing WU-2087
  const exactPattern = `(wu/${id}.yaml)`;

  for (const line of lines) {
    if (line.trim() === '## ✅ Done') {
      currentSection = WU_STATUS.DONE;
      continue;
    }
    if (line.trim() === '## 🔧 In progress') {
      currentSection = WU_STATUS.IN_PROGRESS;
      continue;
    }
    if (line.trim().startsWith('## ')) {
      currentSection = null;
      continue;
    }

    if (line.includes(exactPattern)) {
      if (currentSection === WU_STATUS.DONE) inDone = true;
      if (currentSection === WU_STATUS.IN_PROGRESS) inProgress = true;
    }
  }

  return { inDone, inProgress };
}

/**
 * Parse status.md to find if WU is in In Progress section
 *
 * @param {string} content - Status file content
 * @param {string} id - WU ID to search for
 * @returns {object} Object with inProgress boolean
 */
function parseStatusSections(content: string, id: string) {
  const lines = content.split(/\r?\n/);
  let inProgress = false;
  let currentSection = null;
  // Match exact WU YAML filename to prevent substring false positives
  // e.g., WU-208 should not match lines containing WU-2087
  const exactPattern = `(wu/${id}.yaml)`;

  for (const line of lines) {
    if (line.trim() === '## In Progress') {
      currentSection = WU_STATUS.IN_PROGRESS;
      continue;
    }
    if (line.trim().startsWith('## ')) {
      currentSection = null;
      continue;
    }

    if (currentSection === WU_STATUS.IN_PROGRESS && line.includes(exactPattern)) {
      inProgress = true;
    }
  }

  return { inProgress };
}

/**
 * Check if a worktree exists for a given WU ID
 *
 * Uses word-boundary matching to avoid false positives where one WU ID
 * is a prefix of another (e.g., WU-204 should not match wu-2049).
 *
 * @param {string} id - WU ID
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<boolean>} True if worktree exists
 */
async function checkWorktreeExists(id: string, projectRoot: string) {
  try {
    const git = createGitForPath(projectRoot);
    const output = await git.worktreeList();
    // Match WU ID followed by non-digit or end of string to prevent
    // false positives (e.g., wu-204 matching wu-2049)
    // eslint-disable-next-line security/detect-non-literal-regexp -- WU ID from internal state, not user input
    const pattern = new RegExp(`${id.toLowerCase()}(?![0-9])`, 'i');
    return pattern.test(output);
  } catch {
    return false;
  }
}

/**
 * Precompute active WU IDs from git worktree list.
 *
 * Returns:
 * - Set of normalized WU IDs (e.g. WU-1234) when query succeeds
 * - null when git worktree listing is unavailable (caller should fall back)
 */
export async function listActiveWorktreeIds(projectRoot: string): Promise<Set<string> | null> {
  try {
    const git = createGitForPath(projectRoot);
    const output = await git.worktreeList();
    const matches = output.match(/\bwu-\d+\b/gi) ?? [];
    const ids = new Set<string>();
    for (const match of matches) {
      ids.add(match.toUpperCase());
    }
    return ids;
  } catch {
    return null;
  }
}

/**
 * Check whether a worktree path exists on disk
 *
 * @param {string} worktreePath - Worktree path from WU YAML
 * @returns {Promise<boolean>} True if path exists
 */
async function checkWorktreePathExists(worktreePath: string): Promise<boolean> {
  if (!worktreePath) {
    return false;
  }
  try {
    await access(worktreePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

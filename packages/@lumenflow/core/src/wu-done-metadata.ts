/**
 * Metadata update helpers for wu:done.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';

import { getGitForCwd } from './git-adapter.js';
import { updateStatusRemoveInProgress, addToStatusCompleted } from './wu-status-updater.js';
import { moveWUToDoneBacklog } from './wu-backlog-updater.js';
import { createStamp } from './stamp-utils.js';
import { WU_EVENTS_FILE_NAME } from './wu-state-store.js';
import {
  computeWUYAMLContent,
  computeStatusContentFromMergedState,
  computeBacklogContent,
  computeWUEventsContentAfterComplete,
  computeStampContent,
} from './wu-transaction-collectors.js';
import { computeInitiativeSyncWriteOnWUComplete } from './wu-done-initiative-sync.js';
import {
  DEFAULTS,
  LOG_PREFIX,
  EMOJI,
  PKG_MANAGER,
  SCRIPTS,
  PRETTIER_FLAGS,
  LUMENFLOW_PATHS,
  WU_STATUS,
} from './wu-constants.js';
import { applyExposureDefaults } from './wu-done-validation.js';
import { createFileNotFoundError, createValidationError } from './wu-done-errors.js';
import { writeWU } from './wu-yaml.js';
import { normalizeToDateString } from './date-utils.js';
import { findProjectRoot } from './lumenflow-config.js';

const execAsync = promisify(execCallback);

interface CommitProvenance {
  branch?: string;
  worktreePath?: string;
}

/**
 * Generate commit message for WU completion
 * Extracted from wu-done.ts (WU-1215 Phase 2 Extraction #1 Helper)
 * @param {string} id - WU ID (e.g., "WU-1215")
 * @param {string} title - WU title
 * @param {number} maxLength - Maximum commit header length from commitlint config
 * @returns {string} Formatted commit message
 * @throws {Error} If generated message exceeds maxLength
 */
export function generateCommitMessage(
  id,
  title,
  maxLength = DEFAULTS.MAX_COMMIT_SUBJECT,
  provenance: CommitProvenance = {},
) {
  const prefix = `wu(${id.toLowerCase()}): done - `;
  const safe = String(title).trim().toLowerCase().replace(/\s+/g, ' ');
  const room = Math.max(0, maxLength - prefix.length);
  const short = safe.length > room ? `${safe.slice(0, room - 1)}…` : safe;
  const msg = `${prefix}${short}`;

  if (msg.length > maxLength) {
    const error: Error & { code?: string; data?: Record<string, unknown> } = new Error(
      `Commit message too long (${msg.length}/${maxLength}).\n` +
        `Fix: Shorten WU title\n` +
        `Current title: "${title}" (${title.length} chars)\n` +
        `Suggested max: ~${maxLength - prefix.length} chars`,
    );
    error.code = 'COMMIT_MESSAGE_TOO_LONG';
    error.data = {
      title,
      titleLength: title.length,
      messageLength: msg.length,
      maxLength,
      suggestedMax: maxLength - prefix.length,
    };
    throw error;
  }

  const trailers: string[] = [];
  if (provenance.branch) {
    trailers.push(`Worktree-Branch: ${provenance.branch}`);
  }
  if (provenance.worktreePath) {
    trailers.push(`Worktree-Path: ${provenance.worktreePath}`);
  }

  if (trailers.length === 0) {
    return msg;
  }

  return `${msg}\n\n${trailers.join('\n')}`;
}

/**
 * Validate that required metadata files exist before updating
 * WU-1275: Fail fast before mutations to prevent partial state
 *
 * @param {object} params - Parameters object
 * @param {string} params.statusPath - Path to status.md file
 * @param {string} params.backlogPath - Path to backlog.md file
 * @throws {WUError} If any required file is missing
 */
export function validateMetadataFilesExist({ statusPath, backlogPath }) {
  const missing = [];

  if (!existsSync(statusPath)) {
    missing.push(`Status: ${statusPath}`);
  }

  if (!existsSync(backlogPath)) {
    missing.push(`Backlog: ${backlogPath}`);
  }

  if (missing.length > 0) {
    throw createFileNotFoundError(
      `Required metadata files missing:\n  ${missing.join('\n  ')}\n\nCannot complete WU - verify worktree has latest metadata files.`,
      { missingFiles: missing },
    );
  }
}

/**
 * Update all metadata files for WU completion
 * Extracted from wu-done.ts (WU-1215 Phase 2 Extraction #1 Helper)
 * WU-1572: Made async for WUStateStore integration
 * @param {object} params - Parameters object
 * @param {string} params.id - WU ID
 * @param {string} params.title - WU title
 * @param {object} params.doc - WU YAML document to update
 * @param {string} params.wuPath - Path to WU YAML file
 * @param {string} params.statusPath - Path to status.md file
 * @param {string} params.backlogPath - Path to backlog.md file
 */
export async function updateMetadataFiles({ id, title, doc, wuPath, statusPath, backlogPath }) {
  // WU-1275: Fail fast before any mutations
  validateMetadataFilesExist({ statusPath, backlogPath });

  const exposureUpdate = applyExposureDefaults(doc);
  if (exposureUpdate.applied) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.INFO} Auto-set exposure to ${exposureUpdate.exposure} for ${id}`,
    );
  }

  // Update WU YAML (mark as done, lock, set completion timestamp)
  doc.status = WU_STATUS.DONE;
  doc.locked = true;
  doc.completed_at = new Date().toISOString();
  doc.completed =
    normalizeToDateString(doc.completed ?? doc.completed_at) ?? doc.completed_at.slice(0, 10);
  writeWU(wuPath, doc);

  // Update status.md (remove from In Progress, add to Completed)
  updateStatusRemoveInProgress(statusPath, id);
  addToStatusCompleted(statusPath, id, title);

  // Update backlog.md (move to Done section)
  // WU-1572: Now async for state store integration
  await moveWUToDoneBacklog(backlogPath, id, title);

  // Create completion stamp
  createStamp({ id, title });
}

/**
 * Collect metadata updates to a transaction (WU-1369: Atomic pattern)
 *
 * This is the atomic version of updateMetadataFiles.
 * Instead of writing files immediately, it collects all changes
 * into a WUTransaction object for atomic commit.
 *
 * Usage:
 * ```js
 * const tx = new WUTransaction(id);
 * collectMetadataToTransaction({ id, title, doc, wuPath, statusPath, backlogPath, stampPath, transaction: tx });
 * // All changes are now in tx.pendingWrites
 * // Validate, then commit or abort
 * tx.commit();
 * ```
 *
 * @param {object} params - Parameters object
 * @param {string} params.id - WU ID
 * @param {string} params.title - WU title
 * @param {object} params.doc - WU YAML document to update (will be mutated)
 * @param {string} params.wuPath - Path to WU YAML file
 * @param {string} params.statusPath - Path to status.md file
 * @param {string} params.backlogPath - Path to backlog.md file
 * @param {string} params.stampPath - Path to stamp file
 * @param {WUTransaction} params.transaction - Transaction to add writes to
 * @param {string} [params.projectRoot] - Repository root for config/path resolution
 */
// WU-1574: Made async for computeBacklogContent
export async function collectMetadataToTransaction({
  id,
  title,
  doc,
  wuPath,
  statusPath,
  backlogPath,
  stampPath,
  transaction,
  projectRoot = null,
}) {
  // WU-1369: Fail fast before any computations
  validateMetadataFilesExist({ statusPath, backlogPath });

  const exposureUpdate = applyExposureDefaults(doc);
  if (exposureUpdate.applied) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.INFO} Auto-set exposure to ${exposureUpdate.exposure} for ${id}`,
    );
  }

  // Compute WU YAML content (mutates doc, returns YAML string)
  const wuYAMLContent = computeWUYAMLContent(doc);
  transaction.addWrite(wuPath, wuYAMLContent, 'WU YAML');

  // Compute status.md content (WU-1319: now uses merged state)
  const statusContent = await computeStatusContentFromMergedState(backlogPath, id);
  transaction.addWrite(statusPath, statusContent, 'status.md');

  // Compute backlog.md content (WU-1574: now async)
  const backlogContent = await computeBacklogContent(backlogPath, id, title);
  transaction.addWrite(backlogPath, backlogContent, 'backlog.md');

  const wuEventsUpdate = await computeWUEventsContentAfterComplete(backlogPath, id);
  if (wuEventsUpdate) {
    transaction.addWrite(wuEventsUpdate.eventsPath, wuEventsUpdate.content, 'wu-events.jsonl');
  }

  const resolvedProjectRoot = projectRoot ?? findProjectRoot(path.dirname(backlogPath));
  const initiativeSyncWrite = computeInitiativeSyncWriteOnWUComplete({
    wuId: id,
    wuDoc: doc,
    projectRoot: resolvedProjectRoot,
  });
  if (initiativeSyncWrite) {
    transaction.addWrite(
      initiativeSyncWrite.initiativePath,
      initiativeSyncWrite.content,
      'initiative YAML',
    );
  }

  // Compute stamp content
  const stampContent = computeStampContent(id, title);
  transaction.addWrite(stampPath, stampContent, 'completion stamp');

  console.log(
    `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Collected ${transaction.size} metadata updates for atomic commit`,
  );
}

/**
 * Stage and format metadata files
 * Extracted from wu-done.ts (WU-1215 Phase 2 Extraction #1 Helper)
 * WU-1541: Added optional gitAdapter and repoRoot params to avoid process.chdir dependency
 * @param {object} params - Parameters object
 * @param {string} params.id - WU ID (for error reporting)
 * @param {string} params.wuPath - Path to WU YAML file
 * @param {string} params.statusPath - Path to status.md file
 * @param {string} params.backlogPath - Path to backlog.md file
 * @param {string} params.stampsDir - Path to stamps directory
 * @param {string} [params.initiativePath] - Optional parent initiative YAML path
 * @param {object} [params.gitAdapter] - Git adapter instance (WU-1541: explicit instead of getGitForCwd)
 * @param {string} [params.repoRoot] - Absolute repo root path for resolving relative paths
 * @throws {Error} If formatting fails
 */
export async function stageAndFormatMetadata({
  id,
  wuPath,
  statusPath,
  backlogPath,
  stampsDir,
  initiativePath = null,
  gitAdapter = null,
  repoRoot = null,
}) {
  // WU-1541: Use explicit gitAdapter if provided, otherwise fall back to getGitForCwd()
  // This eliminates the dependency on process.chdir() having been called beforehand
  const gitCwd = gitAdapter ?? getGitForCwd();

  // WU-1541: Use repoRoot for absolute path resolution if provided,
  // otherwise fall back to relative path (legacy behavior for callers that still use chdir)
  const wuEventsPath = repoRoot
    ? path.join(repoRoot, LUMENFLOW_PATHS.STATE_DIR, WU_EVENTS_FILE_NAME)
    : path.join(LUMENFLOW_PATHS.STATE_DIR, WU_EVENTS_FILE_NAME);
  const filesToStage = [wuPath, statusPath, backlogPath];
  if (initiativePath) {
    filesToStage.push(initiativePath);
  }
  if (existsSync(wuEventsPath)) {
    filesToStage.push(wuEventsPath);
  }
  await gitCwd.add(filesToStage);
  // WU-1653: Force-add stamps to override .gitignore (stamps must always be tracked)
  await gitCwd.raw(['add', '--force', stampsDir]);

  // Format documentation
  console.log(`${LOG_PREFIX.DONE} Formatting auto-generated documentation...`);
  try {
    const filesToFormat = [wuPath, statusPath, backlogPath];
    if (initiativePath) {
      filesToFormat.push(initiativePath);
    }
    const prettierTargets = filesToFormat.map((file) => `"${file}"`).join(' ');
    const prettierCmd = `${PKG_MANAGER} ${SCRIPTS.PRETTIER} ${PRETTIER_FLAGS.WRITE} ${prettierTargets}`;
    await execAsync(prettierCmd);
    await gitCwd.add(filesToFormat);
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Documentation formatted`);
  } catch (err) {
    throw createValidationError(`Failed to format documentation: ${err.message}`, {
      wuId: id,
      error: err.message,
    });
  }
}

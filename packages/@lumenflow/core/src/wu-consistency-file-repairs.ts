// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Consistency File Repairs (WU-2015)
 *
 * File-level stamp/YAML/markdown repair operations for WU state inconsistencies.
 * All file modifications are designed to work inside a micro-worktree context.
 *
 * Extracted from wu-consistency-checker.ts to isolate file manipulation logic
 * from detection and orchestration concerns.
 *
 * @see {@link ./wu-consistency-detector.ts} Detection logic
 * @see {@link ./wu-inconsistency-repairer.ts} Repair orchestration
 */

import path from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { parseYAML, stringifyYAML } from './wu-yaml.js';
import { createWuPaths } from './wu-paths.js';
import {
  LUMENFLOW_PATHS,
  REMOTES,
  STRING_LITERALS,
  toKebab,
  WU_STATUS,
  YAML_OPTIONS,
} from './wu-constants.js';
import { WU_EVENT_TYPE } from './wu-state-schema.js';
import { todayISO, normalizeToDateString } from './date-utils.js';
import { createGitForPath } from './git-adapter.js';

/**
 * Result type for consistency repair operations.
 *
 * This is distinct from wu-state-store RepairResult (line-based corruption repair).
 * WU consistency repairs are file-oriented and may be skipped intentionally.
 */
export interface WUConsistencyRepairResult {
  success?: boolean;
  skipped?: boolean;
  reason?: string;
  files?: string[];
}

// Backward-compatible alias for existing imports from this module.
export type RepairResult = WUConsistencyRepairResult;

/**
 * Create stamp file inside a micro-worktree (WU-1078)
 *
 * @param {string} id - WU ID
 * @param {string} title - WU title
 * @param {string} worktreePath - Path to the micro-worktree
 * @returns {Promise<string[]>} List of files created (relative paths)
 */
export async function createStampInWorktree(
  id: string,
  title: string,
  worktreePath: string,
  projectRoot: string,
): Promise<string[]> {
  const paths = createWuPaths({ projectRoot });
  const stampsDir = path.join(worktreePath, paths.STAMPS_DIR());
  const stampRelPath = paths.STAMP(id);
  const stampAbsPath = path.join(worktreePath, stampRelPath);

  // Ensure stamps directory exists
  if (!existsSync(stampsDir)) {
    mkdirSync(stampsDir, { recursive: true });
  }

  // Don't overwrite existing stamp
  if (existsSync(stampAbsPath)) {
    return []; // Stamp already exists
  }

  // Create stamp file
  const body = `WU ${id} — ${title}\nCompleted: ${todayISO()}\n`;
  writeFileSync(stampAbsPath, body, { encoding: 'utf-8' });

  return [stampRelPath];
}

/**
 * Update WU YAML to done+locked+completed state inside a micro-worktree (WU-1078)
 *
 * Repairs STAMP_EXISTS_YAML_NOT_DONE by setting:
 * - status: done
 * - locked: true
 * - completed: YYYY-MM-DD (today, unless already set)
 *
 * @param {string} id - WU ID
 * @param {string} worktreePath - Path to the micro-worktree
 * @param {string} projectRoot - Original project root (for reading source file)
 * @returns {Promise<string[]>} List of files modified (relative paths)
 */
export async function updateYamlToDoneInWorktree(
  id: string,
  worktreePath: string,
  projectRoot: string,
): Promise<string[]> {
  const paths = createWuPaths({ projectRoot });
  const wuRelPath = paths.WU(id);
  const wuSrcPath = path.join(projectRoot, wuRelPath);
  const wuDestPath = path.join(worktreePath, wuRelPath);
  const wuReadPath = existsSync(wuDestPath) ? wuDestPath : wuSrcPath;

  // Read current YAML (prefer destination copy if already modified in this batch)
  const content = readFileSync(wuReadPath, { encoding: 'utf-8' });
  const wuDoc = parseYAML(content) as {
    status?: string;
    locked?: boolean;
    completed?: string;
    completed_at?: string | Date;
    lane?: string;
    title?: string;
  } | null;

  if (!wuDoc) {
    throw new Error(`Failed to parse WU YAML: ${wuReadPath}`);
  }

  // Update fields
  wuDoc.status = WU_STATUS.DONE;
  wuDoc.locked = true;
  const existingCompletedAt = wuDoc.completed_at;
  const completionTimestamp =
    typeof existingCompletedAt === 'string'
      ? existingCompletedAt
      : existingCompletedAt instanceof Date
        ? existingCompletedAt.toISOString()
        : new Date().toISOString();
  wuDoc.completed_at = completionTimestamp;

  // Keep legacy completed date in sync with completed_at for compatibility.
  wuDoc.completed =
    normalizeToDateString(wuDoc.completed ?? completionTimestamp) ??
    completionTimestamp.slice(0, 10);

  // Ensure directory exists in worktree
  const wuDir = path.dirname(wuDestPath);
  if (!existsSync(wuDir)) {
    mkdirSync(wuDir, { recursive: true });
  }

  // Write updated YAML to worktree
  const updatedContent = stringifyYAML(wuDoc, { lineWidth: YAML_OPTIONS.LINE_WIDTH });
  writeFileSync(wuDestPath, updatedContent, { encoding: 'utf-8' });

  const eventFiles = appendReconciliationEventsInWorktree({
    id,
    lane: wuDoc.lane,
    title: wuDoc.title,
    projectRoot,
    worktreePath,
  });

  return [wuRelPath, ...eventFiles];
}

/**
 * Derive WU status from event log entries
 */
export function deriveStatusFromEvents(eventsContent: string, wuId: string): string | undefined {
  let status: string | undefined;
  const lines = eventsContent.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as { wuId?: string; type?: string };
      if (event.wuId !== wuId || !event.type) continue;

      switch (event.type) {
        case WU_EVENT_TYPE.CLAIM:
        case WU_EVENT_TYPE.CREATE:
          status = WU_STATUS.IN_PROGRESS;
          break;
        case WU_EVENT_TYPE.RELEASE:
          status = WU_STATUS.READY;
          break;
        case WU_EVENT_TYPE.COMPLETE:
          status = WU_STATUS.DONE;
          break;
        case WU_EVENT_TYPE.BLOCK:
          status = WU_STATUS.BLOCKED;
          break;
        case WU_EVENT_TYPE.UNBLOCK:
          status = WU_STATUS.IN_PROGRESS;
          break;
      }
    } catch {
      // Ignore malformed lines; preserve file as-is and append corrective events.
    }
  }

  return status;
}

/**
 * Append reconciliation events (claim + complete) to the event store
 * inside a micro-worktree
 */
export function appendReconciliationEventsInWorktree({
  id,
  lane,
  title,
  projectRoot,
  worktreePath,
}: {
  id: string;
  lane?: string;
  title?: string;
  projectRoot: string;
  worktreePath: string;
}): string[] {
  const eventsRelPath = LUMENFLOW_PATHS.WU_EVENTS;
  const eventsSrcPath = path.join(projectRoot, eventsRelPath);
  const eventsDestPath = path.join(worktreePath, eventsRelPath);
  const eventsReadPath = existsSync(eventsDestPath) ? eventsDestPath : eventsSrcPath;
  const existingContent = existsSync(eventsReadPath)
    ? readFileSync(eventsReadPath, { encoding: 'utf-8' })
    : '';
  const derivedStatus = deriveStatusFromEvents(existingContent, id);

  if (derivedStatus === WU_STATUS.DONE) {
    return [];
  }

  const now = new Date().toISOString();
  const appendEvents: Array<Record<string, string>> = [];
  if (derivedStatus !== WU_STATUS.IN_PROGRESS) {
    appendEvents.push({
      type: WU_EVENT_TYPE.CLAIM,
      wuId: id,
      lane: typeof lane === 'string' && lane.trim().length > 0 ? lane : 'Operations: Tooling',
      title: typeof title === 'string' && title.trim().length > 0 ? title : `WU ${id}`,
      timestamp: now,
    });
  }
  appendEvents.push({
    type: WU_EVENT_TYPE.COMPLETE,
    wuId: id,
    reason: 'wu:repair consistency reconciliation for stamp/yaml mismatch',
    timestamp: now,
  });

  const destDir = path.dirname(eventsDestPath);
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }
  const suffix = appendEvents.map((event) => JSON.stringify(event)).join(STRING_LITERALS.NEWLINE);
  const normalizedExisting = existingContent
    ? existingContent.endsWith(STRING_LITERALS.NEWLINE)
      ? existingContent
      : `${existingContent}${STRING_LITERALS.NEWLINE}`
    : '';
  writeFileSync(eventsDestPath, `${normalizedExisting}${suffix}${STRING_LITERALS.NEWLINE}`, {
    encoding: 'utf-8',
  });

  return [eventsRelPath];
}

/**
 * Remove WU entry from a specific section in a markdown file inside a micro-worktree (WU-1078)
 *
 * @param {string} relFilePath - Relative path to the markdown file
 * @param {string} id - WU ID to remove
 * @param {string} sectionHeading - Section heading to target
 * @param {string} worktreePath - Path to the micro-worktree
 * @param {string} projectRoot - Original project root (for reading source file)
 * @returns {Promise<string[]>} List of files modified (relative paths)
 */
export async function removeWUFromSectionInWorktree(
  relFilePath: string,
  id: string,
  sectionHeading: string,
  worktreePath: string,
  projectRoot: string,
): Promise<string[]> {
  const srcPath = path.join(projectRoot, relFilePath);
  const destPath = path.join(worktreePath, relFilePath);

  // Check if source file exists
  if (!existsSync(srcPath)) {
    return []; // File doesn't exist
  }

  const content = readFileSync(srcPath, { encoding: 'utf-8' });
  const lines = content.split(/\r?\n/);

  let inTargetSection = false;
  let nextSectionIdx = -1;
  let sectionStartIdx = -1;

  // Normalize heading for comparison (lowercase, trim)
  const normalizedHeading = sectionHeading.toLowerCase().trim();

  // Find section boundaries
  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i] ?? '';
    const normalizedLine = currentLine.toLowerCase().trim();
    if (normalizedLine === normalizedHeading || normalizedLine.startsWith(normalizedHeading)) {
      inTargetSection = true;
      sectionStartIdx = i;
      continue;
    }
    if (inTargetSection && currentLine.trim().startsWith('## ')) {
      nextSectionIdx = i;
      break;
    }
  }

  if (sectionStartIdx === -1) return [];

  const endIdx = nextSectionIdx === -1 ? lines.length : nextSectionIdx;

  // Filter out lines containing the WU ID in the target section
  const newLines = [];
  let modified = false;
  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i] ?? '';
    if (i > sectionStartIdx && i < endIdx && currentLine.includes(id)) {
      modified = true;
      continue; // Skip this line
    }
    newLines.push(currentLine);
  }

  if (!modified) return [];

  // Ensure directory exists in worktree
  const destDir = path.dirname(destPath);
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  writeFileSync(destPath, newLines.join(STRING_LITERALS.NEWLINE), { encoding: 'utf-8' });

  return [relFilePath];
}

/**
 * Remove orphan worktree for a done WU
 *
 * CRITICAL: This function includes safety guards to prevent data loss.
 * See WU-1276 incident report for why these guards are essential.
 *
 * @param {string} id - WU ID
 * @param {string} lane - Lane name
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<RepairResult>} Result with success, skipped, and reason
 */
export async function removeOrphanWorktree(
  id: string,
  lane: string,
  projectRoot: string,
): Promise<RepairResult> {
  // Find worktree path
  const laneKebab = toKebab(lane);
  const worktreeName = `${laneKebab}-${id.toLowerCase()}`;
  const worktreePath = path.join(projectRoot, 'worktrees', worktreeName);

  // SAFETY GUARD 1: Check if cwd is inside worktree
  const cwd = process.cwd();
  if (cwd.startsWith(worktreePath)) {
    return { skipped: true, reason: 'Cannot delete worktree while inside it' };
  }

  // SAFETY GUARD 2: Check for uncommitted changes (if worktree exists)
  try {
    await access(worktreePath, constants.R_OK);
    // Worktree exists, check for uncommitted changes
    try {
      const gitWorktree = createGitForPath(worktreePath);
      const status = await gitWorktree.getStatus();
      if (status.trim().length > 0) {
        return { skipped: true, reason: 'Worktree has uncommitted changes' };
      }
    } catch {
      // Ignore errors checking status - proceed with other guards
    }
  } catch {
    // Worktree doesn't exist, that's fine
  }

  // SAFETY GUARD 3: Check stamp exists (not rollback state)
  const paths = createWuPaths({ projectRoot });
  const stampPath = path.join(projectRoot, paths.STAMP(id));
  try {
    await access(stampPath, constants.R_OK);
  } catch {
    return { skipped: true, reason: 'WU marked done but no stamp - possible rollback state' };
  }

  // Safe to proceed with cleanup
  const git = createGitForPath(projectRoot);

  try {
    await access(worktreePath, constants.R_OK);
    await git.worktreeRemove(worktreePath, { force: true });
  } catch {
    // Worktree may not exist
  }

  // Delete lane branch
  const branchName = `lane/${laneKebab}/${id.toLowerCase()}`;
  try {
    await git.deleteBranch(branchName, { force: true });
  } catch {
    // Branch may not exist locally
  }
  try {
    await git.raw(['push', REMOTES.ORIGIN, '--delete', branchName]);
  } catch {
    // Remote branch may not exist
  }

  return { success: true };
}

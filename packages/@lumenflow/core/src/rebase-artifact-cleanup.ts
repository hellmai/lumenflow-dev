/**
 * Rebase Artifact Cleanup
 *
 * Detects and cleans up completion artifacts (stamps, status=done)
 * that appear in worktree after rebasing from main.
 *
 * This prevents contradictory state where an in_progress WU has
 * completion markers from a previous completion cycle on main.
 *
 * Part of WU-1371: Post-rebase artifact cleanup
 * WU-1449: Extended to handle backlog/status duplicates after rebase
 *
 * @see {@link packages/@lumenflow/cli/src/wu-done.ts} - Creates completion artifacts
 * @see {@link packages/@lumenflow/cli/src/lib/stamp-utils.ts} - Stamp file utilities
 * @see {@link packages/@lumenflow/cli/src/lib/wu-recovery.ts} - Related zombie state handling
 */

import { readFile, writeFile, unlink, access } from 'node:fs/promises';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import fg from 'fast-glob';
import { parseYAML, stringifyYAML } from './wu-yaml.js';

import { WU_PATHS } from './wu-paths.js';
import {
  WU_STATUS,
  LOG_PREFIX,
  EMOJI,
  YAML_OPTIONS,
  BACKLOG_SECTIONS,
  STATUS_SECTIONS,
  REMOTES,
  BRANCHES,
  BUILD_ARTIFACT_GLOBS,
  BUILD_ARTIFACT_IGNORES,
} from './wu-constants.js';
import { findSectionBounds, removeBulletFromSection } from './backlog-editor.js';
import { getErrorMessage } from './error-handler.js';

/** @constant {string} FRONTMATTER_DELIMITER - YAML frontmatter delimiter */
const FRONTMATTER_DELIMITER = '---';

interface GitAdapterLike {
  raw(args: string[]): Promise<string>;
}

interface MarkdownFileContents {
  frontmatter: string;
  lines: string[];
}

interface RebasedArtifactDetectionResult {
  stamps: string[];
  yamlStatusDone: boolean;
  hasArtifacts: boolean;
}

interface DuplicateDetectionResult {
  backlogDuplicate: boolean;
  statusDuplicate: boolean;
  hasDuplicates: boolean;
}

interface FileDuplicateCleanupResult {
  cleaned: boolean;
  error: string | null;
}

interface BacklogDeduplicateResult {
  backlogCleaned: boolean;
  statusCleaned: boolean;
  cleaned: boolean;
  errors: string[];
}

interface CleanupRebasedArtifactsResult {
  stampsCleaned: string[];
  yamlReset: boolean;
  backlogCleaned: boolean;
  statusCleaned: boolean;
  errors: string[];
  cleaned: boolean;
}

interface BuildArtifactsCleanupResult {
  distDirectories: string[];
  tsbuildinfoFiles: string[];
  removedCount: number;
}

/**
 * Check if a file exists (async)
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>} True if file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a file exists on origin/main using git show
 * WU-1817: Used to verify artifacts are truly rebased from main
 *
 * @param {object} gitAdapter - Git adapter instance with raw() method
 * @param {string} relativePath - Path relative to repo root
 * @returns {Promise<boolean>} True if file exists on origin/main
 */
async function fileExistsOnMain(gitAdapter: GitAdapterLike, relativePath: string): Promise<boolean> {
  try {
    await gitAdapter.raw(['show', `${REMOTES.ORIGIN}/${BRANCHES.MAIN}:${relativePath}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if YAML on origin/main has status=done
 * WU-1817: Used to verify done status is truly rebased from main
 *
 * @param {object} gitAdapter - Git adapter instance with raw() method
 * @param {string} wuId - WU ID (e.g., 'WU-1817')
 * @returns {Promise<boolean>} True if YAML on main has status=done
 */
async function yamlIsDoneOnMain(gitAdapter: GitAdapterLike, wuId: string): Promise<boolean> {
  try {
    const content = await gitAdapter.raw([
      'show',
      `${REMOTES.ORIGIN}/${BRANCHES.MAIN}:${WU_PATHS.WU(wuId)}`,
    ]);
    const doc = parseYAML(content) as { status?: string } | null;
    return doc && doc.status === WU_STATUS.DONE;
  } catch {
    return false;
  }
}

/**
 * Read markdown file and separate frontmatter from content
 * Simplified version that doesn't require gray-matter (which has js-yaml compatibility issues)
 *
 * @param {string} filePath - Path to file
 * @returns {{frontmatter: string, lines: string[]}} Frontmatter and content lines
 */
function readMarkdownFile(filePath: string): MarkdownFileContents {
  const raw = readFileSync(filePath, { encoding: 'utf-8' });
  const allLines = raw.split('\n');

  // Check for frontmatter (starts with ---)
  if (allLines[0]?.trim() === FRONTMATTER_DELIMITER) {
    // Find closing ---
    let endIdx = -1;
    for (let i = 1; i < allLines.length; i++) {
      if (allLines[i]?.trim() === FRONTMATTER_DELIMITER) {
        endIdx = i;
        break;
      }
    }

    if (endIdx > 0) {
      // Extract frontmatter and content
      const frontmatterLines = allLines.slice(0, endIdx + 1);
      const contentLines = allLines.slice(endIdx + 1);
      return {
        frontmatter: `${frontmatterLines.join('\n')}\n`,
        lines: contentLines,
      };
    }
  }

  // No frontmatter
  return {
    frontmatter: '',
    lines: allLines,
  };
}

/**
 * Write markdown file with frontmatter and content
 *
 * @param {string} filePath - Path to file
 * @param {string} frontmatter - Frontmatter text (including --- markers)
 * @param {string[]} lines - Content lines
 */
function writeMarkdownFile(filePath: string, frontmatter: string, lines: string[]): void {
  const content = frontmatter + lines.join('\n');
  writeFileSync(filePath, content, { encoding: 'utf-8' });
}

/**
 * Detect rebased completion artifacts in a worktree
 *
 * WU-1817: Now verifies artifacts exist on origin/main before flagging.
 * Only artifacts that exist on BOTH worktree AND origin/main are true
 * rebased artifacts. Artifacts that exist only locally (created by the
 * lane branch itself) should NOT be cleaned - this was the WU-1816 bug.
 *
 * Checks for:
 * 1. Stamp files (.lumenflow/stamps/WU-{id}.done) that exist on origin/main
 * 2. WU YAML with status=done that also has status=done on origin/main
 *
 * @param {string} worktreePath - Path to the worktree directory
 * @param {string} wuId - WU ID (e.g., 'WU-1371')
 * @param {object} gitAdapter - Git adapter instance with raw() method
 * @returns {Promise<object>} Detection result
 * @returns {string[]} result.stamps - Array of detected stamp file paths (only if on origin/main)
 * @returns {boolean} result.yamlStatusDone - True if YAML has status=done AND origin/main has done
 * @returns {boolean} result.hasArtifacts - True if any rebased artifacts detected
 *
 * @example
 * const result = await detectRebasedArtifacts(worktreePath, wuId, gitAdapter);
 * if (result.hasArtifacts) {
 *   console.log('Found rebased artifacts, cleaning up...');
 * }
 */
export async function detectRebasedArtifacts(
  worktreePath: string,
  wuId: string,
  gitAdapter: GitAdapterLike,
): Promise<RebasedArtifactDetectionResult> {
  const stamps: string[] = [];
  let yamlStatusDone = false;

  // Check for stamp file in worktree
  const stampPath = join(worktreePath, WU_PATHS.STAMP(wuId));
  const localStampExists = await fileExists(stampPath);

  // Check YAML status in worktree
  const wuYamlPath = join(worktreePath, WU_PATHS.WU(wuId));
  let localYamlDone = false;
  if (await fileExists(wuYamlPath)) {
    try {
      const content = await readFile(wuYamlPath, { encoding: 'utf-8' });
      const doc = parseYAML(content) as { status?: string } | null;
      if (doc && doc.status === WU_STATUS.DONE) {
        localYamlDone = true;
      }
    } catch {
      // YAML read error - treat as no artifact (will be caught elsewhere)
    }
  }

  // WU-1817: Verify artifacts also exist on origin/main
  // Only flag as rebased artifact if exists on BOTH worktree AND main
  const stampOnMain = localStampExists
    ? await fileExistsOnMain(gitAdapter, WU_PATHS.STAMP(wuId))
    : false;
  const yamlDoneOnMain = localYamlDone ? await yamlIsDoneOnMain(gitAdapter, wuId) : false;

  // Only include artifacts that exist on both
  if (stampOnMain) {
    stamps.push(stampPath);
  }
  yamlStatusDone = yamlDoneOnMain;

  const hasArtifacts = stamps.length > 0 || yamlStatusDone;

  return {
    stamps,
    yamlStatusDone,
    hasArtifacts,
  };
}

/**
 * Clean up rebased completion artifacts from a worktree
 *
 * Actions:
 * 1. Remove stamp files that shouldn't exist
 * 2. Reset YAML status from done to in_progress
 * 3. Remove locked and completed_at fields from YAML
 * 4. Log warnings explaining cleanup actions
 *
 * Idempotent: Safe to call multiple times, won't throw if artifacts don't exist.
 *
 * @param {string} worktreePath - Path to the worktree directory
 * @param {string} wuId - WU ID (e.g., 'WU-1371')
 * @returns {Promise<object>} Cleanup result
 * @returns {string[]} result.stampsCleaned - WU IDs whose stamps were removed
 * @returns {boolean} result.yamlReset - True if YAML status was reset
 * @returns {string[]} result.errors - Any errors encountered (non-fatal)
 * @returns {boolean} result.cleaned - True if any cleanup was performed
 *
 * @example
 * const result = await cleanupRebasedArtifacts(worktreePath, wuId);
 * if (result.cleaned) {
 *   console.log('Cleaned rebased artifacts:', result);
 * }
 */
export async function cleanupRebasedArtifacts(
  worktreePath: string,
  wuId: string,
): Promise<CleanupRebasedArtifactsResult> {
  const stampsCleaned: string[] = [];
  let yamlReset = false;
  const errors: string[] = [];

  // Clean stamp file
  const stampPath = join(worktreePath, WU_PATHS.STAMP(wuId));
  try {
    if (await fileExists(stampPath)) {
      await unlink(stampPath);
      stampsCleaned.push(wuId);
      console.log(
        LOG_PREFIX.CLEANUP,
        `${EMOJI.WARNING} Removed rebased stamp file for ${wuId} (artifact from main rebase)`,
      );
    }
  } catch (error) {
    const stampErrMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to remove stamp: ${stampErrMessage}`);
  }

  // Reset YAML status
  const wuYamlPath = join(worktreePath, WU_PATHS.WU(wuId));
  try {
    if (await fileExists(wuYamlPath)) {
      const content = await readFile(wuYamlPath, { encoding: 'utf-8' });
      const doc = parseYAML(content) as {
        status?: string;
        locked?: boolean;
        completed_at?: string;
      } | null;

      if (doc && doc.status === WU_STATUS.DONE) {
        // Reset status
        doc.status = WU_STATUS.IN_PROGRESS;

        // Remove completion fields
        delete doc.locked;
        delete doc.completed_at;

        // Write back
        const updatedContent = stringifyYAML(doc, { lineWidth: YAML_OPTIONS.LINE_WIDTH });
        await writeFile(wuYamlPath, updatedContent, { encoding: 'utf-8' });

        yamlReset = true;
        console.log(
          LOG_PREFIX.CLEANUP,
          `${EMOJI.WARNING} Reset YAML status from done to in_progress for ${wuId} (artifact from main rebase)`,
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to reset YAML status: ${message}`);
  }

  // WU-1449: Also clean backlog/status duplicates
  const backlogDedup = await deduplicateBacklogAfterRebase(worktreePath, wuId);

  const cleaned = stampsCleaned.length > 0 || yamlReset || backlogDedup.cleaned;

  return {
    stampsCleaned,
    yamlReset,
    backlogCleaned: backlogDedup.backlogCleaned,
    statusCleaned: backlogDedup.statusCleaned,
    errors: [...errors, ...backlogDedup.errors],
    cleaned,
  };
}

/**
 * Detect WU duplicates in backlog/status files after rebase
 *
 * Checks if a WU appears in both:
 * - "In Progress" AND "Done" sections of backlog.md
 * - "In Progress" AND "Completed" sections of status.md
 *
 * This state occurs when main advanced with WU completion,
 * then rebase merged main's "Done" state into the worktree
 * while the worktree already had the WU in "In Progress".
 *
 * Part of WU-1449: Extend rebase cleanup to remove backlog/status duplicates
 *
 * @param {string} worktreePath - Path to the worktree directory
 * @param {string} wuId - WU ID (e.g., 'WU-1449')
 * @returns {Promise<object>} Detection result
 * @returns {boolean} result.backlogDuplicate - True if WU in both In Progress and Done in backlog.md
 * @returns {boolean} result.statusDuplicate - True if WU in both In Progress and Completed in status.md
 * @returns {boolean} result.hasDuplicates - True if any duplicates detected
 *
 * @example
 * const result = await detectBacklogDuplicates(worktreePath, wuId);
 * if (result.hasDuplicates) {
 *   console.log('Found backlog duplicates, cleaning up...');
 * }
 */
export async function detectBacklogDuplicates(
  worktreePath: string,
  wuId: string,
): Promise<DuplicateDetectionResult> {
  let backlogDuplicate = false;
  let statusDuplicate = false;

  // Check backlog.md for duplicate (WU in both In Progress and Done)
  const backlogPath = join(worktreePath, WU_PATHS.BACKLOG());
  if (existsSync(backlogPath)) {
    try {
      const { lines } = readMarkdownFile(backlogPath);

      const inProgressBounds = findSectionBounds(lines, BACKLOG_SECTIONS.IN_PROGRESS);
      const doneBounds = findSectionBounds(lines, BACKLOG_SECTIONS.DONE);

      if (inProgressBounds && doneBounds) {
        const inProgressSection = lines.slice(inProgressBounds.start, inProgressBounds.end);
        const doneSection = lines.slice(doneBounds.start, doneBounds.end);

        const inProgressHasWU = inProgressSection.some((line) => line.includes(wuId));
        const doneHasWU = doneSection.some((line) => line.includes(wuId));

        backlogDuplicate = inProgressHasWU && doneHasWU;
      }
    } catch {
      // File read error - treat as no duplicate (will be caught elsewhere)
    }
  }

  // Check status.md for duplicate (WU in both In Progress and Completed)
  const statusPath = join(worktreePath, WU_PATHS.STATUS());
  if (existsSync(statusPath)) {
    try {
      const { lines } = readMarkdownFile(statusPath);

      const inProgressBounds = findSectionBounds(lines, STATUS_SECTIONS.IN_PROGRESS);
      const completedBounds = findSectionBounds(lines, STATUS_SECTIONS.COMPLETED);

      if (inProgressBounds && completedBounds) {
        const inProgressSection = lines.slice(inProgressBounds.start, inProgressBounds.end);
        const completedSection = lines.slice(completedBounds.start, completedBounds.end);

        const inProgressHasWU = inProgressSection.some((line) => line.includes(wuId));
        const completedHasWU = completedSection.some((line) => line.includes(wuId));

        statusDuplicate = inProgressHasWU && completedHasWU;
      }
    } catch {
      // File read error - treat as no duplicate (will be caught elsewhere)
    }
  }

  const hasDuplicates = backlogDuplicate || statusDuplicate;

  return {
    backlogDuplicate,
    statusDuplicate,
    hasDuplicates,
  };
}

/**
 * Clean duplicates from a single markdown file
 *
 * Helper function to reduce cognitive complexity of deduplicateBacklogAfterRebase.
 *
 * @param {string} filePath - Path to the markdown file
 * @param {string} wuId - WU ID to check for duplicates
 * @param {string} inProgressSection - Section name for in-progress items
 * @param {string} completedSection - Section name for completed items
 * @param {string} fileLabel - Label for log messages (e.g., 'backlog.md')
 * @param {string} completedLabel - Label for completed section (e.g., 'Done' or 'Completed')
 * @returns {{cleaned: boolean, error: string|null}} Result
 */
function cleanDuplicatesFromFile(
  filePath: string,
  wuId: string,
  inProgressSection: string,
  completedSection: string,
  fileLabel: string,
  completedLabel: string,
): FileDuplicateCleanupResult {
  if (!existsSync(filePath)) {
    return { cleaned: false, error: null };
  }

  try {
    const { frontmatter, lines } = readMarkdownFile(filePath);

    const inProgressBounds = findSectionBounds(lines, inProgressSection);
    const completedBounds = findSectionBounds(lines, completedSection);

    if (!inProgressBounds || !completedBounds) {
      return { cleaned: false, error: null };
    }

    const inProgressLines = lines.slice(inProgressBounds.start, inProgressBounds.end);
    const completedLines = lines.slice(completedBounds.start, completedBounds.end);

    const inProgressHasWU = inProgressLines.some((line) => line.includes(wuId));
    const completedHasWU = completedLines.some((line) => line.includes(wuId));

    // Only clean if WU is in BOTH sections (duplicate state)
    if (!inProgressHasWU || !completedHasWU) {
      return { cleaned: false, error: null };
    }

    removeBulletFromSection(lines, inProgressBounds.start, inProgressBounds.end, wuId);
    writeMarkdownFile(filePath, frontmatter, lines);

    console.log(
      LOG_PREFIX.CLEANUP,
      `${EMOJI.WARNING} Removed ${wuId} from In Progress section in ${fileLabel} (already in ${completedLabel} after rebase)`,
    );

    return { cleaned: true, error: null };
  } catch (error: unknown) {
    return { cleaned: false, error: `Failed to clean ${fileLabel}: ${getErrorMessage(error)}` };
  }
}

/**
 * Remove WU from In Progress sections when already in Done/Completed after rebase
 *
 * This handles the specific case where:
 * 1. WU is completing (wu:done in progress)
 * 2. Auto-rebase pulls main's completion state
 * 3. WU now appears in BOTH In Progress AND Done sections
 * 4. This function removes the duplicate from In Progress (keeps Done)
 *
 * Applies to both backlog.md and status.md.
 * Idempotent: Safe to call multiple times.
 *
 * Part of WU-1449: Extend rebase cleanup to remove backlog/status duplicates
 *
 * @param {string} worktreePath - Path to the worktree directory
 * @param {string} wuId - WU ID (e.g., 'WU-1449')
 * @returns {Promise<object>} Cleanup result
 * @returns {boolean} result.backlogCleaned - True if WU removed from backlog.md In Progress
 * @returns {boolean} result.statusCleaned - True if WU removed from status.md In Progress
 * @returns {boolean} result.cleaned - True if any cleanup was performed
 * @returns {string[]} result.errors - Any errors encountered (non-fatal)
 *
 * @example
 * const result = await deduplicateBacklogAfterRebase(worktreePath, wuId);
 * if (result.cleaned) {
 *   console.log('Cleaned backlog duplicates:', result);
 * }
 */
export async function deduplicateBacklogAfterRebase(
  worktreePath: string,
  wuId: string,
): Promise<BacklogDeduplicateResult> {
  const errors: string[] = [];

  // Clean backlog.md duplicates
  const backlogPath = join(worktreePath, WU_PATHS.BACKLOG());
  const backlogResult = cleanDuplicatesFromFile(
    backlogPath,
    wuId,
    BACKLOG_SECTIONS.IN_PROGRESS,
    BACKLOG_SECTIONS.DONE,
    'backlog.md',
    'Done',
  );
  if (backlogResult.error) {
    errors.push(backlogResult.error);
  }

  // Clean status.md duplicates
  const statusPath = join(worktreePath, WU_PATHS.STATUS());
  const statusResult = cleanDuplicatesFromFile(
    statusPath,
    wuId,
    STATUS_SECTIONS.IN_PROGRESS,
    STATUS_SECTIONS.COMPLETED,
    'status.md',
    'Completed',
  );
  if (statusResult.error) {
    errors.push(statusResult.error);
  }

  return {
    backlogCleaned: backlogResult.cleaned,
    statusCleaned: statusResult.cleaned,
    cleaned: backlogResult.cleaned || statusResult.cleaned,
    errors,
  };
}

/**
 * Clean up build artifacts in a worktree (dist folders + tsbuildinfo files)
 *
 * WU-1042: Provide a safe helper for clearing build artifacts that can
 * trigger TS5055 or stale build issues in worktrees.
 *
 * @param {string} worktreePath - Path to the worktree directory
 * @returns {Promise<object>} Cleanup result
 * @returns {string[]} result.distDirectories - Removed dist directories (relative paths)
 * @returns {string[]} result.tsbuildinfoFiles - Removed tsbuildinfo files (relative paths)
 * @returns {number} result.removedCount - Total removed artifacts
 */
export async function cleanupWorktreeBuildArtifacts(
  worktreePath: string,
): Promise<BuildArtifactsCleanupResult> {
  const root = resolve(worktreePath);
  const distDirectories = await fg(BUILD_ARTIFACT_GLOBS.DIST_DIRS, {
    cwd: root,
    onlyDirectories: true,
    dot: true,
    followSymbolicLinks: false,
    ignore: BUILD_ARTIFACT_IGNORES,
  });
  const tsbuildinfoFiles = await fg(BUILD_ARTIFACT_GLOBS.TSBUILDINFO_FILES, {
    cwd: root,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
    ignore: BUILD_ARTIFACT_IGNORES,
  });

  for (const dir of distDirectories) {
    rmSync(join(root, dir), { recursive: true, force: true });
  }

  for (const file of tsbuildinfoFiles) {
    rmSync(join(root, file), { force: true });
  }

  return {
    distDirectories,
    tsbuildinfoFiles,
    removedCount: distDirectories.length + tsbuildinfoFiles.length,
  };
}

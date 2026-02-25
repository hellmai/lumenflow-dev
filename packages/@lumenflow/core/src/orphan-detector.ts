// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Orphan Worktree Detector (WU-1476)
 *
 * Detects orphan directories in worktrees/ that are not tracked by git worktree.
 * Orphan directories can occur when wu:done fails mid-workflow due to:
 * - Backlog sync issues
 * - Formatting errors
 * - Typecheck failures
 * - Recovery mode interruptions
 *
 * Multi-layer defense strategy:
 * - Layer 1: Explicit cleanup in git-adapter.worktreeRemove()
 * - Layer 2: Orphan detection in wu:prune (this module)
 * - Layer 3: Pre-flight check in wu:claim
 * - Layer 4: Manual utility wu:cleanup-orphans
 *
 * @see {@link packages/@lumenflow/cli/src/wu-prune.ts} - Primary consumer
 * @see {@link packages/@lumenflow/cli/src/wu-claim.ts} - Pre-flight orphan check
 * @see {@link packages/@lumenflow/cli/src/lib/git-adapter.ts} - worktreeRemove with cleanup
 */

import { readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { getGitForCwd, createGitForPath } from './git-adapter.js';
import { STRING_LITERALS, DEFAULTS } from './wu-constants.js';

/**
 * Result of orphan detection
 * @typedef {object} OrphanDetectionResult
 * @property {string[]} orphans - List of orphan directory paths (absolute)
 * @property {string[]} tracked - List of tracked worktree paths (absolute)
 * @property {string[]} errors - List of error messages encountered during detection
 */

/**
 * Parsed worktree entry from git worktree list --porcelain
 */
interface WorktreeEntry {
  /** Absolute path to worktree */
  path: string;
  /** HEAD commit SHA */
  head?: string;
  /** Branch name (without refs/heads/ prefix) */
  branch?: string;
}

/**
 * Parse git worktree list --porcelain output into structured entries
 *
 * @param {string} porcelainOutput - Output from git worktree list --porcelain
 * @returns {WorktreeEntry[]} Parsed worktree entries
 */
export function parseWorktreeList(porcelainOutput: string): WorktreeEntry[] {
  if (!porcelainOutput || porcelainOutput.trim() === '') {
    return [];
  }

  const worktrees: WorktreeEntry[] = [];
  const lines = porcelainOutput.split(STRING_LITERALS.NEWLINE);
  let current: Partial<WorktreeEntry> = {};

  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      if (current.path) {
        worktrees.push(current as WorktreeEntry);
      }
      current = { path: line.substring(9).trim() };
    } else if (line.startsWith('HEAD ')) {
      current.head = line.substring(5).trim();
    } else if (line.startsWith('branch ')) {
      const fullRef = line.substring(7).trim();
      // Extract branch name from refs/heads/...
      current.branch = fullRef.replace(/^refs\/heads\//, '');
    } else if (line === '') {
      if (current.path) {
        worktrees.push(current as WorktreeEntry);
      }
      current = {};
    }
  }

  // Handle final entry without trailing newline
  if (current.path) {
    worktrees.push(current as WorktreeEntry);
  }

  return worktrees;
}

/**
 * Get set of tracked worktree paths from git
 *
 * @param {string} [projectRoot] - Project root directory (defaults to cwd)
 * @returns {Promise<Set<string>>} Set of absolute paths tracked by git worktree
 */
export async function getTrackedWorktreePaths(projectRoot?: string) {
  const git = projectRoot ? createGitForPath(projectRoot) : getGitForCwd();
  const output = await git.worktreeList();
  const entries = parseWorktreeList(output);
  return new Set(entries.map((e) => e.path));
}

/**
 * Identify tracked worktrees that are missing on disk
 *
 * @param {string[]} trackedPaths - Absolute paths from git worktree list
 * @param {(path: string) => boolean} [existsFn] - Optional fs.existsSync override
 * @returns {string[]} Missing worktree paths
 */
export function getMissingWorktreesFromTracked(
  trackedPaths: readonly string[],
  existsFn = existsSync,
) {
  if (!Array.isArray(trackedPaths)) {
    return [];
  }
  return trackedPaths.filter((trackedPath) => !existsFn(trackedPath));
}

/**
 * Detect tracked worktrees that are missing on disk
 *
 * @param {string} [projectRoot] - Project root directory (defaults to cwd)
 * @returns {Promise<string[]>} Missing tracked worktree paths
 */
export async function detectMissingTrackedWorktrees(projectRoot?: string) {
  const root = projectRoot || process.cwd();
  const tracked = await getTrackedWorktreePaths(root);
  return getMissingWorktreesFromTracked([...tracked]);
}

/**
 * Get list of directories in worktrees/ folder
 *
 * @param {string} projectRoot - Absolute path to project root
 * @returns {string[]} List of absolute paths to directories in worktrees/
 */
export function getWorktreeDirectories(projectRoot: string) {
  const worktreesDir = path.join(projectRoot, DEFAULTS.WORKTREES_DIR);

  if (!existsSync(worktreesDir)) {
    return [];
  }

  try {
    const entries = readdirSync(worktreesDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(worktreesDir, entry.name));
  } catch {
    return [];
  }
}

/**
 * Detect orphan worktree directories
 *
 * Compares directories in worktrees/ against git worktree list to find
 * directories that exist on disk but are not tracked by git.
 *
 * @param {string} [projectRoot] - Project root directory (defaults to cwd)
 * @returns {Promise<OrphanDetectionResult>} Detection result with orphans and tracked paths
 */
export async function detectOrphanWorktrees(projectRoot?: string) {
  const errors: string[] = [];
  const root = projectRoot || process.cwd();

  // Get paths tracked by git worktree
  let trackedPaths;
  try {
    trackedPaths = await getTrackedWorktreePaths(root);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`Failed to get git worktree list: ${message}`);
    return { orphans: [], tracked: [], errors };
  }

  // Get directories on disk
  const diskDirectories = getWorktreeDirectories(root);

  // Find orphans: directories that exist but aren't tracked
  const orphans = diskDirectories.filter((dir) => !trackedPaths.has(dir));

  return {
    orphans,
    tracked: [...trackedPaths],
    errors,
  };
}

/**
 * Check if a specific worktree path is an orphan
 *
 * Used by wu:claim for pre-flight checks before creating a worktree.
 *
 * @param {string} worktreePath - Absolute path to check
 * @param {string} [projectRoot] - Project root directory (defaults to cwd)
 * @returns {Promise<boolean>} True if the path exists but is not tracked by git
 */
export async function isOrphanWorktree(worktreePath: string, projectRoot?: string) {
  // If directory doesn't exist, it's not an orphan
  if (!existsSync(worktreePath)) {
    return false;
  }

  // Check if path is in the tracked set
  const trackedPaths = await getTrackedWorktreePaths(projectRoot);
  return !trackedPaths.has(worktreePath);
}

/**
 * Options for removing orphan directories
 */
export interface RemoveOrphanDirectoryOptions {
  /** If true, don't actually remove */
  dryRun?: boolean;
}

/**
 * Remove an orphan directory
 *
 * Safely removes an orphan worktree directory from disk.
 * Only removes directories that are confirmed orphans.
 *
 * @param {string} orphanPath - Absolute path to orphan directory
 * @param {RemoveOrphanDirectoryOptions} [options] - Options
 * @returns {Promise<{removed: boolean, path: string, error?: string}>} Result
 */
export async function removeOrphanDirectory(
  orphanPath: string,
  options: RemoveOrphanDirectoryOptions = {},
) {
  const { dryRun = false } = options;

  // Verify it exists
  if (!existsSync(orphanPath)) {
    return { removed: false, path: orphanPath, error: 'Directory does not exist' };
  }

  // Verify it's a directory
  try {
    const stat = statSync(orphanPath);
    if (!stat.isDirectory()) {
      return { removed: false, path: orphanPath, error: 'Path is not a directory' };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { removed: false, path: orphanPath, error: `Failed to stat: ${message}` };
  }

  // Verify it's in worktrees/ directory (safety check)
  const basename = path.basename(path.dirname(orphanPath));
  if (basename !== DEFAULTS.WORKTREES_DIR) {
    return {
      removed: false,
      path: orphanPath,
      error: `Safety check failed: not in ${DEFAULTS.WORKTREES_DIR}/ directory`,
    };
  }

  if (dryRun) {
    return { removed: false, path: orphanPath, dryRun: true };
  }

  // Remove the directory
  try {
    rmSync(orphanPath, { recursive: true, force: true });
    return { removed: true, path: orphanPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { removed: false, path: orphanPath, error: `Failed to remove: ${message}` };
  }
}

/**
 * Clean up all orphan directories
 *
 * Detects and removes all orphan worktree directories.
 *
 * @param {string} [projectRoot] - Project root directory (defaults to cwd)
 * @param {RemoveOrphanDirectoryOptions} [options] - Options
 * @returns {Promise<{detected: number, removed: number, errors: string[]}>} Summary
 */
export async function cleanupOrphanDirectories(
  projectRoot?: string,
  options: RemoveOrphanDirectoryOptions = {},
) {
  const { dryRun = false } = options;
  const result = await detectOrphanWorktrees(projectRoot);
  const errors = [...result.errors];
  let removed = 0;

  for (const orphanPath of result.orphans) {
    const removeResult = await removeOrphanDirectory(orphanPath, { dryRun });
    if (removeResult.removed) {
      removed++;
    } else if (removeResult.error) {
      errors.push(`${orphanPath}: ${removeResult.error}`);
    }
  }

  return {
    detected: result.orphans.length,
    removed,
    errors,
  };
}

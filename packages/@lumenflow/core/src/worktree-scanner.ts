/**
 * Worktree Scanner (WU-1748)
 *
 * Scans existing git worktrees to detect uncommitted changes.
 * Provides cross-agent visibility for abandoned WU work.
 *
 * Features:
 * - Parses git worktree list output
 * - Detects uncommitted changes per worktree
 * - Reports last activity timestamp
 * - Identifies potentially abandoned WUs
 *
 * @see {@link tools/lib/__tests__/worktree-scanner.test.mjs} - Tests
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Regex pattern to extract WU ID from lane branch name
 * Matches patterns like: lane/operations/wu-1234, lane/operations-tooling/wu-1234
 */
const WU_ID_PATTERN = /wu-(\d+)$/i;

/**
 * Regex pattern to parse git worktree list output line
 * Format: /path/to/worktree  SHA1 [branch] or (detached HEAD)
 */
const WORKTREE_LINE_PATTERN = /^(\S+)\s+(\S+)\s+(?:\[([^\]]+)\]|\(([^)]+)\))$/;

/**
 * @typedef {object} WorktreeInfo
 * @property {string} path - Absolute path to worktree
 * @property {string} sha - Current commit SHA
 * @property {string} branch - Branch name or "(detached HEAD)"
 * @property {boolean} isMain - Whether this is the main worktree
 * @property {string} [wuId] - WU ID if this is a lane worktree
 */

/**
 * @typedef {object} WorktreeStatus
 * @property {boolean} hasUncommittedChanges - Whether there are uncommitted changes
 * @property {number} uncommittedFileCount - Number of uncommitted files
 * @property {string[]} uncommittedFiles - List of uncommitted file paths
 * @property {string} lastActivityTimestamp - ISO timestamp of last git activity
 * @property {string} [error] - Error message if git commands failed
 */

/**
 * @typedef {object} WorktreeScanResult
 * @property {(WorktreeInfo & WorktreeStatus)[]} worktrees - All WU worktrees with status
 * @property {(WorktreeInfo & WorktreeStatus)[]} worktreesWithUncommittedWork - Worktrees with uncommitted changes
 * @property {object} summary - Summary statistics
 * @property {number} summary.totalWorktrees - Total number of WU worktrees
 * @property {number} summary.withUncommittedChanges - Number with uncommitted changes
 * @property {number} summary.totalUncommittedFiles - Total uncommitted files across all worktrees
 */

/**
 * Parses git worktree list output into structured data.
 *
 * @param {string} output - Raw output from `git worktree list`
 * @returns {WorktreeInfo[]} Parsed worktree information
 *
 * @example
 * const info = parseWorktreeList('/home/user/project abc1234 [main]');
 * // Returns: [{ path: '/home/user/project', sha: 'abc1234', branch: 'main', isMain: true }]
 */
export function parseWorktreeList(output) {
  if (!output || !output.trim()) {
    return [];
  }

  const lines = output.trim().split('\n');
  const worktrees = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(WORKTREE_LINE_PATTERN);
    if (!match) continue;

    const [, path, sha, bracketBranch, parenBranch] = match;
    const branch = bracketBranch || parenBranch;
    const isMain = branch === 'main' || branch === 'master';

    /** @type {WorktreeInfo} */
    const info: { path: string; sha: string; branch: string; isMain: boolean; wuId?: string } = {
      path,
      sha,
      branch,
      isMain,
    };

    // Extract WU ID from lane branch name
    const wuMatch = branch.match(WU_ID_PATTERN);
    if (wuMatch) {
      info.wuId = `WU-${wuMatch[1]}`;
    }

    worktrees.push(info);
  }

  return worktrees;
}

/**
 * Gets the status of a single worktree including uncommitted changes.
 *
 * @param {string} worktreePath - Path to the worktree
 * @param {object} [options] - Options
 * @param {WorktreeScannerOptions} [options] - Options
 * @returns {Promise<WorktreeStatus>} Worktree status
 *
 * @example
 * const status = await getWorktreeStatus('/path/to/worktree');
 * if (status.hasUncommittedChanges) {
 *   console.log(`Found ${status.uncommittedFileCount} uncommitted files`);
 * }
 */
interface WorktreeScannerOptions {
  /** Custom exec function for testing */
  execAsync?: (cmd: string) => Promise<{ stdout: string; stderr: string }>;
}

export async function getWorktreeStatus(worktreePath, options: WorktreeScannerOptions = {}) {
  const runCmd = options.execAsync || execAsync;

  /** @type {WorktreeStatus} */
  const status: { hasUncommittedChanges: boolean; uncommittedFileCount: number; uncommittedFiles: string[]; lastActivityTimestamp: string; error?: string } = {
    hasUncommittedChanges: false,
    uncommittedFileCount: 0,
    uncommittedFiles: [],
    lastActivityTimestamp: '',
  };

  try {
    // Get uncommitted changes via git status --porcelain
    const statusResult = await runCmd(`git -C "${worktreePath}" status --porcelain`);
    // Note: Don't trim() the whole output as it would remove leading space from first line
    // Git status --porcelain format: XY filename (2 chars + space + path)
    const statusOutput = statusResult.stdout;

    if (statusOutput && statusOutput.trim()) {
      const files = statusOutput
        .split('\n')
        .filter((line) => line.length > 3) // Filter empty lines
        .map((line) => line.slice(3).trim()); // Remove XY prefix and trim path
      status.uncommittedFiles = files;
      status.uncommittedFileCount = files.length;
      status.hasUncommittedChanges = files.length > 0;
    }

    // Get last activity timestamp from git log
    const logResult = await runCmd(
      `git -C "${worktreePath}" log -1 --format=%aI 2>/dev/null || echo ""`
    );
    status.lastActivityTimestamp = logResult.stdout.trim();
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error);
  }

  return status;
}

/**
 * Scans all worktrees and returns their status.
 *
 * Excludes the main worktree and focuses on WU worktrees (lane branches).
 *
 * @param {string} basePath - Path to main repository
 * @param {WorktreeScannerOptions} [options] - Options
 * @returns {Promise<WorktreeScanResult>} Scan results with all worktrees and summary
 *
 * @example
 * const result = await scanWorktrees('/path/to/repo');
 * for (const wt of result.worktreesWithUncommittedWork) {
 *   console.log(`${wt.wuId}: ${wt.uncommittedFileCount} uncommitted files`);
 * }
 */
export async function scanWorktrees(basePath, options: WorktreeScannerOptions = {}) {
  const runCmd = options.execAsync || execAsync;

  // Get worktree list
  const listResult = await runCmd(`git -C "${basePath}" worktree list`);
  const allWorktrees = parseWorktreeList(listResult.stdout);

  // Filter to WU worktrees only (exclude main)
  const wuWorktrees = allWorktrees.filter((wt) => !wt.isMain && wt.wuId);

  // Get status for each WU worktree
  const worktreesWithStatus = await Promise.all(
    wuWorktrees.map(async (wt) => {
      const status = await getWorktreeStatus(wt.path, { execAsync: runCmd });
      return { ...wt, ...status };
    })
  );

  // Filter to those with uncommitted changes
  const worktreesWithUncommittedWork = worktreesWithStatus.filter((wt) => wt.hasUncommittedChanges);

  // Calculate summary
  const summary = {
    totalWorktrees: worktreesWithStatus.length,
    withUncommittedChanges: worktreesWithUncommittedWork.length,
    totalUncommittedFiles: worktreesWithStatus.reduce(
      (sum, wt) => sum + wt.uncommittedFileCount,
      0
    ),
  };

  return {
    worktrees: worktreesWithStatus,
    worktreesWithUncommittedWork,
    summary,
  };
}

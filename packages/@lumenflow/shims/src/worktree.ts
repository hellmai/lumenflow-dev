/**
 * @lumenflow/shims - Worktree Detection Utilities (WU-2546)
 *
 * Shared utilities for detecting git worktree context.
 *
 * @module @lumenflow/shims/worktree
 */

import { execSync, type StdioOptions } from 'node:child_process';
import path from 'node:path';

const STDIO_PIPE: StdioOptions = ['pipe', 'pipe', 'pipe'];
const ENCODING = 'utf8' as const;

/**
 * Execute a shell command and return the output.
 *
 * @param cmd - Command to execute
 * @returns Command output or empty string on error
 */
export function run(cmd: string): string {
  try {
    return execSync(cmd, { stdio: STDIO_PIPE, encoding: ENCODING }).trim();
  } catch {
    return '';
  }
}

/**
 * Get the current git branch name.
 *
 * @param gitPath - Path to git executable (default: '/usr/bin/git')
 * @returns Branch name or null if not in a git repo
 */
export function getCurrentBranch(gitPath: string = '/usr/bin/git'): string | null {
  return run(`${gitPath} rev-parse --abbrev-ref HEAD`) || null;
}

/**
 * Check if we're in the main worktree (not a lane worktree).
 *
 * In the main checkout, git-dir returns ".git".
 * In a worktree, git-dir returns ".git/worktrees/<name>".
 *
 * @param gitPath - Path to git executable (default: '/usr/bin/git')
 * @returns True if in main worktree
 */
export function isMainWorktree(gitPath: string = '/usr/bin/git'): boolean {
  const gitDir = run(`${gitPath} rev-parse --git-dir`);
  if (!gitDir) return true;
  const normalized = gitDir.replace(/\\/g, '/');
  return !normalized.includes('/worktrees/');
}

/**
 * Check if we're in any worktree (not the main checkout).
 *
 * @param gitPath - Path to git executable (default: '/usr/bin/git')
 * @returns True if in a worktree
 */
export function isInWorktree(gitPath: string = '/usr/bin/git'): boolean {
  const gitDir = run(`${gitPath} rev-parse --git-dir`);
  if (!gitDir) return false;
  return gitDir.includes('/worktrees/');
}

/**
 * Get the main checkout's path using git.
 *
 * Works in both main checkout and worktrees.
 * Uses git rev-parse --git-common-dir which returns the main .git directory
 * even when run from a worktree.
 *
 * @returns Path to main checkout, or null if not in a git repo
 */
export function getMainCheckoutPath(): string | null {
  try {
    const gitCommonDir = execSync('git rev-parse --git-common-dir', {
      encoding: ENCODING,
      stdio: STDIO_PIPE,
    }).trim();

    return path.dirname(path.resolve(gitCommonDir));
  } catch {
    return null;
  }
}

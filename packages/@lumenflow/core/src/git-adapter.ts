// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file git-adapter.ts
 * @description Git operations adapter using simple-git library
 * WU-1082: Extract shared utilities (eliminate run() duplication)
 * WU-1213: Refactor to use simple-git library (eliminate execSync)
 * WU-2242: Add runtime type assertions to prevent silent API misuse
 *
 * Replaces run() function in:
 * - tools/wu-claim.ts
 * - tools/wu-done.ts
 * - tools/wu-block.ts
 * - tools/wu-unblock.ts
 * - tools/wu-create.ts
 * - tools/wu-cleanup.ts
 * - tools/gates-pre-commit.ts
 * - tools/validate.ts
 * - tools/guard-worktree-commit.ts
 */

import { simpleGit, type SimpleGit } from 'simple-git';
import { existsSync, rmSync } from 'node:fs';
import { GIT_COMMANDS, GIT_FLAGS, GIT_REFS } from './wu-constants.js';
import { createError, ErrorCodes } from './error-handler.js';
import type {
  DeleteBranchOptions,
  MergeOptions,
  MergeResult,
  PushOptions,
  WorktreeRemoveOptions,
} from './ports/git-validator.ports.js';

// Type definitions
interface GitAdapterOptions {
  git?: SimpleGit;
  baseDir?: string;
}

interface ResetOptions {
  hard?: boolean;
}

interface LogOptions {
  maxCount?: number;
}

// WU-2242: Runtime assertion helpers
/**
 * Assert that a value is a non-empty string
 * @param {*} value - Value to check
 * @param {string} name - Parameter name for error message
 * @throws {TypeError} If value is not a string
 * @throws {Error} If value is an empty string
 */
function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string, got ${typeof value}`);
  }
  if (value === '') {
    throw createError(ErrorCodes.INVALID_ARGUMENT, `${name} must be a non-empty string`);
  }
}

/**
 * Assert that a value is a string (if provided)
 * @param {*} value - Value to check
 * @param {string} name - Parameter name for error message
 * @throws {TypeError} If value is not a string (and not null/undefined)
 */
function assertOptionalString(
  value: unknown,
  name: string,
): asserts value is string | undefined | null {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw new TypeError(`${name} must be a string, got ${typeof value}`);
  }
}

/**
 * Assert that a value is a string or array of strings
 * @param {*} value - Value to check
 * @param {string} name - Parameter name for error message
 * @throws {TypeError} If value is not a string or array
 * @throws {Error} If value is empty string or empty array
 */
function assertStringOrArray(value: unknown, name: string): asserts value is string | string[] {
  if (typeof value === 'string') {
    if (value === '') {
      throw createError(ErrorCodes.INVALID_ARGUMENT, `${name} must be a non-empty string or array`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw createError(ErrorCodes.INVALID_ARGUMENT, `${name} must be a non-empty string or array`);
    }
    return;
  }
  throw new TypeError(`${name} must be a string or array, got ${typeof value}`);
}

/**
 * Assert that a value is an array
 * @param {*} value - Value to check
 * @param {string} name - Parameter name for error message
 * @throws {TypeError} If value is not an array
 */
function assertArray(value: unknown, name: string): asserts value is string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array, got ${typeof value}`);
  }
}

/**
 * Git operations adapter with dependency injection support
 * @class GitAdapter
 */
export class GitAdapter {
  private readonly git: SimpleGit;

  /**
   * Create a GitAdapter instance
   * @param {object} [options] - Configuration options
   * @param {object} [options.git] - simple-git instance (for testing)
   * @param {string} [options.baseDir] - Base directory for git operations
   */
  constructor(options: GitAdapterOptions = {}) {
    if (options.baseDir && process.env.DEBUG) {
      console.log(`[git-adapter] DEBUG: GitAdapter constructor with baseDir=${options.baseDir}`);
    }
    this.git = options.git || simpleGit(options.baseDir);
  }

  /**
   * Get current branch name
   * @returns {Promise<string>} Current branch name
   * @example
   * await git.getCurrentBranch(); // "lane/operations/wu-1213"
   */
  async getCurrentBranch() {
    const result = await this.git.revparse([GIT_FLAGS.ABBREV_REF, 'HEAD']);
    return result.trim();
  }

  /**
   * Get git status (porcelain format string for compatibility)
   * @returns {Promise<string>} Status output in porcelain format
   * @example
   * await git.getStatus(); // " M file.txt\n?? untracked.txt"
   */
  async getStatus() {
    const result = await this.git.raw(['status', GIT_FLAGS.PORCELAIN]);
    return result.trim();
  }

  /**
   * Get unpushed commits (compared to upstream)
   * @returns {Promise<string>} Oneline log output for unpushed commits
   * @example
   * await git.getUnpushedCommits(); // "abc123 fix: ...\n"
   */
  async getUnpushedCommits() {
    const result = await this.git.raw([
      GIT_COMMANDS.LOG,
      GIT_REFS.UPSTREAM_RANGE,
      GIT_FLAGS.ONELINE,
    ]);
    return result.trim();
  }

  /**
   * Check if a branch exists
   * @param {string} branch - Branch name
   * @returns {Promise<boolean>} True if branch exists
   * @throws {TypeError} If branch is not a string
   * @throws {Error} If branch is empty
   * @example
   * await git.branchExists('main'); // true
   * await git.branchExists('nonexistent'); // false
   */
  async branchExists(branch: string): Promise<boolean> {
    assertNonEmptyString(branch, 'branch');
    try {
      await this.git.raw(['rev-parse', '--verify', branch]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a remote branch exists via git ls-remote --heads
   * @param {string} remote - Remote name (e.g., 'origin')
   * @param {string} branch - Branch name
   * @returns {Promise<boolean>} True if remote branch exists
   * @throws {TypeError} If remote or branch is not a string
   * @throws {Error} If remote or branch is empty
   * @example
   * await git.remoteBranchExists('origin', 'lane/operations/wu-123'); // true/false
   */
  async remoteBranchExists(remote: string, branch: string): Promise<boolean> {
    assertNonEmptyString(remote, 'remote');
    assertNonEmptyString(branch, 'branch');
    const result = await this.git.raw(['ls-remote', '--heads', remote, branch]);
    return result.trim().length > 0;
  }

  /**
   * Fetch from remote
   * @param {string} [remote] - Remote name (defaults to fetching all)
   * @param {string} [branch] - Branch name
   * @throws {TypeError} If remote or branch is not a string (when provided)
   * @example
   * await git.fetch('origin', 'main');
   * await git.fetch(); // Fetch all remotes
   */
  async fetch(remote?: string, branch?: string): Promise<void> {
    assertOptionalString(remote, 'remote');
    assertOptionalString(branch, 'branch');
    if (remote && branch) {
      await this.git.fetch(remote, branch);
    } else if (remote) {
      await this.git.fetch(remote);
    } else {
      await this.git.fetch();
    }
  }

  /**
   * Pull from remote branch
   * @param {string} remote - Remote name
   * @param {string} branch - Branch name
   * @throws {TypeError} If remote or branch is not a string
   * @example
   * await git.pull('origin', 'main');
   */
  async pull(remote: string, branch: string): Promise<void> {
    assertNonEmptyString(remote, 'remote');
    assertNonEmptyString(branch, 'branch');
    await this.git.pull(remote, branch);
  }

  /**
   * Get git config value
   * @param {string} key - Config key (e.g., 'user.email')
   * @returns {Promise<string>} Config value
   * @example
   * await git.getConfigValue('user.email'); // "user@example.com"
   */
  async getConfigValue(key: string): Promise<string> {
    const result = await this.git.raw(['config', key]);
    return result.trim();
  }

  /**
   * Check if working tree is clean (no uncommitted changes)
   * @returns {Promise<boolean>} True if clean
   * @example
   * await git.isClean(); // true or false
   */
  async isClean() {
    const status = await this.getStatus();
    return status === '';
  }

  /**
   * Add files to staging area
   * @param {string|string[]} files - Files to add
   * @throws {TypeError} If files is not a string or array
   * @throws {Error} If files is empty string or empty array
   * @example
   * await git.add('file.txt');
   * await git.add(['file1.txt', 'file2.txt']);
   * await git.add('.'); // Add all
   */
  async add(files: string | string[]): Promise<void> {
    assertStringOrArray(files, 'files');
    await this.git.add(files);
  }

  /**
   * Add files to staging area including deletions
   *
   * WU-1813: Stages modifications, additions, AND deletions for specified files.
   * Unlike add(), this uses `git add -A` which properly handles tracked file deletions.
   *
   * When files array is empty, stages all changes in the working directory (git add -A .)
   * to catch UnsafeAny deletions that might not have been explicitly listed.
   *
   * @param {string[]} files - Files to add (empty array = add all)
   * @example
   * await git.addWithDeletions(['modified.txt', 'deleted.txt']);
   * await git.addWithDeletions([]); // Add all changes including deletions
   */
  async addWithDeletions(files: string[]): Promise<void> {
    if (files && files.length > 0) {
      // Stage specific files with -A flag to include deletions
      // Using -- separator for safety with paths that might look like flags
      await this.git.raw(['add', '-A', '--', ...files]);
    } else {
      // Stage all changes including deletions
      await this.git.raw(['add', '-A', '.']);
    }
  }

  /**
   * Commit changes
   * @param {string} message - Commit message
   * @throws {TypeError} If message is not a string
   * @throws {Error} If message is empty
   * @example
   * await git.commit('feat: add new feature');
   */
  async commit(message: string): Promise<void> {
    assertNonEmptyString(message, 'message');
    await this.git.commit(message);
  }

  /**
   * Push to remote
   * @param {string} [remote='origin'] - Remote name
   * @param {string} [branch] - Branch name (uses current branch if not specified)
   * @param {object} [options] - Push options
   * @param {boolean} [options.setUpstream] - Set upstream tracking (-u flag)
   * @throws {TypeError} If remote or branch is not a string (when provided)
   * @example
   * await git.push('origin', 'main');
   * await git.push('origin', 'feature', { setUpstream: true });
   */
  async push(remote = 'origin', branch?: string, options: PushOptions = {}): Promise<void> {
    assertOptionalString(remote, 'remote');
    assertOptionalString(branch, 'branch');
    const pushOptions: Record<string, null> = {};
    if (options.setUpstream) {
      pushOptions[GIT_FLAGS.UPSTREAM] = null;
    }
    await this.git.push(remote, branch, pushOptions);
  }

  /**
   * Push using refspec to push local ref to different remote ref
   *
   * WU-1435: Enables push-only pattern to keep local main pristine.
   * Pushes directly to origin/main without updating local main.
   *
   * @param {string} remote - Remote name (e.g., 'origin')
   * @param {string} localRef - Local ref to push (e.g., 'tmp/wu-claim/wu-123')
   * @param {string} remoteRef - Remote ref to update (e.g., 'main')
   * @example
   * await git.pushRefspec('origin', 'tmp/wu-claim/wu-123', 'main');
   * // Equivalent to: git push origin tmp/wu-claim/wu-123:main
   */
  async pushRefspec(remote: string, localRef: string, remoteRef: string): Promise<void> {
    const refspec = `${localRef}:${remoteRef}`;
    await this.git.push(remote, refspec);
  }

  /**
   * Create and checkout a new branch
   * @param {string} branch - Branch name
   * @param {string} [startPoint] - Starting commit (defaults to HEAD)
   * @throws {TypeError} If branch is not a string, or startPoint is not a string (when provided)
   * @throws {Error} If branch is empty
   * @example
   * await git.createBranch('feature/new-feature');
   * await git.createBranch('hotfix/bug', 'main');
   */
  async createBranch(branch: string, startPoint?: string): Promise<void> {
    assertNonEmptyString(branch, 'branch');
    assertOptionalString(startPoint, 'startPoint');
    const args = [GIT_FLAGS.BRANCH, branch];
    if (startPoint) {
      args.push(startPoint);
    }
    await this.git.checkout(args);
  }

  /**
   * Checkout a branch
   * @param {string} branch - Branch name
   * @throws {TypeError} If branch is not a string
   * @throws {Error} If branch is empty
   * @example
   * await git.checkout('main');
   */
  async checkout(branch: string): Promise<void> {
    assertNonEmptyString(branch, 'branch');
    await this.git.checkout(branch);
  }

  /**
   * Get commit hash
   * @param {string} [ref='HEAD'] - Git ref
   * @returns {Promise<string>} Commit hash
   * @example
   * await git.getCommitHash(); // "a1b2c3d..."
   * await git.getCommitHash('main'); // "e4f5g6h..."
   */
  async getCommitHash(ref = 'HEAD'): Promise<string> {
    const result = await this.git.revparse([ref]);
    return result.trim();
  }

  /**
   * Merge a branch
   *
   * WU-1749: Bug 1 fix - Return success status and handle false positive failures.
   * simple-git's merge() returns a MergeSummary that we now properly handle.
   *
   * @param {string} branch - Branch to merge
   * @param {object} [options] - Merge options
   * @param {boolean} [options.ffOnly] - Fast-forward only merge
   * @returns {Promise<{success: boolean}>} Merge result
   * @throws {TypeError} If branch is not a string
   * @throws {Error} If branch is empty
   * @example
   * await git.merge('feature-branch');
   * await git.merge('feature-branch', { ffOnly: true });
   */
  async merge(branch: string, options: MergeOptions = {}): Promise<MergeResult> {
    assertNonEmptyString(branch, 'branch');
    const args: string[] = [];
    if (options.ffOnly) {
      args.push(GIT_FLAGS.FF_ONLY);
    }
    args.push(branch);
    await this.git.merge(args);
    // If we get here without throwing, merge succeeded
    return { success: true };
  }

  /**
   * Get commit log
   *
   * WU-1749: Bug 4 fix - Add log() method for counting commits.
   * Used by wu-done-retry-helpers.ts to count previous completion attempts.
   *
   * @param {object} [options] - Log options
   * @param {number} [options.maxCount] - Maximum number of commits to return
   * @returns {Promise<{all: Array<{hash: string, message: string}>, total: number}>} Log result
   * @example
   * await git.log({ maxCount: 50 });
   */
  async log(options: LogOptions = {}) {
    return await this.git.log(options);
  }

  // New semantic methods for wu- scripts (WU-1213)

  /**
   * Find common ancestor (merge base) of two refs
   * @param {string} ref1 - First ref
   * @param {string} ref2 - Second ref
   * @returns {Promise<string>} Common ancestor commit hash
   * @throws {TypeError} If ref1 or ref2 is not a string
   * @example
   * await git.mergeBase('main', 'feature'); // "abc123def456"
   */
  async mergeBase(ref1: string, ref2: string): Promise<string> {
    assertNonEmptyString(ref1, 'ref1');
    assertNonEmptyString(ref2, 'ref2');
    const result = await this.git.raw(['merge-base', ref1, ref2]);
    return result.trim();
  }

  /**
   * Simulate merge and detect conflicts without touching working tree
   * @param {string} base - Base commit hash
   * @param {string} ref1 - First ref to merge
   * @param {string} ref2 - Second ref to merge
   * @returns {Promise<string>} Merge tree output (contains conflict markers if conflicts exist)
   * @example
   * await git.mergeTree('base123', 'main', 'feature');
   */
  async mergeTree(base: string, ref1: string, ref2: string): Promise<string> {
    const result = await this.git.raw(['merge-tree', base, ref1, ref2]);
    return result;
  }

  /**
   * List commits with various options
   * @param {string[]} args - Arguments to pass to git rev-list
   * @returns {Promise<string>} Rev-list output
   * @example
   * await git.revList(['--count', '--left-right', 'main...feature']); // "5\t0"
   */
  async revList(args: string[]): Promise<string> {
    const result = await this.git.raw(['rev-list', ...args]);
    return result.trim();
  }

  /**
   * Add a worktree with new branch
   * @param {string} path - Worktree path
   * @param {string} branch - Branch name
   * @param {string} [startPoint] - Starting commit (defaults to HEAD)
   * @throws {TypeError} If path or branch is not a string
   * @throws {Error} If path or branch is empty
   * @example
   * await git.worktreeAdd('worktrees/feature', 'feature-branch', 'main');
   */
  async worktreeAdd(path: string, branch: string, startPoint?: string): Promise<void> {
    assertNonEmptyString(path, 'path');
    assertNonEmptyString(branch, 'branch');
    assertOptionalString(startPoint, 'startPoint');
    const args = ['worktree', 'add', path, GIT_FLAGS.BRANCH, branch];
    if (startPoint) {
      args.push(startPoint);
    }
    await this.git.raw(args);
  }

  /**
   * Remove a worktree
   *
   * WU-1476: Layer 1 defense - explicit directory cleanup after git worktree remove.
   * Git worktree remove can leave orphan directories when:
   * - The worktree was forcefully removed
   * - Git worktree metadata was corrupted
   * - Previous wu:done failed mid-workflow
   *
   * @param {string} worktreePath - Worktree path
   * @param {object} [options] - Remove options
   * @param {boolean} [options.force] - Force removal
   * @example
   * await git.worktreeRemove('worktrees/feature');
   * await git.worktreeRemove('worktrees/feature', { force: true });
   */
  async worktreeRemove(worktreePath: string, options: WorktreeRemoveOptions = {}): Promise<void> {
    const args = ['worktree', 'remove'];
    if (options.force) {
      args.push(GIT_FLAGS.FORCE);
    }
    args.push(worktreePath);

    // Attempt git worktree remove
    try {
      await this.git.raw(args);
    } catch (err) {
      // If git fails, we still want to clean up the directory
      // Re-throw after cleanup attempt to report the original error

      if (existsSync(worktreePath)) {
        rmSync(worktreePath, { recursive: true, force: true });
      }
      throw err;
    }

    // Layer 1 defense (WU-1476): Explicit cleanup if directory still exists
    // This handles edge cases where git worktree remove succeeds but leaves the directory

    if (existsSync(worktreePath)) {
      try {
        rmSync(worktreePath, { recursive: true, force: true });
      } catch (rmErr) {
        // WU-1014: Log but don't throw - git worktree remove succeeded, directory cleanup is best-effort
        console.warn(
          `[git-adapter] worktreeRemove: git succeeded but directory cleanup failed for ${worktreePath}: ${rmErr instanceof Error ? rmErr.message : String(rmErr)}`,
        );
      }
    }
  }

  /**
   * List all worktrees
   * @returns {Promise<string>} Worktree list in porcelain format
   * @example
   * await git.worktreeList();
   */
  async worktreeList() {
    const result = await this.git.raw(['worktree', 'list', GIT_FLAGS.PORCELAIN]);
    return result;
  }

  /**
   * Delete a branch
   * @param {string} branch - Branch name
   * @param {object} [options] - Delete options
   * @param {boolean} [options.force] - Force delete (use -D instead of -d)
   * @throws {TypeError} If branch is not a string
   * @throws {Error} If branch is empty
   * @example
   * await git.deleteBranch('feature');
   * await git.deleteBranch('feature', { force: true });
   */
  async deleteBranch(branch: string, options: DeleteBranchOptions = {}): Promise<void> {
    assertNonEmptyString(branch, 'branch');
    const flag = options.force ? GIT_FLAGS.DELETE_FORCE : GIT_FLAGS.DELETE;
    await this.git.branch([flag, branch]);
  }

  /**
   * Create a branch WITHOUT switching to it (WU-1262)
   * Used for micro-worktree pattern where main checkout stays on main
   * @param {string} branch - Branch name to create
   * @param {string} [startPoint] - Starting commit (defaults to HEAD)
   * @example
   * await git.createBranchNoCheckout('tmp/wu-create/wu-123', 'main');
   */
  async createBranchNoCheckout(branch: string, startPoint?: string): Promise<void> {
    const args = ['branch', branch];
    if (startPoint) {
      args.push(startPoint);
    }
    await this.git.raw(args);
  }

  /**
   * Add a worktree for an EXISTING branch (WU-1262)
   * Unlike worktreeAdd, this doesn't create a new branch
   * @param {string} path - Worktree path
   * @param {string} branch - Existing branch name
   * @example
   * await git.worktreeAddExisting('/tmp/wu-create-xyz', 'tmp/wu-create/wu-123');
   */
  async worktreeAddExisting(path: string, branch: string): Promise<void> {
    await this.git.raw(['worktree', 'add', path, branch]);
  }

  /**
   * Rebase current branch onto target (WU-1262)
   * Used in micro-worktree to rebase temp branch when main moves
   * @param {string} onto - Target ref to rebase onto
   * @throws {TypeError} If onto is not a string
   * @throws {Error} If onto is empty
   * @example
   * await git.rebase('main');
   */
  async rebase(onto: string): Promise<void> {
    assertNonEmptyString(onto, 'onto');
    const gitWithEditor = this.git.env({ ...process.env, GIT_EDITOR: 'true' });
    await gitWithEditor.rebase([onto]);
  }

  /**
   * Reset HEAD to specified commit
   * @param {string} [ref] - Commit ref to reset to (defaults to HEAD)
   * @param {object} [options] - Reset options
   * @param {boolean} [options.hard] - Hard reset (--hard flag)
   * @example
   * await git.reset('abc123', { hard: true });
   */
  async reset(ref?: string, options: ResetOptions = {}): Promise<void> {
    const args = ['reset'];
    if (options.hard) {
      args.push(GIT_FLAGS.HARD);
    }
    if (ref) {
      args.push(ref);
    }
    await this.git.raw(args);
  }

  /**
   * Execute arbitrary git command via raw()
   * @param {string[]} args - Git command arguments
   * @returns {Promise<string>} Command output
   * @throws {TypeError} If args is not an array
   * @example
   * await git.raw(['status', '--porcelain']);
   */
  async raw(args: string[]): Promise<string> {
    assertArray(args, 'args');
    const result = await this.git.raw(args);
    return result;
  }

  /**
   * WU-2208: List file/directory names at a given git ref and tree path.
   *
   * Uses `git ls-tree --name-only <ref> <path>/` to enumerate entries.
   * Returns an array of filenames (not full paths) within the directory.
   * Returns empty array if the path does not exist at the given ref.
   *
   * @param ref - Git ref (e.g., 'origin/main')
   * @param path - Directory path relative to repo root
   * @returns Array of filenames in the directory at the given ref
   */
  async listTreeAtRef(ref: string, path: string): Promise<string[]> {
    assertNonEmptyString(ref, 'ref');
    assertNonEmptyString(path, 'path');
    try {
      // Ensure path ends with / for directory listing
      const dirPath = path.endsWith('/') ? path : `${path}/`;
      const result = await this.git.raw(['ls-tree', '--name-only', ref, dirPath]);
      if (!result || result.trim().length === 0) {
        return [];
      }
      return result
        .trim()
        .split('\n')
        .filter((line) => line.length > 0);
    } catch {
      // Path doesn't exist at ref, or ref doesn't exist
      return [];
    }
  }

  /**
   * WU-2208: Show a file's content at a given git ref.
   *
   * Uses `git show <ref>:<path>` to retrieve file content.
   * Returns empty string if the file does not exist at the given ref.
   *
   * @param ref - Git ref (e.g., 'origin/main')
   * @param path - File path relative to repo root
   * @returns File content as string, or empty string if not found
   */
  async showFileAtRef(ref: string, path: string): Promise<string> {
    assertNonEmptyString(ref, 'ref');
    assertNonEmptyString(path, 'path');
    try {
      const result = await this.git.raw(['show', `${ref}:${path}`]);
      return result ?? '';
    } catch {
      // File doesn't exist at ref
      return '';
    }
  }

  // Deprecated methods (for backward compatibility during migration)

  /**
   * @deprecated Use async methods directly instead
   * Legacy method for backward compatibility
   * Execute a git command and return trimmed output
   * @param {string} cmd - Command to execute
   * @returns {string} Trimmed command output
   */
  run(cmd: string): never {
    throw createError(
      ErrorCodes.DEPRECATED_API,
      'GitAdapter.run() is deprecated (WU-1213). Use async methods instead. ' +
        `Attempted to run: ${cmd}`,
    );
  }

  /**
   * @deprecated Use worktreeAdd() instead
   */
  addWorktree(path: string, branch: string, startPoint?: string) {
    return this.worktreeAdd(path, branch, startPoint);
  }

  /**
   * @deprecated Use worktreeRemove() instead
   */
  removeWorktree(path: string, options?: WorktreeRemoveOptions) {
    return this.worktreeRemove(path, options);
  }
}

// WU-1235: Factory functions for explicit directory control

/**
 * Create a GitAdapter for a specific directory
 * Use this when you need git operations in an explicit path (e.g., worktree vs main)
 * @param {string} baseDir - Directory for git operations
 * @returns {GitAdapter} New GitAdapter instance for the specified directory
 * @example
 * const gitWorktree = createGitForPath('/path/to/worktree');
 * const gitMain = createGitForPath('/path/to/main');
 */
export function createGitForPath(baseDir: string): GitAdapter {
  return new GitAdapter({ baseDir });
}

/**
 * Create a GitAdapter for the current working directory
 * Captures process.cwd() at call time (not import time)
 * Use this after process.chdir() to get an adapter for the new directory
 * @returns {GitAdapter} New GitAdapter instance for current process.cwd()
 * @example
 * process.chdir(worktreePath);
 * const git = getGitForCwd(); // Uses new directory
 */
export function getGitForCwd(): GitAdapter {
  const cwd = process.cwd();
  if (process.env.DEBUG) {
    console.log(`[git-adapter] DEBUG: getGitForCwd() creating adapter with baseDir=${cwd}`);
  }
  return new GitAdapter({ baseDir: cwd });
}

// Singleton deprecation tracking
let singletonWarned = false;

/**
 * Reset singleton warning flag (for testing only)
 * @internal
 */
export function _resetSingletonWarning() {
  singletonWarned = false;
}

/**
 * @deprecated Use createGitForPath() or getGitForCwd() instead
 * Singleton GitAdapter instance - captured cwd at module load time
 * WARNING: Does not respect process.chdir() - use factory functions for worktree operations
 * @type {GitAdapter}
 */
const gitSingleton = new GitAdapter();

export const git = new Proxy(gitSingleton, {
  get(target, prop) {
    if (!singletonWarned) {
      console.warn(
        '[DEPRECATED] git singleton captured cwd at import time. ' +
          'Use createGitForPath(path) or getGitForCwd() for explicit directory control.',
      );
      singletonWarned = true;
    }
    const value = target[prop as keyof GitAdapter];
    // Bind methods to preserve 'this' context
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

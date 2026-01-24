/**
 * Git State Reader for WU Context
 *
 * WU-1090: Context-aware state machine for WU lifecycle commands
 *
 * Reads git state including:
 * - Current branch
 * - Dirty working tree (uncommitted changes)
 * - Staged changes
 * - Ahead/behind tracking branch
 *
 * Uses simple-git library (NOT execSync) per library-first mandate.
 *
 * @module
 */

import { simpleGit, type SimpleGit } from 'simple-git';

/**
 * Git state information for WU operations.
 *
 * Captures the current git state relevant to command execution.
 */
export interface GitState {
  /** Current branch name (null if detached) */
  branch: string | null;
  /** Whether HEAD is detached */
  isDetached: boolean;
  /** Whether working tree has uncommitted changes */
  isDirty: boolean;
  /** Whether there are staged changes */
  hasStaged: boolean;
  /** Commits ahead of tracking branch */
  ahead: number;
  /** Commits behind tracking branch */
  behind: number;
  /** Tracking branch (e.g., 'origin/main') */
  tracking: string | null;
  /** List of modified files */
  modifiedFiles: string[];
  /** Whether an error occurred reading state */
  hasError: boolean;
  /** Error message if hasError is true */
  errorMessage: string | null;
}

/**
 * Read current git state using simple-git library.
 *
 * Uses git status to efficiently gather all state in one operation.
 *
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns Promise<GitState> - Current git state
 */
export async function readGitState(cwd: string = process.cwd()): Promise<GitState> {
  try {
    const git: SimpleGit = simpleGit(cwd);
    const status = await git.status();

    // Determine if working tree is dirty
    const isDirty = !status.isClean();

    // Check for staged changes - simple-git provides staged array
    const hasStaged = status.staged.length > 0;

    return {
      branch: status.current,
      isDetached: status.detached === true,
      isDirty,
      hasStaged,
      ahead: status.ahead,
      behind: status.behind,
      tracking: status.tracking,
      modifiedFiles: status.modified || [],
      hasError: false,
      errorMessage: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      branch: null,
      isDetached: false,
      isDirty: false,
      hasStaged: false,
      ahead: 0,
      behind: 0,
      tracking: null,
      modifiedFiles: [],
      hasError: true,
      errorMessage: message,
    };
  }
}

/**
 * @file worktree-manager.ts
 * @description Git worktree lifecycle management for LumenFlow
 *
 * Provides safe worktree creation and cleanup for WU isolation.
 * Used by wu:claim and wu:done to manage parallel work contexts.
 */

import { existsSync, rmSync } from 'node:fs';
import { GitAdapter, createGitAdapter, type GitAdapterOptions } from './git-adapter.js';

/**
 * Information about a git worktree
 */
export interface WorktreeInfo {
  /** Absolute path to the worktree */
  path: string;
  /** HEAD commit hash */
  head: string;
  /** Branch name (null if detached) */
  branch: string | null;
}

/**
 * Options for creating a worktree
 */
export interface WorktreeCreateOptions {
  /** Path where worktree will be created */
  path: string;
  /** Branch name to create */
  branch: string;
  /** Starting commit (default: HEAD) */
  startPoint?: string;
}

/**
 * Options for removing a worktree
 */
export interface WorktreeRemoveOptions {
  /** Force removal even with uncommitted changes */
  force?: boolean;
}

/**
 * Result of worktree creation
 */
export interface WorktreeCreateResult {
  /** Path where worktree was created */
  path: string;
  /** Branch name */
  branch: string;
}

/**
 * Options for WorktreeManager
 */
export interface WorktreeManagerOptions {
  /** GitAdapter instance (or options to create one) */
  git?: GitAdapter | GitAdapterOptions;
  /** Base directory for git operations */
  baseDir?: string;
}

/**
 * WorktreeManager - Git worktree lifecycle management
 *
 * @example
 * \`\`\`ts
 * const manager = createWorktreeManager({ baseDir: '/path/to/repo' });
 *
 * // Create worktree for a WU
 * await manager.create({
 *   path: 'worktrees/operations-wu-123',
 *   branch: 'lane/operations/wu-123',
 *   startPoint: 'origin/main'
 * });
 *
 * // Clean up after wu:done
 * await manager.remove('worktrees/operations-wu-123');
 * \`\`\`
 */
export class WorktreeManager {
  private readonly git: GitAdapter;

  constructor(options: WorktreeManagerOptions = {}) {
    if (options.git instanceof GitAdapter) {
      this.git = options.git;
    } else {
      this.git = createGitAdapter(options.git ?? { baseDir: options.baseDir });
    }
  }

  /**
   * Create a new worktree with a branch
   * @param options - Creation options
   * @returns Created worktree info
   * @throws Error if path or branch is empty
   */
  async create(options: WorktreeCreateOptions): Promise<WorktreeCreateResult> {
    if (!options.path) {
      throw new Error('Worktree path is required');
    }
    if (!options.branch) {
      throw new Error('Branch name is required');
    }

    const args = ['worktree', 'add', options.path, '-b', options.branch];
    if (options.startPoint) {
      args.push(options.startPoint);
    }

    await this.git.raw(args);

    return {
      path: options.path,
      branch: options.branch,
    };
  }

  /**
   * Remove a worktree safely
   *
   * Handles edge cases:
   * - Worktree already removed
   * - Orphan directories after failed git operations
   * - Git worktree metadata corruption
   *
   * @param worktreePath - Path to the worktree
   * @param options - Remove options
   */
  async remove(worktreePath: string, options: WorktreeRemoveOptions = {}): Promise<void> {
    if (!worktreePath) {
      throw new Error('Worktree path is required');
    }

    // Check if path exists - worktreePath is validated above (non-empty string)

    if (!existsSync(worktreePath)) {
      return; // Already removed
    }

    // Try git worktree remove
    try {
      const args = ['worktree', 'remove'];
      if (options.force) {
        args.push('--force');
      }
      args.push(worktreePath);
      await this.git.raw(args);
    } catch {
      // Git command failed - clean up directory manually
    }

    // Layer 1 defense: Clean up orphan directory if it still exists

    if (existsSync(worktreePath)) {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  }

  /**
   * List all worktrees
   * @returns Array of worktree information
   */
  async list(): Promise<WorktreeInfo[]> {
    const output = await this.git.raw(['worktree', 'list', '--porcelain']);

    if (!output.trim()) {
      return [];
    }

    const worktrees: WorktreeInfo[] = [];
    const blocks = output.split('\n\n').filter(Boolean);

    for (const block of blocks) {
      const lines = block.split('\n');
      let path = '';
      let head = '';
      let branch: string | null = null;

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          path = line.slice('worktree '.length);
        } else if (line.startsWith('HEAD ')) {
          head = line.slice('HEAD '.length);
        } else if (line.startsWith('branch ')) {
          // Extract branch name from refs/heads/...
          const ref = line.slice('branch '.length);
          branch = ref.replace('refs/heads/', '');
        } else if (line === 'detached') {
          branch = null;
        }
      }

      if (path && head) {
        worktrees.push({ path, head, branch });
      }
    }

    return worktrees;
  }

  /**
   * Check if a worktree exists at a path
   * @param worktreePath - Path to check
   * @returns True if worktree exists in git's tracking
   */
  async exists(worktreePath: string): Promise<boolean> {
    const worktrees = await this.list();
    return worktrees.some((wt) => wt.path === worktreePath);
  }
}

/**
 * Factory function to create a WorktreeManager
 * @param options - Manager options
 * @returns New WorktreeManager instance
 */
export function createWorktreeManager(options: WorktreeManagerOptions = {}): WorktreeManager {
  return new WorktreeManager(options);
}

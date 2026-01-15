/**
 * WorktreeGuard - Worktree context verification (WU-2537)
 * @module @lumenflow/core/lib
 */

export class WorktreeGuard {
  private readonly currentPath: string;

  constructor(currentPath: string) {
    this.currentPath = currentPath;
  }

  async isInWorktree(): Promise<boolean> {
    return this.currentPath.includes('worktrees/');
  }

  async getCurrentWorktreePath(): Promise<string | null> {
    if (await this.isInWorktree()) {
      return this.currentPath;
    }
    return null;
  }

  async assertInWorktree(): Promise<void> {
    if (!(await this.isInWorktree())) {
      throw new Error(
        'Operation requires worktree context, but running from main checkout'
      );
    }
  }

  getWorktreeWuId(): string | null {
    const match = this.currentPath.match(/worktrees\/[^/]+-wu-(\d+)/);
    if (!match) {
      return null;
    }
    return `WU-${match[1]}`;
  }
}

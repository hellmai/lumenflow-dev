/**
 * @file guard-main-branch.test.ts
 * @description Tests for guard-main-branch worktree context detection (WU-1130)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { guardMainBranch } from '../guard-main-branch.js';

// Mock the core module
vi.mock('@lumenflow/core', () => ({
  createGitForPath: vi.fn(),
  getGitForCwd: vi.fn(),
  isAgentBranch: vi.fn().mockResolvedValue(false),
  getConfig: vi.fn().mockReturnValue({
    git: {
      mainBranch: 'main',
      laneBranchPrefix: 'lane/',
    },
  }),
}));

// Mock the worktree-guard module
vi.mock('@lumenflow/core/core/worktree-guard', () => ({
  isInWorktree: vi.fn(),
}));

import { getGitForCwd, createGitForPath } from '@lumenflow/core';
import { isInWorktree } from '@lumenflow/core/core/worktree-guard';

describe('guard-main-branch (WU-1130)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('lane branch worktree detection', () => {
    it('should allow operations when on lane branch AND in worktree', async () => {
      // Setup: On lane branch, in worktree
      const mockGit = {
        getCurrentBranch: vi.fn().mockResolvedValue('lane/framework-cli/wu-1130'),
      };
      vi.mocked(getGitForCwd).mockReturnValue(
        mockGit as unknown as ReturnType<typeof getGitForCwd>,
      );
      vi.mocked(isInWorktree).mockReturnValue(true);

      const result = await guardMainBranch({});

      expect(result.success).toBe(true);
      expect(result.isProtected).toBe(false);
      expect(result.currentBranch).toBe('lane/framework-cli/wu-1130');
    });

    it('should block operations when on lane branch but NOT in worktree', async () => {
      // Setup: On lane branch, but not in worktree (e.g., checked out directly)
      const mockGit = {
        getCurrentBranch: vi.fn().mockResolvedValue('lane/framework-cli/wu-1130'),
      };
      vi.mocked(getGitForCwd).mockReturnValue(
        mockGit as unknown as ReturnType<typeof getGitForCwd>,
      );
      vi.mocked(isInWorktree).mockReturnValue(false);

      const result = await guardMainBranch({});

      expect(result.success).toBe(true);
      expect(result.isProtected).toBe(true);
      expect(result.reason).toContain('requires worktree');
    });

    it('should use baseDir for worktree detection when provided', async () => {
      const mockGit = {
        getCurrentBranch: vi.fn().mockResolvedValue('lane/ops-tooling/wu-2725'),
      };
      vi.mocked(createGitForPath).mockReturnValue(
        mockGit as unknown as ReturnType<typeof createGitForPath>,
      );
      vi.mocked(isInWorktree).mockReturnValue(true);

      const result = await guardMainBranch({ baseDir: '/path/to/worktrees/ops-tooling-wu-2725' });

      expect(isInWorktree).toHaveBeenCalledWith({ cwd: '/path/to/worktrees/ops-tooling-wu-2725' });
      expect(result.isProtected).toBe(false);
    });
  });

  describe('main branch protection', () => {
    it('should block operations on main branch', async () => {
      const mockGit = {
        getCurrentBranch: vi.fn().mockResolvedValue('main'),
      };
      vi.mocked(getGitForCwd).mockReturnValue(
        mockGit as unknown as ReturnType<typeof getGitForCwd>,
      );

      const result = await guardMainBranch({});

      expect(result.isProtected).toBe(true);
      expect(result.reason).toContain("'main' is protected");
    });
  });
});

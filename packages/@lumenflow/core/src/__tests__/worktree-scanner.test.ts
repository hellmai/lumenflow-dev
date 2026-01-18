/**
 * Worktree Scanner Tests (WU-1748)
 *
 * TDD: Tests written first, implementation follows.
 * Scans existing worktrees to detect uncommitted changes for abandoned WU visibility.
 *
 * @see {@link tools/lib/worktree-scanner.mjs} - Implementation
 */

import { describe, it, expect } from 'vitest';

// Import will fail initially (TDD - write test first)
// import { scanWorktrees, getWorktreeStatus, parseWorktreeList } from '../worktree-scanner.js';

/**
 * Test fixtures for worktree scanning
 */
const FIXTURES = {
  /** Example git worktree list output */
  worktreeListOutput: `/home/user/project                        abc1234 [main]
/home/user/project/worktrees/operations-wu-1234  def5678 [lane/operations/wu-1234]
/home/user/project/worktrees/experience-wu-1235  ghi9012 [lane/experience/wu-1235]
`,

  /** Example git status --porcelain output with uncommitted changes */
  gitStatusWithChanges: [' M src/file1.ts', ' M src/file2.ts', '?? src/newfile.ts'].join('\n'),

  /** Example git status --porcelain output with no changes */
  gitStatusClean: '',

  /** Example git log output for last commit timestamp */
  gitLogOutput: '2025-12-16T10:30:00+00:00',
};

describe('worktree-scanner', () => {
  describe('parseWorktreeList', () => {
    it('should parse git worktree list output into structured data', async () => {
      // Dynamic import to allow test to run even before module exists
      const { parseWorktreeList } = await import('../worktree-scanner.js');

      const result = parseWorktreeList(FIXTURES.worktreeListOutput);

      expect(result.length).toBe(3);
      // Main worktree has no wuId
      expect(result[0].path).toBe('/home/user/project');
      expect(result[0].sha).toBe('abc1234');
      expect(result[0].branch).toBe('main');
      expect(result[0].isMain).toBe(true);
      expect(result[0].wuId).toBe(undefined);

      // WU worktrees have wuId extracted
      expect(result[1].path).toBe('/home/user/project/worktrees/operations-wu-1234');
      expect(result[1].sha).toBe('def5678');
      expect(result[1].branch).toBe('lane/operations/wu-1234');
      expect(result[1].isMain).toBe(false);
      expect(result[1].wuId).toBe('WU-1234');
    });

    it('should extract WU ID from lane branch name', async () => {
      const { parseWorktreeList } = await import('../worktree-scanner.js');

      const result = parseWorktreeList(FIXTURES.worktreeListOutput);

      expect(result[1].wuId).toBe('WU-1234');
      expect(result[2].wuId).toBe('WU-1235');
    });

    it('should handle main worktree without WU ID', async () => {
      const { parseWorktreeList } = await import('../worktree-scanner.js');

      const result = parseWorktreeList(FIXTURES.worktreeListOutput);

      expect(result[0].wuId).toBe(undefined);
    });
  });

  describe('getWorktreeStatus', () => {
    it('should detect uncommitted changes in worktree', async () => {
      const { getWorktreeStatus } = await import('../worktree-scanner.js');

      // Create mock execAsync function
      const mockExecAsync = async (cmd) => {
        if (cmd.includes('status --porcelain')) {
          return { stdout: FIXTURES.gitStatusWithChanges, stderr: '' };
        }
        if (cmd.includes('log -1')) {
          return { stdout: FIXTURES.gitLogOutput, stderr: '' };
        }
        return { stdout: '', stderr: '' };
      };

      const result = await getWorktreeStatus('/fake/worktree/path', { execAsync: mockExecAsync });

      expect(result.hasUncommittedChanges).toBe(true);
      expect(result.uncommittedFileCount).toBe(3);
      expect(result.uncommittedFiles).toEqual(['src/file1.ts', 'src/file2.ts', 'src/newfile.ts']);
    });

    it('should report clean worktree with no uncommitted changes', async () => {
      const { getWorktreeStatus } = await import('../worktree-scanner.js');

      const mockExecAsync = async (cmd) => {
        if (cmd.includes('status --porcelain')) {
          return { stdout: FIXTURES.gitStatusClean, stderr: '' };
        }
        if (cmd.includes('log -1')) {
          return { stdout: FIXTURES.gitLogOutput, stderr: '' };
        }
        return { stdout: '', stderr: '' };
      };

      const result = await getWorktreeStatus('/fake/worktree/path', { execAsync: mockExecAsync });

      expect(result.hasUncommittedChanges).toBe(false);
      expect(result.uncommittedFileCount).toBe(0);
      expect(result.uncommittedFiles).toEqual([]);
    });

    it('should include last activity timestamp from git log', async () => {
      const { getWorktreeStatus } = await import('../worktree-scanner.js');

      const mockExecAsync = async (cmd) => {
        if (cmd.includes('status --porcelain')) {
          return { stdout: '', stderr: '' };
        }
        if (cmd.includes('log -1')) {
          return { stdout: '2025-12-16T10:30:00+00:00', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      };

      const result = await getWorktreeStatus('/fake/worktree/path', { execAsync: mockExecAsync });

      expect(result.lastActivityTimestamp).toBe('2025-12-16T10:30:00+00:00');
    });
  });

  describe('scanWorktrees', () => {
    it('should return all worktrees with their status', async () => {
      const { scanWorktrees } = await import('../worktree-scanner.js');

      const mockExecAsync = async (cmd) => {
        if (cmd.includes('worktree list')) {
          return { stdout: FIXTURES.worktreeListOutput, stderr: '' };
        }
        if (cmd.includes('status --porcelain')) {
          return { stdout: FIXTURES.gitStatusWithChanges, stderr: '' };
        }
        if (cmd.includes('log -1')) {
          return { stdout: FIXTURES.gitLogOutput, stderr: '' };
        }
        return { stdout: '', stderr: '' };
      };

      const result = await scanWorktrees('/fake/base/path', { execAsync: mockExecAsync });

      // Should include WU worktrees but not main
      expect(result.worktrees.length).toBe(2);
      expect(result.worktrees[0].wuId).toBe('WU-1234');
      expect(result.worktrees[1].wuId).toBe('WU-1235');
    });

    it('should identify abandoned WUs with uncommitted changes', async () => {
      const { scanWorktrees } = await import('../worktree-scanner.js');

      const mockExecAsync = async (cmd) => {
        if (cmd.includes('worktree list')) {
          return { stdout: FIXTURES.worktreeListOutput, stderr: '' };
        }
        if (cmd.includes('status --porcelain')) {
          return { stdout: FIXTURES.gitStatusWithChanges, stderr: '' };
        }
        if (cmd.includes('log -1')) {
          // Old timestamp = potentially abandoned
          return { stdout: '2025-12-15T10:30:00+00:00', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      };

      const result = await scanWorktrees('/fake/base/path', { execAsync: mockExecAsync });

      // All worktrees have uncommitted changes
      expect(result.worktreesWithUncommittedWork.length).toBe(2);
      expect(result.worktreesWithUncommittedWork[0].wuId).toBe('WU-1234');
    });

    it('should calculate summary statistics', async () => {
      const { scanWorktrees } = await import('../worktree-scanner.js');

      const mockExecAsync = async (cmd) => {
        if (cmd.includes('worktree list')) {
          return { stdout: FIXTURES.worktreeListOutput, stderr: '' };
        }
        if (cmd.includes('status --porcelain')) {
          return { stdout: FIXTURES.gitStatusWithChanges, stderr: '' };
        }
        if (cmd.includes('log -1')) {
          return { stdout: FIXTURES.gitLogOutput, stderr: '' };
        }
        return { stdout: '', stderr: '' };
      };

      const result = await scanWorktrees('/fake/base/path', { execAsync: mockExecAsync });

      expect(result.summary.totalWorktrees).toBe(2);
      expect(result.summary.withUncommittedChanges).toBe(2);
      expect(result.summary.totalUncommittedFiles).toBe(6); // 3 files * 2 worktrees
    });
  });

  describe('edge cases', () => {
    it('should handle empty worktree list', async () => {
      const { parseWorktreeList } = await import('../worktree-scanner.js');

      const result = parseWorktreeList('');

      expect(result).toEqual([]);
    });

    it('should handle worktree with detached HEAD', async () => {
      const { parseWorktreeList } = await import('../worktree-scanner.js');

      const detachedOutput = `/home/user/project  abc1234 (detached HEAD)
`;
      const result = parseWorktreeList(detachedOutput);

      expect(result.length).toBe(1);
      // Branch is captured without parentheses (inner content of capture group)
      expect(result[0].branch).toBe('detached HEAD');
    });

    it('should handle git command failures gracefully', async () => {
      const { getWorktreeStatus } = await import('../worktree-scanner.js');

      const mockExecAsync = async () => {
        throw new Error('git command failed');
      };

      const result = await getWorktreeStatus('/fake/worktree/path', { execAsync: mockExecAsync });

      expect(result.error).toBe('git command failed');
      expect(result.hasUncommittedChanges).toBe(false);
    });
  });
});

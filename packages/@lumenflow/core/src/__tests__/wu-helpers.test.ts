/**
 * @fileoverview Tests for wu-helpers module
 *
 * WU-1091: Tests for ensureOnMain() agent branch bypass functionality
 *
 * @module __tests__/wu-helpers.test
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// Mock the branch-check module
vi.mock('../branch-check.js', () => ({
  isAgentBranchWithDetails: vi.fn(),
}));

// Import after mocking
import { ensureOnMain } from '../wu-helpers.js';
import { isAgentBranchWithDetails } from '../branch-check.js';

describe('wu-helpers', () => {
  describe('ensureOnMain', () => {
    let mockGit: { getCurrentBranch: Mock };

    beforeEach(() => {
      mockGit = {
        getCurrentBranch: vi.fn(),
      };
      vi.clearAllMocks();
    });

    describe('on main branch', () => {
      it('should not throw when on main branch', async () => {
        mockGit.getCurrentBranch.mockResolvedValue('main');

        await expect(ensureOnMain(mockGit)).resolves.not.toThrow();
      });

      it('should not call isAgentBranchWithDetails when already on main', async () => {
        mockGit.getCurrentBranch.mockResolvedValue('main');

        await ensureOnMain(mockGit);

        expect(isAgentBranchWithDetails).not.toHaveBeenCalled();
      });
    });

    describe('agent branch bypass (WU-1091)', () => {
      it('should call isAgentBranchWithDetails when not on main', async () => {
        mockGit.getCurrentBranch.mockResolvedValue('claude/session-123');
        vi.mocked(isAgentBranchWithDetails).mockResolvedValue({
          isMatch: true,
          patternResult: {
            patterns: ['claude/*'],
            source: 'registry',
            registryFetched: true,
          },
        });

        await ensureOnMain(mockGit);

        expect(isAgentBranchWithDetails).toHaveBeenCalledWith('claude/session-123');
      });

      it('should NOT throw for claude/* agent branches', async () => {
        mockGit.getCurrentBranch.mockResolvedValue('claude/session-abc');
        vi.mocked(isAgentBranchWithDetails).mockResolvedValue({
          isMatch: true,
          patternResult: {
            patterns: ['claude/*'],
            source: 'registry',
            registryFetched: true,
          },
        });

        await expect(ensureOnMain(mockGit)).resolves.not.toThrow();
      });

      it('should NOT throw for codex/* agent branches', async () => {
        mockGit.getCurrentBranch.mockResolvedValue('codex/workspace-xyz');
        vi.mocked(isAgentBranchWithDetails).mockResolvedValue({
          isMatch: true,
          patternResult: {
            patterns: ['codex/*'],
            source: 'registry',
            registryFetched: true,
          },
        });

        await expect(ensureOnMain(mockGit)).resolves.not.toThrow();
      });

      it('should NOT throw for copilot/* agent branches', async () => {
        mockGit.getCurrentBranch.mockResolvedValue('copilot/pr-fix-123');
        vi.mocked(isAgentBranchWithDetails).mockResolvedValue({
          isMatch: true,
          patternResult: {
            patterns: ['copilot/*'],
            source: 'registry',
            registryFetched: true,
          },
        });

        await expect(ensureOnMain(mockGit)).resolves.not.toThrow();
      });

      it('should NOT throw for cursor/* agent branches', async () => {
        mockGit.getCurrentBranch.mockResolvedValue('cursor/composer-session');
        vi.mocked(isAgentBranchWithDetails).mockResolvedValue({
          isMatch: true,
          patternResult: {
            patterns: ['cursor/*'],
            source: 'registry',
            registryFetched: true,
          },
        });

        await expect(ensureOnMain(mockGit)).resolves.not.toThrow();
      });

      it('should NOT throw for generic agent/* branches', async () => {
        mockGit.getCurrentBranch.mockResolvedValue('agent/automation-task');
        vi.mocked(isAgentBranchWithDetails).mockResolvedValue({
          isMatch: true,
          patternResult: {
            patterns: ['agent/*'],
            source: 'defaults',
            registryFetched: false,
          },
        });

        await expect(ensureOnMain(mockGit)).resolves.not.toThrow();
      });
    });

    describe('lane branches require worktree (no bypass)', () => {
      it('should throw for lane/* branches (no agent bypass)', async () => {
        mockGit.getCurrentBranch.mockResolvedValue('lane/operations/wu-123');
        vi.mocked(isAgentBranchWithDetails).mockResolvedValue({
          isMatch: false,
          patternResult: {
            patterns: [],
            source: 'defaults',
            registryFetched: false,
          },
        });

        await expect(ensureOnMain(mockGit)).rejects.toThrow(
          "Run from shared checkout on 'main' (found 'lane/operations/wu-123')",
        );
      });

      it('should throw for nested lane branches', async () => {
        mockGit.getCurrentBranch.mockResolvedValue('lane/framework-core/wu-1091');
        vi.mocked(isAgentBranchWithDetails).mockResolvedValue({
          isMatch: false,
          patternResult: {
            patterns: [],
            source: 'defaults',
            registryFetched: false,
          },
        });

        await expect(ensureOnMain(mockGit)).rejects.toThrow(
          "Run from shared checkout on 'main' (found 'lane/framework-core/wu-1091')",
        );
      });
    });

    describe('protected branches remain protected', () => {
      it('should never allow bypass for main even if somehow matched as agent', async () => {
        // This test ensures main is always handled first (early return before agent check)
        mockGit.getCurrentBranch.mockResolvedValue('main');

        await ensureOnMain(mockGit);

        // isAgentBranchWithDetails should not be called for main
        expect(isAgentBranchWithDetails).not.toHaveBeenCalled();
      });
    });

    describe('non-agent branches throw', () => {
      it('should throw for feature/* branches', async () => {
        mockGit.getCurrentBranch.mockResolvedValue('feature/my-feature');
        vi.mocked(isAgentBranchWithDetails).mockResolvedValue({
          isMatch: false,
          patternResult: {
            patterns: ['claude/*', 'codex/*'],
            source: 'registry',
            registryFetched: true,
          },
        });

        await expect(ensureOnMain(mockGit)).rejects.toThrow(
          "Run from shared checkout on 'main' (found 'feature/my-feature')",
        );
      });

      it('should throw for arbitrary branches', async () => {
        mockGit.getCurrentBranch.mockResolvedValue('some-random-branch');
        vi.mocked(isAgentBranchWithDetails).mockResolvedValue({
          isMatch: false,
          patternResult: {
            patterns: [],
            source: 'defaults',
            registryFetched: false,
          },
        });

        await expect(ensureOnMain(mockGit)).rejects.toThrow(
          "Run from shared checkout on 'main' (found 'some-random-branch')",
        );
      });
    });

    describe('observability logging (WU-1091)', () => {
      it('should log when bypassing for agent branch', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        mockGit.getCurrentBranch.mockResolvedValue('claude/session-123');
        vi.mocked(isAgentBranchWithDetails).mockResolvedValue({
          isMatch: true,
          patternResult: {
            patterns: ['claude/*'],
            source: 'registry',
            registryFetched: true,
          },
        });

        await ensureOnMain(mockGit);

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('[ensureOnMain] Bypassing for agent branch'),
        );
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('claude/session-123'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('registry'));

        consoleSpy.mockRestore();
      });

      it('should include source in log message', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        mockGit.getCurrentBranch.mockResolvedValue('agent/task-1');
        vi.mocked(isAgentBranchWithDetails).mockResolvedValue({
          isMatch: true,
          patternResult: {
            patterns: ['agent/*'],
            source: 'defaults',
            registryFetched: false,
          },
        });

        await ensureOnMain(mockGit);

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('defaults'));

        consoleSpy.mockRestore();
      });
    });
  });
});

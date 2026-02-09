/**
 * @fileoverview Tests for wu-helpers module
 *
 * WU-1091: Tests for ensureOnMain() agent branch bypass functionality
 * WU-1102: Additional tests for helper functions
 *
 * @module __tests__/wu-helpers.test
 */

import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

// Mock the branch-check module
vi.mock('../branch-check.js', () => ({
  isAgentBranchWithDetails: vi.fn(),
}));

// Import after mocking
import {
  ensureOnMain,
  validateWUIDFormat,
  run,
  extractWUFromBranch,
  validateBranchName,
  checkWUStatus,
  formatHookError,
  extractWUFromCommitMessage,
  ensureMainUpToDate,
} from '../wu-helpers.js';
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

  describe('validateWUIDFormat', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // WU-1538: die() now throws ProcessExitError instead of calling process.exit
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    it('should not throw for valid WU ID format', () => {
      expect(() => validateWUIDFormat('WU-123')).not.toThrow();
      expect(() => validateWUIDFormat('WU-1')).not.toThrow();
      expect(() => validateWUIDFormat('WU-99999')).not.toThrow();
    });

    it('should throw ProcessExitError for lowercase wu id', () => {
      expect(() => validateWUIDFormat('wu-123')).toThrow();
    });

    it('should throw ProcessExitError for wrong prefix', () => {
      expect(() => validateWUIDFormat('TICKET-123')).toThrow();
    });

    it('should throw ProcessExitError for missing number', () => {
      expect(() => validateWUIDFormat('WU-')).toThrow();
    });

    it('should throw ProcessExitError for empty string', () => {
      expect(() => validateWUIDFormat('')).toThrow();
    });
  });

  describe('run', () => {
    it('should execute command and return output', () => {
      const result = run('echo hello');
      expect(result).toBe('hello');
    });

    it('should return empty string on command failure', () => {
      const result = run('nonexistent-command-12345');
      expect(result).toBe('');
    });

    it('should trim output', () => {
      const result = run('echo "  hello  "');
      expect(result).toBe('hello');
    });
  });

  describe('extractWUFromBranch', () => {
    it('should extract WU ID from lane branch', () => {
      expect(extractWUFromBranch('lane/framework-core/wu-123')).toBe('WU-123');
    });

    it('should extract and uppercase WU ID', () => {
      expect(extractWUFromBranch('lane/ops/wu-456')).toBe('WU-456');
    });

    it('should return null for main branch', () => {
      expect(extractWUFromBranch('main')).toBeNull();
    });

    it('should return null for feature branch', () => {
      expect(extractWUFromBranch('feature/my-feature')).toBeNull();
    });

    it('should return null for null input', () => {
      expect(extractWUFromBranch(null as unknown as string)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(extractWUFromBranch('')).toBeNull();
    });

    it('should return null for agent branches', () => {
      expect(extractWUFromBranch('claude/session-123')).toBeNull();
    });
  });

  describe('validateBranchName', () => {
    it('should return valid for main branch', () => {
      const result = validateBranchName('main');
      expect(result.valid).toBe(true);
      expect(result.lane).toBeNull();
      expect(result.wuid).toBeNull();
      expect(result.error).toBeNull();
    });

    it('should return valid for lane branch and extract info', () => {
      const result = validateBranchName('lane/framework-core/wu-123');
      expect(result.valid).toBe(true);
      expect(result.lane).toBe('framework-core');
      expect(result.wuid).toBe('WU-123');
      expect(result.error).toBeNull();
    });

    it('should return invalid for feature branch', () => {
      const result = validateBranchName('feature/my-feature');
      expect(result.valid).toBe(false);
      expect(result.error).toContain("doesn't follow lane");
    });

    it('should return valid for null branch', () => {
      const result = validateBranchName(null as unknown as string);
      expect(result.valid).toBe(true);
    });

    it('should return valid for empty string', () => {
      const result = validateBranchName('');
      expect(result.valid).toBe(true);
    });

    it('should uppercase WU ID in result', () => {
      const result = validateBranchName('lane/ops/wu-999');
      expect(result.wuid).toBe('WU-999');
    });
  });

  describe('formatHookError', () => {
    it('should format hook error message', () => {
      const result = formatHookError('pre-commit', 'WU status is invalid');
      expect(result).toContain('PRE-COMMIT HOOK ERROR');
      expect(result).toContain('WU status is invalid');
    });

    it('should include box characters', () => {
      const result = formatHookError('pre-push', 'Not in worktree');
      expect(result).toContain('\u2554'); // Box drawing character
      expect(result).toContain('\u2551');
    });
  });

  describe('extractWUFromCommitMessage', () => {
    it('should extract WU ID from wu() format', () => {
      expect(extractWUFromCommitMessage('wu(wu-123): some message')).toBe('WU-123');
    });

    it('should extract WU ID from type(wu-id) format', () => {
      expect(extractWUFromCommitMessage('feat(wu-456): add feature')).toBe('WU-456');
      expect(extractWUFromCommitMessage('fix(wu-789): fix bug')).toBe('WU-789');
      expect(extractWUFromCommitMessage('chore(wu-100): cleanup')).toBe('WU-100');
    });

    it('should return null for message without WU ID', () => {
      expect(extractWUFromCommitMessage('feat: add feature')).toBeNull();
      expect(extractWUFromCommitMessage('random commit message')).toBeNull();
    });

    it('should return null for null input', () => {
      expect(extractWUFromCommitMessage(null as unknown as string)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(extractWUFromCommitMessage('')).toBeNull();
    });

    it('should uppercase the extracted WU ID', () => {
      expect(extractWUFromCommitMessage('fix(wu-111): fix')).toBe('WU-111');
    });
  });

  describe('ensureMainUpToDate', () => {
    let mockGit: {
      fetch: Mock;
      getCommitHash: Mock;
    };

    beforeEach(() => {
      mockGit = {
        fetch: vi.fn().mockResolvedValue(undefined),
        getCommitHash: vi.fn(),
      };
    });

    it('should not throw when local and remote are in sync', async () => {
      mockGit.getCommitHash.mockResolvedValue('abc123');

      await expect(ensureMainUpToDate(mockGit)).resolves.not.toThrow();
      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'main');
    });

    it('should throw when local and remote are out of sync', async () => {
      mockGit.getCommitHash.mockResolvedValueOnce('local123').mockResolvedValueOnce('remote456');

      await expect(ensureMainUpToDate(mockGit)).rejects.toThrow(/out of sync/);
    });

    it('should call fetch with correct remote and branch', async () => {
      mockGit.getCommitHash.mockResolvedValue('same-hash');

      await ensureMainUpToDate(mockGit, 'wu-test');

      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'main');
    });
  });
});

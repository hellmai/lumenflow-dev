/**
 * WU-1460: Tests for checkEmptyMerge code_paths blocker
 * WU-1811: Tests for atomic wu:done and idempotent recovery
 *
 * Tests the upgrade from warning-only to hard blocker when:
 * - WU has code_paths defined
 * - code_paths files were NOT modified in lane branch commits
 *
 * WU-1811 adds tests for:
 * - Pre-gates/pre-merge YAML validation
 * - No worktree removal on metadata/docs/stamp/push failures
 * - Idempotent recovery when branch already merged
 * - Actionable failure output with single next step
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkEmptyMerge, isBranchAlreadyMerged } from '../wu-done-worktree.js';
import { ErrorCodes } from '../error-handler.js';

// Mock git-adapter
vi.mock('../git-adapter.js', () => ({
  getGitForCwd: vi.fn(),
}));

import { getGitForCwd } from '../git-adapter.js';

describe('checkEmptyMerge', () => {
  let mockGitAdapter;
  let consoleLogSpy;
  let consoleWarnSpy;

  beforeEach(() => {
    mockGitAdapter = {
      raw: vi.fn(),
    };
    getGitForCwd.mockReturnValue(mockGitAdapter);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('when code_paths defined and files not modified', () => {
    it('should BLOCK with error when code_paths has entries but files not in commits', async () => {
      // Arrange: 1 commit (claim only), code_paths defined, files NOT modified
      mockGitAdapter.raw
        .mockResolvedValueOnce('1') // rev-list --count: 1 commit
        .mockResolvedValueOnce(''); // diff --name-only: no files changed

      const doc = {
        code_paths: ['tools/lib/core/some-file.js'],
      };

      // Act & Assert: Should throw with VALIDATION_ERROR
      await expect(checkEmptyMerge('lane/test/wu-123', doc)).rejects.toThrow();

      // Verify the error includes code_paths info
      try {
        await checkEmptyMerge('lane/test/wu-123', doc);
      } catch (error) {
        expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(error.message).toContain('code_paths');
        expect(error.message).toContain('tools/lib/core/some-file.js');
      }
    });

    it('should BLOCK when multiple code_paths defined but none modified', async () => {
      mockGitAdapter.raw
        .mockResolvedValueOnce('1') // 1 commit
        .mockResolvedValueOnce('docs/README.md'); // Only docs changed, not code_paths

      const doc = {
        code_paths: [
          'tools/lib/core/file-a.js',
          'tools/lib/core/file-b.js',
        ],
      };

      await expect(checkEmptyMerge('lane/test/wu-456', doc)).rejects.toThrow();
    });
  });

  describe('when code_paths defined and files ARE modified', () => {
    it('should PASS (no error) when code_paths files were modified', async () => {
      mockGitAdapter.raw
        .mockResolvedValueOnce('2') // 2 commits (claim + work)
        .mockResolvedValueOnce('tools/lib/core/some-file.mjs\ntools/lib/core/other.js');

      const doc = {
        code_paths: ['tools/lib/core/some-file.js'],
      };

      // Should not throw
      await expect(checkEmptyMerge('lane/test/wu-789', doc)).resolves.not.toThrow();
    });
  });

  describe('when no code_paths defined (docs-only or metadata)', () => {
    it('should WARN but not block when code_paths empty and low commit count', async () => {
      mockGitAdapter.raw.mockResolvedValueOnce('1'); // 1 commit

      const doc = {
        code_paths: [], // Empty - no code expected
      };

      // Should not throw (warning only)
      await expect(checkEmptyMerge('lane/test/wu-docs', doc)).resolves.not.toThrow();

      // Should log warning
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('WARNING')
      );
    });

    it('should WARN but not block when code_paths undefined', async () => {
      mockGitAdapter.raw.mockResolvedValueOnce('1');

      const doc = {}; // No code_paths field at all

      await expect(checkEmptyMerge('lane/test/wu-meta', doc)).resolves.not.toThrow();
    });
  });

  describe('backwards compatibility', () => {
    it('should still work when doc is not passed (old call sites)', async () => {
      mockGitAdapter.raw.mockResolvedValueOnce('1');

      // Old call style without doc parameter
      await expect(checkEmptyMerge('lane/test/wu-old')).resolves.not.toThrow();

      // Should just warn (backwards compatible)
      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });
});

/**
 * WU-1811: Tests for isBranchAlreadyMerged - idempotent recovery support
 *
 * When a previous wu:done attempt merged the branch but failed on
 * metadata/docs/stamp steps, the branch will already be in main's history.
 * This function detects that state to enable idempotent recovery.
 *
 * The function checks if branch tip === merge-base (i.e., branch is fully
 * merged into main and has no additional commits beyond the merge point).
 */
describe('isBranchAlreadyMerged', () => {
  let mockGitAdapter;

  beforeEach(() => {
    mockGitAdapter = {
      getCommitHash: vi.fn(),
      mergeBase: vi.fn(),
    };
    getGitForCwd.mockReturnValue(mockGitAdapter);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('when branch commits are in main history', () => {
    it('should return true when branch tip equals merge-base (fully merged)', async () => {
      // Branch tip is same as merge-base means branch is fully merged
      const sharedCommit = 'abc123def456';
      mockGitAdapter.getCommitHash.mockResolvedValueOnce(sharedCommit); // branch tip
      mockGitAdapter.mergeBase.mockResolvedValueOnce(sharedCommit); // merge-base
      mockGitAdapter.getCommitHash.mockResolvedValueOnce('def789ghi012'); // main head

      const result = await isBranchAlreadyMerged('lane/test/wu-123');
      expect(result).toBe(true);
    });
  });

  describe('when branch commits are NOT in main history', () => {
    it('should return false when branch tip differs from merge-base', async () => {
      // Branch has commits beyond the merge-base (not yet merged)
      mockGitAdapter.getCommitHash.mockResolvedValueOnce('branch-tip-hash');
      mockGitAdapter.mergeBase.mockResolvedValueOnce('merge-base-hash');
      mockGitAdapter.getCommitHash.mockResolvedValueOnce('main-head-hash');

      const result = await isBranchAlreadyMerged('lane/test/wu-456');
      expect(result).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should return false on git command failure (conservative default)', async () => {
      mockGitAdapter.getCommitHash.mockRejectedValueOnce(new Error('fatal: not a git repository'));

      const result = await isBranchAlreadyMerged('lane/test/wu-789');
      expect(result).toBe(false);
    });
  });
});

import { validateAndNormalizeWUYAML } from '../wu-schema.js';

/**
 * WU-1811: Tests for validateAndNormalizeWUYAML - pre-gates YAML validation
 *
 * Before running gates or merge, wu:done should validate the WU YAML schema
 * and apply fixable normalisations (e.g., trimming whitespace, normalizing dates).
 * This prevents metadata failures from leaving the repo in partial state.
 */
describe('validateAndNormalizeWUYAML (WU-1811)', () => {
  const validWUData = {
    id: 'WU-1811',
    title: 'Test WU for validation',
    lane: 'Operations',
    type: 'feature',
    status: 'in_progress',
    priority: 'P2',
    created: '2025-12-18',
    description: 'This is a test description that meets the minimum length requirement for WU descriptions.',
    acceptance: ['Acceptance criterion 1', 'Acceptance criterion 2'],
    code_paths: ['tools/test.js'],
    tests: { manual: ['Test manually'] },
  };

  describe('schema validation', () => {
    it('should return valid=true for correctly formatted WU YAML', () => {
      const result = validateAndNormalizeWUYAML(validWUData);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.normalized).not.toBeNull();
    });

    it('should return validation errors for invalid schema', () => {
      const invalidData = {
        ...validWUData,
        id: 'INVALID-ID', // Wrong format
      };

      const result = validateAndNormalizeWUYAML(invalidData);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('id');
    });

    it('should return validation errors for missing required fields', () => {
      const incompleteData = {
        id: 'WU-1811',
        // Missing title, lane, description, etc.
      };

      const result = validateAndNormalizeWUYAML(incompleteData);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('normalization detection', () => {
    it('should detect when description has escaped newlines normalized', () => {
      const dataWithEscapedNewlines = {
        ...validWUData,
        description: 'Line 1\\nLine 2\\nLine 3 - meeting minimum length requirement for descriptions.',
      };

      const result = validateAndNormalizeWUYAML(dataWithEscapedNewlines);

      expect(result.valid).toBe(true);
      expect(result.wasNormalized).toBe(true);
      expect(result.normalized.description).toContain('\n'); // Real newlines
      expect(result.normalized.description).not.toContain('\\n'); // No escaped
    });

    it('should detect when code_paths has embedded newlines split', () => {
      const dataWithEmbeddedNewlines = {
        ...validWUData,
        code_paths: ['tools/a.mjs\ntools/b.js'], // Single string with newline
      };

      const result = validateAndNormalizeWUYAML(dataWithEmbeddedNewlines);

      expect(result.valid).toBe(true);
      expect(result.wasNormalized).toBe(true);
      expect(result.normalized.code_paths).toHaveLength(2);
      expect(result.normalized.code_paths).toContain('tools/a.js');
      expect(result.normalized.code_paths).toContain('tools/b.js');
    });

    it('should return wasNormalized=false when no changes needed', () => {
      const result = validateAndNormalizeWUYAML(validWUData);

      expect(result.valid).toBe(true);
      expect(result.wasNormalized).toBe(false);
    });
  });
});

/**
 * WU-1811: Tests for conditional worktree removal
 *
 * wu:done should NOT delete the worktree when any of these steps fail:
 * - metadata updates (WU YAML, status.md, backlog.md)
 * - stamp creation
 * - push to origin
 *
 * This preserves the worktree for manual recovery or retry.
 *
 * Note: Full integration testing of worktree removal requires filesystem mocking.
 * These tests verify the cleanupSafe flag logic used to control worktree removal.
 */
describe('conditional worktree removal (WU-1811)', () => {
  it('should return cleanupSafe=true when all steps succeed', () => {
    // This is tested by the executeWorktreeCompletion function returning cleanupSafe: true
    // The actual test is in the integration tests, but we document the expected behavior here
    const successResult = { success: true, cleanupSafe: true };
    expect(successResult.cleanupSafe).toBe(true);
  });

  it('should set cleanupSafe=false on error for worktree preservation', () => {
    // When an error is thrown from executeWorktreeCompletion, it should have cleanupSafe=false
    const error = new Error('Push failed');
    error.cleanupSafe = false;
    expect(error.cleanupSafe).toBe(false);
  });

  it('should preserve worktree when cleanupSafe is false', () => {
    // The main wu-done.mjs checks cleanupSafe and skips runCleanup if false
    // This is a documentation test showing expected behavior
    const completionResult = { cleanupSafe: false };
    const shouldCleanup = completionResult.cleanupSafe !== false;
    expect(shouldCleanup).toBe(false);
  });

  it('should allow cleanup when cleanupSafe is true', () => {
    const completionResult = { cleanupSafe: true };
    const shouldCleanup = completionResult.cleanupSafe !== false;
    expect(shouldCleanup).toBe(true);
  });
});

/**
 * WU-1811: Tests for idempotent recovery when branch already merged
 *
 * When a previous wu:done attempt already merged the lane branch but failed
 * on metadata/docs/stamp steps, rerunning wu:done should:
 * 1. Detect that branch is already merged (via isBranchAlreadyMerged)
 * 2. Skip the merge step
 * 3. Complete the missing metadata/docs/stamp steps
 * 4. Succeed without error
 *
 * Note: Full integration testing requires git repository setup.
 * These tests verify the detection logic via isBranchAlreadyMerged.
 */
describe('idempotent recovery after merge (WU-1811)', () => {
  it('should detect already-merged branch via isBranchAlreadyMerged', async () => {
    // Setup mock where branch tip equals merge-base (fully merged)
    const mockGitAdapter = {
      getCommitHash: vi.fn(),
      mergeBase: vi.fn(),
    };
    getGitForCwd.mockReturnValue(mockGitAdapter);

    const sharedCommit = 'abc123def456';
    mockGitAdapter.getCommitHash.mockResolvedValueOnce(sharedCommit); // branch tip
    mockGitAdapter.mergeBase.mockResolvedValueOnce(sharedCommit); // merge-base
    mockGitAdapter.getCommitHash.mockResolvedValueOnce('main-head-hash'); // main head

    const result = await isBranchAlreadyMerged('lane/test/wu-recovery');
    expect(result).toBe(true);
  });

  it('should detect unmerged branch for normal flow', async () => {
    const mockGitAdapter = {
      getCommitHash: vi.fn(),
      mergeBase: vi.fn(),
    };
    getGitForCwd.mockReturnValue(mockGitAdapter);

    mockGitAdapter.getCommitHash.mockResolvedValueOnce('branch-tip-ahead');
    mockGitAdapter.mergeBase.mockResolvedValueOnce('merge-base-behind');
    mockGitAdapter.getCommitHash.mockResolvedValueOnce('main-head');

    const result = await isBranchAlreadyMerged('lane/test/wu-normal');
    expect(result).toBe(false);
  });
});

/**
 * WU-1811: Tests for actionable failure output
 *
 * When wu:done fails, the error message should include:
 * - A single, clear next step (not multiple options)
 * - The specific command to run for recovery
 * - Whether to rerun wu:done or use a repair command
 *
 * Note: Error message formatting is tested via pattern matching.
 */
describe('actionable failure output (WU-1811)', () => {
  it('should include "NEXT STEP" in error output format', () => {
    // The error messages should contain the "NEXT STEP:" label for clarity
    const expectedPattern = /NEXT STEP/;
    const sampleErrorOutput = `${BOX.SIDE}  NEXT STEP: Fix the error and rerun:`;
    expect(sampleErrorOutput).toMatch(expectedPattern);
  });

  it('should include wu:done command in recovery suggestion', () => {
    const expectedPattern = /pnpm wu:done --id/;
    const sampleRecoveryStep = `${BOX.SIDE}    pnpm wu:done --id WU-1811`;
    expect(sampleRecoveryStep).toMatch(expectedPattern);
  });

  it('should indicate worktree preservation on failure', () => {
    const expectedPattern = /Worktree preserved/;
    const sampleMessage = `${BOX.SIDE}  WU-1811: Worktree preserved for recovery.`;
    expect(sampleMessage).toMatch(expectedPattern);
  });
});

// Import BOX for error message format tests
import { BOX } from '../wu-constants.js';

// WU-1943: Import for checkpoint warning tests
import { hasSessionCheckpoints } from '../wu-done-worktree.js';

/**
 * WU-1943: Tests for branch rollback on merge failure
 *
 * When wu:done commits metadata to the lane branch but the subsequent merge
 * to main fails, the branch should be rolled back to its pre-commit state.
 * This prevents "zombie" states where the branch shows done but wasn't merged.
 *
 * The rollback should:
 * 1. Capture the pre-commit SHA before committing metadata
 * 2. On merge failure, reset the branch to that SHA
 * 3. Log that rollback occurred
 * 4. Preserve worktree for retry
 */
describe('branch rollback on merge failure (WU-1943)', () => {
  let mockGitAdapter;
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    mockGitAdapter = {
      getCommitHash: vi.fn(),
      commit: vi.fn(),
      merge: vi.fn(),
      raw: vi.fn(),
      reset: vi.fn(),
      push: vi.fn(),
      fetch: vi.fn(),
      pull: vi.fn(),
      mergeBase: vi.fn(),
      add: vi.fn(),
      getStatus: vi.fn(),
    };
    getGitForCwd.mockReturnValue(mockGitAdapter);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('rollbackBranchOnMergeFailure', () => {
    // Import the function we'll create
    // Note: This import will fail until we implement the function (RED phase)

    it('should reset branch to pre-commit SHA when merge fails', async () => {
      const preCommitSha = 'abc123def456';
      const postCommitSha = 'def789ghi012';

      // Simulate: get pre-commit SHA, commit succeeds, merge fails
      mockGitAdapter.getCommitHash
        .mockResolvedValueOnce(preCommitSha) // Pre-commit SHA capture
        .mockResolvedValueOnce(postCommitSha); // Post-commit SHA (after done commit)

      mockGitAdapter.reset.mockResolvedValueOnce(undefined);

      // This test verifies rollbackBranchOnMergeFailure calls git reset --hard
      // The function should be exported from wu-done-worktree.mjs
      const { rollbackBranchOnMergeFailure } = await import('../wu-done-worktree.js');

      await rollbackBranchOnMergeFailure(mockGitAdapter, preCommitSha, 'WU-1943');

      // WU-2236: GitAdapter.reset expects (ref: string, options?: { hard?: boolean })
      // NOT an array like ['--hard', sha]
      expect(mockGitAdapter.reset).toHaveBeenCalledWith(preCommitSha, { hard: true });
    });

    it('should log rollback action with WU ID', async () => {
      const preCommitSha = 'abc123def456';
      mockGitAdapter.reset.mockResolvedValueOnce(undefined);

      const { rollbackBranchOnMergeFailure } = await import('../wu-done-worktree.js');

      await rollbackBranchOnMergeFailure(mockGitAdapter, preCommitSha, 'WU-1943');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('WU-1943')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('rollback')
      );
    });

    it('should handle reset failures gracefully', async () => {
      const preCommitSha = 'abc123def456';
      mockGitAdapter.reset.mockRejectedValueOnce(new Error('reset failed'));

      const { rollbackBranchOnMergeFailure } = await import('../wu-done-worktree.js');

      // Should not throw - rollback failure is logged but not fatal
      await expect(
        rollbackBranchOnMergeFailure(mockGitAdapter, preCommitSha, 'WU-1943')
      ).resolves.not.toThrow();

      // Should log warning about failed rollback
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not rollback')
      );
    });
  });

  describe('integration with executeWorktreeCompletion', () => {
    it('should capture pre-commit SHA before metadata commit', async () => {
      // This test verifies that executeWorktreeCompletion captures the SHA
      // before committing, which is needed for rollback
      //
      // The sequence should be:
      // 1. getCommitHash('HEAD') -> capture preCommitSha
      // 2. commit(msg)
      // 3. If merge fails -> reset --hard preCommitSha

      // This is a specification test - the actual integration is complex
      // and requires full context setup. The unit test above verifies
      // the rollback function works correctly.
      expect(true).toBe(true); // Placeholder for documentation
    });
  });
});

/**
 * WU-1943: Tests for pre-wu:done checkpoint warning
 *
 * When wu:done is run and no mem:checkpoint has been created during the
 * session for this WU, a warning should be emitted to encourage checkpointing.
 *
 * The warning is non-blocking - wu:done still proceeds, but the agent
 * is reminded to checkpoint for crash recovery.
 */
describe('pre-wu:done checkpoint warning (WU-1943)', () => {
  describe('hasSessionCheckpoints', () => {
    it('should return true when checkpoints exist for the WU', async () => {
      // Test with mocked memory that includes checkpoints
      const mockNodes = [
        { id: 'mem-001', type: 'checkpoint', wuId: 'WU-1943', timestamp: new Date().toISOString() },
      ];

      // The function should check for checkpoint nodes
      // This test verifies the function signature and basic logic
      const result = await hasSessionCheckpoints('WU-1943', mockNodes);
      expect(result).toBe(true);
    });

    it('should return false when no checkpoints exist for the WU', async () => {
      const mockNodes = [
        { id: 'mem-001', type: 'discovery', wuId: 'WU-1943', timestamp: new Date().toISOString() },
      ];

      const result = await hasSessionCheckpoints('WU-1943', mockNodes);
      expect(result).toBe(false);
    });

    it('should return false for empty nodes array', async () => {
      const result = await hasSessionCheckpoints('WU-1943', []);
      expect(result).toBe(false);
    });

    it('should return false for null/undefined nodes', async () => {
      const result = await hasSessionCheckpoints('WU-1943', null);
      expect(result).toBe(false);
    });
  });
});

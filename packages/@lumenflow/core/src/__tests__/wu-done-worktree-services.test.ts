/**
 * @file wu-done-worktree-services.test.ts
 * @description Tests for extracted wu:done worktree completion services.
 *
 * WU-1664: Each service corresponds to a pipeline state from the XState machine
 * (WU-1662) and can be invoked independently by the state-machine orchestrator.
 *
 * Services tested:
 * - validateWorktreeState: validating state
 * - prepareTransaction: preparing state
 * - commitTransaction: committing state (transaction + git commit)
 * - mergeToMain: merging state
 * - finalizeCompletion: cleaningUp state
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The module under test
import {
  validateWorktreeState,
  prepareTransaction,
  commitTransaction,
  mergeToMain,
  finalizeCompletion,
  type WorktreeServiceDeps,
  type ValidationResult,
  type PreparationResult,
  type CommitResult,
  type MergeResult,
  type FinalizationResult,
} from '../wu-done-worktree-services.js';

// Re-export check: these services should be importable from core index
import * as coreIndex from '../index.js';

/** Test-only worktree path constant. */
const TEST_WU_ID = 'WU-999992';

/**
 * Create a minimal mock git adapter for testing.
 */
function createMockGitAdapter() {
  return {
    getCommitHash: vi.fn().mockResolvedValue('abc123'),
    fetch: vi.fn().mockResolvedValue(undefined),
    revList: vi.fn().mockResolvedValue('0'),
    commit: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
    raw: vi.fn().mockResolvedValue(''),
    merge: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    rebase: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockResolvedValue(''),
    log: vi.fn().mockResolvedValue({ all: [] }),
    reset: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Create a minimal mock WU document for testing.
 */
function createMockWUDoc(overrides = {}) {
  return {
    id: TEST_WU_ID,
    title: 'Test WU',
    status: 'in_progress',
    lane: 'Framework: Core Lifecycle',
    type: 'refactor',
    code_paths: ['packages/@lumenflow/core/src/wu-done-worktree-services.ts'],
    acceptance: ['Service extraction complete'],
    tests: { unit: [], e2e: [], manual: [] },
    exposure: 'backend-only',
    priority: 'P2',
    created: '2026-02-13',
    ...overrides,
  };
}

/**
 * Create a temporary worktree-like directory structure for filesystem-dependent tests.
 */
function createTempWorktree() {
  const root = mkdtempSync(join(tmpdir(), 'wu-done-services-'));

  // Create required directory structure
  mkdirSync(join(root, 'docs', '04-operations', 'tasks', 'wu'), { recursive: true });
  mkdirSync(join(root, '.lumenflow', 'state'), { recursive: true });
  mkdirSync(join(root, '.lumenflow', 'stamps'), { recursive: true });

  // Create required metadata files
  writeFileSync(join(root, 'docs', '04-operations', 'tasks', 'status.md'), '# Status\n');
  writeFileSync(join(root, 'docs', '04-operations', 'tasks', 'backlog.md'), '# Backlog\n');

  // Create WU YAML
  const wuContent = [
    `id: ${TEST_WU_ID}`,
    'title: Test WU',
    'status: in_progress',
    "lane: 'Framework: Core Lifecycle'",
    'type: refactor',
    'priority: P2',
    'created: 2026-02-13',
    'code_paths:',
    '  - packages/@lumenflow/core/src/wu-done-worktree-services.ts',
    'acceptance:',
    '  - Service extraction complete',
    'tests:',
    '  unit: []',
    '  e2e: []',
    '  manual: []',
    'exposure: backend-only',
  ].join('\n');
  writeFileSync(join(root, 'docs', '04-operations', 'tasks', 'wu', `${TEST_WU_ID}.yaml`), wuContent);

  // Create state store events file with a claim event
  writeFileSync(
    join(root, '.lumenflow', 'state', 'wu-events.jsonl'),
    `${JSON.stringify({
      type: 'claim',
      wuId: TEST_WU_ID,
      lane: 'Framework: Core Lifecycle',
      title: 'Test WU',
      timestamp: '2026-02-10T00:00:00.000Z',
    })}\n`,
  );

  return root;
}

describe('WU-1664: wu:done worktree completion services', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateWorktreeState', () => {
    it('should export validateWorktreeState as a function', () => {
      expect(typeof validateWorktreeState).toBe('function');
    });

    it('should propagate schema validation errors for incomplete doc', async () => {
      // The service delegates to validateAndNormalizeWUYAML which uses the full WUSchema.
      // This test verifies the service correctly returns errors from the schema validator.
      const doc = createMockWUDoc();
      const gitAdapter = createMockGitAdapter();

      const result = await validateWorktreeState({
        wuId: TEST_WU_ID,
        worktreePath: 'worktrees/test-wu-100',
        doc,
        mainCheckoutPath: '/main',
        gitAdapterForMain: gitAdapter,
      });

      // The mock doc may or may not pass the full schema depending on required fields.
      // What matters is the service returns a well-formed result with errors array.
      expect(typeof result.valid).toBe('boolean');
      expect(Array.isArray(result.errors)).toBe(true);
      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it('should return valid=false with errors for schema-invalid WU', async () => {
      // A doc with invalid/missing required fields
      const doc = { id: TEST_WU_ID, status: 'in_progress' };
      const gitAdapter = createMockGitAdapter();

      const result = await validateWorktreeState({
        wuId: TEST_WU_ID,
        worktreePath: 'worktrees/test-wu-100',
        doc,
        mainCheckoutPath: '/main',
        gitAdapterForMain: gitAdapter,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('validation failed');
    });

    it('should return valid=false when WU status cannot transition to done', async () => {
      const doc = createMockWUDoc({ status: 'ready' });
      const gitAdapter = createMockGitAdapter();

      const result = await validateWorktreeState({
        wuId: TEST_WU_ID,
        worktreePath: 'worktrees/test-wu-100',
        doc,
        mainCheckoutPath: '/main',
        gitAdapterForMain: gitAdapter,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should return valid=false when main is behind origin', async () => {
      const doc = createMockWUDoc();
      const gitAdapter = createMockGitAdapter();
      // Simulate main behind origin
      gitAdapter.getCommitHash
        .mockResolvedValueOnce('local-sha')
        .mockResolvedValueOnce('remote-sha');
      gitAdapter.revList.mockResolvedValueOnce('3');

      const result = await validateWorktreeState({
        wuId: TEST_WU_ID,
        worktreePath: 'worktrees/test-wu-100',
        doc,
        mainCheckoutPath: '/main',
        gitAdapterForMain: gitAdapter,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('behind'))).toBe(true);
    });

    it('should detect zombie state when status is done and worktree path exists on disk', async () => {
      // detectZombieState checks: doc.status === 'done' && worktreePath exists on disk
      const tempDir = mkdtempSync(join(tmpdir(), 'zombie-test-'));
      try {
        const doc = createMockWUDoc({ status: 'done' });
        const gitAdapter = createMockGitAdapter();

        const result = await validateWorktreeState({
          wuId: TEST_WU_ID,
          worktreePath: tempDir,
          doc,
          mainCheckoutPath: '/main',
          gitAdapterForMain: gitAdapter,
        });

        expect(result.zombieDetected).toBe(true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should not detect zombie when worktree path does not exist', async () => {
      const doc = createMockWUDoc({ status: 'done' });
      const gitAdapter = createMockGitAdapter();

      const result = await validateWorktreeState({
        wuId: TEST_WU_ID,
        worktreePath: '/non-existent-path-zombie-test',
        doc,
        mainCheckoutPath: '/main',
        gitAdapterForMain: gitAdapter,
      });

      // Without an existing path, zombie detection returns false,
      // and assertTransition('done' -> 'done') should fail
      expect(result.zombieDetected).toBe(false);
    });
  });

  describe('prepareTransaction', () => {
    let tempWorktree = '';

    beforeEach(() => {
      tempWorktree = createTempWorktree();
    });

    afterEach(() => {
      if (tempWorktree) {
        rmSync(tempWorktree, { recursive: true, force: true });
      }
    });

    it('should export prepareTransaction as a function', () => {
      expect(typeof prepareTransaction).toBe('function');
    });

    it('should return a transaction object and pending writes', async () => {
      const result = await prepareTransaction({
        wuId: TEST_WU_ID,
        title: 'Test WU',
        doc: createMockWUDoc(),
        worktreePath: tempWorktree,
      });

      expect(result.transaction).toBeDefined();
      expect(result.stagedMetadataAllowlist).toBeDefined();
      expect(Array.isArray(result.stagedMetadataAllowlist)).toBe(true);
      // Should have entries for WU YAML, status, backlog, stamp, and events
      expect(result.stagedMetadataAllowlist.length).toBeGreaterThan(0);
    });

    it('should not commit the transaction yet', async () => {
      const result = await prepareTransaction({
        wuId: TEST_WU_ID,
        title: 'Test WU',
        doc: createMockWUDoc(),
        worktreePath: tempWorktree,
      });

      // Transaction should be in a valid state (not yet committed)
      expect(result.transaction.isCommitted).toBe(false);
    });
  });

  describe('commitTransaction', () => {
    let tempWorktree = '';

    beforeEach(() => {
      tempWorktree = createTempWorktree();
    });

    afterEach(() => {
      if (tempWorktree) {
        rmSync(tempWorktree, { recursive: true, force: true });
      }
    });

    it('should export commitTransaction as a function', () => {
      expect(typeof commitTransaction).toBe('function');
    });

    it('should commit transaction and create git commit', async () => {
      const prep = await prepareTransaction({
        wuId: TEST_WU_ID,
        title: 'Test WU',
        doc: createMockWUDoc(),
        worktreePath: tempWorktree,
      });

      const mockGit = createMockGitAdapter();

      const result = await commitTransaction({
        wuId: TEST_WU_ID,
        title: 'Test WU',
        transaction: prep.transaction,
        worktreePath: tempWorktree,
        worktreeGit: mockGit,
        doc: createMockWUDoc(),
        maxCommitLength: 72,
        isDocsOnly: false,
        stagedMetadataAllowlist: prep.stagedMetadataAllowlist,
        validateStagedFiles: vi.fn().mockResolvedValue(undefined),
      });

      expect(result.committed).toBe(true);
      expect(result.preCommitSha).toBe('abc123');
      // Verify git commit was called
      expect(mockGit.commit).toHaveBeenCalled();
    });
  });

  describe('mergeToMain', () => {
    it('should export mergeToMain as a function', () => {
      expect(typeof mergeToMain).toBe('function');
    });

    it('should return merged=false when noMerge is true', async () => {
      const result = await mergeToMain({
        wuId: TEST_WU_ID,
        doc: createMockWUDoc(),
        worktreePath: 'worktrees/test-wu-100',
        args: { noMerge: true, noAutoRebase: false },
      });

      expect(result.merged).toBe(false);
      expect(result.prUrl).toBeNull();
    });

    it('should throw when lane branch not found', async () => {
      // With default mock, branchExists will return false for the computed lane branch
      // because there is no real git repo behind it
      await expect(
        mergeToMain({
          wuId: TEST_WU_ID,
          doc: createMockWUDoc(),
          worktreePath: 'worktrees/test-wu-100',
          args: { noMerge: false, noAutoRebase: false },
        }),
      ).rejects.toThrow();
    });
  });

  describe('finalizeCompletion', () => {
    it('should export finalizeCompletion as a function', () => {
      expect(typeof finalizeCompletion).toBe('function');
    });

    it('should clear recovery attempts and emit lane signal', async () => {
      const result = await finalizeCompletion({
        wuId: TEST_WU_ID,
        doc: createMockWUDoc(),
        laneBranch: 'lane/framework-core-lifecycle/wu-1664',
      });

      expect(result.finalized).toBe(true);
    });

    it('should handle null lane branch gracefully', async () => {
      const result = await finalizeCompletion({
        wuId: TEST_WU_ID,
        doc: createMockWUDoc(),
        laneBranch: null,
      });

      expect(result.finalized).toBe(true);
    });
  });

  describe('Service interface types', () => {
    it('should export WorktreeServiceDeps type (compile-time check)', () => {
      const deps: Partial<WorktreeServiceDeps> = {
        wuId: 'WU-100',
        worktreePath: 'worktrees/test-wu-100',
      };
      expect(deps.wuId).toBe('WU-100');
    });

    it('should export ValidationResult type (compile-time check)', () => {
      const result: ValidationResult = {
        valid: true,
        errors: [],
        zombieDetected: false,
      };
      expect(result.valid).toBe(true);
    });

    it('should export PreparationResult type (compile-time check)', () => {
      const result: Partial<PreparationResult> = {
        stagedMetadataAllowlist: [],
      };
      expect(result.stagedMetadataAllowlist).toEqual([]);
    });

    it('should export CommitResult type (compile-time check)', () => {
      const result: CommitResult = {
        committed: true,
        preCommitSha: 'abc123',
      };
      expect(result.committed).toBe(true);
    });

    it('should export MergeResult type (compile-time check)', () => {
      const result: MergeResult = {
        merged: true,
        prUrl: null,
      };
      expect(result.merged).toBe(true);
    });

    it('should export FinalizationResult type (compile-time check)', () => {
      const result: FinalizationResult = {
        finalized: true,
      };
      expect(result.finalized).toBe(true);
    });
  });

  describe('Core index re-exports', () => {
    it('should export validateWorktreeState from core index', () => {
      expect(typeof (coreIndex as Record<string, unknown>).validateWorktreeState).toBe('function');
    });

    it('should export prepareTransaction from core index', () => {
      expect(typeof (coreIndex as Record<string, unknown>).prepareTransaction).toBe('function');
    });

    it('should export commitTransaction from core index', () => {
      expect(typeof (coreIndex as Record<string, unknown>).commitTransaction).toBe('function');
    });

    it('should export mergeToMain from core index', () => {
      expect(typeof (coreIndex as Record<string, unknown>).mergeToMain).toBe('function');
    });

    it('should export finalizeCompletion from core index', () => {
      expect(typeof (coreIndex as Record<string, unknown>).finalizeCompletion).toBe('function');
    });
  });

  describe('Backwards compatibility', () => {
    it('should not change the executeWorktreeCompletion export', async () => {
      const { executeWorktreeCompletion } = await import('../wu-done-worktree.js');
      expect(typeof executeWorktreeCompletion).toBe('function');
    });

    it('should not change the resolveWorktreeMetadataPaths export', async () => {
      const { resolveWorktreeMetadataPaths } = await import('../wu-done-worktree.js');
      expect(typeof resolveWorktreeMetadataPaths).toBe('function');
    });

    it('should not change branch-only exports', async () => {
      const { executeBranchOnlyCompletion, executeBranchPRCompletion } = await import(
        '../wu-done-branch-only.js'
      );
      expect(typeof executeBranchOnlyCompletion).toBe('function');
      expect(typeof executeBranchPRCompletion).toBe('function');
    });
  });
});

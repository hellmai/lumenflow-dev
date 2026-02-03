/**
 * wu-consistency-checker tests (WU-1370)
 *
 * Tests for repairWUInconsistency behavior when called with projectRoot parameter.
 * When projectRoot is provided, the function should work directly in that directory
 * instead of creating a nested micro-worktree.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

// Track withMicroWorktree calls to verify it's NOT called when projectRoot is provided
let withMicroWorktreeCalls: Array<{ operation: string; id: string; pushOnly?: boolean }> = [];

// Mock git adapter before importing modules that use it
const mockGitForCwd = {
  worktreeList: vi.fn().mockResolvedValue(''),
  branchExists: vi.fn().mockResolvedValue(false),
  deleteBranch: vi.fn().mockResolvedValue(undefined),
  createBranchNoCheckout: vi.fn().mockResolvedValue(undefined),
  worktreeAddExisting: vi.fn().mockResolvedValue(undefined),
  worktreeRemove: vi.fn().mockResolvedValue(undefined),
  merge: vi.fn().mockResolvedValue(undefined),
  fetch: vi.fn().mockResolvedValue(undefined),
  push: vi.fn().mockResolvedValue(undefined),
  add: vi.fn().mockResolvedValue(undefined),
  addWithDeletions: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
  pushRefspec: vi.fn().mockResolvedValue(undefined),
  getCurrentBranch: vi.fn().mockResolvedValue('main'),
  getStatus: vi.fn().mockResolvedValue(''),
  raw: vi.fn().mockResolvedValue(''),
};

const mockGitForWorktree = {
  ...mockGitForCwd,
  rebase: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../git-adapter.js', () => ({
  getGitForCwd: vi.fn(() => mockGitForCwd),
  createGitForPath: vi.fn(() => mockGitForWorktree),
}));

// Spy on withMicroWorktree to track when it's called
vi.mock('../micro-worktree.js', async () => {
  const actual =
    await vi.importActual<typeof import('../micro-worktree.js')>('../micro-worktree.js');
  return {
    ...actual,
    withMicroWorktree: vi
      .fn()
      .mockImplementation(
        async (options: {
          operation: string;
          id: string;
          pushOnly?: boolean;
          execute: (ctx: {
            worktreePath: string;
            gitWorktree: unknown;
          }) => Promise<{ files: string[]; commitMessage: string }>;
        }) => {
          withMicroWorktreeCalls.push({
            operation: options.operation,
            id: options.id,
            pushOnly: options.pushOnly,
          });
          // Create a temp directory to simulate micro-worktree
          const microWorktreePath = mkdtempSync(path.join(tmpdir(), 'micro-worktree-test-'));

          // Copy project structure to micro-worktree for the execute function
          const result = await options.execute({
            worktreePath: microWorktreePath,
            gitWorktree: mockGitForWorktree,
          });

          // Clean up temp dir
          rmSync(microWorktreePath, { recursive: true, force: true });

          return { ...result, ref: 'main' };
        },
      ),
  };
});

describe('wu-consistency-checker (WU-1370)', () => {
  let testProjectRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    withMicroWorktreeCalls = [];

    // Create a test project structure
    testProjectRoot = mkdtempSync(path.join(tmpdir(), 'wu-consistency-test-'));

    // Create necessary directories
    mkdirSync(path.join(testProjectRoot, 'docs/04-operations/tasks/wu'), { recursive: true });
    mkdirSync(path.join(testProjectRoot, '.lumenflow/stamps'), { recursive: true });
    mkdirSync(path.join(testProjectRoot, '.lumenflow/state'), { recursive: true });

    // Create a done WU without stamp (orphan state to repair)
    const wuContent = `id: WU-8888
title: Test WU for Nested Worktree
lane: 'Framework: Core'
type: bug
status: done
priority: P2
created: 2026-01-23
code_paths: []
tests:
  manual: []
  unit: []
  e2e: []
artifacts: []
dependencies: []
risks: []
notes: ''
requires_review: false
description: Test WU for repair testing
acceptance:
  - Test acceptance criteria
`;
    writeFileSync(
      path.join(testProjectRoot, 'docs/04-operations/tasks/wu/WU-8888.yaml'),
      wuContent,
    );
  });

  afterEach(() => {
    // Clean up test directories
    if (testProjectRoot && existsSync(testProjectRoot)) {
      rmSync(testProjectRoot, { recursive: true, force: true });
    }
  });

  describe('repairWUInconsistency with projectRoot', () => {
    it('should NOT create a micro-worktree when projectRoot is provided', async () => {
      // This test verifies that when repairWUInconsistency is called with a projectRoot
      // (e.g., from handleOrphanCheck within a micro-worktree), it should work directly
      // in that directory instead of creating a nested micro-worktree.
      //
      // The current bug: repairWUInconsistency always creates its own micro-worktree,
      // even when called from within another micro-worktree. This nested micro-worktree
      // merges to local main (since it doesn't use pushOnly), causing main to drift
      // ahead of origin/main.

      const { repairWUInconsistency } = await import('../wu-consistency-checker.js');

      const report = {
        valid: false,
        errors: [
          {
            type: 'YAML_DONE_NO_STAMP',
            wuId: 'WU-8888',
            title: 'Test WU for Nested Worktree',
            description: 'WU done but no stamp',
            repairAction: 'Create stamp file',
            canAutoRepair: true,
          },
        ],
      };

      // Call with projectRoot - should NOT create micro-worktree
      await repairWUInconsistency(report, { projectRoot: testProjectRoot });

      // Verify that withMicroWorktree was NOT called
      // When projectRoot is provided, we're already in a micro-worktree context
      // and should work directly in that directory
      expect(withMicroWorktreeCalls).toHaveLength(0);
    });

    it('should create stamp file directly in projectRoot when provided', async () => {
      const { repairWUInconsistency } = await import('../wu-consistency-checker.js');

      const report = {
        valid: false,
        errors: [
          {
            type: 'YAML_DONE_NO_STAMP',
            wuId: 'WU-8888',
            title: 'Test WU for Nested Worktree',
            description: 'WU done but no stamp',
            repairAction: 'Create stamp file',
            canAutoRepair: true,
          },
        ],
      };

      await repairWUInconsistency(report, { projectRoot: testProjectRoot });

      // Verify stamp was created directly in projectRoot
      const stampPath = path.join(testProjectRoot, '.lumenflow/stamps/WU-8888.done');
      expect(existsSync(stampPath)).toBe(true);

      // Verify stamp content
      const stampContent = readFileSync(stampPath, 'utf-8');
      expect(stampContent).toContain('WU-8888');
      expect(stampContent).toContain('Test WU for Nested Worktree');
    });

    it('should return modified files list when projectRoot is provided', async () => {
      const { repairWUInconsistency } = await import('../wu-consistency-checker.js');

      const report = {
        valid: false,
        errors: [
          {
            type: 'YAML_DONE_NO_STAMP',
            wuId: 'WU-8888',
            title: 'Test WU for Nested Worktree',
            description: 'WU done but no stamp',
            repairAction: 'Create stamp file',
            canAutoRepair: true,
          },
        ],
      };

      const result = await repairWUInconsistency(report, { projectRoot: testProjectRoot });

      // When projectRoot is provided, we should get repair counts
      // The function should still report what was repaired
      expect(result.repaired).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
    });
  });

  describe('repairWUInconsistency without projectRoot (CLI behavior)', () => {
    it('should create micro-worktree when projectRoot is NOT provided', async () => {
      // This test verifies the existing wu:repair CLI behavior is unchanged.
      // When no projectRoot is provided (i.e., called from CLI directly),
      // it should still create a micro-worktree for safety.

      const { repairWUInconsistency } = await import('../wu-consistency-checker.js');

      // Mock process.cwd to return our test directory
      const originalCwd = process.cwd;
      vi.spyOn(process, 'cwd').mockReturnValue(testProjectRoot);

      try {
        const report = {
          valid: false,
          errors: [
            {
              type: 'YAML_DONE_NO_STAMP',
              wuId: 'WU-8888',
              title: 'Test WU for Nested Worktree',
              description: 'WU done but no stamp',
              repairAction: 'Create stamp file',
              canAutoRepair: true,
            },
          ],
        };

        // Call without projectRoot - should create micro-worktree
        await repairWUInconsistency(report);

        // Verify that withMicroWorktree WAS called
        expect(withMicroWorktreeCalls.length).toBeGreaterThan(0);
        expect(withMicroWorktreeCalls[0]).toMatchObject({
          operation: expect.stringContaining('repair'),
        });
      } finally {
        process.cwd = originalCwd;
      }
    });
  });
});

/**
 * wu:repair micro-worktree isolation tests (WU-1078, WU-1370)
 *
 * Tests that wu:repair uses micro-worktree for all file changes,
 * never writing directly to main checkout.
 *
 * WU-1370: When projectRoot is explicitly provided, repairs work directly
 * in that directory (no micro-worktree). This prevents nested micro-worktrees
 * when repair is called from within another micro-worktree context.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

// Track withMicroWorktree calls
let withMicroWorktreeCalls: Array<{ operation: string; id: string }> = [];

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

vi.mock('@lumenflow/core/git-adapter', () => ({
  getGitForCwd: vi.fn(() => mockGitForCwd),
  createGitForPath: vi.fn(() => mockGitForWorktree),
}));

// Spy on withMicroWorktree to verify it's called
vi.mock('@lumenflow/core/micro-worktree', async () => {
  const actual = await vi.importActual<typeof import('@lumenflow/core/micro-worktree')>(
    '@lumenflow/core/micro-worktree',
  );
  return {
    ...actual,
    withMicroWorktree: vi
      .fn()
      .mockImplementation(
        async (options: {
          operation: string;
          id: string;
          execute: (ctx: {
            worktreePath: string;
            gitWorktree: unknown;
          }) => Promise<{ files: string[]; commitMessage: string }>;
        }) => {
          withMicroWorktreeCalls.push({ operation: options.operation, id: options.id });
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

describe('wu:repair micro-worktree isolation (WU-1078)', () => {
  let testProjectRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    withMicroWorktreeCalls = [];

    // Create a test project structure
    testProjectRoot = mkdtempSync(path.join(tmpdir(), 'wu-repair-test-'));

    // Create necessary directories
    mkdirSync(path.join(testProjectRoot, 'docs/04-operations/tasks/wu'), { recursive: true });
    mkdirSync(path.join(testProjectRoot, '.lumenflow/stamps'), { recursive: true });
    mkdirSync(path.join(testProjectRoot, '.lumenflow/state'), { recursive: true });

    // Create a done WU without stamp (orphan state to repair)
    const wuContent = `id: WU-9999
title: Test WU
lane: 'Framework: CLI'
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
      path.join(testProjectRoot, 'docs/04-operations/tasks/wu/WU-9999.yaml'),
      wuContent,
    );
  });

  afterEach(() => {
    // Clean up test directories
    if (testProjectRoot && existsSync(testProjectRoot)) {
      rmSync(testProjectRoot, { recursive: true, force: true });
    }
  });

  describe('repairWUInconsistency with projectRoot (direct mode)', () => {
    // WU-1370: When projectRoot is provided, repairs work directly in that directory
    // without creating a micro-worktree. This is used when repair is called from
    // within a micro-worktree context (e.g., handleOrphanCheck during wu:claim).

    it('should NOT use micro-worktree when projectRoot is provided (WU-1370)', async () => {
      const { repairWUInconsistency } = await import('@lumenflow/core/wu-consistency-checker');
      const { withMicroWorktree } = await import('@lumenflow/core/micro-worktree');

      const report = {
        valid: false,
        errors: [
          {
            type: 'YAML_DONE_NO_STAMP',
            wuId: 'WU-9999',
            title: 'Test WU',
            description: 'WU done but no stamp',
            repairAction: 'Create stamp file',
            canAutoRepair: true,
          },
        ],
      };

      // When projectRoot is provided, direct mode is used (no micro-worktree)
      await repairWUInconsistency(report, { projectRoot: testProjectRoot });

      // Verify micro-worktree was NOT used
      expect(withMicroWorktree).not.toHaveBeenCalled();
      expect(withMicroWorktreeCalls).toHaveLength(0);
    });

    it('should create stamp file directly in projectRoot when provided', async () => {
      const { repairWUInconsistency } = await import('@lumenflow/core/wu-consistency-checker');

      const report = {
        valid: false,
        errors: [
          {
            type: 'YAML_DONE_NO_STAMP',
            wuId: 'WU-9999',
            title: 'Test WU',
            description: 'WU done but no stamp',
            repairAction: 'Create stamp file',
            canAutoRepair: true,
          },
        ],
      };

      await repairWUInconsistency(report, { projectRoot: testProjectRoot });

      // Verify stamp was created directly in projectRoot
      const stampPath = path.join(testProjectRoot, '.lumenflow/stamps/WU-9999.done');
      expect(existsSync(stampPath)).toBe(true);

      // Verify stamp content
      const stampContent = readFileSync(stampPath, 'utf-8');
      expect(stampContent).toContain('WU-9999');
      expect(stampContent).toContain('Test WU');
    });

    it('should work directly for YAML_DONE_STATUS_IN_PROGRESS repair when projectRoot provided', async () => {
      const { repairWUInconsistency } = await import('@lumenflow/core/wu-consistency-checker');
      const { withMicroWorktree } = await import('@lumenflow/core/micro-worktree');

      // Create status.md with WU-9999 in In Progress section
      writeFileSync(
        path.join(testProjectRoot, 'docs/04-operations/tasks/status.md'),
        `# Status\n\n## In Progress\n\n- [WU-9999](wu/WU-9999.yaml) Test WU\n\n## Done\n\n`,
      );

      const report = {
        valid: false,
        errors: [
          {
            type: 'YAML_DONE_STATUS_IN_PROGRESS',
            wuId: 'WU-9999',
            description: 'WU done but in status.md In Progress',
            repairAction: 'Remove from status.md In Progress section',
            canAutoRepair: true,
          },
        ],
      };

      await repairWUInconsistency(report, { projectRoot: testProjectRoot });

      // Verify micro-worktree was NOT used (direct mode)
      expect(withMicroWorktree).not.toHaveBeenCalled();
    });

    it('should batch multiple repairs directly when projectRoot provided', async () => {
      const { repairWUInconsistency } = await import('@lumenflow/core/wu-consistency-checker');
      const { withMicroWorktree } = await import('@lumenflow/core/micro-worktree');

      // Create multiple WUs needing repair
      for (const id of ['WU-9998', 'WU-9997']) {
        writeFileSync(
          path.join(testProjectRoot, `docs/04-operations/tasks/wu/${id}.yaml`),
          `id: ${id}
title: Test WU ${id}
lane: 'Framework: CLI'
type: bug
status: done
priority: P2
created: 2026-01-23
code_paths: []
description: Test
acceptance: []
`,
        );
      }

      const report = {
        valid: false,
        errors: [
          {
            type: 'YAML_DONE_NO_STAMP',
            wuId: 'WU-9999',
            title: 'Test WU 9999',
            description: 'WU done but no stamp',
            repairAction: 'Create stamp file',
            canAutoRepair: true,
          },
          {
            type: 'YAML_DONE_NO_STAMP',
            wuId: 'WU-9998',
            title: 'Test WU 9998',
            description: 'WU done but no stamp',
            repairAction: 'Create stamp file',
            canAutoRepair: true,
          },
          {
            type: 'YAML_DONE_NO_STAMP',
            wuId: 'WU-9997',
            title: 'Test WU 9997',
            description: 'WU done but no stamp',
            repairAction: 'Create stamp file',
            canAutoRepair: true,
          },
        ],
      };

      await repairWUInconsistency(report, { projectRoot: testProjectRoot });

      // Verify micro-worktree was NOT used (direct mode)
      expect(withMicroWorktree).not.toHaveBeenCalled();

      // Verify all stamps were created directly
      expect(existsSync(path.join(testProjectRoot, '.lumenflow/stamps/WU-9999.done'))).toBe(true);
      expect(existsSync(path.join(testProjectRoot, '.lumenflow/stamps/WU-9998.done'))).toBe(true);
      expect(existsSync(path.join(testProjectRoot, '.lumenflow/stamps/WU-9997.done'))).toBe(true);
    });
  });

  describe('repairWUInconsistency without projectRoot (CLI mode)', () => {
    // When no projectRoot is provided (CLI invocation), micro-worktree should be used

    it('should use micro-worktree isolation when no projectRoot provided', async () => {
      const { repairWUInconsistency } = await import('@lumenflow/core/wu-consistency-checker');
      const { withMicroWorktree } = await import('@lumenflow/core/micro-worktree');

      // Mock process.cwd to return our test directory
      const originalCwd = process.cwd;
      vi.spyOn(process, 'cwd').mockReturnValue(testProjectRoot);

      try {
        const report = {
          valid: false,
          errors: [
            {
              type: 'YAML_DONE_NO_STAMP',
              wuId: 'WU-9999',
              title: 'Test WU',
              description: 'WU done but no stamp',
              repairAction: 'Create stamp file',
              canAutoRepair: true,
            },
          ],
        };

        // When no projectRoot is provided, micro-worktree should be used
        await repairWUInconsistency(report);

        // Verify micro-worktree WAS used
        expect(withMicroWorktree).toHaveBeenCalled();
        expect(withMicroWorktreeCalls.length).toBeGreaterThan(0);
        expect(withMicroWorktreeCalls[0]).toMatchObject({
          operation: expect.stringContaining('repair'),
          id: expect.stringContaining('WU-'),
        });
      } finally {
        process.cwd = originalCwd;
      }
    });
  });
});

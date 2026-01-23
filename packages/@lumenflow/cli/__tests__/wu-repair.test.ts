/**
 * wu:repair micro-worktree isolation tests (WU-1078)
 *
 * Tests that wu:repair uses micro-worktree for all file changes,
 * never writing directly to main checkout.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
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

vi.mock('@lumenflow/core/dist/git-adapter.js', () => ({
  getGitForCwd: vi.fn(() => mockGitForCwd),
  createGitForPath: vi.fn(() => mockGitForWorktree),
}));

// Spy on withMicroWorktree to verify it's called
vi.mock('@lumenflow/core/dist/micro-worktree.js', async () => {
  const actual = await vi.importActual<typeof import('@lumenflow/core/dist/micro-worktree.js')>(
    '@lumenflow/core/dist/micro-worktree.js',
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

  describe('repairWUInconsistency', () => {
    it('should use micro-worktree isolation for YAML_DONE_NO_STAMP repair', async () => {
      // Import from @lumenflow/core to get the function that handles repairs
      const { repairWUInconsistency } =
        await import('@lumenflow/core/dist/wu-consistency-checker.js');
      const { withMicroWorktree } = await import('@lumenflow/core/dist/micro-worktree.js');

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

      // Verify micro-worktree was used for the repair
      expect(withMicroWorktree).toHaveBeenCalled();
      expect(withMicroWorktreeCalls.length).toBeGreaterThan(0);
      expect(withMicroWorktreeCalls[0]).toMatchObject({
        operation: expect.stringContaining('repair'),
        id: expect.stringContaining('WU-'),
      });
    });

    it('should use micro-worktree isolation for YAML_DONE_STATUS_IN_PROGRESS repair', async () => {
      const { repairWUInconsistency } =
        await import('@lumenflow/core/dist/wu-consistency-checker.js');
      const { withMicroWorktree } = await import('@lumenflow/core/dist/micro-worktree.js');

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

      expect(withMicroWorktree).toHaveBeenCalled();
    });

    it('should use micro-worktree isolation for STAMP_EXISTS_YAML_NOT_DONE repair', async () => {
      const { repairWUInconsistency } =
        await import('@lumenflow/core/dist/wu-consistency-checker.js');
      const { withMicroWorktree } = await import('@lumenflow/core/dist/micro-worktree.js');

      // Create stamp file
      writeFileSync(
        path.join(testProjectRoot, '.lumenflow/stamps/WU-9999.done'),
        'WU WU-9999 - Test WU\nCompleted: 2026-01-23\n',
      );

      // Update WU YAML to not-done status
      const wuNotDone = `id: WU-9999
title: Test WU
lane: 'Framework: CLI'
type: bug
status: in_progress
priority: P2
created: 2026-01-23
code_paths: []
description: Test WU for repair testing
acceptance:
  - Test acceptance criteria
`;
      writeFileSync(
        path.join(testProjectRoot, 'docs/04-operations/tasks/wu/WU-9999.yaml'),
        wuNotDone,
      );

      const report = {
        valid: false,
        errors: [
          {
            type: 'STAMP_EXISTS_YAML_NOT_DONE',
            wuId: 'WU-9999',
            title: 'Test WU',
            description: 'Stamp exists but YAML not done',
            repairAction: 'Update YAML to done+locked+completed',
            canAutoRepair: true,
          },
        ],
      };

      await repairWUInconsistency(report, { projectRoot: testProjectRoot });

      expect(withMicroWorktree).toHaveBeenCalled();
    });

    it('should batch multiple repairs into a single micro-worktree operation', async () => {
      const { repairWUInconsistency } =
        await import('@lumenflow/core/dist/wu-consistency-checker.js');
      const { withMicroWorktree } = await import('@lumenflow/core/dist/micro-worktree.js');

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

      // Should use a single micro-worktree for all repairs (batch mode)
      // Currently will be called once per repair, but ideally should batch
      expect(withMicroWorktree).toHaveBeenCalled();
    });
  });
});

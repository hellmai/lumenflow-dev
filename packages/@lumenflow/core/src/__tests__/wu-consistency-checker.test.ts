/**
 * wu-consistency-checker tests (WU-1370)
 *
 * Tests for repairWUInconsistency behavior when called with projectRoot parameter.
 * When projectRoot is provided, the function should work directly in that directory
 * instead of creating a nested micro-worktree.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
  readFileSync,
  cpSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

// Track withMicroWorktree calls to verify it's NOT called when projectRoot is provided
let withMicroWorktreeCalls: Array<{ operation: string; id: string; pushOnly?: boolean }> = [];
let lastMicroWorktreeFiles = new Map<string, string>();

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

          // Copy minimal project structure from cwd to micro-worktree
          const sourceRoot = process.cwd();
          const docsSource = path.join(sourceRoot, 'docs');
          const lumenflowSource = path.join(sourceRoot, '.lumenflow');
          if (existsSync(docsSource)) {
            cpSync(docsSource, path.join(microWorktreePath, 'docs'), { recursive: true });
          }
          if (existsSync(lumenflowSource)) {
            cpSync(lumenflowSource, path.join(microWorktreePath, '.lumenflow'), {
              recursive: true,
            });
          }

          const result = await options.execute({
            worktreePath: microWorktreePath,
            gitWorktree: mockGitForWorktree,
          });

          lastMicroWorktreeFiles = new Map();
          for (const file of result.files ?? []) {
            const absPath = path.join(microWorktreePath, file);
            if (existsSync(absPath)) {
              lastMicroWorktreeFiles.set(file, readFileSync(absPath, 'utf-8'));
            }
          }

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
    lastMicroWorktreeFiles = new Map();

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

    it('should repair stamp/yaml mismatch and append complete event to reconcile state', async () => {
      const { repairWUInconsistency } = await import('../wu-consistency-checker.js');
      const { parseYAML } = await import('../wu-yaml.js');

      const wuPath = path.join(testProjectRoot, 'docs/04-operations/tasks/wu/WU-2000.yaml');
      writeFileSync(
        wuPath,
        `id: WU-2000
title: Test WU for State Reconcile
lane: 'Operations: Tooling'
type: bug
status: in_progress
priority: P1
created: 2026-02-10
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
`,
      );
      writeFileSync(
        path.join(testProjectRoot, '.lumenflow/stamps/WU-2000.done'),
        'WU WU-2000 — Test\nCompleted: 2026-02-10\n',
      );
      writeFileSync(
        path.join(testProjectRoot, '.lumenflow/state/wu-events.jsonl'),
        JSON.stringify({
          type: 'claim',
          wuId: 'WU-2000',
          lane: 'Operations: Tooling',
          title: 'Test WU for State Reconcile',
          timestamp: '2026-02-10T01:00:00.000Z',
        }) + '\n',
      );

      const report = {
        valid: false,
        errors: [
          {
            type: 'STAMP_EXISTS_YAML_NOT_DONE',
            wuId: 'WU-2000',
            title: 'Test WU for State Reconcile',
            description: 'Stamp exists but YAML status is not done',
            repairAction: 'Update YAML to done+locked+completed',
            canAutoRepair: true,
          },
        ],
      };

      const result = await repairWUInconsistency(report, { projectRoot: testProjectRoot });
      expect(result.repaired).toBe(1);
      expect(result.failed).toBe(0);

      const updatedWU = parseYAML(readFileSync(wuPath, 'utf-8')) as {
        status?: string;
        locked?: boolean;
        completed?: string;
        completed_at?: string;
      };
      expect(updatedWU.status).toBe('done');
      expect(updatedWU.locked).toBe(true);
      expect(updatedWU.completed_at).toBeDefined();
      expect(updatedWU.completed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(updatedWU.completed).toBe(String(updatedWU.completed_at).slice(0, 10));

      const events = readFileSync(
        path.join(testProjectRoot, '.lumenflow/state/wu-events.jsonl'),
        'utf-8',
      )
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { type: string; wuId: string });
      const wuEvents = events.filter((event) => event.wuId === 'WU-2000');
      expect(wuEvents.some((event) => event.type === 'complete')).toBe(true);
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

    it('should apply cumulative removals for multiple status.md inconsistencies in one batch', async () => {
      const { repairWUInconsistency } = await import('../wu-consistency-checker.js');

      mkdirSync(path.join(testProjectRoot, 'docs/04-operations/tasks'), { recursive: true });
      writeFileSync(
        path.join(testProjectRoot, 'docs/04-operations/tasks/status.md'),
        `# Work Unit Status

## In Progress

- [WU-3001 — First](wu/WU-3001.yaml)
- [WU-3002 — Second](wu/WU-3002.yaml)

## Completed

(No items completed yet)
`,
      );

      const originalCwd = process.cwd;
      vi.spyOn(process, 'cwd').mockReturnValue(testProjectRoot);

      try {
        const report = {
          valid: false,
          errors: [
            {
              type: 'YAML_DONE_STATUS_IN_PROGRESS',
              wuId: 'WU-3001',
              description: 'WU-3001 should be removed from status.md In Progress',
              repairAction: 'Remove from status.md In Progress section',
              canAutoRepair: true,
            },
            {
              type: 'YAML_DONE_STATUS_IN_PROGRESS',
              wuId: 'WU-3002',
              description: 'WU-3002 should be removed from status.md In Progress',
              repairAction: 'Remove from status.md In Progress section',
              canAutoRepair: true,
            },
          ],
        };

        const result = await repairWUInconsistency(report);
        expect(result.repaired).toBe(2);

        const statusOutput = lastMicroWorktreeFiles.get('docs/04-operations/tasks/status.md');
        expect(statusOutput).toBeDefined();
        expect(statusOutput).not.toContain('WU-3001');
        expect(statusOutput).not.toContain('WU-3002');
      } finally {
        process.cwd = originalCwd;
      }
    });
  });
});

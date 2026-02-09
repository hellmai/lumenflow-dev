/**
 * @file wu-status.test.ts
 * Tests for wu:status CLI command (WU-1090)
 *
 * TDD: RED phase - Tests written BEFORE implementation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CONTEXT_VALIDATION, WU_STATUS } from '@lumenflow/core/wu-constants';
import type { WuContext } from '@lumenflow/core/validation/types';

const { LOCATION_TYPES, COMMANDS } = CONTEXT_VALIDATION;

// Mock the context module - tests will import from dist after build
vi.mock('@lumenflow/core/context/index', () => ({
  computeContext: vi.fn(),
}));

describe('wu:status CLI (WU-1090)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('formatStatusOutput', () => {
    it('formats location info correctly for main checkout', async () => {
      // Dynamic import to get the mocked version
      const { formatStatusOutput } = await import('../dist/wu-status.js');

      const context: WuContext = {
        location: {
          type: LOCATION_TYPES.MAIN,
          cwd: '/home/user/repo',
          gitRoot: '/home/user/repo',
          mainCheckout: '/home/user/repo',
          worktreeName: null,
          worktreeWuId: null,
        },
        git: {
          branch: 'main',
          isDetached: false,
          isDirty: false,
          hasStaged: false,
          ahead: 0,
          behind: 0,
          tracking: 'origin/main',
          modifiedFiles: [],
          hasError: false,
          errorMessage: null,
        },
        wu: null,
        session: { isActive: false, sessionId: null },
      };

      const output = formatStatusOutput(context);

      expect(output).toContain('main checkout');
      expect(output).toContain('main'); // branch
    });

    it('formats location info correctly for worktree', async () => {
      const { formatStatusOutput } = await import('../dist/wu-status.js');

      const context: WuContext = {
        location: {
          type: LOCATION_TYPES.WORKTREE,
          cwd: '/home/user/repo/worktrees/framework-core-wu-1090',
          gitRoot: '/home/user/repo/worktrees/framework-core-wu-1090',
          mainCheckout: '/home/user/repo',
          worktreeName: 'framework-core-wu-1090',
          worktreeWuId: 'WU-1090',
        },
        git: {
          branch: 'lane/framework-core/wu-1090',
          isDetached: false,
          isDirty: true,
          hasStaged: true,
          ahead: 3,
          behind: 0,
          tracking: 'origin/lane/framework-core/wu-1090',
          modifiedFiles: ['src/file.ts'],
          hasError: false,
          errorMessage: null,
        },
        wu: {
          id: 'WU-1090',
          status: WU_STATUS.IN_PROGRESS,
          lane: 'Framework: Core',
          title: 'Context-aware state machine',
          yamlPath: '/home/user/repo/docs/04-operations/tasks/wu/WU-1090.yaml',
          isConsistent: true,
          inconsistencyReason: null,
        },
        session: { isActive: true, sessionId: 'sess-123' },
      };

      const output = formatStatusOutput(context);

      expect(output).toContain('worktree');
      expect(output).toContain('WU-1090');
      expect(output).toContain('in_progress');
      expect(output).toContain('Framework: Core');
      expect(output).toContain('dirty'); // has uncommitted changes
      expect(output).toContain('3 ahead'); // commits ahead
    });

    it('shows valid commands for current context', async () => {
      const { formatStatusOutput } = await import('../dist/wu-status.js');

      const context: WuContext = {
        location: {
          type: LOCATION_TYPES.MAIN,
          cwd: '/home/user/repo',
          gitRoot: '/home/user/repo',
          mainCheckout: '/home/user/repo',
          worktreeName: null,
          worktreeWuId: null,
        },
        git: {
          branch: 'main',
          isDetached: false,
          isDirty: false,
          hasStaged: false,
          ahead: 0,
          behind: 0,
          tracking: null,
          modifiedFiles: [],
          hasError: false,
          errorMessage: null,
        },
        wu: {
          id: 'WU-100',
          status: WU_STATUS.READY,
          lane: 'Operations',
          title: 'Test WU',
          yamlPath: '/home/user/repo/docs/04-operations/tasks/wu/WU-100.yaml',
          isConsistent: true,
          inconsistencyReason: null,
        },
        session: { isActive: false, sessionId: null },
      };

      const output = formatStatusOutput(context);

      // Should show wu:claim as valid (WU is ready, we're in main)
      expect(output).toContain(COMMANDS.WU_CLAIM);
    });

    it('shows git state with dirty indicator', async () => {
      const { formatStatusOutput } = await import('../dist/wu-status.js');

      const context: WuContext = {
        location: {
          type: LOCATION_TYPES.WORKTREE,
          cwd: '/home/user/repo/worktrees/ops-wu-50',
          gitRoot: '/home/user/repo/worktrees/ops-wu-50',
          mainCheckout: '/home/user/repo',
          worktreeName: 'ops-wu-50',
          worktreeWuId: 'WU-50',
        },
        git: {
          branch: 'lane/operations/wu-50',
          isDetached: false,
          isDirty: true,
          hasStaged: false,
          ahead: 0,
          behind: 2,
          tracking: 'origin/main',
          modifiedFiles: ['file1.ts', 'file2.ts'],
          hasError: false,
          errorMessage: null,
        },
        wu: null,
        session: { isActive: false, sessionId: null },
      };

      const output = formatStatusOutput(context);

      expect(output).toContain('dirty');
      expect(output).toContain('2 behind');
    });
  });

  describe('getStatusExitCode', () => {
    it('returns 0 when context has no issues', async () => {
      const { getStatusExitCode } = await import('../dist/wu-status.js');

      const context: WuContext = {
        location: {
          type: LOCATION_TYPES.MAIN,
          cwd: '/home/user/repo',
          gitRoot: '/home/user/repo',
          mainCheckout: '/home/user/repo',
          worktreeName: null,
          worktreeWuId: null,
        },
        git: {
          branch: 'main',
          isDetached: false,
          isDirty: false,
          hasStaged: false,
          ahead: 0,
          behind: 0,
          tracking: null,
          modifiedFiles: [],
          hasError: false,
          errorMessage: null,
        },
        wu: null,
        session: { isActive: false, sessionId: null },
      };

      const code = getStatusExitCode(context);
      expect(code).toBe(0);
    });

    it('returns 1 when git has errors', async () => {
      const { getStatusExitCode } = await import('../dist/wu-status.js');

      const context: WuContext = {
        location: {
          type: LOCATION_TYPES.UNKNOWN,
          cwd: '/tmp/not-a-repo',
          gitRoot: '/tmp/not-a-repo',
          mainCheckout: '/tmp/not-a-repo',
          worktreeName: null,
          worktreeWuId: null,
        },
        git: {
          branch: null,
          isDetached: false,
          isDirty: false,
          hasStaged: false,
          ahead: 0,
          behind: 0,
          tracking: null,
          modifiedFiles: [],
          hasError: true,
          errorMessage: 'Not a git repository',
        },
        wu: null,
        session: { isActive: false, sessionId: null },
      };

      const code = getStatusExitCode(context);
      expect(code).toBe(1);
    });
  });
});

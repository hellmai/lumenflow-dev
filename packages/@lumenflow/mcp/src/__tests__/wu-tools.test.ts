// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-tools.test.ts
 * @description Tests for additional WU MCP tool implementations
 *
 * WU-1422: MCP tools: wu_block, wu_unblock, wu_edit, wu_release, wu_recover, wu_repair,
 * wu_deps, wu_prep, wu_preflight, wu_prune, wu_delete, wu_cleanup, wu_validate,
 * wu_infer_lane, wu_unlock_lane
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as toolsShared from '../tools-shared.js';
import {
  wuBlockTool,
  wuUnblockTool,
  wuEditTool,
  wuReleaseTool,
  wuRecoverTool,
  wuRepairTool,
  wuDepsTool,
  wuPrepTool,
  wuPreflightTool,
  wuPruneTool,
  wuDeleteTool,
  wuCleanupTool,
  wuSandboxTool,
  wuBriefTool,
  wuDelegateTool,
  wuValidateTool,
  wuInferLaneTool,
  wuUnlockLaneTool,
  backlogPruneTool,
  docsSyncTool,
  gatesTool,
  gatesDocsTool,
  laneHealthTool,
  laneSuggestTool,
  lumenflowTool,
  lumenflowGatesTool,
  lumenflowValidateTool,
  lumenflowMetricsTool,
  metricsTool,
  stateBootstrapTool,
  stateCleanupTool,
  stateDoctorTool,
  syncTemplatesTool,
  fileReadTool,
  fileWriteTool,
  fileEditTool,
  fileDeleteTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitBranchTool,
  initPlanTool,
  planCreateTool,
  planEditTool,
  planLinkTool,
  planPromoteTool,
  signalCleanupTool,
  wuProtoTool,
  allTools,
  buildMcpManifestParityReport,
  registeredTools,
} from '../tools.js';
import * as cliRunner from '../cli-runner.js';
import { PUBLIC_MANIFEST } from '../../../cli/src/public-manifest.js';

// Mock cli-runner for all operations
vi.mock('../cli-runner.js', () => ({
  runCliCommand: vi.fn(),
}));

vi.mock('../tools-shared.js', async () => {
  const actual = await vi.importActual<typeof import('../tools-shared.js')>('../tools-shared.js');
  return {
    ...actual,
    executeViaPack: vi.fn(actual.executeViaPack),
  };
});

describe('wu_claim cloud mode passthrough (WU-1491)', () => {
  const mockRunCliCommand = vi.mocked(cliRunner.runCliCommand);
  const mockExecuteViaPack = vi.mocked(toolsShared.executeViaPack);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Import wuClaimTool dynamically to ensure it picks up schema changes
  let wuClaimTool;
  beforeEach(async () => {
    const tools = await import('../tools.js');
    wuClaimTool = tools.wuClaimTool;
  });

  it('should pass --cloud flag to CLI', async () => {
    mockExecuteViaPack.mockResolvedValue({
      success: true,
      data: { message: 'WU claimed in cloud mode' },
    });

    const result = await wuClaimTool.execute({
      id: 'WU-1491',
      lane: 'Framework: CLI',
      cloud: true,
    });

    expect(result.success).toBe(true);
    expect(mockExecuteViaPack).toHaveBeenCalledWith(
      'wu:claim',
      expect.objectContaining({
        id: 'WU-1491',
        lane: 'Framework: CLI',
        cloud: true,
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'wu:claim',
          args: expect.arrayContaining(['--id', 'WU-1491', '--lane', 'Framework: CLI', '--cloud']),
        }),
      }),
    );
    expect(mockRunCliCommand).not.toHaveBeenCalled();
  });

  it('should pass --branch-only flag to CLI', async () => {
    mockExecuteViaPack.mockResolvedValue({
      success: true,
      data: { message: 'WU claimed in branch-only mode' },
    });

    const result = await wuClaimTool.execute({
      id: 'WU-1491',
      lane: 'Framework: CLI',
      branch_only: true,
    });

    expect(result.success).toBe(true);
    expect(mockExecuteViaPack).toHaveBeenCalledWith(
      'wu:claim',
      expect.objectContaining({
        id: 'WU-1491',
        lane: 'Framework: CLI',
        branch_only: true,
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'wu:claim',
          args: expect.arrayContaining([
            '--id',
            'WU-1491',
            '--lane',
            'Framework: CLI',
            '--branch-only',
          ]),
        }),
      }),
    );
    expect(mockRunCliCommand).not.toHaveBeenCalled();
  });

  it('should pass --pr-mode flag to CLI', async () => {
    mockExecuteViaPack.mockResolvedValue({
      success: true,
      data: { message: 'WU claimed in PR mode' },
    });

    const result = await wuClaimTool.execute({
      id: 'WU-1491',
      lane: 'Framework: CLI',
      pr_mode: true,
    });

    expect(result.success).toBe(true);
    expect(mockExecuteViaPack).toHaveBeenCalledWith(
      'wu:claim',
      expect.objectContaining({
        id: 'WU-1491',
        lane: 'Framework: CLI',
        pr_mode: true,
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'wu:claim',
          args: expect.arrayContaining([
            '--id',
            'WU-1491',
            '--lane',
            'Framework: CLI',
            '--pr-mode',
          ]),
        }),
      }),
    );
    expect(mockRunCliCommand).not.toHaveBeenCalled();
  });

  it('should pass combined --branch-only --pr-mode flags to CLI', async () => {
    mockExecuteViaPack.mockResolvedValue({
      success: true,
      data: { message: 'WU claimed in branch-pr mode' },
    });

    const result = await wuClaimTool.execute({
      id: 'WU-1491',
      lane: 'Framework: CLI',
      branch_only: true,
      pr_mode: true,
    });

    expect(result.success).toBe(true);
    expect(mockExecuteViaPack).toHaveBeenCalledWith(
      'wu:claim',
      expect.objectContaining({
        id: 'WU-1491',
        lane: 'Framework: CLI',
        branch_only: true,
        pr_mode: true,
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'wu:claim',
          args: expect.arrayContaining([
            '--id',
            'WU-1491',
            '--lane',
            'Framework: CLI',
            '--branch-only',
            '--pr-mode',
          ]),
        }),
      }),
    );
    expect(mockRunCliCommand).not.toHaveBeenCalled();
  });

  it('should require sandbox_command when sandbox mode is requested', async () => {
    const result = await wuClaimTool.execute({
      id: 'WU-1687',
      lane: 'Framework: CLI Enforcement',
      sandbox: true,
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('sandbox_command');
  });

  it('should pass sandbox mode and command args through to CLI', async () => {
    mockExecuteViaPack.mockResolvedValue({
      success: true,
      data: { message: 'WU claimed with sandbox launch' },
    });

    const result = await wuClaimTool.execute({
      id: 'WU-1687',
      lane: 'Framework: CLI Enforcement',
      sandbox: true,
      sandbox_command: ['node', '-e', 'process.exit(0)'],
    });

    expect(result.success).toBe(true);
    expect(mockExecuteViaPack).toHaveBeenCalledWith(
      'wu:claim',
      expect.objectContaining({
        id: 'WU-1687',
        lane: 'Framework: CLI Enforcement',
        sandbox: true,
        sandbox_command: ['node', '-e', 'process.exit(0)'],
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'wu:claim',
          args: expect.arrayContaining([
            '--id',
            'WU-1687',
            '--lane',
            'Framework: CLI Enforcement',
            '--sandbox',
            '--',
            'node',
            '-e',
            'process.exit(0)',
          ]),
        }),
      }),
    );
    expect(mockRunCliCommand).not.toHaveBeenCalled();
  });
});

describe('WU MCP tools (WU-1422)', () => {
  const mockRunCliCommand = vi.mocked(cliRunner.runCliCommand);
  const mockExecuteViaPack = vi.mocked(toolsShared.executeViaPack);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('wu_block', () => {
    it('should block WU via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'WU blocked successfully' },
      });

      const result = await wuBlockTool.execute({ id: 'WU-1422', reason: 'Waiting for dependency' });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:block',
        expect.objectContaining({ id: 'WU-1422', reason: 'Waiting for dependency' }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:block',
            args: expect.arrayContaining(['--id', 'WU-1422', '--reason', 'Waiting for dependency']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should require id parameter', async () => {
      const result = await wuBlockTool.execute({ reason: 'test' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });

    it('should require reason parameter', async () => {
      const result = await wuBlockTool.execute({ id: 'WU-1422' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('reason');
    });
  });

  describe('wu_unblock', () => {
    it('should unblock WU via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'WU unblocked successfully' },
      });

      const result = await wuUnblockTool.execute({ id: 'WU-1422' });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:unblock',
        expect.objectContaining({ id: 'WU-1422' }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:unblock',
            args: expect.arrayContaining(['--id', 'WU-1422']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should require id parameter', async () => {
      const result = await wuUnblockTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });
  });

  describe('wu_edit', () => {
    it('should edit WU via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'WU edited successfully' },
      });

      const result = await wuEditTool.execute({
        id: 'WU-1422',
        description: 'Updated description',
        acceptance: ['New criterion'],
      });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:edit',
        expect.objectContaining({
          id: 'WU-1422',
          description: 'Updated description',
          acceptance: ['New criterion'],
        }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:edit',
            args: expect.arrayContaining([
              '--id',
              'WU-1422',
              '--description',
              'Updated description',
            ]),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should require id parameter', async () => {
      const result = await wuEditTool.execute({ description: 'test' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });
  });

  describe('wu_release', () => {
    it('should release WU via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'WU released successfully' },
      });

      const result = await wuReleaseTool.execute({ id: 'WU-1422', reason: 'Agent crashed' });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:release',
        expect.objectContaining({ id: 'WU-1422', reason: 'Agent crashed' }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:release',
            args: expect.arrayContaining(['--id', 'WU-1422', '--reason', 'Agent crashed']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should require id parameter', async () => {
      const result = await wuReleaseTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });
  });

  describe('wu_recover', () => {
    it('should recover WU via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { status: 'recovered', action: 'resume' },
      });

      const result = await wuRecoverTool.execute({ id: 'WU-1422', action: 'resume' });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:recover',
        expect.objectContaining({ id: 'WU-1422', action: 'resume' }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:recover',
            args: expect.arrayContaining(['--id', 'WU-1422', '--action', 'resume']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should require id parameter', async () => {
      const result = await wuRecoverTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });
  });

  describe('wu_repair', () => {
    it('should repair WU via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'WU repaired successfully' },
      });

      const result = await wuRepairTool.execute({ id: 'WU-1422' });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:repair',
        expect.objectContaining({ id: 'WU-1422' }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:repair',
            args: expect.arrayContaining(['--id', 'WU-1422']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should support check mode', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'No issues found' },
      });

      const result = await wuRepairTool.execute({ id: 'WU-1422', check: true });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:repair',
        expect.objectContaining({ id: 'WU-1422', check: true }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:repair',
            args: expect.arrayContaining(['--id', 'WU-1422', '--check']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });
  });

  describe('wu_deps', () => {
    it('should show WU dependencies via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { dependencies: ['WU-1420', 'WU-1421'] },
      });

      const result = await wuDepsTool.execute({ id: 'WU-1422' });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:deps',
        expect.objectContaining({ id: 'WU-1422' }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:deps',
            args: expect.arrayContaining(['--id', 'WU-1422']),
          }),
        }),
      );
    });

    it('should require id parameter', async () => {
      const result = await wuDepsTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });

    it('should support format option', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'WU-1422 -> WU-1420' },
      });

      const result = await wuDepsTool.execute({ id: 'WU-1422', format: 'ascii' });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:deps',
        expect.objectContaining({ id: 'WU-1422', format: 'ascii' }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:deps',
            args: expect.arrayContaining(['--id', 'WU-1422', '--format', 'ascii']),
          }),
        }),
      );
    });
  });

  describe('wu_prep', () => {
    it('should prep WU via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Gates passed. Run: cd /main && pnpm wu:done --id WU-1422' },
      });

      const result = await wuPrepTool.execute({ id: 'WU-1422' });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:prep',
        expect.objectContaining({ id: 'WU-1422' }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:prep',
            args: expect.arrayContaining(['--id', 'WU-1422']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should require id parameter', async () => {
      const result = await wuPrepTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });

    it('should support docs-only flag', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Docs gates passed' },
      });

      const result = await wuPrepTool.execute({ id: 'WU-1422', docs_only: true });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:prep',
        expect.objectContaining({ id: 'WU-1422', docs_only: true }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:prep',
            args: expect.arrayContaining(['--id', 'WU-1422', '--docs-only']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should support full-tests flag', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Full tests run' },
      });

      const result = await wuPrepTool.execute({ id: 'WU-1422', full_tests: true });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:prep',
        expect.objectContaining({ id: 'WU-1422', full_tests: true }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:prep',
            args: expect.arrayContaining(['--id', 'WU-1422', '--full-tests']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });
  });

  describe('wu_preflight', () => {
    it('should run preflight checks via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Preflight checks passed' },
      });

      const result = await wuPreflightTool.execute({ id: 'WU-1422' });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:preflight',
        expect.objectContaining({ id: 'WU-1422' }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:preflight',
            args: expect.arrayContaining(['--id', 'WU-1422']),
          }),
        }),
      );
    });

    it('should require id parameter', async () => {
      const result = await wuPreflightTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });
  });

  describe('wu_prune', () => {
    it('should prune worktrees via executeViaPack (dry-run by default)', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Would remove: worktrees/stale-wu-123' },
      });

      const result = await wuPruneTool.execute({});

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:prune',
        expect.objectContaining({}),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:prune',
            args: [],
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should support execute mode', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Pruned 2 stale worktrees' },
      });

      const result = await wuPruneTool.execute({ execute: true });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:prune',
        expect.objectContaining({ execute: true }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:prune',
            args: expect.arrayContaining(['--execute']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });
  });

  describe('wu_delete', () => {
    it('should delete WU via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'WU-1422 deleted' },
      });

      const result = await wuDeleteTool.execute({ id: 'WU-1422' });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:delete',
        expect.objectContaining({ id: 'WU-1422' }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:delete',
            args: expect.arrayContaining(['--id', 'WU-1422']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should require id parameter', async () => {
      const result = await wuDeleteTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });

    it('should support dry-run mode', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Would delete: WU-1422' },
      });

      const result = await wuDeleteTool.execute({ id: 'WU-1422', dry_run: true });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:delete',
        expect.objectContaining({ id: 'WU-1422', dry_run: true }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:delete',
            args: expect.arrayContaining(['--id', 'WU-1422', '--dry-run']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });
  });

  describe('wu_cleanup', () => {
    it('should cleanup WU via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Cleanup complete' },
      });

      const result = await wuCleanupTool.execute({ id: 'WU-1422' });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:cleanup',
        expect.objectContaining({ id: 'WU-1422' }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:cleanup',
            args: expect.arrayContaining(['--id', 'WU-1422']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should require id parameter', async () => {
      const result = await wuCleanupTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });
  });

  describe('wu_sandbox', () => {
    it('should run wu:sandbox via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Sandbox command completed' },
      });

      const result = await wuSandboxTool.execute({
        id: 'WU-1687',
        worktree: '/tmp/wu-1687',
        command: ['node', '-e', 'process.exit(0)'],
      });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:sandbox',
        expect.objectContaining({
          id: 'WU-1687',
          worktree: '/tmp/wu-1687',
          command: ['node', '-e', 'process.exit(0)'],
        }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:sandbox',
            args: expect.arrayContaining([
              '--id',
              'WU-1687',
              '--worktree',
              '/tmp/wu-1687',
              '--',
              'node',
              '-e',
              'process.exit(0)',
            ]),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should require command parameter', async () => {
      const result = await wuSandboxTool.execute({
        id: 'WU-1687',
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('command');
    });
  });

  describe('wu_spawn removal (WU-1617)', () => {
    it('should not expose wu_spawn in MCP tool registry', () => {
      expect(allTools.some((tool) => tool.name === 'wu_spawn')).toBe(false);
    });

    it('should not expose wu:spawn in public CLI manifest', () => {
      const commandNames = PUBLIC_MANIFEST.map((command) => command.name);
      expect(commandNames).not.toContain('wu:spawn');
    });
  });

  describe('wu_delegate', () => {
    it('should generate brief prompt via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Brief prompt generated' },
      });

      const result = await wuBriefTool.execute({
        id: 'WU-1604',
        client: 'claude-code',
      });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:brief',
        expect.objectContaining({
          id: 'WU-1604',
          client: 'claude-code',
        }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:brief',
            args: expect.arrayContaining(['--id', 'WU-1604', '--client', 'claude-code']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should generate delegation prompt and record intent via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Delegation prompt generated' },
      });

      const result = await wuDelegateTool.execute({
        id: 'WU-1604',
        parent_wu: 'WU-1600',
        client: 'claude-code',
      });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:delegate',
        expect.objectContaining({
          id: 'WU-1604',
          parent_wu: 'WU-1600',
          client: 'claude-code',
        }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:delegate',
            args: expect.arrayContaining([
              '--id',
              'WU-1604',
              '--parent-wu',
              'WU-1600',
              '--client',
              'claude-code',
            ]),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should require parent_wu parameter', async () => {
      const result = await wuDelegateTool.execute({ id: 'WU-1604' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('parent_wu');
    });
  });

  describe('wu_validate', () => {
    it('should validate WU via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'WU-1422 is valid' },
      });

      const result = await wuValidateTool.execute({ id: 'WU-1422' });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:validate',
        expect.objectContaining({ id: 'WU-1422' }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:validate',
            args: expect.arrayContaining(['--id', 'WU-1422']),
          }),
        }),
      );
    });

    it('should require id parameter', async () => {
      const result = await wuValidateTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });

    it('should support no-strict mode', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Validation passed (non-strict)' },
      });

      const result = await wuValidateTool.execute({ id: 'WU-1422', no_strict: true });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:validate',
        expect.objectContaining({ id: 'WU-1422', no_strict: true }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:validate',
            args: expect.arrayContaining(['--id', 'WU-1422', '--no-strict']),
          }),
        }),
      );
    });
  });

  describe('wu_infer_lane', () => {
    it('should infer lane via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { lane: 'Framework: CLI' },
      });

      const result = await wuInferLaneTool.execute({ id: 'WU-1422' });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:infer-lane',
        expect.objectContaining({ id: 'WU-1422' }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:infer-lane',
            args: expect.arrayContaining(['--id', 'WU-1422']),
          }),
        }),
      );
    });

    it('should support paths and desc parameters', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { lane: 'Content: Documentation' },
      });

      const result = await wuInferLaneTool.execute({
        paths: ['docs/**'],
        desc: 'Documentation updates',
      });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:infer-lane',
        expect.objectContaining({ paths: ['docs/**'], desc: 'Documentation updates' }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:infer-lane',
            args: expect.arrayContaining(['--paths', 'docs/**', '--desc', 'Documentation updates']),
          }),
        }),
      );
    });
  });

  describe('wu_unlock_lane', () => {
    it('should unlock lane via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Lane unlocked' },
      });

      const result = await wuUnlockLaneTool.execute({
        lane: 'Framework: CLI',
        reason: 'Agent crashed',
      });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:unlock-lane',
        expect.objectContaining({
          lane: 'Framework: CLI',
          reason: 'Agent crashed',
        }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:unlock-lane',
            args: expect.arrayContaining(['--lane', 'Framework: CLI', '--reason', 'Agent crashed']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should require lane parameter', async () => {
      const result = await wuUnlockLaneTool.execute({ reason: 'test' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('lane');
    });

    it('should support list mode', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: [{ lane: 'Framework: CLI', wu: 'WU-1422' }],
      });

      const result = await wuUnlockLaneTool.execute({ list: true });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'wu:unlock-lane',
        expect.objectContaining({ list: true }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'wu:unlock-lane',
            args: expect.arrayContaining(['--list']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });
  });
});

describe('Wave-1 parity MCP tools (WU-1482)', () => {
  const mockRunCliCommand = vi.mocked(cliRunner.runCliCommand);
  const mockExecuteViaPack = vi.mocked(toolsShared.executeViaPack);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should run backlog:prune with mapped flags', async () => {
    mockExecuteViaPack.mockResolvedValue({ success: true, data: { message: 'ok' } });

    const result = await backlogPruneTool.execute({
      execute: true,
      stale_days_in_progress: 5,
      stale_days_ready: 20,
      archive_days: 60,
    });

    expect(result.success).toBe(true);
    expect(mockExecuteViaPack).toHaveBeenCalledWith(
      'backlog:prune',
      expect.objectContaining({
        execute: true,
        stale_days_in_progress: 5,
        stale_days_ready: 20,
        archive_days: 60,
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'backlog:prune',
        }),
      }),
    );
    expect(mockRunCliCommand).not.toHaveBeenCalled();
  });

  it('should run docs:sync with vendor and force flags', async () => {
    mockExecuteViaPack.mockResolvedValue({ success: true, data: { message: 'ok' } });

    const result = await docsSyncTool.execute({ vendor: 'all', force: true });

    expect(result.success).toBe(true);
    expect(mockExecuteViaPack).toHaveBeenCalledWith(
      'docs:sync',
      expect.objectContaining({ vendor: 'all', force: true }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'docs:sync',
          args: expect.arrayContaining(['--vendor', 'all', '--force']),
        }),
      }),
    );
    expect(mockRunCliCommand).not.toHaveBeenCalled();
  });

  it('should run gates and gates:docs aliases', async () => {
    mockExecuteViaPack.mockResolvedValue({ success: true, data: { message: 'ok' } });

    await gatesTool.execute({ docs_only: false, full_lint: true, coverage_mode: 'block' });
    expect(mockExecuteViaPack).toHaveBeenCalledWith(
      'gates',
      expect.objectContaining({
        docs_only: false,
        full_lint: true,
        coverage_mode: 'block',
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'gates',
          args: expect.arrayContaining(['--full-lint', '--coverage-mode', 'block']),
        }),
      }),
    );

    await gatesDocsTool.execute({});
    expect(mockExecuteViaPack).toHaveBeenCalledWith(
      'gates',
      expect.objectContaining({}),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'gates',
          args: expect.arrayContaining(['--docs-only']),
        }),
      }),
    );
    expect(mockRunCliCommand).not.toHaveBeenCalled();
  });

  it('should run lane tools with mapped flags via executeViaPack', async () => {
    mockExecuteViaPack.mockResolvedValue({ success: true, data: { message: 'ok' } });

    await laneHealthTool.execute({ json: true, verbose: true, no_coverage: true });
    expect(mockExecuteViaPack).toHaveBeenCalledWith(
      'lane:health',
      expect.objectContaining({ json: true, verbose: true, no_coverage: true }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'lane:health',
          args: expect.arrayContaining(['--json', '--verbose', '--no-coverage']),
        }),
      }),
    );

    mockExecuteViaPack.mockClear();
    await laneSuggestTool.execute({
      dry_run: true,
      interactive: true,
      output: 'lanes.yaml',
      json: true,
      no_llm: true,
      include_git: true,
    });
    expect(mockExecuteViaPack).toHaveBeenCalledWith(
      'lane:suggest',
      expect.objectContaining({
        dry_run: true,
        interactive: true,
        output: 'lanes.yaml',
        json: true,
        no_llm: true,
        include_git: true,
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'lane:suggest',
          args: expect.arrayContaining([
            '--dry-run',
            '--interactive',
            '--output',
            'lanes.yaml',
            '--json',
            '--no-llm',
            '--include-git',
          ]),
        }),
      }),
    );
  });

  it('should run lumenflow aliases and metrics tool with mapped flags', async () => {
    mockExecuteViaPack.mockResolvedValue({ success: true, data: { message: 'ok' } });

    await lumenflowTool.execute({ client: 'codex', merge: true, full: true, framework: 'arc42' });
    expect(mockExecuteViaPack).toHaveBeenCalledWith(
      'lumenflow',
      expect.objectContaining({
        client: 'codex',
        merge: true,
        full: true,
        framework: 'arc42',
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'lumenflow',
          args: expect.arrayContaining([
            '--client',
            'codex',
            '--merge',
            '--full',
            '--framework',
            'arc42',
          ]),
        }),
      }),
    );

    await lumenflowGatesTool.execute({ docs_only: true });
    expect(mockExecuteViaPack).toHaveBeenNthCalledWith(
      2,
      'gates',
      expect.objectContaining({ docs_only: true }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'gates',
          args: expect.arrayContaining(['--docs-only']),
        }),
      }),
    );

    await lumenflowValidateTool.execute({});
    expect(mockExecuteViaPack).toHaveBeenNthCalledWith(
      3,
      'lumenflow:validate',
      {},
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'validate',
        }),
      }),
    );

    await lumenflowMetricsTool.execute({ subcommand: 'flow', days: 14, format: 'json' });
    expect(mockExecuteViaPack).toHaveBeenNthCalledWith(
      4,
      'lumenflow:metrics',
      expect.objectContaining({
        subcommand: 'flow',
        days: 14,
        format: 'json',
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'metrics',
        }),
      }),
    );

    await metricsTool.execute({ subcommand: 'dora', dry_run: true });
    expect(mockExecuteViaPack).toHaveBeenNthCalledWith(
      5,
      'metrics',
      expect.objectContaining({
        subcommand: 'dora',
        dry_run: true,
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'metrics',
        }),
      }),
    );
  });

  it('should run state tools with mapped flags', async () => {
    mockExecuteViaPack.mockResolvedValue({ success: true, data: { message: 'ok' } });

    await stateBootstrapTool.execute({
      execute: true,
      force: true,
      wu_dir: 'docs/tasks/wu',
      state_dir: '.lumenflow/state',
    });
    expect(mockExecuteViaPack).toHaveBeenNthCalledWith(
      1,
      'state:bootstrap',
      expect.objectContaining({
        execute: true,
        force: true,
        wu_dir: 'docs/tasks/wu',
        state_dir: '.lumenflow/state',
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'state:bootstrap',
        }),
      }),
    );

    await stateCleanupTool.execute({
      dry_run: true,
      signals_only: true,
      json: true,
      base_dir: '.',
    });
    expect(mockExecuteViaPack).toHaveBeenNthCalledWith(
      2,
      'state:cleanup',
      expect.objectContaining({
        dry_run: true,
        signals_only: true,
        json: true,
        base_dir: '.',
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'state:cleanup',
        }),
      }),
    );

    await stateDoctorTool.execute({ fix: true, dry_run: true, quiet: true });
    expect(mockExecuteViaPack).toHaveBeenNthCalledWith(
      3,
      'state:doctor',
      expect.objectContaining({
        fix: true,
        dry_run: true,
        quiet: true,
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'state:doctor',
        }),
      }),
    );
    expect(mockRunCliCommand).not.toHaveBeenCalled();
  });

  it('should run sync:templates with mapped flags', async () => {
    mockExecuteViaPack.mockResolvedValue({ success: true, data: { message: 'ok' } });

    const result = await syncTemplatesTool.execute({
      dry_run: true,
      verbose: true,
      check_drift: true,
    });

    expect(result.success).toBe(true);
    expect(mockExecuteViaPack).toHaveBeenCalledWith(
      'sync:templates',
      expect.objectContaining({
        dry_run: true,
        verbose: true,
        check_drift: true,
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'sync:templates',
          args: expect.arrayContaining(['--dry-run', '--verbose', '--check-drift']),
        }),
      }),
    );
    expect(mockRunCliCommand).not.toHaveBeenCalled();
  });
});

describe('Wave-2 parity MCP tools (WU-1483)', () => {
  const mockRunCliCommand = vi.mocked(cliRunner.runCliCommand);
  const mockExecuteViaPack = vi.mocked(toolsShared.executeViaPack);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should validate file_read required path and execute via runtime helper', async () => {
    const missing = await fileReadTool.execute({});
    expect(missing.success).toBe(false);
    expect(missing.error?.message).toContain('path');

    mockExecuteViaPack.mockResolvedValue({
      success: true,
      data: {
        content: 'content',
      },
    });

    const result = await fileReadTool.execute({
      path: 'README.md',
      encoding: 'utf-8',
      start_line: 10,
      end_line: 20,
      max_size: 4096,
    });

    expect(result.success).toBe(true);
    expect(mockExecuteViaPack).toHaveBeenCalledWith(
      'file:read',
      expect.objectContaining({
        path: 'README.md',
        encoding: 'utf-8',
        start_line: 10,
        end_line: 20,
        max_size: 4096,
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'file:read',
        }),
      }),
    );
    expect(mockRunCliCommand).not.toHaveBeenCalled();
  });

  it('should route file write/edit/delete through runtime helper', async () => {
    mockExecuteViaPack.mockResolvedValue({ success: true, data: { message: 'ok' } });

    await fileWriteTool.execute({
      path: 'tmp/file.txt',
      content: 'hello',
      no_create_dirs: true,
    });

    await fileEditTool.execute({
      path: 'tmp/file.txt',
      old_string: 'hello',
      new_string: 'world',
      replace_all: true,
    });

    await fileDeleteTool.execute({ path: 'tmp/file.txt', recursive: true, force: true });

    expect(mockExecuteViaPack).toHaveBeenNthCalledWith(
      1,
      'file:write',
      expect.objectContaining({
        path: 'tmp/file.txt',
        content: 'hello',
        no_create_dirs: true,
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'file:write',
        }),
      }),
    );

    expect(mockExecuteViaPack).toHaveBeenNthCalledWith(
      2,
      'file:edit',
      expect.objectContaining({
        path: 'tmp/file.txt',
        old_string: 'hello',
        new_string: 'world',
        replace_all: true,
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'file:edit',
        }),
      }),
    );

    expect(mockExecuteViaPack).toHaveBeenNthCalledWith(
      3,
      'file:delete',
      expect.objectContaining({
        path: 'tmp/file.txt',
        recursive: true,
        force: true,
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'file:delete',
        }),
      }),
    );
    expect(mockRunCliCommand).not.toHaveBeenCalled();
  });

  it('should route git commands through runtime helper', async () => {
    mockExecuteViaPack.mockResolvedValue({ success: true, data: { output: 'ok' } });

    await gitStatusTool.execute({ base_dir: '.', path: 'src', porcelain: true, short: true });
    await gitDiffTool.execute({
      ref: 'HEAD~1',
      staged: true,
      name_only: true,
      stat: true,
      path: 'packages/@lumenflow/mcp/src/tools.ts',
    });
    await gitLogTool.execute({ oneline: true, max_count: 5, since: '7 days ago', author: 'tom' });
    await gitBranchTool.execute({ all: true, remotes: true, show_current: true, contains: 'HEAD' });

    expect(mockExecuteViaPack).toHaveBeenNthCalledWith(
      1,
      'git:status',
      expect.objectContaining({
        commands: [['git', 'status', '--porcelain', '--short', 'src']],
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'git:status',
        }),
      }),
    );

    expect(mockExecuteViaPack).toHaveBeenNthCalledWith(
      2,
      'git:status',
      expect.objectContaining({
        commands: [
          [
            'git',
            'diff',
            '--staged',
            '--name-only',
            '--stat',
            'HEAD~1',
            '--',
            'packages/@lumenflow/mcp/src/tools.ts',
          ],
        ],
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'git:diff',
        }),
      }),
    );

    expect(mockExecuteViaPack).toHaveBeenNthCalledWith(
      3,
      'git:status',
      expect.objectContaining({
        commands: [
          ['git', 'log', '--oneline', '-n', '5', '--since', '7 days ago', '--author', 'tom'],
        ],
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'git:log',
        }),
      }),
    );

    expect(mockExecuteViaPack).toHaveBeenNthCalledWith(
      4,
      'git:status',
      expect.objectContaining({
        commands: [['git', 'branch', '--all', '--remotes', '--show-current', '--contains', 'HEAD']],
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'git:branch',
        }),
      }),
    );
    expect(mockRunCliCommand).not.toHaveBeenCalled();
  });

  it('should validate and map init_plan + plan command args', async () => {
    mockExecuteViaPack.mockResolvedValue({ success: true, data: { message: 'ok' } });

    const missingInit = await initPlanTool.execute({ initiative: 'INIT-MCP-FULL' });
    expect(missingInit.success).toBe(false);
    expect(missingInit.error?.message).toContain('plan');

    await initPlanTool.execute({ initiative: 'INIT-MCP-FULL', create: true });
    expect(mockExecuteViaPack).toHaveBeenCalledWith(
      'init:plan',
      expect.objectContaining({
        initiative: 'INIT-MCP-FULL',
        create: true,
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'init:plan',
          args: expect.arrayContaining(['--initiative', 'INIT-MCP-FULL', '--create']),
        }),
      }),
    );
    expect(mockRunCliCommand).not.toHaveBeenCalled();

    await planCreateTool.execute({ id: 'WU-1483', title: 'MCP wave-2 plan' });
    expect(mockExecuteViaPack).toHaveBeenCalledWith(
      'plan:create',
      expect.objectContaining({ id: 'WU-1483', title: 'MCP wave-2 plan' }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'plan:create',
          args: expect.arrayContaining(['--id', 'WU-1483', '--title', 'MCP wave-2 plan']),
        }),
      }),
    );

    await planEditTool.execute({ id: 'WU-1483', section: 'Goal', append: 'line' });
    expect(mockExecuteViaPack).toHaveBeenCalledWith(
      'plan:edit',
      expect.objectContaining({ id: 'WU-1483', section: 'Goal', append: 'line' }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'plan:edit',
          args: expect.arrayContaining([
            '--id',
            'WU-1483',
            '--section',
            'Goal',
            '--append',
            'line',
          ]),
        }),
      }),
    );

    await planLinkTool.execute({ id: 'WU-1483', plan: 'lumenflow://plans/WU-1483-plan.md' });
    expect(mockExecuteViaPack).toHaveBeenCalledWith(
      'plan:link',
      expect.objectContaining({ id: 'WU-1483', plan: 'lumenflow://plans/WU-1483-plan.md' }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'plan:link',
          args: expect.arrayContaining([
            '--id',
            'WU-1483',
            '--plan',
            'lumenflow://plans/WU-1483-plan.md',
          ]),
        }),
      }),
    );

    await planPromoteTool.execute({ id: 'WU-1483', force: true });
    expect(mockExecuteViaPack).toHaveBeenCalledWith(
      'plan:promote',
      expect.objectContaining({ id: 'WU-1483', force: true }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'plan:promote',
          args: expect.arrayContaining(['--id', 'WU-1483', '--force']),
        }),
      }),
    );
    expect(mockRunCliCommand).not.toHaveBeenCalled();
  });

  it('should map signal_cleanup and wu_proto args with required validation', async () => {
    mockRunCliCommand.mockResolvedValue({ success: true, stdout: 'ok', stderr: '', exitCode: 0 });
    mockExecuteViaPack.mockResolvedValue({ success: true, data: { message: 'ok' } });

    await signalCleanupTool.execute({
      dry_run: true,
      ttl: '7d',
      unread_ttl: '30d',
      max_entries: 100,
      json: true,
      quiet: true,
      base_dir: '.',
    });
    expect(mockExecuteViaPack).toHaveBeenCalledWith(
      'signal:cleanup',
      expect.objectContaining({
        dry_run: true,
        ttl: '7d',
        unread_ttl: '30d',
        max_entries: 100,
        json: true,
        quiet: true,
        base_dir: '.',
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'signal:cleanup',
        }),
      }),
    );
    expect(mockRunCliCommand).not.toHaveBeenCalled();

    const missingProto = await wuProtoTool.execute({ title: 'proto' });
    expect(missingProto.success).toBe(false);
    expect(missingProto.error?.message).toContain('lane');

    await wuProtoTool.execute({
      lane: 'Framework: MCP',
      title: 'Prototype',
      description: 'desc',
      code_paths: ['packages/@lumenflow/mcp/src/tools.ts'],
      labels: ['proto', 'mcp'],
      assigned_to: 'tom@hellm.ai',
    });
    expect(mockExecuteViaPack).toHaveBeenLastCalledWith(
      'wu:proto',
      expect.objectContaining({
        lane: 'Framework: MCP',
        title: 'Prototype',
        description: 'desc',
        code_paths: ['packages/@lumenflow/mcp/src/tools.ts'],
        labels: ['proto', 'mcp'],
        assigned_to: 'tom@hellm.ai',
      }),
      expect.objectContaining({
        fallback: expect.objectContaining({
          command: 'wu:proto',
          args: expect.arrayContaining([
            '--lane',
            'Framework: MCP',
            '--title',
            'Prototype',
            '--description',
            'desc',
            '--code-paths',
            'packages/@lumenflow/mcp/src/tools.ts',
            '--labels',
            'proto,mcp',
            '--assigned-to',
            'tom@hellm.ai',
          ]),
        }),
      }),
    );
    expect(mockRunCliCommand).not.toHaveBeenCalled();
  });
});

describe('Manifest parity truth gate (WU-1481)', () => {
  // WU-1880: pack commands are known, tracked parity gaps.
  // WU-1919: Added pack:validate, pack:hash, pack:publish, pack:install to public manifest.
  // WU-1927: Added onboard command to public manifest.
  // WU-1952: Added pack:author to public manifest.
  // WU-1962: Added workspace:init and lumenflow-onboard alias to public manifest.
  // WU-1980: Added cloud:connect command to public manifest.
  // WU-1983: Added MCP parity tools for cloud_connect, onboard aliases, and workspace_init.
  // The truth gate remains strict by requiring this list to be explicit.
  const EXPECTED_MISSING_COMMANDS: string[] = [
    'pack_author',
    'pack_hash',
    'pack_install',
    'pack_publish',
    'pack_search',
    'pack_validate',
    'templates_sync',
  ];

  const EXPECTED_ALLOWED_EXTRAS = [
    'context_get',
    'gates_run',
    'task_block',
    'task_complete',
    'task_create',
    'task_inspect',
    'task_unblock',
    'tool_execute',
    'validate_agent_skills',
    'validate_agent_sync',
    'validate_backlog_sync',
    'validate_skills_spec',
    'wu_list',
  ];

  it('reports deterministic missing and extra command lists', () => {
    const report = buildMcpManifestParityReport(
      PUBLIC_MANIFEST.map((command) => command.name),
      registeredTools.map((tool) => tool.name),
    );

    expect(report.missing).toEqual(EXPECTED_MISSING_COMMANDS);
    expect(report.allowedExtra).toEqual(EXPECTED_ALLOWED_EXTRAS);
    expect(report.unexpectedExtra).toEqual([]);
  });

  it('requires normalized parity drift to stay within the expected remediation set', () => {
    const report = buildMcpManifestParityReport(
      PUBLIC_MANIFEST.map((command) => command.name),
      registeredTools.map((tool) => tool.name),
    );

    const details =
      `Missing tools: ${report.missing.join(', ') || '(none)'}\n` +
      `Unexpected tools: ${report.unexpectedExtra.join(', ') || '(none)'}`;

    expect(report.missing, details).toEqual(EXPECTED_MISSING_COMMANDS);
    expect(report.unexpectedExtra, details).toEqual([]);
  });
});

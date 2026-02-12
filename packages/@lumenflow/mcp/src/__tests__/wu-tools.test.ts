/**
 * @file wu-tools.test.ts
 * @description Tests for additional WU MCP tool implementations
 *
 * WU-1422: MCP tools: wu_block, wu_unblock, wu_edit, wu_release, wu_recover, wu_repair,
 * wu_deps, wu_prep, wu_preflight, wu_prune, wu_delete, wu_cleanup, wu_validate,
 * wu_infer_lane, wu_unlock_lane
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
} from '../tools.js';
import * as cliRunner from '../cli-runner.js';
import { PUBLIC_MANIFEST } from '../../../cli/src/public-manifest.js';

// Mock cli-runner for all operations
vi.mock('../cli-runner.js', () => ({
  runCliCommand: vi.fn(),
}));

describe('wu_claim cloud mode passthrough (WU-1491)', () => {
  const mockRunCliCommand = vi.mocked(cliRunner.runCliCommand);

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
    mockRunCliCommand.mockResolvedValue({
      success: true,
      stdout: 'WU claimed in cloud mode',
      stderr: '',
      exitCode: 0,
    });

    const result = await wuClaimTool.execute({
      id: 'WU-1491',
      lane: 'Framework: CLI',
      cloud: true,
    });

    expect(result.success).toBe(true);
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'wu:claim',
      expect.arrayContaining(['--id', 'WU-1491', '--lane', 'Framework: CLI', '--cloud']),
      expect.any(Object),
    );
  });

  it('should pass --branch-only flag to CLI', async () => {
    mockRunCliCommand.mockResolvedValue({
      success: true,
      stdout: 'WU claimed in branch-only mode',
      stderr: '',
      exitCode: 0,
    });

    const result = await wuClaimTool.execute({
      id: 'WU-1491',
      lane: 'Framework: CLI',
      branch_only: true,
    });

    expect(result.success).toBe(true);
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'wu:claim',
      expect.arrayContaining(['--id', 'WU-1491', '--lane', 'Framework: CLI', '--branch-only']),
      expect.any(Object),
    );
  });

  it('should pass --pr-mode flag to CLI', async () => {
    mockRunCliCommand.mockResolvedValue({
      success: true,
      stdout: 'WU claimed in PR mode',
      stderr: '',
      exitCode: 0,
    });

    const result = await wuClaimTool.execute({
      id: 'WU-1491',
      lane: 'Framework: CLI',
      pr_mode: true,
    });

    expect(result.success).toBe(true);
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'wu:claim',
      expect.arrayContaining(['--id', 'WU-1491', '--lane', 'Framework: CLI', '--pr-mode']),
      expect.any(Object),
    );
  });

  it('should pass combined --branch-only --pr-mode flags to CLI', async () => {
    mockRunCliCommand.mockResolvedValue({
      success: true,
      stdout: 'WU claimed in branch-pr mode',
      stderr: '',
      exitCode: 0,
    });

    const result = await wuClaimTool.execute({
      id: 'WU-1491',
      lane: 'Framework: CLI',
      branch_only: true,
      pr_mode: true,
    });

    expect(result.success).toBe(true);
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'wu:claim',
      expect.arrayContaining([
        '--id',
        'WU-1491',
        '--lane',
        'Framework: CLI',
        '--branch-only',
        '--pr-mode',
      ]),
      expect.any(Object),
    );
  });
});

describe('WU MCP tools (WU-1422)', () => {
  const mockRunCliCommand = vi.mocked(cliRunner.runCliCommand);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('wu_block', () => {
    it('should block WU via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'WU blocked successfully',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuBlockTool.execute({ id: 'WU-1422', reason: 'Waiting for dependency' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:block',
        expect.arrayContaining(['--id', 'WU-1422', '--reason', 'Waiting for dependency']),
        expect.any(Object),
      );
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
    it('should unblock WU via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'WU unblocked successfully',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuUnblockTool.execute({ id: 'WU-1422' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:unblock',
        expect.arrayContaining(['--id', 'WU-1422']),
        expect.any(Object),
      );
    });

    it('should require id parameter', async () => {
      const result = await wuUnblockTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });
  });

  describe('wu_edit', () => {
    it('should edit WU via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'WU edited successfully',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuEditTool.execute({
        id: 'WU-1422',
        description: 'Updated description',
        acceptance: ['New criterion'],
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:edit',
        expect.arrayContaining(['--id', 'WU-1422', '--description', 'Updated description']),
        expect.any(Object),
      );
    });

    it('should require id parameter', async () => {
      const result = await wuEditTool.execute({ description: 'test' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });
  });

  describe('wu_release', () => {
    it('should release WU via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'WU released successfully',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuReleaseTool.execute({ id: 'WU-1422', reason: 'Agent crashed' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:release',
        expect.arrayContaining(['--id', 'WU-1422', '--reason', 'Agent crashed']),
        expect.any(Object),
      );
    });

    it('should require id parameter', async () => {
      const result = await wuReleaseTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });
  });

  describe('wu_recover', () => {
    it('should recover WU via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: JSON.stringify({ status: 'recovered', action: 'resume' }),
        stderr: '',
        exitCode: 0,
      });

      const result = await wuRecoverTool.execute({ id: 'WU-1422', action: 'resume' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:recover',
        expect.arrayContaining(['--id', 'WU-1422', '--action', 'resume']),
        expect.any(Object),
      );
    });

    it('should require id parameter', async () => {
      const result = await wuRecoverTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });
  });

  describe('wu_repair', () => {
    it('should repair WU via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'WU repaired successfully',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuRepairTool.execute({ id: 'WU-1422' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:repair',
        expect.arrayContaining(['--id', 'WU-1422']),
        expect.any(Object),
      );
    });

    it('should support check mode', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'No issues found',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuRepairTool.execute({ id: 'WU-1422', check: true });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:repair',
        expect.arrayContaining(['--id', 'WU-1422', '--check']),
        expect.any(Object),
      );
    });
  });

  describe('wu_deps', () => {
    it('should show WU dependencies via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: JSON.stringify({ dependencies: ['WU-1420', 'WU-1421'] }),
        stderr: '',
        exitCode: 0,
      });

      const result = await wuDepsTool.execute({ id: 'WU-1422' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:deps',
        expect.arrayContaining(['--id', 'WU-1422']),
        expect.any(Object),
      );
    });

    it('should require id parameter', async () => {
      const result = await wuDepsTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });

    it('should support format option', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'WU-1422 -> WU-1420',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuDepsTool.execute({ id: 'WU-1422', format: 'ascii' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:deps',
        expect.arrayContaining(['--id', 'WU-1422', '--format', 'ascii']),
        expect.any(Object),
      );
    });
  });

  describe('wu_prep', () => {
    it('should prep WU via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Gates passed. Run: cd /main && pnpm wu:done --id WU-1422',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuPrepTool.execute({ id: 'WU-1422' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:prep',
        expect.arrayContaining(['--id', 'WU-1422']),
        expect.any(Object),
      );
    });

    it('should require id parameter', async () => {
      const result = await wuPrepTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });

    it('should support docs-only flag', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Docs gates passed',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuPrepTool.execute({ id: 'WU-1422', docs_only: true });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:prep',
        expect.arrayContaining(['--id', 'WU-1422', '--docs-only']),
        expect.any(Object),
      );
    });
  });

  describe('wu_preflight', () => {
    it('should run preflight checks via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Preflight checks passed',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuPreflightTool.execute({ id: 'WU-1422' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:preflight',
        expect.arrayContaining(['--id', 'WU-1422']),
        expect.any(Object),
      );
    });

    it('should require id parameter', async () => {
      const result = await wuPreflightTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });
  });

  describe('wu_prune', () => {
    it('should prune worktrees via CLI shell-out (dry-run by default)', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Would remove: worktrees/stale-wu-123',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuPruneTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith('wu:prune', [], expect.any(Object));
    });

    it('should support execute mode', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Pruned 2 stale worktrees',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuPruneTool.execute({ execute: true });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:prune',
        expect.arrayContaining(['--execute']),
        expect.any(Object),
      );
    });
  });

  describe('wu_delete', () => {
    it('should delete WU via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'WU-1422 deleted',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuDeleteTool.execute({ id: 'WU-1422' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:delete',
        expect.arrayContaining(['--id', 'WU-1422']),
        expect.any(Object),
      );
    });

    it('should require id parameter', async () => {
      const result = await wuDeleteTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });

    it('should support dry-run mode', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Would delete: WU-1422',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuDeleteTool.execute({ id: 'WU-1422', dry_run: true });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:delete',
        expect.arrayContaining(['--id', 'WU-1422', '--dry-run']),
        expect.any(Object),
      );
    });
  });

  describe('wu_cleanup', () => {
    it('should cleanup WU via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Cleanup complete',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuCleanupTool.execute({ id: 'WU-1422' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:cleanup',
        expect.arrayContaining(['--id', 'WU-1422']),
        expect.any(Object),
      );
    });

    it('should require id parameter', async () => {
      const result = await wuCleanupTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
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
    it('should generate delegation prompt and record intent via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Delegation prompt generated',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuDelegateTool.execute({
        id: 'WU-1604',
        parent_wu: 'WU-1600',
        client: 'claude-code',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:delegate',
        expect.arrayContaining([
          '--id',
          'WU-1604',
          '--parent-wu',
          'WU-1600',
          '--client',
          'claude-code',
        ]),
        expect.any(Object),
      );
    });

    it('should require parent_wu parameter', async () => {
      const result = await wuDelegateTool.execute({ id: 'WU-1604' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('parent_wu');
    });
  });

  describe('wu_validate', () => {
    it('should validate WU via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'WU-1422 is valid',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuValidateTool.execute({ id: 'WU-1422' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:validate',
        expect.arrayContaining(['--id', 'WU-1422']),
        expect.any(Object),
      );
    });

    it('should require id parameter', async () => {
      const result = await wuValidateTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });

    it('should support no-strict mode', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Validation passed (non-strict)',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuValidateTool.execute({ id: 'WU-1422', no_strict: true });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:validate',
        expect.arrayContaining(['--id', 'WU-1422', '--no-strict']),
        expect.any(Object),
      );
    });
  });

  describe('wu_infer_lane', () => {
    it('should infer lane via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Framework: CLI',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuInferLaneTool.execute({ id: 'WU-1422' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:infer-lane',
        expect.arrayContaining(['--id', 'WU-1422']),
        expect.any(Object),
      );
    });

    it('should support paths and desc parameters', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Content: Documentation',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuInferLaneTool.execute({
        paths: ['docs/**'],
        desc: 'Documentation updates',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:infer-lane',
        expect.arrayContaining(['--paths', 'docs/**', '--desc', 'Documentation updates']),
        expect.any(Object),
      );
    });
  });

  describe('wu_unlock_lane', () => {
    it('should unlock lane via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Lane unlocked',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuUnlockLaneTool.execute({
        lane: 'Framework: CLI',
        reason: 'Agent crashed',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:unlock-lane',
        expect.arrayContaining(['--lane', 'Framework: CLI', '--reason', 'Agent crashed']),
        expect.any(Object),
      );
    });

    it('should require lane parameter', async () => {
      const result = await wuUnlockLaneTool.execute({ reason: 'test' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('lane');
    });

    it('should support list mode', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: JSON.stringify([{ lane: 'Framework: CLI', wu: 'WU-1422' }]),
        stderr: '',
        exitCode: 0,
      });

      const result = await wuUnlockLaneTool.execute({ list: true });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:unlock-lane',
        expect.arrayContaining(['--list']),
        expect.any(Object),
      );
    });
  });
});

describe('Wave-1 parity MCP tools (WU-1482)', () => {
  const mockRunCliCommand = vi.mocked(cliRunner.runCliCommand);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should run backlog:prune with mapped flags', async () => {
    mockRunCliCommand.mockResolvedValue({ success: true, stdout: 'ok', stderr: '', exitCode: 0 });

    const result = await backlogPruneTool.execute({
      execute: true,
      stale_days_in_progress: 5,
      stale_days_ready: 20,
      archive_days: 60,
    });

    expect(result.success).toBe(true);
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'backlog:prune',
      expect.arrayContaining([
        '--execute',
        '--stale-days-in-progress',
        '5',
        '--stale-days-ready',
        '20',
        '--archive-days',
        '60',
      ]),
      expect.any(Object),
    );
  });

  it('should run docs:sync with vendor and force flags', async () => {
    mockRunCliCommand.mockResolvedValue({ success: true, stdout: 'ok', stderr: '', exitCode: 0 });

    const result = await docsSyncTool.execute({ vendor: 'all', force: true });

    expect(result.success).toBe(true);
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'docs:sync',
      expect.arrayContaining(['--vendor', 'all', '--force']),
      expect.any(Object),
    );
  });

  it('should run gates and gates:docs aliases', async () => {
    mockRunCliCommand.mockResolvedValue({ success: true, stdout: 'ok', stderr: '', exitCode: 0 });

    await gatesTool.execute({ docs_only: false, full_lint: true, coverage_mode: 'block' });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'gates',
      expect.arrayContaining(['--full-lint', '--coverage-mode', 'block']),
      expect.any(Object),
    );

    await gatesDocsTool.execute({});
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'gates',
      expect.arrayContaining(['--docs-only']),
      expect.any(Object),
    );
  });

  it('should run lane tools with mapped flags', async () => {
    mockRunCliCommand.mockResolvedValue({ success: true, stdout: 'ok', stderr: '', exitCode: 0 });

    await laneHealthTool.execute({ json: true, verbose: true, no_coverage: true });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'lane:health',
      expect.arrayContaining(['--json', '--verbose', '--no-coverage']),
      expect.any(Object),
    );

    await laneSuggestTool.execute({
      dry_run: true,
      interactive: true,
      output: 'lanes.yaml',
      json: true,
      no_llm: true,
      include_git: true,
    });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'lane:suggest',
      expect.arrayContaining([
        '--dry-run',
        '--interactive',
        '--output',
        'lanes.yaml',
        '--json',
        '--no-llm',
        '--include-git',
      ]),
      expect.any(Object),
    );
  });

  it('should run lumenflow aliases and metrics tool with mapped flags', async () => {
    mockRunCliCommand.mockResolvedValue({ success: true, stdout: 'ok', stderr: '', exitCode: 0 });

    await lumenflowTool.execute({ client: 'codex', merge: true, full: true, framework: 'arc42' });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'lumenflow',
      expect.arrayContaining(['--client', 'codex', '--merge', '--full', '--framework', 'arc42']),
      expect.any(Object),
    );

    await lumenflowGatesTool.execute({ docs_only: true });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'gates',
      expect.arrayContaining(['--docs-only']),
      expect.any(Object),
    );

    await lumenflowValidateTool.execute({});
    expect(mockRunCliCommand).toHaveBeenCalledWith('validate', [], expect.any(Object));

    await lumenflowMetricsTool.execute({ subcommand: 'flow', days: 14, format: 'json' });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'metrics',
      expect.arrayContaining(['flow', '--days', '14', '--format', 'json']),
      expect.any(Object),
    );

    await metricsTool.execute({ subcommand: 'dora', dry_run: true });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'metrics',
      expect.arrayContaining(['dora', '--dry-run']),
      expect.any(Object),
    );
  });

  it('should run state tools with mapped flags', async () => {
    mockRunCliCommand.mockResolvedValue({ success: true, stdout: 'ok', stderr: '', exitCode: 0 });

    await stateBootstrapTool.execute({
      execute: true,
      force: true,
      wu_dir: 'docs/04-operations/tasks/wu',
      state_dir: '.lumenflow/state',
    });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'state:bootstrap',
      expect.arrayContaining([
        '--execute',
        '--force',
        '--wu-dir',
        'docs/04-operations/tasks/wu',
        '--state-dir',
        '.lumenflow/state',
      ]),
      expect.any(Object),
    );

    await stateCleanupTool.execute({
      dry_run: true,
      signals_only: true,
      json: true,
      base_dir: '.',
    });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'state:cleanup',
      expect.arrayContaining(['--dry-run', '--signals-only', '--json', '--base-dir', '.']),
      expect.any(Object),
    );

    await stateDoctorTool.execute({ fix: true, dry_run: true, quiet: true });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'state:doctor',
      expect.arrayContaining(['--fix', '--dry-run', '--quiet']),
      expect.any(Object),
    );
  });

  it('should run sync:templates with mapped flags', async () => {
    mockRunCliCommand.mockResolvedValue({ success: true, stdout: 'ok', stderr: '', exitCode: 0 });

    const result = await syncTemplatesTool.execute({
      dry_run: true,
      verbose: true,
      check_drift: true,
    });

    expect(result.success).toBe(true);
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'sync:templates',
      expect.arrayContaining(['--dry-run', '--verbose', '--check-drift']),
      expect.any(Object),
    );
  });
});

describe('Wave-2 parity MCP tools (WU-1483)', () => {
  const mockRunCliCommand = vi.mocked(cliRunner.runCliCommand);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should validate file_read required path and map args', async () => {
    const missing = await fileReadTool.execute({});
    expect(missing.success).toBe(false);
    expect(missing.error?.message).toContain('path');

    mockRunCliCommand.mockResolvedValue({
      success: true,
      stdout: 'content',
      stderr: '',
      exitCode: 0,
    });
    const result = await fileReadTool.execute({
      path: 'README.md',
      encoding: 'utf-8',
      start_line: 10,
      end_line: 20,
      max_size: 4096,
    });
    expect(result.success).toBe(true);
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'file:read',
      expect.arrayContaining([
        '--path',
        'README.md',
        '--encoding',
        'utf-8',
        '--start-line',
        '10',
        '--end-line',
        '20',
        '--max-size',
        '4096',
      ]),
      expect.any(Object),
    );
  });

  it('should map file write/edit/delete command args', async () => {
    mockRunCliCommand.mockResolvedValue({ success: true, stdout: 'ok', stderr: '', exitCode: 0 });

    await fileWriteTool.execute({
      path: 'tmp/file.txt',
      content: 'hello',
      no_create_dirs: true,
      scan_phi: true,
    });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'file:write',
      expect.arrayContaining([
        '--path',
        'tmp/file.txt',
        '--content',
        'hello',
        '--no-create-dirs',
        '--scan-phi',
      ]),
      expect.any(Object),
    );

    await fileEditTool.execute({
      path: 'tmp/file.txt',
      old_string: 'hello',
      new_string: 'world',
      replace_all: true,
    });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'file:edit',
      expect.arrayContaining([
        '--path',
        'tmp/file.txt',
        '--old-string',
        'hello',
        '--new-string',
        'world',
        '--replace-all',
      ]),
      expect.any(Object),
    );

    await fileDeleteTool.execute({ path: 'tmp/file.txt', recursive: true, force: true });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'file:delete',
      expect.arrayContaining(['--path', 'tmp/file.txt', '--recursive', '--force']),
      expect.any(Object),
    );
  });

  it('should map git command args', async () => {
    mockRunCliCommand.mockResolvedValue({ success: true, stdout: 'ok', stderr: '', exitCode: 0 });

    await gitStatusTool.execute({ base_dir: '.', path: 'src', porcelain: true, short: true });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'git:status',
      expect.arrayContaining(['--base-dir', '.', '--porcelain', '--short', 'src']),
      expect.any(Object),
    );

    await gitDiffTool.execute({
      ref: 'HEAD~1',
      staged: true,
      name_only: true,
      stat: true,
      path: 'packages/@lumenflow/mcp/src/tools.ts',
    });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'git:diff',
      expect.arrayContaining([
        '--staged',
        '--name-only',
        '--stat',
        'HEAD~1',
        '--',
        'packages/@lumenflow/mcp/src/tools.ts',
      ]),
      expect.any(Object),
    );

    await gitLogTool.execute({ oneline: true, max_count: 5, since: '7 days ago', author: 'tom' });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'git:log',
      expect.arrayContaining(['--oneline', '-n', '5', '--since', '7 days ago', '--author', 'tom']),
      expect.any(Object),
    );

    await gitBranchTool.execute({ all: true, remotes: true, show_current: true, contains: 'HEAD' });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'git:branch',
      expect.arrayContaining(['--all', '--remotes', '--show-current', '--contains', 'HEAD']),
      expect.any(Object),
    );
  });

  it('should validate and map init_plan + plan command args', async () => {
    mockRunCliCommand.mockResolvedValue({ success: true, stdout: 'ok', stderr: '', exitCode: 0 });

    const missingInit = await initPlanTool.execute({ initiative: 'INIT-MCP-FULL' });
    expect(missingInit.success).toBe(false);
    expect(missingInit.error?.message).toContain('plan');

    await initPlanTool.execute({ initiative: 'INIT-MCP-FULL', create: true });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'init:plan',
      expect.arrayContaining(['--initiative', 'INIT-MCP-FULL', '--create']),
      expect.any(Object),
    );

    await planCreateTool.execute({ id: 'WU-1483', title: 'MCP wave-2 plan' });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'plan:create',
      expect.arrayContaining(['--id', 'WU-1483', '--title', 'MCP wave-2 plan']),
      expect.any(Object),
    );

    await planEditTool.execute({ id: 'WU-1483', section: 'Goal', append: 'line' });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'plan:edit',
      expect.arrayContaining(['--id', 'WU-1483', '--section', 'Goal', '--append', 'line']),
      expect.any(Object),
    );

    await planLinkTool.execute({ id: 'WU-1483', plan: 'lumenflow://plans/WU-1483-plan.md' });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'plan:link',
      expect.arrayContaining(['--id', 'WU-1483', '--plan', 'lumenflow://plans/WU-1483-plan.md']),
      expect.any(Object),
    );

    await planPromoteTool.execute({ id: 'WU-1483', force: true });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'plan:promote',
      expect.arrayContaining(['--id', 'WU-1483', '--force']),
      expect.any(Object),
    );
  });

  it('should map signal_cleanup and wu_proto args with required validation', async () => {
    mockRunCliCommand.mockResolvedValue({ success: true, stdout: 'ok', stderr: '', exitCode: 0 });

    await signalCleanupTool.execute({
      dry_run: true,
      ttl: '7d',
      unread_ttl: '30d',
      max_entries: 100,
      json: true,
      quiet: true,
      base_dir: '.',
    });
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'signal:cleanup',
      expect.arrayContaining([
        '--dry-run',
        '--ttl',
        '7d',
        '--unread-ttl',
        '30d',
        '--max-entries',
        '100',
        '--json',
        '--quiet',
        '--base-dir',
        '.',
      ]),
      expect.any(Object),
    );

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
    expect(mockRunCliCommand).toHaveBeenCalledWith(
      'wu:proto',
      expect.arrayContaining([
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
      expect.any(Object),
    );
  });
});

describe('Manifest parity truth gate (WU-1481)', () => {
  const EXPECTED_MISSING_COMMANDS: string[] = [];

  const EXPECTED_ALLOWED_EXTRAS = [
    'context_get',
    'gates_run',
    'initiative_remove_wu',
    'validate_agent_skills',
    'validate_agent_sync',
    'validate_backlog_sync',
    'validate_skills_spec',
    'wu_list',
  ];

  it('reports deterministic missing and extra command lists', () => {
    const report = buildMcpManifestParityReport(
      PUBLIC_MANIFEST.map((command) => command.name),
      allTools.map((tool) => tool.name),
    );

    expect(report.missing).toEqual(EXPECTED_MISSING_COMMANDS);
    expect(report.allowedExtra).toEqual(EXPECTED_ALLOWED_EXTRAS);
    expect(report.unexpectedExtra).toEqual([]);
  });

  it('requires full normalized parity for initiative closure', () => {
    const report = buildMcpManifestParityReport(
      PUBLIC_MANIFEST.map((command) => command.name),
      allTools.map((tool) => tool.name),
    );

    const details =
      `Missing tools: ${report.missing.join(', ') || '(none)'}\n` +
      `Unexpected tools: ${report.unexpectedExtra.join(', ') || '(none)'}`;

    expect(report.missing, details).toEqual([]);
    expect(report.unexpectedExtra, details).toEqual([]);
  });
});

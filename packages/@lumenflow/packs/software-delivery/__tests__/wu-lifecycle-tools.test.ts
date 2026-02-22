// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

const spawnSyncMock = vi.hoisted(() => vi.fn());
const runtimeRunMock = vi.hoisted(() => vi.fn());

vi.mock('../tool-impl/runtime-cli-adapter.js', async () => {
  const actual = await vi.importActual('../tool-impl/runtime-cli-adapter.js');
  return {
    ...actual,
    runtimeCliAdapter: {
      run: runtimeRunMock,
    },
  };
});

import {
  gatesTool,
  wuBlockTool,
  wuBriefTool,
  wuCleanupTool,
  wuClaimTool,
  wuDeleteTool,
  wuDelegateTool,
  wuDepsTool,
  wuDoneTool,
  wuEditTool,
  wuPruneTool,
  wuProtoTool,
  wuRecoverTool,
  wuReleaseTool,
  wuRepairTool,
  wuSandboxTool,
  wuStatusTool,
  wuUnblockTool,
  wuUnlockLaneTool,
} from '../tool-impl/wu-lifecycle-tools.js';

const CLI_ENTRY_SCRIPT_PATH = path.resolve(process.cwd(), 'tools/cli-entry.mjs');
const WU_STATUS_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/wu-status.js',
);

describe('wu lifecycle tool adapters (WU-1887)', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
    runtimeRunMock.mockReset();
    runtimeRunMock.mockImplementation(async (command: string, args: string[]) => {
      const cliEntryCommands = new Set([
        'wu-claim',
        'wu-prep',
        'wu-done',
        'wu-sandbox',
        'wu-prune',
        'wu-delete',
        'wu-cleanup',
        'wu-unlock-lane',
        'wu-brief',
        'wu-delegate',
        'wu-deps',
        'wu-edit',
        'wu-proto',
        'wu-validate',
        'wu-block',
        'wu-unblock',
        'wu-release',
        'wu-recover',
        'wu-repair',
        'gates',
      ]);
      const scriptPath = cliEntryCommands.has(command)
        ? CLI_ENTRY_SCRIPT_PATH
        : path.resolve(process.cwd(), `packages/@lumenflow/cli/dist/${command}.js`);
      const nodeArgs = cliEntryCommands.has(command)
        ? [scriptPath, command, ...args]
        : [scriptPath, ...args];

      const result = spawnSyncMock(process.execPath, nodeArgs, {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      return {
        ok: result.status === 0 && !result.error,
        status: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        executionError: result.error?.message,
      };
    });
  });

  it('runs wu:status with --json and parses structured output', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: '{"id":"WU-1887","status":"in_progress"}\n',
      stderr: '',
      error: undefined,
    });

    const output = await wuStatusTool({ id: 'WU-1887' });

    expect(output.success).toBe(true);
    expect(output.data).toMatchObject({ id: 'WU-1887', status: 'in_progress' });
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [WU_STATUS_SCRIPT_PATH, '--id', 'WU-1887', '--json'],
      expect.objectContaining({
        cwd: process.cwd(),
        encoding: 'utf8',
      }),
    );
  });

  it('builds wu:claim sandbox arguments with command passthrough', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'claimed',
      stderr: '',
      error: undefined,
    });

    const output = await wuClaimTool({
      id: 'WU-1887',
      lane: 'Framework: Core Lifecycle',
      sandbox: true,
      sandbox_command: ['node', '-v'],
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [
        CLI_ENTRY_SCRIPT_PATH,
        'wu-claim',
        '--id',
        'WU-1887',
        '--lane',
        'Framework: Core Lifecycle',
        '--sandbox',
        '--',
        'node',
        '-v',
      ],
      expect.objectContaining({
        cwd: process.cwd(),
      }),
    );
  });

  it('rejects wu:claim sandbox mode without sandbox_command', async () => {
    const output = await wuClaimTool({
      id: 'WU-1887',
      lane: 'Framework: Core Lifecycle',
      sandbox: true,
    });

    expect(output.success).toBe(false);
    expect(output.error?.code).toBe('MISSING_PARAMETER');
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('maps wu:proto options to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'prototype created',
      stderr: '',
      error: undefined,
    });

    const output = await wuProtoTool({
      lane: 'Framework: Core Lifecycle',
      title: 'Prototype title',
      description: 'Prototype description',
      code_paths: ['packages/@lumenflow/mcp/src/runtime-tool-resolver.ts'],
      labels: ['prototype', 'runtime'],
      assigned_to: 'codex',
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [
        CLI_ENTRY_SCRIPT_PATH,
        'wu-proto',
        '--lane',
        'Framework: Core Lifecycle',
        '--title',
        'Prototype title',
        '--description',
        'Prototype description',
        '--code-paths',
        'packages/@lumenflow/mcp/src/runtime-tool-resolver.ts',
        '--labels',
        'prototype,runtime',
        '--assigned-to',
        'codex',
      ],
      expect.any(Object),
    );
  });

  it('maps wu:brief prompt options to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'brief generated',
      stderr: '',
      error: undefined,
    });

    const output = await wuBriefTool({
      id: 'WU-1894',
      client: 'codex-cli',
      thinking: true,
      budget: 4,
      no_context: true,
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [
        CLI_ENTRY_SCRIPT_PATH,
        'wu-brief',
        '--id',
        'WU-1894',
        '--client',
        'codex-cli',
        '--thinking',
        '--budget',
        '4',
        '--no-context',
      ],
      expect.any(Object),
    );
  });

  it('requires parent_wu for wu:delegate', async () => {
    const output = await wuDelegateTool({
      id: 'WU-1894',
    });

    expect(output.success).toBe(false);
    expect(output.error?.code).toBe('MISSING_PARAMETER');
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('maps wu:delegate prompt options to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'delegate generated',
      stderr: '',
      error: undefined,
    });

    const output = await wuDelegateTool({
      id: 'WU-1894',
      parent_wu: 'WU-1888',
      client: 'codex-cli',
      no_context: true,
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [
        CLI_ENTRY_SCRIPT_PATH,
        'wu-delegate',
        '--id',
        'WU-1894',
        '--client',
        'codex-cli',
        '--parent-wu',
        'WU-1888',
        '--no-context',
      ],
      expect.any(Object),
    );
  });

  it('maps wu:deps options to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'deps ok',
      stderr: '',
      error: undefined,
    });

    const output = await wuDepsTool({
      id: 'WU-1894',
      format: 'json',
      depth: 2,
      direction: 'both',
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [
        CLI_ENTRY_SCRIPT_PATH,
        'wu-deps',
        '--id',
        'WU-1894',
        '--format',
        'json',
        '--depth',
        '2',
        '--direction',
        'both',
      ],
      expect.any(Object),
    );
  });

  it('maps wu:edit options to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'edit ok',
      stderr: '',
      error: undefined,
    });

    const output = await wuEditTool({
      id: 'WU-1894',
      description: 'Updated description',
      acceptance: ['first', 'second'],
      notes: 'note',
      code_paths: ['packages/@lumenflow/mcp/src/tools/wu-tools.ts'],
      lane: 'Framework: Core Lifecycle',
      priority: 'high',
      initiative: 'INIT-030',
      phase: 6,
      no_strict: true,
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [
        CLI_ENTRY_SCRIPT_PATH,
        'wu-edit',
        '--id',
        'WU-1894',
        '--description',
        'Updated description',
        '--acceptance',
        'first',
        '--acceptance',
        'second',
        '--notes',
        'note',
        '--code-paths',
        'packages/@lumenflow/mcp/src/tools/wu-tools.ts',
        '--lane',
        'Framework: Core Lifecycle',
        '--priority',
        'high',
        '--initiative',
        'INIT-030',
        '--phase',
        '6',
        '--no-strict',
      ],
      expect.any(Object),
    );
  });

  it('maps wu:sandbox options to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'sandbox ok',
      stderr: '',
      error: undefined,
    });

    const output = await wuSandboxTool({
      id: 'WU-1895',
      worktree: 'worktrees/framework-core-lifecycle-wu-1895',
      command: ['node', '-v'],
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [
        CLI_ENTRY_SCRIPT_PATH,
        'wu-sandbox',
        '--id',
        'WU-1895',
        '--worktree',
        'worktrees/framework-core-lifecycle-wu-1895',
        '--',
        'node',
        '-v',
      ],
      expect.any(Object),
    );
  });

  it('requires command for wu:sandbox', async () => {
    const output = await wuSandboxTool({
      id: 'WU-1895',
    });

    expect(output.success).toBe(false);
    expect(output.error?.code).toBe('MISSING_PARAMETER');
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('maps wu:prune options to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'prune ok',
      stderr: '',
      error: undefined,
    });

    const output = await wuPruneTool({
      execute: true,
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [CLI_ENTRY_SCRIPT_PATH, 'wu-prune', '--execute'],
      expect.any(Object),
    );
  });

  it('maps wu:delete options to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'delete ok',
      stderr: '',
      error: undefined,
    });

    const output = await wuDeleteTool({
      id: 'WU-1895',
      dry_run: true,
      batch: 'WU-1895,WU-1896',
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [
        CLI_ENTRY_SCRIPT_PATH,
        'wu-delete',
        '--id',
        'WU-1895',
        '--dry-run',
        '--batch',
        'WU-1895,WU-1896',
      ],
      expect.any(Object),
    );
  });

  it('maps wu:cleanup options to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'cleanup ok',
      stderr: '',
      error: undefined,
    });

    const output = await wuCleanupTool({
      id: 'WU-1895',
      artifacts: true,
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [CLI_ENTRY_SCRIPT_PATH, 'wu-cleanup', '--id', 'WU-1895', '--artifacts'],
      expect.any(Object),
    );
  });

  it('requires lane for wu:unlock-lane when not listing locks', async () => {
    const output = await wuUnlockLaneTool({
      reason: 'manual remediation',
    });

    expect(output.success).toBe(false);
    expect(output.error?.code).toBe('MISSING_PARAMETER');
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('maps wu:unlock-lane options to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'unlock ok',
      stderr: '',
      error: undefined,
    });

    const output = await wuUnlockLaneTool({
      lane: 'Framework: Core Lifecycle',
      reason: 'manual remediation',
      force: true,
      status: true,
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [
        CLI_ENTRY_SCRIPT_PATH,
        'wu-unlock-lane',
        '--lane',
        'Framework: Core Lifecycle',
        '--reason',
        'manual remediation',
        '--force',
        '--status',
      ],
      expect.any(Object),
    );
  });

  it('maps wu:block options to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'blocked',
      stderr: '',
      error: undefined,
    });

    const output = await wuBlockTool({
      id: 'WU-1893',
      reason: 'Blocked by dependency',
      remove_worktree: true,
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [
        CLI_ENTRY_SCRIPT_PATH,
        'wu-block',
        '--id',
        'WU-1893',
        '--reason',
        'Blocked by dependency',
        '--remove-worktree',
      ],
      expect.any(Object),
    );
  });

  it('maps wu:unblock options to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'unblocked',
      stderr: '',
      error: undefined,
    });

    const output = await wuUnblockTool({
      id: 'WU-1893',
      reason: 'Dependency cleared',
      create_worktree: true,
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [
        CLI_ENTRY_SCRIPT_PATH,
        'wu-unblock',
        '--id',
        'WU-1893',
        '--reason',
        'Dependency cleared',
        '--create-worktree',
      ],
      expect.any(Object),
    );
  });

  it('maps wu:release options to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'released',
      stderr: '',
      error: undefined,
    });

    const output = await wuReleaseTool({
      id: 'WU-1893',
      reason: 'Recovered ownership',
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [CLI_ENTRY_SCRIPT_PATH, 'wu-release', '--id', 'WU-1893', '--reason', 'Recovered ownership'],
      expect.any(Object),
    );
  });

  it('maps wu:recover options to CLI flags and parses json output', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: '{"id":"WU-1893","status":"ready"}\n',
      stderr: '',
      error: undefined,
    });

    const output = await wuRecoverTool({
      id: 'WU-1893',
      action: 'resume',
      force: true,
      json: true,
    });

    expect(output.success).toBe(true);
    expect(output.data).toMatchObject({ id: 'WU-1893', status: 'ready' });
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [
        CLI_ENTRY_SCRIPT_PATH,
        'wu-recover',
        '--id',
        'WU-1893',
        '--action',
        'resume',
        '--force',
        '--json',
      ],
      expect.any(Object),
    );
  });

  it('maps wu:repair options to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'repair complete',
      stderr: '',
      error: undefined,
    });

    const output = await wuRepairTool({
      id: 'WU-1893',
      check: true,
      claim: true,
      repair_state: true,
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [
        CLI_ENTRY_SCRIPT_PATH,
        'wu-repair',
        '--id',
        'WU-1893',
        '--check',
        '--claim',
        '--repair-state',
      ],
      expect.any(Object),
    );
  });

  it('maps gates options to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'gates ok',
      stderr: '',
      error: undefined,
    });

    const output = await gatesTool({
      docs_only: true,
      full_lint: true,
      coverage_mode: 'block',
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [CLI_ENTRY_SCRIPT_PATH, 'gates', '--docs-only', '--full-lint', '--coverage-mode', 'block'],
      expect.any(Object),
    );
  });

  it('returns tool-specific error code when command fails', async () => {
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'wu:done failed',
      error: undefined,
    });

    const output = await wuDoneTool({ id: 'WU-1887' });

    expect(output.success).toBe(false);
    expect(output.error?.code).toBe('WU_DONE_ERROR');
    expect(output.error?.message).toContain('wu:done failed');
  });
});

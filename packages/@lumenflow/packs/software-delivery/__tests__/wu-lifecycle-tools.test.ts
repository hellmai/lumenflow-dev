// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}));

import {
  gatesTool,
  wuBlockTool,
  wuClaimTool,
  wuDoneTool,
  wuRecoverTool,
  wuReleaseTool,
  wuRepairTool,
  wuStatusTool,
  wuUnblockTool,
} from '../tool-impl/wu-lifecycle-tools.js';

const CLI_ENTRY_SCRIPT_PATH = path.resolve(process.cwd(), 'tools/cli-entry.mjs');
const WU_STATUS_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/wu-status.js',
);

describe('wu lifecycle tool adapters (WU-1887)', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
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
      [CLI_ENTRY_SCRIPT_PATH, 'wu-recover', '--id', 'WU-1893', '--action', 'resume', '--force', '--json'],
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
      [CLI_ENTRY_SCRIPT_PATH, 'wu-repair', '--id', 'WU-1893', '--check', '--claim', '--repair-state'],
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

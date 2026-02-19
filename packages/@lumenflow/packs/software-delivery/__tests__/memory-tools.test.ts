// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}));

import {
  memCheckpointTool,
  memCleanupTool,
  memContextTool,
  memCreateTool,
  memDeleteTool,
  memExportTool,
  memInboxTool,
  memInitTool,
  memReadyTool,
  memRecoverTool,
  memSignalTool,
  memStartTool,
  memSummarizeTool,
  memTriageTool,
} from '../tool-impl/memory-tools.js';

const MEM_INIT_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/mem-init.js',
);
const MEM_START_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/mem-start.js',
);
const MEM_READY_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/mem-ready.js',
);
const MEM_CHECKPOINT_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/mem-checkpoint.js',
);
const MEM_CLEANUP_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/mem-cleanup.js',
);
const MEM_CONTEXT_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/mem-context.js',
);
const MEM_CREATE_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/mem-create.js',
);
const MEM_DELETE_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/mem-delete.js',
);
const MEM_EXPORT_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/mem-export.js',
);
const MEM_INBOX_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/mem-inbox.js',
);
const MEM_SIGNAL_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/mem-signal.js',
);
const MEM_SUMMARIZE_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/mem-summarize.js',
);
const MEM_TRIAGE_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/mem-triage.js',
);
const MEM_RECOVER_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/mem-recover.js',
);

describe('memory tool adapters (WU-1896)', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  it('maps mem:init arguments to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'initialized',
      stderr: '',
      error: undefined,
    });

    const output = await memInitTool({ wu: 'WU-1896' });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [MEM_INIT_SCRIPT_PATH, '--wu', 'WU-1896'],
      expect.any(Object),
    );
  });

  it('maps mem:start arguments to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'started',
      stderr: '',
      error: undefined,
    });

    const output = await memStartTool({ wu: 'WU-1896', lane: 'Framework: Core Lifecycle' });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [MEM_START_SCRIPT_PATH, '--wu', 'WU-1896', '--lane', 'Framework: Core Lifecycle'],
      expect.any(Object),
    );
  });

  it('maps mem:ready arguments to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: '{"nodes":[]}',
      stderr: '',
      error: undefined,
    });

    const output = await memReadyTool({ wu: 'WU-1896' });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [MEM_READY_SCRIPT_PATH, '--wu', 'WU-1896'],
      expect.any(Object),
    );
  });

  it('maps mem:checkpoint arguments to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'checkpoint saved',
      stderr: '',
      error: undefined,
    });

    const output = await memCheckpointTool({
      wu: 'WU-1896',
      message: 'Checkpoint before gates',
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [MEM_CHECKPOINT_SCRIPT_PATH, '--wu', 'WU-1896', '--message', 'Checkpoint before gates'],
      expect.any(Object),
    );
  });

  it('maps mem:cleanup arguments to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'cleanup done',
      stderr: '',
      error: undefined,
    });

    const output = await memCleanupTool({ dry_run: true });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [MEM_CLEANUP_SCRIPT_PATH, '--dry-run'],
      expect.any(Object),
    );
  });

  it('maps mem:context arguments to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: '{"context":[]}',
      stderr: '',
      error: undefined,
    });

    const output = await memContextTool({ wu: 'WU-1896', lane: 'Framework: Core Lifecycle' });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [MEM_CONTEXT_SCRIPT_PATH, '--wu', 'WU-1896', '--lane', 'Framework: Core Lifecycle'],
      expect.any(Object),
    );
  });

  it('maps mem:create arguments to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'created',
      stderr: '',
      error: undefined,
    });

    const output = await memCreateTool({
      message: 'Bug: parser drift',
      wu: 'WU-1896',
      type: 'discovery',
      tags: ['bug', 'scope-creep'],
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [
        MEM_CREATE_SCRIPT_PATH,
        'Bug: parser drift',
        '--wu',
        'WU-1896',
        '--type',
        'discovery',
        '--tags',
        'bug,scope-creep',
      ],
      expect.any(Object),
    );
  });

  it('maps mem:delete arguments to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'deleted',
      stderr: '',
      error: undefined,
    });

    const output = await memDeleteTool({ id: 'mem-123' });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [MEM_DELETE_SCRIPT_PATH, '--id', 'mem-123'],
      expect.any(Object),
    );
  });

  it('maps mem:export arguments to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'exported',
      stderr: '',
      error: undefined,
    });

    const output = await memExportTool({ wu: 'WU-1896', format: 'json' });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [MEM_EXPORT_SCRIPT_PATH, '--wu', 'WU-1896', '--format', 'json'],
      expect.any(Object),
    );
  });

  it('maps mem:inbox arguments to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: '[]',
      stderr: '',
      error: undefined,
    });

    const output = await memInboxTool({
      since: '30m',
      wu: 'WU-1896',
      lane: 'Framework: Core Lifecycle',
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [
        MEM_INBOX_SCRIPT_PATH,
        '--since',
        '30m',
        '--wu',
        'WU-1896',
        '--lane',
        'Framework: Core Lifecycle',
      ],
      expect.any(Object),
    );
  });

  it('maps mem:signal arguments to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'signaled',
      stderr: '',
      error: undefined,
    });

    const output = await memSignalTool({
      message: 'AC1 complete',
      wu: 'WU-1896',
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [MEM_SIGNAL_SCRIPT_PATH, 'AC1 complete', '--wu', 'WU-1896'],
      expect.any(Object),
    );
  });

  it('maps mem:summarize arguments to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'summary',
      stderr: '',
      error: undefined,
    });

    const output = await memSummarizeTool({ wu: 'WU-1896' });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [MEM_SUMMARIZE_SCRIPT_PATH, '--wu', 'WU-1896'],
      expect.any(Object),
    );
  });

  it('maps mem:triage arguments to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: '{"promoted":1}',
      stderr: '',
      error: undefined,
    });

    const output = await memTriageTool({
      wu: 'WU-1896',
      promote: 'mem-123',
      lane: 'Framework: Core Lifecycle',
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [
        MEM_TRIAGE_SCRIPT_PATH,
        '--wu',
        'WU-1896',
        '--promote',
        'mem-123',
        '--lane',
        'Framework: Core Lifecycle',
      ],
      expect.any(Object),
    );
  });

  it('maps mem:recover arguments to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'recovered',
      stderr: '',
      error: undefined,
    });

    const output = await memRecoverTool({
      wu: 'WU-1896',
      max_size: 1024,
      format: 'json',
      quiet: true,
      base_dir: '/tmp/worktree',
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [
        MEM_RECOVER_SCRIPT_PATH,
        '--wu',
        'WU-1896',
        '--max-size',
        '1024',
        '--format',
        'json',
        '--quiet',
        '--base-dir',
        '/tmp/worktree',
      ],
      expect.any(Object),
    );
  });

  it('requires wu for mem:init', async () => {
    const output = await memInitTool({});

    expect(output.success).toBe(false);
    expect(output.error?.code).toBe('MISSING_PARAMETER');
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('requires message for mem:create', async () => {
    const output = await memCreateTool({ wu: 'WU-1896' });

    expect(output.success).toBe(false);
    expect(output.error?.code).toBe('MISSING_PARAMETER');
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('requires id for mem:delete', async () => {
    const output = await memDeleteTool({});

    expect(output.success).toBe(false);
    expect(output.error?.code).toBe('MISSING_PARAMETER');
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('returns tool-specific error code when command fails', async () => {
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'mem:recover failed',
      error: undefined,
    });

    const output = await memRecoverTool({ wu: 'WU-1896' });

    expect(output.success).toBe(false);
    expect(output.error?.code).toBe('MEM_RECOVER_ERROR');
    expect(output.error?.message).toContain('mem:recover failed');
  });
});

// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runSignalMiddleware,
  resetSignalMiddlewareStateForTests,
} from '../signal-middleware.js';

describe('signal middleware (WU-2147)', () => {
  beforeEach(() => {
    resetSignalMiddlewareStateForTests();
  });

  it('surfaces unread signals to stderr for high-value commands', async () => {
    const stderrWrite = vi.fn();
    const loadUnreadSignals = vi.fn().mockResolvedValue([
      {
        id: 'sig-1',
        message: 'coordinate on WU-2147',
        created_at: '2026-03-01T12:00:00.000Z',
        read: false,
        wu_id: 'WU-2147',
      },
    ]);

    await runSignalMiddleware({
      commandName: 'wu:done',
      baseDir: '/tmp/project',
      stderrWrite,
      loadUnreadSignals,
    });

    expect(loadUnreadSignals).toHaveBeenCalledWith('/tmp/project');
    expect(stderrWrite).toHaveBeenCalledTimes(1);
    expect(stderrWrite.mock.calls[0]?.[0]).toContain('[signals] 1 unread coordination signal(s)');
    expect(stderrWrite.mock.calls[0]?.[0]).toContain('coordinate on WU-2147');
  });

  it('skips low-value commands', async () => {
    const loadUnreadSignals = vi.fn();
    const stderrWrite = vi.fn();

    await runSignalMiddleware({
      commandName: 'mem:signal',
      loadUnreadSignals,
      stderrWrite,
    });

    expect(loadUnreadSignals).not.toHaveBeenCalled();
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it('throttles generic command checks', async () => {
    const loadUnreadSignals = vi.fn().mockResolvedValue([]);
    const stderrWrite = vi.fn();
    const now = vi.fn().mockReturnValue(1_000);

    await runSignalMiddleware({
      commandName: 'wu:unlock-lane',
      loadUnreadSignals,
      stderrWrite,
      now,
    });
    await runSignalMiddleware({
      commandName: 'wu:unlock-lane',
      loadUnreadSignals,
      stderrWrite,
      now,
    });

    expect(loadUnreadSignals).toHaveBeenCalledTimes(1);
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it('fails open when local signal loading throws', async () => {
    const loadUnreadSignals = vi.fn().mockRejectedValue(new Error('disk failure'));

    await expect(
      runSignalMiddleware({
        commandName: 'wu:claim',
        loadUnreadSignals,
      }),
    ).resolves.toBeUndefined();
  });

  it('times out remote pull and still continues command-side flow', async () => {
    const loadUnreadSignals = vi.fn().mockResolvedValue([]);

    await expect(
      runSignalMiddleware({
        commandName: 'wu:done',
        remotePull: async () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 20);
          }),
        remotePullTimeoutMs: 1,
        loadUnreadSignals,
      }),
    ).resolves.toBeUndefined();

    expect(loadUnreadSignals).toHaveBeenCalledTimes(1);
  });

  it('opens a remote-pull circuit after repeated failures', async () => {
    const remotePull = vi.fn().mockRejectedValue(new Error('remote unavailable'));
    const loadUnreadSignals = vi.fn().mockResolvedValue([]);
    const now = vi.fn();

    now.mockReturnValueOnce(1_000);
    await runSignalMiddleware({
      commandName: 'wu:done',
      remotePull,
      loadUnreadSignals,
      now,
    });

    now.mockReturnValueOnce(2_000);
    await runSignalMiddleware({
      commandName: 'wu:done',
      remotePull,
      loadUnreadSignals,
      now,
    });

    now.mockReturnValueOnce(3_000);
    await runSignalMiddleware({
      commandName: 'wu:done',
      remotePull,
      loadUnreadSignals,
      now,
    });

    now.mockReturnValueOnce(4_000);
    await runSignalMiddleware({
      commandName: 'wu:done',
      remotePull,
      loadUnreadSignals,
      now,
    });

    expect(remotePull).toHaveBeenCalledTimes(3);
  });

  it('never writes signal summaries to stdout', async () => {
    const stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stderrWrite = vi.fn();
    const loadUnreadSignals = vi.fn().mockResolvedValue([
      {
        id: 'sig-2',
        message: 'signal to stderr only',
        created_at: '2026-03-01T12:00:00.000Z',
        read: false,
      },
    ]);

    await runSignalMiddleware({
      commandName: 'wu:prep',
      stderrWrite,
      loadUnreadSignals,
    });

    expect(stderrWrite).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).not.toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });
});

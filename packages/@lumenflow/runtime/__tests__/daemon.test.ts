import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeDaemon } from '../src/daemon/runtime-daemon.js';
import { TaskScheduler } from '../src/scheduler/task-scheduler.js';
import { SessionManager } from '../src/session/session-manager.js';
import { routeRequestWithDaemonFallback, sendDaemonRequest } from '../src/client/daemon-client.js';

describe('runtime daemon', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-runtime-daemon-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('starts daemon, writes PID file, serves unix socket, and shuts down cleanly', async () => {
    const socketPath = join(tempRoot, 'lumenflowd.sock');
    const pidFilePath = join(tempRoot, 'lumenflowd.pid');

    const daemon = new RuntimeDaemon({
      socketPath,
      pidFilePath,
      scheduler: new TaskScheduler(),
      sessionManager: new SessionManager({ checkpointsDir: join(tempRoot, 'checkpoints') }),
    });

    await daemon.start();

    const pidFile = await readFile(pidFilePath, 'utf8');
    expect(Number(pidFile.trim())).toBeGreaterThan(0);

    const ping = await sendDaemonRequest(socketPath, {
      id: 'ping-1',
      method: 'ping',
      params: {},
    });
    expect(ping.ok).toBe(true);

    await daemon.stop();
  });

  it('routes through daemon when available and falls back in-process when unavailable', async () => {
    const socketPath = join(tempRoot, 'lumenflowd.sock');
    const pidFilePath = join(tempRoot, 'lumenflowd.pid');

    const daemon = new RuntimeDaemon({
      socketPath,
      pidFilePath,
      scheduler: new TaskScheduler(),
      sessionManager: new SessionManager({ checkpointsDir: join(tempRoot, 'checkpoints') }),
    });
    await daemon.start();

    const fallback = vi.fn(async () => ({ ok: true, result: 'fallback' }));
    const viaDaemon = await routeRequestWithDaemonFallback({
      socketPath,
      request: {
        id: 'ping-2',
        method: 'ping',
        params: {},
      },
      inProcessHandler: fallback,
    });

    expect(viaDaemon.ok).toBe(true);
    expect(fallback).not.toHaveBeenCalled();

    await daemon.stop();

    const viaFallback = await routeRequestWithDaemonFallback({
      socketPath,
      request: {
        id: 'ping-3',
        method: 'ping',
        params: {},
      },
      inProcessHandler: fallback,
    });

    expect(viaFallback.result).toBe('fallback');
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('persists session checkpoints and restores them', async () => {
    const checkpointsDir = join(tempRoot, 'checkpoints');
    const manager = new SessionManager({ checkpointsDir });

    const session = await manager.createSession({ agent_id: 'agent-1' });
    await manager.checkpoint(session.session_id, { step: 'running', progress: 0.5 });

    const restored = await manager.restore(session.session_id);
    expect(restored?.state).toEqual({ step: 'running', progress: 0.5 });
  });

  it('handles graceful shutdown signal path', async () => {
    const socketPath = join(tempRoot, 'lumenflowd.sock');
    const pidFilePath = join(tempRoot, 'lumenflowd.pid');

    const daemon = new RuntimeDaemon({
      socketPath,
      pidFilePath,
      scheduler: new TaskScheduler(),
      sessionManager: new SessionManager({ checkpointsDir: join(tempRoot, 'checkpoints') }),
    });

    await daemon.start();
    await daemon.handleSignal('SIGTERM');

    expect(daemon.isRunning()).toBe(false);
  });
});

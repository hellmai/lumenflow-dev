import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeDaemon } from '../src/daemon/runtime-daemon.js';
import { TaskScheduler } from '../src/scheduler/task-scheduler.js';
import { SessionManager } from '../src/session/session-manager.js';
import { routeRequestWithDaemonFallback, sendDaemonRequest } from '../src/client/daemon-client.js';
import type { DaemonResponse } from '../src/transport/unix-socket-server.js';

async function sendRawDaemonLine(socketPath: string, line: string, timeoutMs = 1000) {
  return new Promise<DaemonResponse>((resolve, reject) => {
    const socket = createConnection(socketPath);
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out waiting for daemon response after ${timeoutMs}ms`));
    }, timeoutMs);

    let buffer = '';

    socket.on('connect', () => {
      socket.write(`${line}\n`);
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) {
        return;
      }

      const raw = buffer.slice(0, newlineIndex);
      clearTimeout(timeout);
      socket.end();
      try {
        resolve(JSON.parse(raw) as DaemonResponse);
      } catch (error) {
        reject(error);
      }
    });

    socket.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

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
    const socketStats = await stat(socketPath);
    expect(socketStats.mode & 0o777).toBe(0o600);

    const ping = await sendDaemonRequest(socketPath, {
      id: 'ping-1',
      method: 'ping',
      params: {},
    });
    expect(ping.ok).toBe(true);

    await daemon.stop();
  });

  it('rejects malformed requests and invalid request params', async () => {
    const socketPath = join(tempRoot, 'lumenflowd.sock');
    const pidFilePath = join(tempRoot, 'lumenflowd.pid');

    const daemon = new RuntimeDaemon({
      socketPath,
      pidFilePath,
      scheduler: new TaskScheduler(),
      sessionManager: new SessionManager({ checkpointsDir: join(tempRoot, 'checkpoints') }),
    });
    await daemon.start();

    const malformedJson = await sendRawDaemonLine(socketPath, '{"id":"bad-json"');
    expect(malformedJson.ok).toBe(false);
    expect(malformedJson.id).toBe('unknown');

    const invalidEnvelope = await sendRawDaemonLine(
      socketPath,
      JSON.stringify({
        id: 'bad-envelope',
        params: {},
      }),
    );
    expect(invalidEnvelope.ok).toBe(false);
    expect(invalidEnvelope.id).toBe('bad-envelope');

    const invalidParams = await sendDaemonRequest(socketPath, {
      id: 'bad-params',
      method: 'session.create',
      params: {},
    });
    expect(invalidParams.ok).toBe(false);
    expect(invalidParams.error).toContain('Invalid params');

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

  it('unbinds only daemon-owned signal listeners during stop', async () => {
    const socketPath = join(tempRoot, 'lumenflowd.sock');
    const pidFilePath = join(tempRoot, 'lumenflowd.pid');
    const externalSigterm = vi.fn();
    const externalSigint = vi.fn();
    process.on('SIGTERM', externalSigterm);
    process.on('SIGINT', externalSigint);

    const daemon = new RuntimeDaemon({
      socketPath,
      pidFilePath,
      scheduler: new TaskScheduler(),
      sessionManager: new SessionManager({ checkpointsDir: join(tempRoot, 'checkpoints') }),
    });

    try {
      await daemon.start();
      await daemon.stop();
      expect(process.listeners('SIGTERM')).toContain(externalSigterm);
      expect(process.listeners('SIGINT')).toContain(externalSigint);
    } finally {
      process.removeListener('SIGTERM', externalSigterm);
      process.removeListener('SIGINT', externalSigint);
      if (daemon.isRunning()) {
        await daemon.stop();
      }
    }
  });
});

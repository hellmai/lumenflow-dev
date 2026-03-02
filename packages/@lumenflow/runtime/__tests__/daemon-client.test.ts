import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DaemonRequest, DaemonResponse } from '../src/transport/unix-socket-server.js';

const { createConnectionMock } = vi.hoisted(() => ({
  createConnectionMock: vi.fn(),
}));

vi.mock('node:net', () => ({
  createConnection: createConnectionMock,
}));

import { routeRequestWithDaemonFallback, sendDaemonRequest } from '../src/client/daemon-client.js';

class MockSocket extends EventEmitter {
  write = vi.fn();
  end = vi.fn();
  destroy = vi.fn();
}

function createRequest(id = 'req-1'): DaemonRequest {
  return {
    id,
    method: 'ping',
    params: {},
  };
}

function createSuccessResponse(id = 'req-1'): DaemonResponse {
  return {
    ok: true,
    id,
    result: {
      pong: true,
    },
  };
}

const MOCK_SOCKET_PATH = '/tmp/lumenflowd_socket';

describe('daemon-client', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('writes newline-delimited JSON and resolves parsed daemon responses', async () => {
    const socket = new MockSocket();
    createConnectionMock.mockReturnValue(socket);

    const request = createRequest('connect-success');
    const response = createSuccessResponse('connect-success');
    const pending = sendDaemonRequest(MOCK_SOCKET_PATH, request, 100);

    socket.emit('connect');
    expect(socket.write).toHaveBeenCalledWith(`${JSON.stringify(request)}\n`);

    socket.emit('data', Buffer.from(`${JSON.stringify(response)}\n`, 'utf8'));
    await expect(pending).resolves.toEqual(response);
    expect(socket.end).toHaveBeenCalledTimes(1);
  });

  it('waits for a newline before parsing response data', async () => {
    const socket = new MockSocket();
    createConnectionMock.mockReturnValue(socket);

    const pending = sendDaemonRequest(MOCK_SOCKET_PATH, createRequest('partial'), 100);
    socket.emit('connect');
    socket.emit('data', Buffer.from('{"ok":true,"id":"partial"', 'utf8'));

    expect(socket.end).not.toHaveBeenCalled();

    socket.emit('data', Buffer.from(',"result":{"pong":true}}\n', 'utf8'));
    await expect(pending).resolves.toMatchObject({ ok: true, id: 'partial' });
  });

  it('rejects when daemon returns invalid JSON payloads', async () => {
    const socket = new MockSocket();
    createConnectionMock.mockReturnValue(socket);

    const pending = sendDaemonRequest(MOCK_SOCKET_PATH, createRequest('bad-json'), 100);
    socket.emit('connect');
    socket.emit('data', Buffer.from('{not-json}\n', 'utf8'));

    await expect(pending).rejects.toBeInstanceOf(SyntaxError);
  });

  it('rejects on socket errors', async () => {
    const socket = new MockSocket();
    createConnectionMock.mockReturnValue(socket);

    const pending = sendDaemonRequest(MOCK_SOCKET_PATH, createRequest('socket-error'), 100);
    const error = new TypeError('socket unavailable');
    socket.emit('error', error);

    await expect(pending).rejects.toBe(error);
  });

  it('times out and destroys the socket when daemon does not respond', async () => {
    vi.useFakeTimers();
    const socket = new MockSocket();
    createConnectionMock.mockReturnValue(socket);

    const pending = sendDaemonRequest(MOCK_SOCKET_PATH, createRequest('timeout'), 10);
    const rejection = expect(pending).rejects.toThrow('Daemon request timed out after 10ms');
    await vi.advanceTimersByTimeAsync(11);

    await rejection;
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it('uses in-process fallback when daemon request fails', async () => {
    const socket = new MockSocket();
    createConnectionMock.mockReturnValue(socket);

    const request = createRequest('fallback');
    const fallback = vi.fn(async () => createSuccessResponse('fallback-in-process'));
    const pending = routeRequestWithDaemonFallback({
      socketPath: MOCK_SOCKET_PATH,
      request,
      inProcessHandler: fallback,
    });

    socket.emit('error', new TypeError('daemon unavailable'));

    await expect(pending).resolves.toMatchObject({ id: 'fallback-in-process', ok: true });
    expect(fallback).toHaveBeenCalledWith(request);
  });
});

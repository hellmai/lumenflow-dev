import { createConnection } from 'node:net';
import type { DaemonRequest, DaemonResponse } from '../transport/unix-socket-server.js';

export interface RouteWithFallbackInput {
  socketPath: string;
  request: DaemonRequest;
  inProcessHandler: (request: DaemonRequest) => Promise<DaemonResponse>;
}

export async function sendDaemonRequest(
  socketPath: string,
  request: DaemonRequest,
  timeoutMs = 1000,
): Promise<DaemonResponse> {
  return new Promise<DaemonResponse>((resolve, reject) => {
    const socket = createConnection(socketPath);
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Daemon request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    let buffer = '';

    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) {
        return;
      }

      const line = buffer.slice(0, newlineIndex);
      clearTimeout(timeout);
      socket.end();

      try {
        resolve(JSON.parse(line) as DaemonResponse);
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

export async function routeRequestWithDaemonFallback(
  input: RouteWithFallbackInput,
): Promise<DaemonResponse> {
  try {
    return await sendDaemonRequest(input.socketPath, input.request);
  } catch {
    return input.inProcessHandler(input.request);
  }
}

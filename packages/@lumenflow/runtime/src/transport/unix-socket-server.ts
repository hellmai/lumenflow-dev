import { createServer, type Server, type Socket } from 'node:net';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

export interface DaemonRequest {
  id: string;
  method: string;
  params: unknown;
}

export interface DaemonResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export type DaemonRequestHandler = (request: DaemonRequest) => Promise<DaemonResponse>;

export interface UnixSocketServerOptions {
  socketPath: string;
  handler: DaemonRequestHandler;
}

export class UnixSocketServer {
  private readonly socketPath: string;
  private readonly handler: DaemonRequestHandler;
  private server: Server | null;

  constructor(options: UnixSocketServerOptions) {
    this.socketPath = path.resolve(options.socketPath);
    this.handler = options.handler;
    this.server = null;
  }

  async start(): Promise<void> {
    await mkdir(path.dirname(this.socketPath), { recursive: true });
    await rm(this.socketPath, { force: true });

    this.server = createServer((socket) => {
      this.attachConnection(socket);
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.server) {
        reject(new Error('Unix socket server was not created.'));
        return;
      }

      this.server.once('error', reject);
      this.server.listen(this.socketPath, () => {
        this.server?.off('error', reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const activeServer = this.server;
    this.server = null;

    if (activeServer) {
      await new Promise<void>((resolve, reject) => {
        activeServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }

    await rm(this.socketPath, { force: true });
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  private attachConnection(socket: Socket): void {
    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        this.processLine(trimmed, socket).catch(() => {
          socket.write(
            `${JSON.stringify({
              id: 'unknown',
              ok: false,
              error: 'Failed to process daemon request.',
            } satisfies DaemonResponse)}\n`,
          );
        });
      }
    });
  }

  private async processLine(line: string, socket: Socket): Promise<void> {
    const request = JSON.parse(line) as DaemonRequest;
    const response = await this.handler(request);
    socket.write(`${JSON.stringify(response)}\n`);
  }
}

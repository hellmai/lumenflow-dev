import { createServer, type Server, type Socket } from 'node:net';
import { chmod, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export const DaemonRequestSchema = z.object({
  id: z.string().min(1),
  method: z.string().min(1),
  params: z.unknown(),
});
export type DaemonRequest = z.infer<typeof DaemonRequestSchema>;

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
    await chmod(this.socketPath, 0o600);
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
    let parsedRequestJson: unknown;
    try {
      parsedRequestJson = JSON.parse(line);
    } catch {
      socket.write(
        `${JSON.stringify({
          id: 'unknown',
          ok: false,
          error: 'Invalid JSON payload.',
        } satisfies DaemonResponse)}\n`,
      );
      return;
    }

    const parsedRequest = DaemonRequestSchema.safeParse(parsedRequestJson);
    if (!parsedRequest.success) {
      const requestId =
        parsedRequestJson &&
        typeof parsedRequestJson === 'object' &&
        'id' in parsedRequestJson &&
        typeof (parsedRequestJson as { id?: unknown }).id === 'string'
          ? ((parsedRequestJson as { id: string }).id ?? 'unknown')
          : 'unknown';

      socket.write(
        `${JSON.stringify({
          id: requestId,
          ok: false,
          error: `Invalid daemon request: ${parsedRequest.error.issues[0]?.message ?? parsedRequest.error.message}`,
        } satisfies DaemonResponse)}\n`,
      );
      return;
    }

    const response = await this.handler(parsedRequest.data);
    socket.write(`${JSON.stringify(response)}\n`);
  }
}

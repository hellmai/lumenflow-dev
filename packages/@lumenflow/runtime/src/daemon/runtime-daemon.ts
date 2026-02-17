import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TaskScheduler, type ScheduledTask } from '../scheduler/task-scheduler.js';
import { SessionManager } from '../session/session-manager.js';
import {
  UnixSocketServer,
  type DaemonRequest,
  type DaemonResponse,
} from '../transport/unix-socket-server.js';

export interface RuntimeDaemonOptions {
  socketPath: string;
  pidFilePath: string;
  scheduler: TaskScheduler;
  sessionManager: SessionManager;
}

export class RuntimeDaemon {
  private readonly socketPath: string;
  private readonly pidFilePath: string;
  private readonly scheduler: TaskScheduler;
  private readonly sessionManager: SessionManager;
  private readonly transport: UnixSocketServer;
  private signalBound = false;

  constructor(options: RuntimeDaemonOptions) {
    this.socketPath = path.resolve(options.socketPath);
    this.pidFilePath = path.resolve(options.pidFilePath);
    this.scheduler = options.scheduler;
    this.sessionManager = options.sessionManager;
    this.transport = new UnixSocketServer({
      socketPath: this.socketPath,
      handler: async (request) => this.handleRequest(request),
    });
  }

  async start(): Promise<void> {
    if (this.isRunning()) {
      return;
    }

    await mkdir(path.dirname(this.pidFilePath), { recursive: true });
    await writeFile(this.pidFilePath, String(process.pid), 'utf8');
    await this.transport.start();
    this.bindSignals();
  }

  async stop(): Promise<void> {
    if (!this.isRunning()) {
      await rm(this.pidFilePath, { force: true });
      return;
    }

    await this.transport.stop();
    await rm(this.pidFilePath, { force: true });
    this.unbindSignals();
  }

  isRunning(): boolean {
    return this.transport.isRunning();
  }

  async handleSignal(_signal: 'SIGTERM' | 'SIGINT'): Promise<void> {
    await this.stop();
  }

  private async handleRequest(request: DaemonRequest): Promise<DaemonResponse> {
    if (request.method === 'ping') {
      return {
        id: request.id,
        ok: true,
        result: {
          status: 'ok',
        },
      };
    }

    if (request.method === 'scheduler.enqueue') {
      this.scheduler.enqueue(request.params as ScheduledTask);
      return {
        id: request.id,
        ok: true,
        result: {
          enqueued: true,
        },
      };
    }

    if (request.method === 'scheduler.dequeue') {
      return {
        id: request.id,
        ok: true,
        result: this.scheduler.dequeue(),
      };
    }

    if (request.method === 'session.create') {
      const result = await this.sessionManager.createSession(
        request.params as {
          agent_id: string;
        },
      );
      return {
        id: request.id,
        ok: true,
        result,
      };
    }

    if (request.method === 'session.checkpoint') {
      const params = request.params as {
        session_id: string;
        state: Record<string, unknown>;
      };
      const result = await this.sessionManager.checkpoint(params.session_id, params.state);
      return {
        id: request.id,
        ok: true,
        result,
      };
    }

    if (request.method === 'session.restore') {
      const params = request.params as {
        session_id: string;
      };
      const result = await this.sessionManager.restore(params.session_id);
      return {
        id: request.id,
        ok: true,
        result,
      };
    }

    return {
      id: request.id,
      ok: false,
      error: `Unknown method: ${request.method}`,
    };
  }

  private bindSignals(): void {
    if (this.signalBound) {
      return;
    }
    this.signalBound = true;
    process.once('SIGTERM', () => {
      this.handleSignal('SIGTERM').catch(() => {
        // no-op: shutdown best-effort
      });
    });
    process.once('SIGINT', () => {
      this.handleSignal('SIGINT').catch(() => {
        // no-op: shutdown best-effort
      });
    });
  }

  private unbindSignals(): void {
    if (!this.signalBound) {
      return;
    }
    this.signalBound = false;
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  }
}

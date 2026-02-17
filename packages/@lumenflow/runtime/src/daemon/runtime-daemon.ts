import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { TaskScheduler, type ScheduledTask } from '../scheduler/task-scheduler.js';
import { SessionManager } from '../session/session-manager.js';
import {
  UnixSocketServer,
  type DaemonRequest,
  type DaemonResponse,
} from '../transport/unix-socket-server.js';

const SchedulerEnqueueParamsSchema = z.object({
  task_id: z.string().min(1),
  lane_id: z.string().min(1),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']),
  payload: z.record(z.string(), z.unknown()).optional(),
});
const EmptyParamsSchema = z.record(z.string(), z.unknown());

const SessionCreateParamsSchema = z.object({
  agent_id: z.string().min(1),
});

const SessionCheckpointParamsSchema = z.object({
  session_id: z.string().min(1),
  state: z.record(z.string(), z.unknown()),
});

const SessionRestoreParamsSchema = z.object({
  session_id: z.string().min(1),
});

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
  private sigtermHandler: (() => void) | null = null;
  private sigintHandler: (() => void) | null = null;

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

  private invalidParamsResponse(
    requestId: string,
    method: string,
    message: string,
  ): DaemonResponse {
    return {
      id: requestId,
      ok: false,
      error: `Invalid params for ${method}: ${message}`,
    };
  }

  private async handleRequest(request: DaemonRequest): Promise<DaemonResponse> {
    if (request.method === 'ping') {
      const parsedParams = EmptyParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return this.invalidParamsResponse(request.id, request.method, parsedParams.error.message);
      }
      return {
        id: request.id,
        ok: true,
        result: {
          status: 'ok',
        },
      };
    }

    if (request.method === 'scheduler.enqueue') {
      const parsedParams = SchedulerEnqueueParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return this.invalidParamsResponse(request.id, request.method, parsedParams.error.message);
      }

      this.scheduler.enqueue(parsedParams.data as ScheduledTask);
      return {
        id: request.id,
        ok: true,
        result: {
          enqueued: true,
        },
      };
    }

    if (request.method === 'scheduler.dequeue') {
      const parsedParams = EmptyParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return this.invalidParamsResponse(request.id, request.method, parsedParams.error.message);
      }
      return {
        id: request.id,
        ok: true,
        result: this.scheduler.dequeue(),
      };
    }

    if (request.method === 'session.create') {
      const parsedParams = SessionCreateParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return this.invalidParamsResponse(request.id, request.method, parsedParams.error.message);
      }

      const result = await this.sessionManager.createSession(parsedParams.data);
      return {
        id: request.id,
        ok: true,
        result,
      };
    }

    if (request.method === 'session.checkpoint') {
      const parsedParams = SessionCheckpointParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return this.invalidParamsResponse(request.id, request.method, parsedParams.error.message);
      }

      const result = await this.sessionManager.checkpoint(
        parsedParams.data.session_id,
        parsedParams.data.state,
      );
      return {
        id: request.id,
        ok: true,
        result,
      };
    }

    if (request.method === 'session.restore') {
      const parsedParams = SessionRestoreParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return this.invalidParamsResponse(request.id, request.method, parsedParams.error.message);
      }

      const result = await this.sessionManager.restore(parsedParams.data.session_id);
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
    this.sigtermHandler = () => {
      this.handleSignal('SIGTERM').catch(() => {
        // no-op: shutdown best-effort
      });
    };
    this.sigintHandler = () => {
      this.handleSignal('SIGINT').catch(() => {
        // no-op: shutdown best-effort
      });
    };
    this.signalBound = true;
    process.once('SIGTERM', this.sigtermHandler);
    process.once('SIGINT', this.sigintHandler);
  }

  private unbindSignals(): void {
    if (!this.signalBound) {
      return;
    }
    if (this.sigtermHandler) {
      process.removeListener('SIGTERM', this.sigtermHandler);
    }
    if (this.sigintHandler) {
      process.removeListener('SIGINT', this.sigintHandler);
    }
    this.sigtermHandler = null;
    this.sigintHandler = null;
    this.signalBound = false;
  }
}

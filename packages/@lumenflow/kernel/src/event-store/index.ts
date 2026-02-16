import { appendFile, mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  KernelEventSchema,
  type KernelEvent,
  type TaskSpec,
  type TaskState,
  TaskStateSchema,
  RunSchema,
  type Run,
} from '../kernel.schemas.js';
import { canonical_json } from '../canonical-json.js';

const DEFAULT_LOCK_RETRY_DELAY_MS = 20;
const DEFAULT_LOCK_MAX_RETRIES = 250;

type EventKind = KernelEvent['kind'];
type TaskScopedKernelEvent = Extract<KernelEvent, { task_id: string }>;
type RunLifecycleEvent = Extract<
  KernelEvent,
  { kind: 'run_started' | 'run_paused' | 'run_failed' | 'run_succeeded' }
>;

export interface ReplayFilter {
  taskId?: string;
  kind?: EventKind | EventKind[];
  sinceTimestamp?: string;
  untilTimestamp?: string;
}

export interface EventStoreOptions {
  eventsFilePath: string;
  lockFilePath: string;
  lockRetryDelayMs?: number;
  lockMaxRetries?: number;
  taskSpecLoader?: (taskId: string) => Promise<TaskSpec | null>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toTimestampMillis(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function hasTaskId(event: KernelEvent): event is TaskScopedKernelEvent {
  return 'task_id' in event;
}

function isRunLifecycleEvent(event: KernelEvent): event is RunLifecycleEvent {
  return (
    event.kind === 'run_started' ||
    event.kind === 'run_paused' ||
    event.kind === 'run_failed' ||
    event.kind === 'run_succeeded'
  );
}

function createSyntheticTaskSpec(taskId: string): TaskSpec {
  return {
    id: taskId,
    workspace_id: 'workspace-default',
    lane_id: 'lane-default',
    domain: 'kernel',
    title: `Task ${taskId}`,
    description: `Synthetic projection seed for ${taskId}`,
    acceptance: ['Synthetic projection'],
    declared_scopes: [],
    risk: 'low',
    type: 'runtime',
    priority: 'P3',
    created: '1970-01-01',
  };
}

export function verifyTaskSpecHash(taskSpec: TaskSpec, events: KernelEvent[]): void {
  const created = events.find((event) => event.kind === 'task_created');
  if (!created) {
    return;
  }

  const expectedHash = created.spec_hash;
  const actualHash = canonical_json(taskSpec);

  if (expectedHash !== actualHash) {
    throw new Error(
      `Spec hash mismatch for ${taskSpec.id}: expected ${expectedHash}, actual ${actualHash}`,
    );
  }
}

function reduceRunEvent(event: RunLifecycleEvent, runs: Map<string, Run>): string | undefined {
  const runId = event.run_id;
  const existing =
    runs.get(runId) ??
    ({
      run_id: runId,
      task_id: event.task_id,
      status: 'planned',
      started_at: event.timestamp,
      by: 'unknown',
      session_id: 'unknown',
    } as const);

  let nextRun: Run = { ...existing };

  if (event.kind === 'run_started') {
    nextRun = RunSchema.parse({
      run_id: runId,
      task_id: event.task_id,
      status: 'executing',
      started_at: event.timestamp,
      by: event.by,
      session_id: event.session_id,
    });
  } else if (event.kind === 'run_paused') {
    nextRun = RunSchema.parse({
      ...existing,
      status: 'paused',
    });
  } else if (event.kind === 'run_failed') {
    nextRun = RunSchema.parse({
      ...existing,
      status: 'failed',
      completed_at: event.timestamp,
    });
  } else if (event.kind === 'run_succeeded') {
    nextRun = RunSchema.parse({
      ...existing,
      status: 'succeeded',
      completed_at: event.timestamp,
    });
  }

  runs.set(runId, nextRun);
  return runId;
}

export function projectTaskState(taskSpec: TaskSpec, events: KernelEvent[]): TaskState {
  const sorted = [...events].sort(
    (left, right) => toTimestampMillis(left.timestamp) - toTimestampMillis(right.timestamp),
  );

  const state: TaskState = {
    task_id: taskSpec.id,
    status: 'ready',
    run_count: 0,
  };
  const runs = new Map<string, Run>();
  let currentRunId: string | undefined;

  for (const event of sorted) {
    if (event.kind.startsWith('task_')) {
      if (event.kind === 'task_created') {
        state.status = 'ready';
      } else if (event.kind === 'task_claimed') {
        state.status = 'active';
        state.claimed_at = event.timestamp;
        state.claimed_by = event.by;
        state.session_id = event.session_id;
        state.blocked_reason = undefined;
      } else if (event.kind === 'task_blocked') {
        state.status = 'blocked';
        state.blocked_reason = event.reason;
      } else if (event.kind === 'task_unblocked') {
        state.status = 'active';
        state.blocked_reason = undefined;
      } else if (event.kind === 'task_waiting') {
        state.status = 'waiting';
        state.blocked_reason = event.reason;
      } else if (event.kind === 'task_resumed') {
        state.status = 'active';
        state.blocked_reason = undefined;
      } else if (event.kind === 'task_completed') {
        state.status = 'done';
        state.completed_at = event.timestamp;
      } else if (event.kind === 'task_released') {
        state.status = 'ready';
        state.session_id = undefined;
      }
    }

    if (isRunLifecycleEvent(event)) {
      currentRunId = reduceRunEvent(event, runs);
    }
  }

  state.run_count = runs.size;
  state.current_run = currentRunId ? runs.get(currentRunId) : undefined;
  return TaskStateSchema.parse(state);
}

export class EventStore {
  private readonly eventsFilePath: string;
  private readonly lockFilePath: string;
  private readonly lockRetryDelayMs: number;
  private readonly lockMaxRetries: number;
  private readonly taskSpecLoader?: (taskId: string) => Promise<TaskSpec | null>;

  private orderedEvents: KernelEvent[] = [];
  private byTask = new Map<string, TaskScopedKernelEvent[]>();
  private byKind = new Map<EventKind, KernelEvent[]>();
  private byTimestamp = new Map<string, KernelEvent[]>();

  constructor(options: EventStoreOptions) {
    this.eventsFilePath = options.eventsFilePath;
    this.lockFilePath = options.lockFilePath;
    this.lockRetryDelayMs = options.lockRetryDelayMs ?? DEFAULT_LOCK_RETRY_DELAY_MS;
    this.lockMaxRetries = options.lockMaxRetries ?? DEFAULT_LOCK_MAX_RETRIES;
    this.taskSpecLoader = options.taskSpecLoader;
  }

  async append(event: KernelEvent): Promise<void> {
    const parsed = KernelEventSchema.safeParse(event);
    if (!parsed.success) {
      throw new Error(`KernelEvent validation failed: ${parsed.error.message}`);
    }
    const validated = parsed.data;

    await this.withFileLock(async () => {
      await mkdir(dirname(this.eventsFilePath), { recursive: true });
      await appendFile(this.eventsFilePath, `${JSON.stringify(validated)}\n`, 'utf8');
    });

    await this.reloadFromDisk();
  }

  async replay(filter: ReplayFilter = {}): Promise<KernelEvent[]> {
    await this.reloadFromDisk();

    const kinds = Array.isArray(filter.kind)
      ? new Set(filter.kind)
      : filter.kind
        ? new Set([filter.kind])
        : null;
    const since = filter.sinceTimestamp ? toTimestampMillis(filter.sinceTimestamp) : null;
    const until = filter.untilTimestamp ? toTimestampMillis(filter.untilTimestamp) : null;

    return this.orderedEvents.filter((event) => {
      if (filter.taskId) {
        if (!hasTaskId(event)) {
          return false;
        }
        if (event.task_id !== filter.taskId) {
          return false;
        }
      }
      if (kinds && !kinds.has(event.kind)) {
        return false;
      }
      const ts = toTimestampMillis(event.timestamp);
      if (since !== null && ts < since) {
        return false;
      }
      if (until !== null && ts > until) {
        return false;
      }
      return true;
    });
  }

  async project(taskId: string): Promise<TaskState> {
    await this.reloadFromDisk();
    const taskEvents = this.byTask.get(taskId) ?? [];

    let taskSpec: TaskSpec | null = null;
    if (this.taskSpecLoader) {
      taskSpec = await this.taskSpecLoader(taskId);
    }

    const spec = taskSpec ?? createSyntheticTaskSpec(taskId);
    verifyTaskSpecHash(spec, taskEvents);
    return projectTaskState(spec, taskEvents);
  }

  getByTask(taskId: string): KernelEvent[] {
    return [...(this.byTask.get(taskId) ?? [])];
  }

  getByKind(kind: EventKind): KernelEvent[] {
    return [...(this.byKind.get(kind) ?? [])];
  }

  getByTimestamp(timestamp: string): KernelEvent[] {
    return [...(this.byTimestamp.get(timestamp) ?? [])];
  }

  private async reloadFromDisk(): Promise<void> {
    let content: string;
    try {
      content = await readFile(this.eventsFilePath, 'utf8');
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        this.resetIndexes();
        return;
      }
      throw error;
    }

    this.resetIndexes();
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line === undefined) {
        continue;
      }
      const parsed: unknown = (() => {
        try {
          return JSON.parse(line);
        } catch (error) {
          throw new Error(`Malformed JSON at line ${index + 1}: ${(error as Error).message}`, {
            cause: error,
          });
        }
      })();
      try {
        const event = KernelEventSchema.parse(parsed);
        this.applyEventToIndexes(event);
      } catch (error) {
        throw new Error(`KernelEvent parse failed at line ${index + 1}`, { cause: error });
      }
    }
  }

  private resetIndexes(): void {
    this.orderedEvents = [];
    this.byTask = new Map<string, TaskScopedKernelEvent[]>();
    this.byKind = new Map<EventKind, KernelEvent[]>();
    this.byTimestamp = new Map<string, KernelEvent[]>();
  }

  private applyEventToIndexes(event: KernelEvent): void {
    this.orderedEvents.push(event);

    if (hasTaskId(event)) {
      const taskBucket = this.byTask.get(event.task_id) ?? [];
      taskBucket.push(event);
      this.byTask.set(event.task_id, taskBucket);
    }

    const kindBucket = this.byKind.get(event.kind) ?? [];
    kindBucket.push(event);
    this.byKind.set(event.kind, kindBucket);

    const tsBucket = this.byTimestamp.get(event.timestamp) ?? [];
    tsBucket.push(event);
    this.byTimestamp.set(event.timestamp, tsBucket);
  }

  private async withFileLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.lockFilePath), { recursive: true });

    for (let attempt = 0; attempt <= this.lockMaxRetries; attempt += 1) {
      let handle: Awaited<ReturnType<typeof open>> | null = null;
      try {
        handle = await open(this.lockFilePath, 'wx');
        const result = await operation();
        await handle.close();
        await rm(this.lockFilePath, { force: true });
        return result;
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (handle) {
          await handle.close();
        }
        if (nodeError.code === 'EEXIST' && attempt < this.lockMaxRetries) {
          await sleep(this.lockRetryDelayMs);
          continue;
        }
        throw error;
      }
    }

    throw new Error(`Failed to acquire event-store lock at ${this.lockFilePath}`);
  }
}

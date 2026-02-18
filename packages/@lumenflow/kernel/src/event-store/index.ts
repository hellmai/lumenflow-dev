// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { mkdirSync, watch } from 'node:fs';
import { appendFile, mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import {
  KERNEL_EVENT_KINDS,
  isRunLifecycleEventKind,
  isTaskEventKind,
  type RunLifecycleEventKind,
} from '../event-kinds.js';
import {
  KernelEventSchema,
  RUN_STATUSES,
  type KernelEvent,
  type TaskSpec,
  type TaskState,
  TaskStateSchema,
  RunSchema,
  type Run,
} from '../kernel.schemas.js';
import { canonical_json } from '../canonical-json.js';
import { UTF8_ENCODING } from '../shared-constants.js';

const DEFAULT_LOCK_RETRY_DELAY_MS = 20;
const DEFAULT_LOCK_MAX_RETRIES = 250;
const PROCESS_EXISTS_SIGNAL = 0;
const SUBSCRIPTION_DEBOUNCE_MS = 25;
const SUBSCRIPTION_MAX_DRAIN_PASSES = 8;

type EventKind = KernelEvent['kind'];
type TaskScopedKernelEvent = Extract<KernelEvent, { task_id: string }>;
type RunLifecycleEvent = Extract<KernelEvent, { kind: RunLifecycleEventKind }>;

export interface ReplayFilter {
  taskId?: string;
  kind?: EventKind | EventKind[];
  sinceTimestamp?: string;
  untilTimestamp?: string;
}

export interface Disposable {
  dispose(): void;
}

export interface EventStoreOptions {
  eventsFilePath: string;
  lockFilePath: string;
  lockRetryDelayMs?: number;
  lockMaxRetries?: number;
  taskSpecLoader?: (taskId: string) => Promise<TaskSpec | null>;
}

interface EventStoreLockMetadata {
  pid: number;
  acquired_at: string;
}

interface ParsedReplayFilter {
  kinds: Set<EventKind> | null;
  since: number | null;
  until: number | null;
}

interface TailReadResult {
  text: string;
  nextOffset: number;
  didTruncate: boolean;
}

type EventSubscriber = (event: KernelEvent) => void | Promise<void>;

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
  return isRunLifecycleEventKind(event.kind);
}

function parseReplayFilter(filter: ReplayFilter): ParsedReplayFilter {
  const kinds = Array.isArray(filter.kind)
    ? new Set(filter.kind)
    : filter.kind
      ? new Set([filter.kind])
      : null;
  const since = filter.sinceTimestamp ? toTimestampMillis(filter.sinceTimestamp) : null;
  const until = filter.untilTimestamp ? toTimestampMillis(filter.untilTimestamp) : null;
  return { kinds, since, until };
}

function eventMatchesFilter(
  event: KernelEvent,
  filter: ReplayFilter,
  parsedFilter: ParsedReplayFilter,
): boolean {
  if (filter.taskId) {
    if (!hasTaskId(event)) {
      return false;
    }
    if (event.task_id !== filter.taskId) {
      return false;
    }
  }

  if (parsedFilter.kinds && !parsedFilter.kinds.has(event.kind)) {
    return false;
  }

  const ts = toTimestampMillis(event.timestamp);
  if (parsedFilter.since !== null && ts < parsedFilter.since) {
    return false;
  }
  if (parsedFilter.until !== null && ts > parsedFilter.until) {
    return false;
  }

  return true;
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
  const created = events.find((event) => event.kind === KERNEL_EVENT_KINDS.TASK_CREATED);
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
      status: RUN_STATUSES.PLANNED,
      started_at: event.timestamp,
      by: 'unknown',
      session_id: 'unknown',
    } as const);

  let nextRun: Run = { ...existing };

  if (event.kind === KERNEL_EVENT_KINDS.RUN_STARTED) {
    nextRun = RunSchema.parse({
      run_id: runId,
      task_id: event.task_id,
      status: RUN_STATUSES.EXECUTING,
      started_at: event.timestamp,
      by: event.by,
      session_id: event.session_id,
    });
  } else if (event.kind === KERNEL_EVENT_KINDS.RUN_PAUSED) {
    nextRun = RunSchema.parse({
      ...existing,
      status: RUN_STATUSES.PAUSED,
    });
  } else if (event.kind === KERNEL_EVENT_KINDS.RUN_FAILED) {
    nextRun = RunSchema.parse({
      ...existing,
      status: RUN_STATUSES.FAILED,
      completed_at: event.timestamp,
    });
  } else if (event.kind === KERNEL_EVENT_KINDS.RUN_SUCCEEDED) {
    nextRun = RunSchema.parse({
      ...existing,
      status: RUN_STATUSES.SUCCEEDED,
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
    if (isTaskEventKind(event.kind)) {
      if (event.kind === KERNEL_EVENT_KINDS.TASK_CREATED) {
        state.status = 'ready';
      } else if (event.kind === KERNEL_EVENT_KINDS.TASK_CLAIMED) {
        state.status = 'active';
        state.claimed_at = event.timestamp;
        state.claimed_by = event.by;
        state.session_id = event.session_id;
        state.blocked_reason = undefined;
      } else if (event.kind === KERNEL_EVENT_KINDS.TASK_BLOCKED) {
        state.status = 'blocked';
        state.blocked_reason = event.reason;
      } else if (event.kind === KERNEL_EVENT_KINDS.TASK_UNBLOCKED) {
        state.status = 'active';
        state.blocked_reason = undefined;
      } else if (event.kind === KERNEL_EVENT_KINDS.TASK_WAITING) {
        state.status = 'waiting';
        state.blocked_reason = event.reason;
      } else if (event.kind === KERNEL_EVENT_KINDS.TASK_RESUMED) {
        state.status = 'active';
        state.blocked_reason = undefined;
      } else if (event.kind === KERNEL_EVENT_KINDS.TASK_COMPLETED) {
        state.status = 'done';
        state.completed_at = event.timestamp;
      } else if (event.kind === KERNEL_EVENT_KINDS.TASK_RELEASED) {
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

  private indexesHydrated = false;
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
    await this.appendAll([event]);
  }

  async appendAll(events: KernelEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const validatedEvents = events.map((event) => {
      const parsed = KernelEventSchema.safeParse(event);
      if (!parsed.success) {
        throw new Error(`KernelEvent validation failed: ${parsed.error.message}`);
      }
      return parsed.data;
    });

    const payload = validatedEvents.map((event) => `${JSON.stringify(event)}\n`).join('');

    await this.withFileLock(async () => {
      await mkdir(dirname(this.eventsFilePath), { recursive: true });
      await appendFile(this.eventsFilePath, payload, UTF8_ENCODING);
    });

    if (!this.indexesHydrated) {
      await this.reloadFromDisk();
      return;
    }

    for (const event of validatedEvents) {
      this.applyEventToIndexes(event);
    }
  }

  async replay(filter: ReplayFilter = {}): Promise<KernelEvent[]> {
    await this.reloadFromDisk();
    const parsedFilter = parseReplayFilter(filter);

    return this.orderedEvents.filter((event) => {
      return eventMatchesFilter(event, filter, parsedFilter);
    });
  }

  subscribe(filter: ReplayFilter = {}, callback: EventSubscriber): Disposable {
    const parsedFilter = parseReplayFilter(filter);
    const watchedDirectory = dirname(this.eventsFilePath);
    const watchedFileName = basename(this.eventsFilePath);
    let isDisposed = false;
    let isDraining = false;
    let shouldDrainAgain = false;
    let drainTimer: NodeJS.Timeout | null = null;
    let initializedOffset = false;
    let offset = 0;
    let trailingPartialLine = '';
    const initialOffsetPromise = this.getCurrentFileSize();

    const safeInvoke = async (event: KernelEvent): Promise<void> => {
      try {
        await callback(event);
      } catch {
        // Subscriber callback failures must not break the watch loop.
      }
    };

    const processTextChunk = async (text: string, didTruncate: boolean): Promise<void> => {
      if (didTruncate) {
        trailingPartialLine = '';
      }
      const combinedText = trailingPartialLine + text;
      const lines = combinedText.split('\n');
      trailingPartialLine = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        const eventResult = KernelEventSchema.safeParse(parsed);
        if (!eventResult.success) {
          continue;
        }

        if (eventMatchesFilter(eventResult.data, filter, parsedFilter)) {
          await safeInvoke(eventResult.data);
        }
      }
    };

    const drain = async (): Promise<void> => {
      if (isDisposed || isDraining) {
        return;
      }
      isDraining = true;
      try {
        if (!initializedOffset) {
          offset = await initialOffsetPromise;
          initializedOffset = true;
        }

        let passes = 0;
        do {
          shouldDrainAgain = false;
          const readResult = await this.readTailFromOffset(offset);
          offset = readResult.nextOffset;

          if (readResult.text.length > 0 || readResult.didTruncate) {
            await processTextChunk(readResult.text, readResult.didTruncate);
          }

          passes += 1;
          if (readResult.text.length === 0 && !readResult.didTruncate) {
            break;
          }
        } while (!isDisposed && shouldDrainAgain && passes < SUBSCRIPTION_MAX_DRAIN_PASSES);
      } finally {
        isDraining = false;
      }
    };

    const scheduleDrain = (): void => {
      if (isDisposed) {
        return;
      }
      shouldDrainAgain = true;
      if (drainTimer) {
        return;
      }
      drainTimer = setTimeout(() => {
        drainTimer = null;
        void drain();
      }, SUBSCRIPTION_DEBOUNCE_MS);
    };

    mkdirSync(watchedDirectory, { recursive: true });
    const watcher = watch(watchedDirectory, { persistent: false }, (eventType, filename) => {
      if (isDisposed) {
        return;
      }
      if (eventType !== 'change' && eventType !== 'rename') {
        return;
      }
      if (filename && filename.toString() !== watchedFileName) {
        return;
      }
      scheduleDrain();
    });
    watcher.on('error', () => {
      // Keep runtime alive; watch will naturally stop after dispose.
    });

    return {
      dispose: () => {
        if (isDisposed) {
          return;
        }
        isDisposed = true;
        if (drainTimer) {
          clearTimeout(drainTimer);
          drainTimer = null;
        }
        watcher.close();
      },
    };
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

  private buildLockMetadata(): EventStoreLockMetadata {
    return {
      pid: process.pid,
      acquired_at: new Date().toISOString(),
    };
  }

  private parseLockMetadata(raw: string): EventStoreLockMetadata | null {
    if (!raw.trim()) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<EventStoreLockMetadata>;
      if (
        typeof parsed.pid === 'number' &&
        Number.isInteger(parsed.pid) &&
        parsed.pid > 0 &&
        typeof parsed.acquired_at === 'string' &&
        parsed.acquired_at.length > 0
      ) {
        return {
          pid: parsed.pid,
          acquired_at: parsed.acquired_at,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, PROCESS_EXISTS_SIGNAL);
      return true;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ESRCH') {
        return false;
      }
      if (nodeError.code === 'EPERM') {
        return true;
      }
      return true;
    }
  }

  private async recoverStaleLockIfNeeded(): Promise<boolean> {
    let metadataRaw: string;
    try {
      metadataRaw = await readFile(this.lockFilePath, UTF8_ENCODING);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return true;
      }
      throw error;
    }

    const metadata = this.parseLockMetadata(metadataRaw);
    if (!metadata) {
      return false;
    }

    if (this.isProcessAlive(metadata.pid)) {
      return false;
    }

    await rm(this.lockFilePath, { force: true });
    return true;
  }

  private async cleanupLockHandle(handle: Awaited<ReturnType<typeof open>> | null): Promise<void> {
    if (!handle) {
      return;
    }

    try {
      await handle.close();
    } catch {
      // Best-effort cleanup only.
    }

    await rm(this.lockFilePath, { force: true });
  }

  private async reloadFromDisk(): Promise<void> {
    let content: string;
    try {
      content = await readFile(this.eventsFilePath, UTF8_ENCODING);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        this.resetIndexes();
        this.indexesHydrated = true;
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
    this.indexesHydrated = true;
  }

  private async getCurrentFileSize(): Promise<number> {
    try {
      const fileStats = await stat(this.eventsFilePath);
      return fileStats.size;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return 0;
      }
      throw error;
    }
  }

  private async readTailFromOffset(offset: number): Promise<TailReadResult> {
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(this.eventsFilePath, 'r');
      const fileStats = await handle.stat();
      const didTruncate = fileStats.size < offset;
      const startOffset = didTruncate ? 0 : offset;
      const bytesToRead = Math.max(0, fileStats.size - startOffset);

      if (bytesToRead === 0) {
        return {
          text: '',
          nextOffset: fileStats.size,
          didTruncate,
        };
      }

      const buffer = Buffer.allocUnsafe(bytesToRead);
      let totalBytesRead = 0;
      while (totalBytesRead < bytesToRead) {
        const { bytesRead } = await handle.read(
          buffer,
          totalBytesRead,
          bytesToRead - totalBytesRead,
          startOffset + totalBytesRead,
        );
        if (bytesRead === 0) {
          break;
        }
        totalBytesRead += bytesRead;
      }

      return {
        text: buffer.subarray(0, totalBytesRead).toString(UTF8_ENCODING),
        nextOffset: startOffset + totalBytesRead,
        didTruncate,
      };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return {
          text: '',
          nextOffset: 0,
          didTruncate: offset > 0,
        };
      }
      throw error;
    } finally {
      if (handle) {
        await handle.close().catch(() => {
          // Best-effort cleanup only.
        });
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
        await handle.writeFile(JSON.stringify(this.buildLockMetadata()), UTF8_ENCODING);
        const result = await operation();
        await this.cleanupLockHandle(handle);
        return result;
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        await this.cleanupLockHandle(handle);
        if (nodeError.code === 'EEXIST' && attempt < this.lockMaxRetries) {
          const recovered = await this.recoverStaleLockIfNeeded();
          if (recovered) {
            continue;
          }
          await sleep(this.lockRetryDelayMs);
          continue;
        }
        throw error;
      }
    }

    throw new Error(`Failed to acquire event-store lock at ${this.lockFilePath}`);
  }
}

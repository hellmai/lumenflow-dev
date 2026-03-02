// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadSignals, createSignal, type Signal } from './mem-signal-core.js';
import { loadMemory, type IndexedMemory } from './memory-store.js';

const REMOTE_TIMEOUT_MS = 200;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 60_000;
const SKIPPED_CIRCUIT_OPEN = 'circuit-open';

type SignalOrigin = 'local' | 'remote';

interface SignalEntry {
  id: string;
  kind: string;
  timestamp: string;
  payload: Record<string, unknown>;
  origin?: SignalOrigin;
  source_agent_id?: string;
}

interface PushSignalsInput {
  workspace_id: string;
  session_id?: string;
  signals: SignalEntry[];
}

interface PullSignalsInput {
  workspace_id: string;
  session_id?: string;
  cursor?: string;
  limit?: number;
}

interface PullSignalsResult {
  signals: SignalEntry[];
  next_cursor?: string;
}

interface MemoryRecord {
  id: string;
  namespace: string;
  key: string;
  value: unknown;
  updated_at: string;
  revision?: string;
  origin?: SignalOrigin;
}

interface MemoryConflict {
  namespace: string;
  key: string;
  local_revision?: string;
  remote_revision?: string;
  resolution: 'local_wins' | 'remote_wins' | 'manual';
}

type MemorySyncDirection = 'push' | 'pull' | 'bidirectional';

interface SyncMemoryInput {
  workspace_id: string;
  session_id?: string;
  direction: MemorySyncDirection;
  local_records: MemoryRecord[];
  cursor?: string;
  limit?: number;
}

export interface SyncMemoryResult {
  pushed: number;
  pulled: number;
  conflicts: MemoryConflict[];
  remote_records?: MemoryRecord[];
  next_cursor?: string;
}

export const DEFAULT_CONTROL_PLANE_SYNC_STATE_PATH = path.join(
  '.lumenflow',
  'state',
  'control-plane-sync.json',
);

interface SignalPort {
  pushSignals(input: PushSignalsInput): Promise<{ accepted: number }>;
  pullSignals(input: PullSignalsInput): Promise<PullSignalsResult>;
}

interface MemoryPort {
  syncMemory(input: SyncMemoryInput): Promise<SyncMemoryResult>;
}

export interface ControlPlaneSyncAdapterOptions {
  baseDir: string;
  workspaceId: string;
  sessionId?: string;
  signalPort: SignalPort;
  memoryPort: MemoryPort;
  now?: () => number;
  remoteTimeoutMs?: number;
  circuitOpenMs?: number;
  circuitFailureThreshold?: number;
}

export interface PushLocalSignalsResult {
  pushed: number;
  skippedReason?: typeof SKIPPED_CIRCUIT_OPEN | 'remote-error';
}

export interface PullSignalsSyncResult {
  pulled: number;
  skippedReason?: typeof SKIPPED_CIRCUIT_OPEN | 'remote-error';
}

interface SyncState {
  lastPushedSignalId?: string;
  pullCursor?: string;
  memoryCursor?: string;
  remoteFailureCount: number;
  circuitOpenUntilMs: number;
}

interface ControlPlaneSyncAdapter {
  pushLocalSignals(): Promise<PushLocalSignalsResult>;
  pullSignals(): Promise<PullSignalsSyncResult>;
  syncProjectMemory(): Promise<SyncMemoryResult>;
}

const DEFAULT_SYNC_STATE: SyncState = {
  remoteFailureCount: 0,
  circuitOpenUntilMs: 0,
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function buildSignalPayload(signal: Signal): Record<string, unknown> {
  return {
    message: signal.message,
    wu_id: signal.wu_id,
    lane: signal.lane,
    sender: signal.sender,
    target_agent: signal.target_agent,
  };
}

function toRemoteSignal(signal: Signal): SignalEntry {
  return {
    id: signal.id,
    kind: signal.type ?? 'signal',
    timestamp: signal.created_at,
    payload: buildSignalPayload(signal),
    origin: 'local',
    source_agent_id: signal.sender,
  };
}

function extractMessage(signal: SignalEntry): string {
  const payloadMessage = signal.payload.message;
  if (typeof payloadMessage === 'string' && payloadMessage.trim().length > 0) {
    return payloadMessage;
  }
  return `[${signal.kind}] remote signal`;
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Remote control-plane call timed out')), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function isCircuitOpen(state: SyncState, nowMs: number): boolean {
  return state.circuitOpenUntilMs > nowMs;
}

function markRemoteFailure(
  state: SyncState,
  options: Required<Pick<ControlPlaneSyncAdapterOptions, 'circuitFailureThreshold' | 'circuitOpenMs'>>,
  nowMs: number,
): SyncState {
  const nextFailureCount = state.remoteFailureCount + 1;
  if (nextFailureCount >= options.circuitFailureThreshold) {
    return {
      ...state,
      remoteFailureCount: 0,
      circuitOpenUntilMs: nowMs + options.circuitOpenMs,
    };
  }
  return {
    ...state,
    remoteFailureCount: nextFailureCount,
  };
}

function clearRemoteFailures(state: SyncState): SyncState {
  return {
    ...state,
    remoteFailureCount: 0,
    circuitOpenUntilMs: 0,
  };
}

async function readSyncState(baseDir: string): Promise<SyncState> {
  const syncStatePath = path.join(baseDir, DEFAULT_CONTROL_PLANE_SYNC_STATE_PATH);
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is rooted to baseDir + constant
    const raw = await fs.readFile(syncStatePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<SyncState>;
    return {
      ...DEFAULT_SYNC_STATE,
      ...parsed,
      remoteFailureCount: parsed.remoteFailureCount ?? 0,
      circuitOpenUntilMs: parsed.circuitOpenUntilMs ?? 0,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return { ...DEFAULT_SYNC_STATE };
    }
    throw error;
  }
}

async function writeSyncState(baseDir: string, state: SyncState): Promise<void> {
  const syncStatePath = path.join(baseDir, DEFAULT_CONTROL_PLANE_SYNC_STATE_PATH);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is rooted to baseDir + constant
  await fs.mkdir(path.dirname(syncStatePath), { recursive: true });
  const serializable = {
    lastPushedSignalId: state.lastPushedSignalId,
    pullCursor: state.pullCursor,
    memoryCursor: state.memoryCursor,
    remoteFailureCount: state.remoteFailureCount,
    circuitOpenUntilMs: state.circuitOpenUntilMs,
  };
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is rooted to baseDir + constant
  await fs.writeFile(syncStatePath, `${JSON.stringify(serializable, null, 2)}\n`, 'utf-8');
}

function getSignalsAfterWatermark(signals: Signal[], lastPushedSignalId?: string): Signal[] {
  if (!lastPushedSignalId) {
    return signals;
  }
  const markerIndex = signals.findIndex((signal) => signal.id === lastPushedSignalId);
  if (markerIndex < 0) {
    return signals;
  }
  return signals.slice(markerIndex + 1);
}

function toProjectMemoryRecords(memory: IndexedMemory): MemoryRecord[] {
  return memory.nodes
    .filter((node) => node.lifecycle === 'project')
    .map((node) => ({
      id: node.id,
      namespace: 'project',
      key: node.id,
      value: {
        type: node.type,
        lifecycle: node.lifecycle,
        content: node.content,
        created_at: node.created_at,
        updated_at: node.updated_at,
        wu_id: node.wu_id,
        metadata: node.metadata,
        tags: node.tags,
      },
      updated_at: node.updated_at ?? node.created_at,
      origin: 'local',
    }));
}

export function createControlPlaneSyncAdapter(
  options: ControlPlaneSyncAdapterOptions,
): ControlPlaneSyncAdapter {
  const now = options.now ?? Date.now;
  const remoteTimeoutMs = options.remoteTimeoutMs ?? REMOTE_TIMEOUT_MS;
  const circuitOpenMs = options.circuitOpenMs ?? CIRCUIT_OPEN_MS;
  const circuitFailureThreshold = options.circuitFailureThreshold ?? CIRCUIT_FAILURE_THRESHOLD;

  const circuitConfig = {
    circuitFailureThreshold,
    circuitOpenMs,
  };

  async function executeRemote<T>(
    action: (state: SyncState) => Promise<T>,
  ): Promise<{ ok: true; result: T; state: SyncState } | { ok: false; state: SyncState }> {
    const state = await readSyncState(options.baseDir);
    const nowMs = now();
    if (isCircuitOpen(state, nowMs)) {
      return { ok: false, state };
    }

    try {
      const result = await action(state);
      const nextState = clearRemoteFailures(state);
      await writeSyncState(options.baseDir, nextState);
      return { ok: true, result, state: nextState };
    } catch {
      const nextState = markRemoteFailure(state, circuitConfig, nowMs);
      await writeSyncState(options.baseDir, nextState);
      return { ok: false, state: nextState };
    }
  }

  return {
    async pushLocalSignals(): Promise<PushLocalSignalsResult> {
      const state = await readSyncState(options.baseDir);
      if (isCircuitOpen(state, now())) {
        return { pushed: 0, skippedReason: SKIPPED_CIRCUIT_OPEN };
      }

      const allSignals = await loadSignals(options.baseDir);
      const afterWatermark = getSignalsAfterWatermark(allSignals, state.lastPushedSignalId);
      const localSignals = afterWatermark.filter((signal) => signal.origin !== 'remote');
      if (localSignals.length === 0) {
        return { pushed: 0 };
      }

      const remoteSignals = localSignals.map(toRemoteSignal);

      const remoteResult = await executeRemote(async () =>
        runWithTimeout(
          options.signalPort.pushSignals({
            workspace_id: options.workspaceId,
            session_id: options.sessionId,
            signals: remoteSignals,
          }),
          remoteTimeoutMs,
        ),
      );

      if (!remoteResult.ok) {
        const refreshed = await readSyncState(options.baseDir);
        if (isCircuitOpen(refreshed, now())) {
          return { pushed: 0, skippedReason: SKIPPED_CIRCUIT_OPEN };
        }
        return { pushed: 0, skippedReason: 'remote-error' };
      }

      const currentState = await readSyncState(options.baseDir);
      const nextState: SyncState = {
        ...currentState,
        lastPushedSignalId: localSignals[localSignals.length - 1]?.id,
      };
      await writeSyncState(options.baseDir, nextState);

      return { pushed: remoteResult.result.accepted };
    },

    async pullSignals(): Promise<PullSignalsSyncResult> {
      const remoteResult = await executeRemote(async (state) =>
        runWithTimeout(
          options.signalPort.pullSignals({
            workspace_id: options.workspaceId,
            session_id: options.sessionId,
            cursor: state.pullCursor,
          }),
          remoteTimeoutMs,
        ),
      );

      if (!remoteResult.ok) {
        const refreshed = await readSyncState(options.baseDir);
        if (isCircuitOpen(refreshed, now())) {
          return { pulled: 0, skippedReason: SKIPPED_CIRCUIT_OPEN };
        }
        return { pulled: 0, skippedReason: 'remote-error' };
      }

      const pullResponse = remoteResult.result;
      for (const signal of pullResponse.signals) {
        await createSignal(options.baseDir, {
          message: extractMessage(signal),
          wuId: asString(signal.payload.wu_id),
          lane: asString(signal.payload.lane),
          type: signal.kind,
          sender: signal.source_agent_id,
          target_agent: asString(signal.payload.target_agent),
          origin: 'remote',
          remote_id: signal.id,
        });
      }

      const currentState = await readSyncState(options.baseDir);
      const nextState: SyncState = {
        ...currentState,
        pullCursor: pullResponse.next_cursor ?? currentState.pullCursor,
      };
      await writeSyncState(options.baseDir, nextState);

      return { pulled: pullResponse.signals.length };
    },

    async syncProjectMemory(): Promise<SyncMemoryResult> {
      const state = await readSyncState(options.baseDir);
      const indexedMemory = await loadMemory(path.join(options.baseDir, '.lumenflow', 'memory'));
      const localRecords = toProjectMemoryRecords(indexedMemory);

      const remoteResult = await executeRemote(() =>
        runWithTimeout(
          options.memoryPort.syncMemory({
            workspace_id: options.workspaceId,
            session_id: options.sessionId,
            direction: 'bidirectional',
            local_records: localRecords,
            cursor: state.memoryCursor,
          }),
          remoteTimeoutMs,
        ),
      );

      if (!remoteResult.ok) {
        return { pushed: 0, pulled: 0, conflicts: [] };
      }

      const currentState = await readSyncState(options.baseDir);
      const nextState: SyncState = {
        ...currentState,
        memoryCursor: remoteResult.result.next_cursor ?? currentState.memoryCursor,
      };
      await writeSyncState(options.baseDir, nextState);

      return remoteResult.result;
    },
  };
}

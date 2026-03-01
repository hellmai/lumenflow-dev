// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import type {
  DeregisterSessionInput,
  ListSessionsInput,
  ListSessionsResult,
  MemoryConflict,
  MemoryRecord,
  MemorySyncPort,
  PullSignalsInput,
  PullSignalsResult,
  PushSignalsInput,
  RegisterSessionInput,
  SessionSummary,
  SignalEntry,
  SignalSyncPort,
  SyncMemoryInput,
  SyncMemoryResult,
} from '../signal-sync-port.js';
import type { AcceptedCount } from '../sync-port.js';

const DEFAULT_PAGE_LIMIT = 50;
const CURSOR_BASE = 10;

export interface MockSignalSyncPortOptions {
  conflict_keys?: string[];
  now?: () => string;
}

function memoryKey(record: Pick<MemoryRecord, 'namespace' | 'key'>): string {
  return `${record.namespace}:${record.key}`;
}

function cloneSignal(signal: SignalEntry): SignalEntry {
  return {
    ...signal,
    payload: { ...signal.payload },
  };
}

function cloneMemoryRecord(record: MemoryRecord): MemoryRecord {
  return {
    ...record,
    value: record.value,
  };
}

function parseCursor(cursor?: string): number {
  if (!cursor) {
    return 0;
  }
  const parsed = Number.parseInt(cursor, CURSOR_BASE);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function sortMemoryRecords(records: MemoryRecord[]): MemoryRecord[] {
  return [...records].sort((a, b) => {
    if (a.updated_at === b.updated_at) {
      return memoryKey(a).localeCompare(memoryKey(b));
    }
    return a.updated_at.localeCompare(b.updated_at);
  });
}

export class MockSignalSyncPort implements SignalSyncPort, MemorySyncPort {
  private readonly conflictKeys: Set<string>;
  private readonly now: () => string;
  private readonly signalsByWorkspace = new Map<string, SignalEntry[]>();
  private readonly sessionsByWorkspace = new Map<string, Map<string, SessionSummary>>();
  private readonly memoryByWorkspace = new Map<string, Map<string, MemoryRecord>>();

  public constructor(options: MockSignalSyncPortOptions = {}) {
    this.conflictKeys = new Set(options.conflict_keys ?? []);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async pushSignals(input: PushSignalsInput): Promise<AcceptedCount> {
    const existing = this.signalsByWorkspace.get(input.workspace_id) ?? [];
    const next = existing.concat(
      input.signals.map((signal) =>
        cloneSignal({
          ...signal,
          origin: signal.origin ?? 'local',
        }),
      ),
    );
    this.signalsByWorkspace.set(input.workspace_id, next);
    return { accepted: input.signals.length };
  }

  public async pullSignals(input: PullSignalsInput): Promise<PullSignalsResult> {
    const existing = this.signalsByWorkspace.get(input.workspace_id) ?? [];
    const start = parseCursor(input.cursor);
    const limit = input.limit ?? DEFAULT_PAGE_LIMIT;
    const slice = existing.slice(start, start + limit).map(cloneSignal);
    const nextIndex = start + slice.length;
    return {
      signals: slice,
      next_cursor: nextIndex < existing.length ? String(nextIndex) : undefined,
    };
  }

  public async registerSession(input: RegisterSessionInput): Promise<SessionSummary> {
    const workspaceSessions = this.sessionsByWorkspace.get(input.workspace_id) ?? new Map();
    const session: SessionSummary = {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      agent_id: input.agent_id,
      started_at: input.started_at,
      lane: input.lane,
      wu_id: input.wu_id,
      metadata: input.metadata ? { ...input.metadata } : undefined,
      active: true,
      last_heartbeat_at: this.now(),
    };
    workspaceSessions.set(input.session_id, session);
    this.sessionsByWorkspace.set(input.workspace_id, workspaceSessions);
    return { ...session };
  }

  public async deregisterSession(input: DeregisterSessionInput): Promise<AcceptedCount> {
    const workspaceSessions = this.sessionsByWorkspace.get(input.workspace_id);
    if (!workspaceSessions) {
      return { accepted: 0 };
    }

    const session = workspaceSessions.get(input.session_id);
    if (!session) {
      return { accepted: 0 };
    }

    workspaceSessions.set(input.session_id, {
      ...session,
      active: false,
      last_heartbeat_at: input.ended_at ?? this.now(),
    });
    return { accepted: 1 };
  }

  public async listSessions(input: ListSessionsInput): Promise<ListSessionsResult> {
    const workspaceSessions = this.sessionsByWorkspace.get(input.workspace_id);
    if (!workspaceSessions) {
      return { sessions: [] };
    }

    const includeInactive = input.include_inactive ?? false;
    const sessions = Array.from(workspaceSessions.values())
      .filter((session) => (includeInactive ? true : session.active))
      .filter((session) => (input.lane ? session.lane === input.lane : true))
      .map((session) => ({ ...session }));

    return { sessions };
  }

  public async syncMemory(input: SyncMemoryInput): Promise<SyncMemoryResult> {
    const workspaceMemory = this.memoryByWorkspace.get(input.workspace_id) ?? new Map();
    const conflicts: MemoryConflict[] = [];
    let pushed = 0;

    if (input.direction === 'push' || input.direction === 'bidirectional') {
      for (const localRecord of input.local_records) {
        const key = memoryKey(localRecord);
        const existing = workspaceMemory.get(key);
        const hasRevisionConflict =
          Boolean(existing?.revision) &&
          Boolean(localRecord.revision) &&
          existing?.revision !== localRecord.revision;
        const forcedConflict = this.conflictKeys.has(key) && Boolean(existing);

        if (hasRevisionConflict || forcedConflict) {
          conflicts.push({
            namespace: localRecord.namespace,
            key: localRecord.key,
            local_revision: localRecord.revision,
            remote_revision: existing?.revision,
            resolution: 'manual',
          });
          continue;
        }

        workspaceMemory.set(
          key,
          cloneMemoryRecord({
            ...localRecord,
            origin: localRecord.origin ?? 'local',
          }),
        );
        pushed += 1;
      }
    }

    this.memoryByWorkspace.set(input.workspace_id, workspaceMemory);

    const allRemoteRecords = sortMemoryRecords(
      Array.from(workspaceMemory.values()).map(cloneMemoryRecord),
    );
    const start = parseCursor(input.cursor);
    const limit = input.limit ?? DEFAULT_PAGE_LIMIT;
    const remoteRecords =
      input.direction === 'pull' || input.direction === 'bidirectional'
        ? allRemoteRecords.slice(start, start + limit)
        : [];
    const nextIndex = start + remoteRecords.length;

    return {
      pushed,
      pulled: remoteRecords.length,
      conflicts,
      remote_records: remoteRecords,
      next_cursor:
        (input.direction === 'pull' || input.direction === 'bidirectional') &&
        nextIndex < allRemoteRecords.length
          ? String(nextIndex)
          : undefined,
    };
  }

  public readSignals(workspaceId: string): SignalEntry[] {
    return (this.signalsByWorkspace.get(workspaceId) ?? []).map(cloneSignal);
  }

  public readSessions(workspaceId: string): SessionSummary[] {
    return Array.from(this.sessionsByWorkspace.get(workspaceId)?.values() ?? []).map((session) => ({
      ...session,
    }));
  }

  public readMemory(workspaceId: string): MemoryRecord[] {
    return Array.from(this.memoryByWorkspace.get(workspaceId)?.values() ?? []).map(
      cloneMemoryRecord,
    );
  }
}

export function createMockSignalSyncPort(
  options: MockSignalSyncPortOptions = {},
): MockSignalSyncPort {
  return new MockSignalSyncPort(options);
}

// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import type { AcceptedCount, ControlPlaneSyncPort } from './sync-port.js';

export type SignalOrigin = 'local' | 'remote';

export interface SignalEntry {
  id: string;
  kind: string;
  timestamp: string;
  payload: Record<string, unknown>;
  origin?: SignalOrigin;
  source_agent_id?: string;
}

export interface PushSignalsInput {
  workspace_id: string;
  session_id?: string;
  signals: SignalEntry[];
}

export interface PullSignalsInput {
  workspace_id: string;
  session_id?: string;
  cursor?: string;
  limit?: number;
}

export interface PullSignalsResult {
  signals: SignalEntry[];
  next_cursor?: string;
}

export type SessionMetadataValue = string | number | boolean;

export interface RegisterSessionInput {
  workspace_id: string;
  session_id: string;
  agent_id: string;
  started_at: string;
  lane?: string;
  wu_id?: string;
  metadata?: Record<string, SessionMetadataValue>;
}

export interface DeregisterSessionInput {
  workspace_id: string;
  session_id: string;
  ended_at?: string;
  reason?: string;
}

export interface ListSessionsInput {
  workspace_id: string;
  include_inactive?: boolean;
  lane?: string;
}

export interface SessionSummary {
  workspace_id: string;
  session_id: string;
  agent_id: string;
  started_at: string;
  lane?: string;
  wu_id?: string;
  active: boolean;
  last_heartbeat_at?: string;
  metadata?: Record<string, SessionMetadataValue>;
}

export interface ListSessionsResult {
  sessions: SessionSummary[];
}

export interface SignalSyncPort {
  pushSignals(input: PushSignalsInput): Promise<AcceptedCount>;
  pullSignals(input: PullSignalsInput): Promise<PullSignalsResult>;
  registerSession(input: RegisterSessionInput): Promise<SessionSummary>;
  deregisterSession(input: DeregisterSessionInput): Promise<AcceptedCount>;
  listSessions(input: ListSessionsInput): Promise<ListSessionsResult>;
}

export type MemorySyncDirection = 'push' | 'pull' | 'bidirectional';

export interface MemoryRecord {
  id: string;
  namespace: string;
  key: string;
  value: unknown;
  updated_at: string;
  revision?: string;
  origin?: SignalOrigin;
}

export interface MemoryConflict {
  namespace: string;
  key: string;
  local_revision?: string;
  remote_revision?: string;
  resolution: 'local_wins' | 'remote_wins' | 'manual';
}

export interface SyncMemoryInput {
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

export interface MemorySyncPort {
  syncMemory(input: SyncMemoryInput): Promise<SyncMemoryResult>;
}

export interface ControlPlaneSyncPortV2
  extends ControlPlaneSyncPort,
    SignalSyncPort,
    MemorySyncPort {}

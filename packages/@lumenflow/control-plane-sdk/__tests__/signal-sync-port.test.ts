// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import type {
  AcceptedCount,
  ControlPlanePolicySet,
  ControlPlaneSyncPortV2,
  HeartbeatResult,
  ListSessionsInput,
  ListSessionsResult,
  MemoryRecord,
  PullConfigInput,
  PullSignalsInput,
  PullSignalsResult,
  PushEvidenceInput,
  PushKernelEventsInput,
  PushSignalsInput,
  PushTelemetryInput,
  RegisterSessionInput,
  SessionSummary,
  SignalEntry,
  SyncMemoryInput,
  SyncMemoryResult,
  WorkspaceControlPlaneSpec,
} from '../src/index.js';

describe('signal and memory sync contracts', () => {
  it('defines signal push/pull and session lifecycle types', async () => {
    const signal: SignalEntry = {
      id: 'sig-1',
      kind: 'wu.brief.available',
      timestamp: '2026-03-01T00:00:00.000Z',
      payload: { wuId: 'WU-2149' },
      origin: 'local',
    };

    const pushInput: PushSignalsInput = {
      workspace_id: 'ws-1',
      session_id: 'session-1',
      signals: [signal],
    };

    const pullInput: PullSignalsInput = {
      workspace_id: 'ws-1',
      session_id: 'session-1',
      cursor: 'cursor-1',
      limit: 20,
    };

    const registerInput: RegisterSessionInput = {
      workspace_id: 'ws-1',
      session_id: 'session-1',
      agent_id: 'agent-codex',
      started_at: '2026-03-01T00:00:00.000Z',
      lane: 'Framework: Core Lifecycle',
      wu_id: 'WU-2149',
      metadata: { source: 'unit-test' },
    };

    const listInput: ListSessionsInput = {
      workspace_id: 'ws-1',
      include_inactive: false,
      lane: 'Framework: Core Lifecycle',
    };

    const pushResult: AcceptedCount = { accepted: 1 };
    const pullResult: PullSignalsResult = { signals: [signal], next_cursor: 'cursor-2' };
    const session: SessionSummary = {
      workspace_id: 'ws-1',
      session_id: 'session-1',
      agent_id: 'agent-codex',
      started_at: '2026-03-01T00:00:00.000Z',
      active: true,
      lane: 'Framework: Core Lifecycle',
      wu_id: 'WU-2149',
    };
    const listResult: ListSessionsResult = { sessions: [session] };

    const port: ControlPlaneSyncPortV2 = {
      async pullPolicies(): Promise<ControlPlanePolicySet> {
        return { default_decision: 'allow', rules: [] };
      },
      async pullConfig(_input: PullConfigInput): Promise<WorkspaceControlPlaneSpec> {
        const spec: WorkspaceControlPlaneSpec = {
          id: 'cp-1',
          control_plane: {
            endpoint: 'https://example.test',
            org_id: 'org-1',
            project_id: 'proj-1',
            sync_interval: 5,
            policy_mode: 'authoritative',
            auth: { token_env: 'LUMENFLOW_CONTROL_PLANE_TOKEN' },
          },
        };
        return spec;
      },
      async pushTelemetry(_input: PushTelemetryInput): Promise<AcceptedCount> {
        return { accepted: 0 };
      },
      async pushEvidence(_input: PushEvidenceInput): Promise<AcceptedCount> {
        return { accepted: 0 };
      },
      async pushKernelEvents(_input: PushKernelEventsInput): Promise<AcceptedCount> {
        return { accepted: 0 };
      },
      async authenticate() {
        return {
          workspace_id: 'ws-1',
          org_id: 'org-1',
          agent_id: 'agent-codex',
          token: 'token',
        };
      },
      async heartbeat(): Promise<HeartbeatResult> {
        return {
          status: 'ok',
          server_time: '2026-03-01T00:00:00.000Z',
        };
      },
      async pushSignals(input: PushSignalsInput): Promise<AcceptedCount> {
        expect(input).toEqual(pushInput);
        return pushResult;
      },
      async pullSignals(input: PullSignalsInput): Promise<PullSignalsResult> {
        expect(input).toEqual(pullInput);
        return pullResult;
      },
      async registerSession(input: RegisterSessionInput): Promise<SessionSummary> {
        expect(input).toEqual(registerInput);
        return session;
      },
      async deregisterSession(): Promise<AcceptedCount> {
        return { accepted: 1 };
      },
      async listSessions(input: ListSessionsInput): Promise<ListSessionsResult> {
        expect(input).toEqual(listInput);
        return listResult;
      },
      async syncMemory(): Promise<SyncMemoryResult> {
        return {
          pushed: 1,
          pulled: 0,
          conflicts: [],
          next_cursor: 'mem-cursor-2',
        };
      },
    };

    const pushed = await port.pushSignals(pushInput);
    const pulled = await port.pullSignals(pullInput);
    const registered = await port.registerSession(registerInput);
    const listed = await port.listSessions(listInput);

    expect(pushed.accepted).toBe(1);
    expect(pulled.signals).toHaveLength(1);
    expect(registered.active).toBe(true);
    expect(listed.sessions[0]?.session_id).toBe('session-1');
  });

  it('defines bidirectional memory sync input and output types', async () => {
    const localRecords: MemoryRecord[] = [
      {
        id: 'mem-1',
        namespace: 'project',
        key: 'WU-2149',
        value: { status: 'in_progress' },
        updated_at: '2026-03-01T00:00:00.000Z',
      },
    ];

    const input: SyncMemoryInput = {
      workspace_id: 'ws-1',
      session_id: 'session-1',
      direction: 'bidirectional',
      local_records: localRecords,
      cursor: 'mem-cursor-1',
      limit: 50,
    };

    const port: Pick<ControlPlaneSyncPortV2, 'syncMemory'> = {
      async syncMemory(request: SyncMemoryInput): Promise<SyncMemoryResult> {
        expect(request).toEqual(input);
        return {
          pushed: request.local_records.length,
          pulled: 1,
          conflicts: [],
          remote_records: [
            {
              id: 'mem-2',
              namespace: 'project',
              key: 'WU-2148',
              value: { status: 'done' },
              updated_at: '2026-03-01T00:01:00.000Z',
              origin: 'remote',
            },
          ],
          next_cursor: 'mem-cursor-2',
        };
      },
    };

    const result = await port.syncMemory(input);

    expect(result.pushed).toBe(1);
    expect(result.pulled).toBe(1);
    expect(result.remote_records?.[0]?.origin).toBe('remote');
  });
});

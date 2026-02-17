import type { KernelEvent } from '@lumenflow/kernel';
import { describe, expect, it } from 'vitest';
import {
  MockControlPlaneSyncPort,
  createMockControlPlaneSyncPort,
  type ControlPlaneSyncPort,
} from '../src/index.js';

describe('control-plane sdk sync port', () => {
  it('provides a mock adapter implementing the sync contract', async () => {
    const port: ControlPlaneSyncPort = createMockControlPlaneSyncPort({
      endpoint: 'https://mock.control-plane.local',
      org_id: 'org-test',
      policy_mode: 'authoritative',
    });

    const identity = await port.authenticate({
      workspace_id: 'workspace-a',
      org_id: 'org-test',
      agent_id: 'agent-1',
      token_hint: 'hint',
    });

    expect(identity.workspace_id).toBe('workspace-a');
    expect(identity.org_id).toBe('org-test');

    const heartbeat = await port.heartbeat({
      workspace_id: 'workspace-a',
      session_id: 'session-1',
    });
    expect(heartbeat.status).toBe('ok');

    const policies = await port.pullPolicies({ workspace_id: 'workspace-a' });
    expect(policies).toBeDefined();

    const config = await port.pullConfig({ workspace_id: 'workspace-a' });
    expect(config.control_plane.endpoint).toBe('https://mock.control-plane.local');

    const telemetryResult = await port.pushTelemetry({
      workspace_id: 'workspace-a',
      records: [
        { metric: 'task_completed_total', value: 1, timestamp: '2026-02-17T00:00:00.000Z' },
        { metric: 'task_completed_total', value: 2, timestamp: '2026-02-17T00:01:00.000Z' },
      ],
    });
    expect(telemetryResult.accepted).toBe(2);

    const evidenceResult = await port.pushEvidence({
      workspace_id: 'workspace-a',
      evidence_refs: ['cas:sha256:abc', 'cas:sha256:def'],
    });
    expect(evidenceResult.accepted).toBe(2);

    const kernelEvents: KernelEvent[] = [
      {
        schema_version: 1,
        kind: 'workspace_warning',
        timestamp: '2026-02-17T00:00:00.000Z',
        message: 'test-warning',
      },
    ];

    const eventResult = await port.pushKernelEvents({
      workspace_id: 'workspace-a',
      events: kernelEvents,
    });
    expect(eventResult.accepted).toBe(1);
  });

  it('exports telemetry batches to the configured mock endpoint', async () => {
    const port = new MockControlPlaneSyncPort({
      endpoint: 'https://mock.control-plane.local',
      org_id: 'org-test',
      policy_mode: 'authoritative',
    });

    await port.pushTelemetry({
      workspace_id: 'workspace-a',
      records: [
        { metric: 'run_latency_ms', value: 15, timestamp: '2026-02-17T00:02:00.000Z' },
        { metric: 'run_latency_ms', value: 25, timestamp: '2026-02-17T00:03:00.000Z' },
      ],
    });

    const exported = port.readTelemetryEndpoint('https://mock.control-plane.local');
    expect(exported).toHaveLength(2);
    expect(exported.map((entry) => entry.metric)).toEqual(['run_latency_ms', 'run_latency_ms']);
  });
});

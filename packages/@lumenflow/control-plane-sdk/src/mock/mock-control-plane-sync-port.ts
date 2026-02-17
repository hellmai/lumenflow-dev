import { applyPolicyMode } from '../policy-mode.js';
import type {
  AuthenticateInput,
  ControlPlaneIdentity,
  ControlPlanePolicyMode,
  ControlPlanePolicySet,
  ControlPlaneSyncPort,
  HeartbeatInput,
  HeartbeatResult,
  KernelEvent,
  PullConfigInput,
  PullPoliciesInput,
  PushEvidenceInput,
  PushKernelEventsInput,
  PushTelemetryInput,
  TelemetryRecord,
  WorkspaceControlPlaneSpec,
} from '../sync-port.js';

export interface MockControlPlaneSyncPortOptions {
  endpoint: string;
  org_id: string;
  policy_mode: ControlPlanePolicyMode;
  local_override?: boolean;
  remote_policies?: ControlPlanePolicySet;
  local_policies?: ControlPlanePolicySet;
}

const DEFAULT_REMOTE_POLICIES: ControlPlanePolicySet = {
  default_decision: 'deny',
  rules: [],
};

const DEFAULT_LOCAL_POLICIES: ControlPlanePolicySet = {
  default_decision: 'deny',
  rules: [],
};

export class MockControlPlaneSyncPort implements ControlPlaneSyncPort {
  private readonly options: MockControlPlaneSyncPortOptions;
  private readonly telemetryByEndpoint = new Map<string, TelemetryRecord[]>();
  private readonly evidenceByWorkspace = new Map<string, string[]>();
  private readonly kernelEventsByWorkspace = new Map<string, KernelEvent[]>();

  public constructor(options: MockControlPlaneSyncPortOptions) {
    this.options = {
      ...options,
      local_override: options.local_override ?? false,
      remote_policies: options.remote_policies ?? DEFAULT_REMOTE_POLICIES,
      local_policies: options.local_policies ?? DEFAULT_LOCAL_POLICIES,
    };
  }

  public async pullPolicies(input: PullPoliciesInput): Promise<ControlPlanePolicySet> {
    const merged = applyPolicyMode({
      mode: this.options.policy_mode,
      workspace_id: input.workspace_id,
      remote: this.options.remote_policies ?? DEFAULT_REMOTE_POLICIES,
      local: this.options.local_override ? this.options.local_policies : undefined,
    });

    if (merged.events.length > 0) {
      const events = this.kernelEventsByWorkspace.get(input.workspace_id) ?? [];
      this.kernelEventsByWorkspace.set(input.workspace_id, events.concat(merged.events));
    }

    return merged.effective;
  }

  public async pullConfig(input: PullConfigInput): Promise<WorkspaceControlPlaneSpec> {
    return {
      id: input.workspace_id,
      control_plane: {
        enabled: true,
        endpoint: this.options.endpoint,
        org_id: this.options.org_id,
        sync_interval: 30,
        policy_mode: this.options.policy_mode,
        local_override: this.options.local_override ?? false,
      },
    };
  }

  public async pushTelemetry(input: PushTelemetryInput): Promise<{ accepted: number }> {
    const entries = this.telemetryByEndpoint.get(this.options.endpoint) ?? [];
    this.telemetryByEndpoint.set(this.options.endpoint, entries.concat(input.records));

    return { accepted: input.records.length };
  }

  public async pushEvidence(input: PushEvidenceInput): Promise<{ accepted: number }> {
    const entries = this.evidenceByWorkspace.get(input.workspace_id) ?? [];
    this.evidenceByWorkspace.set(input.workspace_id, entries.concat(input.evidence_refs));

    return { accepted: input.evidence_refs.length };
  }

  public async pushKernelEvents(input: PushKernelEventsInput): Promise<{ accepted: number }> {
    const entries = this.kernelEventsByWorkspace.get(input.workspace_id) ?? [];
    this.kernelEventsByWorkspace.set(input.workspace_id, entries.concat(input.events));

    return { accepted: input.events.length };
  }

  public async authenticate(input: AuthenticateInput): Promise<ControlPlaneIdentity> {
    return {
      workspace_id: input.workspace_id,
      org_id: input.org_id,
      agent_id: input.agent_id,
      token: `mock-token:${input.workspace_id}:${input.agent_id}`,
    };
  }

  public async heartbeat(_input: HeartbeatInput): Promise<HeartbeatResult> {
    return {
      status: 'ok',
      server_time: new Date().toISOString(),
    };
  }

  public readTelemetryEndpoint(endpoint: string): TelemetryRecord[] {
    return (this.telemetryByEndpoint.get(endpoint) ?? []).map((record) => ({ ...record }));
  }

  public readEvidence(workspaceId: string): string[] {
    return [...(this.evidenceByWorkspace.get(workspaceId) ?? [])];
  }

  public readKernelEvents(workspaceId: string): KernelEvent[] {
    return [...(this.kernelEventsByWorkspace.get(workspaceId) ?? [])];
  }
}

export function createMockControlPlaneSyncPort(
  options: MockControlPlaneSyncPortOptions,
): MockControlPlaneSyncPort {
  return new MockControlPlaneSyncPort(options);
}

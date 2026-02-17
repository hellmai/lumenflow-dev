import type {
  ControlPlanePolicyMode,
  ControlPlanePolicySet,
  KernelEvent,
  PolicyDecision,
} from './sync-port.js';

export interface ApplyPolicyModeInput {
  mode: ControlPlanePolicyMode;
  workspace_id: string;
  remote: ControlPlanePolicySet;
  local?: ControlPlanePolicySet;
  timestamp?: string;
}

export interface ApplyPolicyModeResult {
  effective: ControlPlanePolicySet;
  events: KernelEvent[];
}

function clonePolicySet(input: ControlPlanePolicySet): ControlPlanePolicySet {
  return {
    default_decision: input.default_decision,
    rules: input.rules.map((rule) => ({ ...rule })),
  };
}

function isLoosening(remoteDecision: PolicyDecision, localDecision: PolicyDecision): boolean {
  return remoteDecision === 'deny' && localDecision === 'allow';
}

function createWarningEvent(message: string, timestamp: string): KernelEvent {
  return {
    schema_version: 1,
    kind: 'workspace_warning',
    timestamp,
    message,
  };
}

export function applyPolicyMode(input: ApplyPolicyModeInput): ApplyPolicyModeResult {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const remote = clonePolicySet(input.remote);
  const local = input.local;

  if (input.mode === 'authoritative' || !local) {
    return {
      effective: remote,
      events: [],
    };
  }

  const events: KernelEvent[] = [];
  const localDefault = local.default_decision;

  if (isLoosening(remote.default_decision, localDefault)) {
    if (input.mode === 'tighten-only') {
      throw new Error(
        `tighten-only mode rejected local policy loosening for default_decision in workspace ${input.workspace_id}`,
      );
    }

    events.push(
      createWarningEvent(
        `dev-override allowed local policy loosening for default_decision in workspace ${input.workspace_id}`,
        timestamp,
      ),
    );
  }

  const mergedRules = new Map(remote.rules.map((rule) => [rule.id, { ...rule }]));

  for (const localRule of local.rules) {
    const remoteRule = mergedRules.get(localRule.id);
    const remoteDecision = remoteRule?.decision ?? remote.default_decision;

    if (isLoosening(remoteDecision, localRule.decision)) {
      if (input.mode === 'tighten-only') {
        throw new Error(
          `tighten-only mode rejected local policy loosening for rule ${localRule.id} in workspace ${input.workspace_id}`,
        );
      }

      events.push(
        createWarningEvent(
          `dev-override allowed local policy loosening for rule ${localRule.id} in workspace ${input.workspace_id}`,
          timestamp,
        ),
      );
    }

    mergedRules.set(localRule.id, { ...localRule });
  }

  return {
    effective: {
      default_decision: localDefault,
      rules: Array.from(mergedRules.values()),
    },
    events,
  };
}

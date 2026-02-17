import type {
  ControlPlanePolicyMode,
  WorkspaceControlPlaneConfig,
  WorkspaceControlPlaneSpec,
} from './sync-port.js';

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}

function asPositiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${field}: expected a positive integer`);
  }

  return value;
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${field}: expected a non-empty string`);
  }

  return value;
}

function asPolicyMode(value: unknown): ControlPlanePolicyMode {
  if (value === 'authoritative' || value === 'tighten-only' || value === 'dev-override') {
    return value;
  }

  throw new Error('Invalid control_plane.policy_mode');
}

function parseControlPlaneConfig(input: unknown): WorkspaceControlPlaneConfig {
  if (!isObject(input)) {
    throw new Error('Invalid control_plane config: expected an object');
  }

  if (typeof input.enabled !== 'boolean') {
    throw new Error('Invalid control_plane.enabled: expected boolean');
  }

  const localOverrideRaw = input.local_override;
  const localOverride =
    localOverrideRaw === undefined
      ? false
      : typeof localOverrideRaw === 'boolean'
        ? localOverrideRaw
        : (() => {
            throw new Error('Invalid control_plane.local_override: expected boolean');
          })();

  return {
    enabled: input.enabled,
    endpoint: asNonEmptyString(input.endpoint, 'control_plane.endpoint'),
    org_id: asNonEmptyString(input.org_id, 'control_plane.org_id'),
    sync_interval: asPositiveInt(input.sync_interval, 'control_plane.sync_interval'),
    policy_mode: asPolicyMode(input.policy_mode),
    local_override: localOverride,
  };
}

export const ControlPlaneConfigSchema = {
  parse: parseControlPlaneConfig,
} as const;

export const WorkspaceControlPlaneSchema = {
  parse(input: unknown): WorkspaceControlPlaneSpec {
    if (!isObject(input)) {
      throw new Error('Invalid workspace config: expected an object');
    }

    const idRaw = input.id;
    const id =
      idRaw === undefined
        ? undefined
        : typeof idRaw === 'string' && idRaw.trim().length > 0
          ? idRaw
          : (() => {
              throw new Error('Invalid id: expected a non-empty string when provided');
            })();

    return {
      id,
      control_plane: parseControlPlaneConfig(input.control_plane),
    };
  },
} as const;

export function parseWorkspaceControlPlaneConfig(input: unknown): WorkspaceControlPlaneSpec {
  return WorkspaceControlPlaneSchema.parse(input);
}

// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import {
  TOOL_PERMISSIONS,
  TOOL_SCOPE_ACCESS,
  TOOL_SCOPE_TYPES,
  type PathScope,
  type ToolPermission,
} from './tools/types.js';

interface Parser<T> {
  parse(input: unknown): T;
}

export const MANIFEST_POLICY_TRIGGERS = {
  ON_TOOL_REQUEST: 'on_tool_request',
  ON_CLAIM: 'on_claim',
  ON_COMPLETION: 'on_completion',
  ON_EVIDENCE_ADDED: 'on_evidence_added',
} as const;

export type ManifestPolicyTrigger =
  (typeof MANIFEST_POLICY_TRIGGERS)[keyof typeof MANIFEST_POLICY_TRIGGERS];

export const MANIFEST_POLICY_DECISIONS = {
  ALLOW: 'allow',
  DENY: 'deny',
} as const;

export type ManifestPolicyDecision =
  (typeof MANIFEST_POLICY_DECISIONS)[keyof typeof MANIFEST_POLICY_DECISIONS];

export interface SoftwareDeliveryManifestTool {
  name: string;
  entry: string;
  permission: ToolPermission;
  required_scopes: PathScope[];
  internal_only?: boolean;
}

export interface SoftwareDeliveryManifestPolicy {
  id: string;
  trigger: ManifestPolicyTrigger;
  decision: ManifestPolicyDecision;
  reason?: string;
}

export interface SoftwareDeliveryPackManifest {
  id: string;
  version: string;
  config_key?: string;
  config_schema?: string;
  task_types: string[];
  tools: SoftwareDeliveryManifestTool[];
  policies: SoftwareDeliveryManifestPolicy[];
  evidence_types: string[];
  state_aliases: Record<string, string>;
  lane_templates: Array<{ id: string }>;
}

function asRecord(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${label} must be an object.`);
  }
  return input as Record<string, unknown>;
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function parseStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((entry, index) => parseNonEmptyString(entry, `${label}[${index}]`));
}

function isSemver(value: string): boolean {
  let core = value;
  const prereleaseIndex = core.indexOf('-');
  if (prereleaseIndex >= 0) {
    core = core.slice(0, prereleaseIndex);
  }
  const metadataIndex = core.indexOf('+');
  if (metadataIndex >= 0) {
    core = core.slice(0, metadataIndex);
  }
  const parts = core.split('.');
  if (parts.length !== 3) {
    return false;
  }
  return parts.every(
    (part) => part.length > 0 && [...part].every((char) => char >= '0' && char <= '9'),
  );
}

const ALLOWED_POLICY_TRIGGERS = new Set<string>(Object.values(MANIFEST_POLICY_TRIGGERS));
const ALLOWED_POLICY_DECISIONS = new Set<string>(Object.values(MANIFEST_POLICY_DECISIONS));
const ALLOWED_TOOL_PERMISSIONS = new Set<string>(Object.values(TOOL_PERMISSIONS));

function parsePathScope(input: unknown, label: string): PathScope {
  const scope = asRecord(input, label);
  const type = parseNonEmptyString(scope.type, `${label}.type`);
  const pattern = parseNonEmptyString(scope.pattern, `${label}.pattern`);
  const access = parseNonEmptyString(scope.access, `${label}.access`);

  if (type !== TOOL_SCOPE_TYPES.PATH) {
    throw new Error(`${label}.type must be "${TOOL_SCOPE_TYPES.PATH}".`);
  }
  if (access !== TOOL_SCOPE_ACCESS.READ && access !== TOOL_SCOPE_ACCESS.WRITE) {
    throw new Error(
      `${label}.access must be "${TOOL_SCOPE_ACCESS.READ}" or "${TOOL_SCOPE_ACCESS.WRITE}".`,
    );
  }

  return {
    type: TOOL_SCOPE_TYPES.PATH,
    pattern,
    access,
  };
}

function parseRequiredScopes(value: unknown, label: string): PathScope[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array.`);
  }
  return value.map((entry, index) => parsePathScope(entry, `${label}[${index}]`));
}

function parsePolicy(input: unknown, index: number): SoftwareDeliveryManifestPolicy {
  const policy = asRecord(input, `policies[${index}]`);
  const trigger = parseNonEmptyString(policy.trigger, `policies[${index}].trigger`);
  const decision = parseNonEmptyString(policy.decision, `policies[${index}].decision`);

  if (!ALLOWED_POLICY_TRIGGERS.has(trigger)) {
    throw new Error(`policies[${index}].trigger is invalid.`);
  }
  if (!ALLOWED_POLICY_DECISIONS.has(decision)) {
    throw new Error(`policies[${index}].decision is invalid.`);
  }

  return {
    id: parseNonEmptyString(policy.id, `policies[${index}].id`),
    trigger: trigger as ManifestPolicyTrigger,
    decision: decision as ManifestPolicyDecision,
    reason:
      policy.reason === undefined
        ? undefined
        : parseNonEmptyString(policy.reason, `policies[${index}].reason`),
  };
}

function parseTool(input: unknown, index: number): SoftwareDeliveryManifestTool {
  const tool = asRecord(input, `tools[${index}]`);
  const permission =
    tool.permission === undefined
      ? TOOL_PERMISSIONS.READ
      : parseNonEmptyString(tool.permission, `tools[${index}].permission`);

  if (!ALLOWED_TOOL_PERMISSIONS.has(permission)) {
    throw new Error(`tools[${index}].permission is invalid.`);
  }

  return {
    name: parseNonEmptyString(tool.name, `tools[${index}].name`),
    entry: parseNonEmptyString(tool.entry, `tools[${index}].entry`),
    permission: permission as ToolPermission,
    required_scopes: parseRequiredScopes(tool.required_scopes, `tools[${index}].required_scopes`),
    internal_only:
      tool.internal_only === undefined
        ? undefined
        : (() => {
            if (typeof tool.internal_only !== 'boolean') {
              throw new Error(`tools[${index}].internal_only must be boolean.`);
            }
            return tool.internal_only;
          })(),
  };
}

function parseStateAliases(input: unknown): Record<string, string> {
  const aliases = asRecord(input ?? {}, 'state_aliases');
  const parsed: Record<string, string> = {};
  for (const [key, value] of Object.entries(aliases)) {
    parsed[parseNonEmptyString(key, 'state_aliases key')] = parseNonEmptyString(
      value,
      `state_aliases.${key}`,
    );
  }
  return parsed;
}

export const SoftwareDeliveryManifestSchema: Parser<SoftwareDeliveryPackManifest> = {
  parse(input: unknown): SoftwareDeliveryPackManifest {
    const manifest = asRecord(input, 'manifest');
    const version = parseNonEmptyString(manifest.version, 'version');
    if (!isSemver(version)) {
      throw new Error('version must be semver.');
    }

    const taskTypes = parseStringArray(manifest.task_types, 'task_types');
    if (taskTypes.length === 0) {
      throw new Error('task_types must include at least one item.');
    }

    const toolsValue = manifest.tools ?? [];
    if (!Array.isArray(toolsValue)) {
      throw new Error('tools must be an array.');
    }
    const policiesValue = manifest.policies ?? [];
    if (!Array.isArray(policiesValue)) {
      throw new Error('policies must be an array.');
    }
    const laneTemplatesValue = manifest.lane_templates ?? [];
    if (!Array.isArray(laneTemplatesValue)) {
      throw new Error('lane_templates must be an array.');
    }

    return {
      id: parseNonEmptyString(manifest.id, 'id'),
      version,
      task_types: taskTypes,
      tools: toolsValue.map((tool, index) => parseTool(tool, index)),
      policies: policiesValue.map((policy, index) => parsePolicy(policy, index)),
      evidence_types: parseStringArray(manifest.evidence_types ?? [], 'evidence_types'),
      state_aliases: parseStateAliases(manifest.state_aliases),
      lane_templates: laneTemplatesValue.map((laneTemplate, index) => {
        const entry = asRecord(laneTemplate, `lane_templates[${index}]`);
        return { id: parseNonEmptyString(entry.id, `lane_templates[${index}].id`) };
      }),
    };
  },
};

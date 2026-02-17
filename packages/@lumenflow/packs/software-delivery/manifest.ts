import {
  SOFTWARE_DELIVERY_PACK_ID,
  SOFTWARE_DELIVERY_PACK_VERSION,
  SOFTWARE_DELIVERY_POLICY_ID_PREFIX,
} from './constants.js';

interface Parser<T> {
  parse(input: unknown): T;
}

export interface SoftwareDeliveryManifestTool {
  name: string;
  entry: string;
  internal_only?: boolean;
}

export interface SoftwareDeliveryManifestPolicy {
  id: string;
  trigger: 'on_tool_request' | 'on_claim' | 'on_completion' | 'on_evidence_added';
  decision: 'allow' | 'deny';
  reason?: string;
}

export interface SoftwareDeliveryPackManifest {
  id: string;
  version: string;
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

const AllowedPolicyTriggers = new Set([
  'on_tool_request',
  'on_claim',
  'on_completion',
  'on_evidence_added',
]);
const AllowedPolicyDecisions = new Set(['allow', 'deny']);

function parsePolicy(input: unknown, index: number): SoftwareDeliveryManifestPolicy {
  const policy = asRecord(input, `policies[${index}]`);
  const trigger = parseNonEmptyString(policy.trigger, `policies[${index}].trigger`);
  const decision = parseNonEmptyString(policy.decision, `policies[${index}].decision`);
  if (!AllowedPolicyTriggers.has(trigger)) {
    throw new Error(`policies[${index}].trigger is invalid.`);
  }
  if (!AllowedPolicyDecisions.has(decision)) {
    throw new Error(`policies[${index}].decision is invalid.`);
  }
  return {
    id: parseNonEmptyString(policy.id, `policies[${index}].id`),
    trigger: trigger as SoftwareDeliveryManifestPolicy['trigger'],
    decision: decision as SoftwareDeliveryManifestPolicy['decision'],
    reason:
      policy.reason === undefined
        ? undefined
        : parseNonEmptyString(policy.reason, `policies[${index}].reason`),
  };
}

function parseTool(input: unknown, index: number): SoftwareDeliveryManifestTool {
  const tool = asRecord(input, `tools[${index}]`);
  return {
    name: parseNonEmptyString(tool.name, `tools[${index}].name`),
    entry: parseNonEmptyString(tool.entry, `tools[${index}].entry`),
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

export const SOFTWARE_DELIVERY_MANIFEST: SoftwareDeliveryPackManifest = {
  id: SOFTWARE_DELIVERY_PACK_ID,
  version: SOFTWARE_DELIVERY_PACK_VERSION,
  task_types: ['work-unit'],
  tools: [],
  policies: [
    { id: `${SOFTWARE_DELIVERY_POLICY_ID_PREFIX}.format`, trigger: 'on_completion', decision: 'allow' },
    { id: `${SOFTWARE_DELIVERY_POLICY_ID_PREFIX}.lint`, trigger: 'on_completion', decision: 'allow' },
    {
      id: `${SOFTWARE_DELIVERY_POLICY_ID_PREFIX}.typecheck`,
      trigger: 'on_completion',
      decision: 'allow',
    },
    { id: `${SOFTWARE_DELIVERY_POLICY_ID_PREFIX}.test`, trigger: 'on_completion', decision: 'allow' },
    {
      id: `${SOFTWARE_DELIVERY_POLICY_ID_PREFIX}.coverage`,
      trigger: 'on_completion',
      decision: 'allow',
    },
  ],
  evidence_types: ['gate-run'],
  state_aliases: { active: 'in_progress' },
  lane_templates: [],
};

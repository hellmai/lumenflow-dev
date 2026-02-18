// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import {
  SOFTWARE_DELIVERY_PACK_ID,
  SOFTWARE_DELIVERY_PACK_VERSION,
  SOFTWARE_DELIVERY_POLICY_ID_PREFIX,
} from './constants.js';
import type { PathScope } from './tools/types.js';

interface Parser<T> {
  parse(input: unknown): T;
}

export interface SoftwareDeliveryManifestTool {
  name: string;
  entry: string;
  permission: 'read' | 'write' | 'admin';
  required_scopes: PathScope[];
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
const AllowedToolPermissions = new Set(['read', 'write', 'admin']);

function parsePathScope(input: unknown, label: string): PathScope {
  const scope = asRecord(input, label);
  const type = parseNonEmptyString(scope.type, `${label}.type`);
  const pattern = parseNonEmptyString(scope.pattern, `${label}.pattern`);
  const access = parseNonEmptyString(scope.access, `${label}.access`);

  if (type !== 'path') {
    throw new Error(`${label}.type must be "path".`);
  }
  if (access !== 'read' && access !== 'write') {
    throw new Error(`${label}.access must be "read" or "write".`);
  }

  return {
    type: 'path',
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
  const permission =
    tool.permission === undefined
      ? 'read'
      : parseNonEmptyString(tool.permission, `tools[${index}].permission`);
  if (!AllowedToolPermissions.has(permission)) {
    throw new Error(`tools[${index}].permission is invalid.`);
  }

  return {
    name: parseNonEmptyString(tool.name, `tools[${index}].name`),
    entry: parseNonEmptyString(tool.entry, `tools[${index}].entry`),
    permission: permission as SoftwareDeliveryManifestTool['permission'],
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

export const SOFTWARE_DELIVERY_MANIFEST: SoftwareDeliveryPackManifest = {
  id: SOFTWARE_DELIVERY_PACK_ID,
  version: SOFTWARE_DELIVERY_PACK_VERSION,
  task_types: ['work-unit'],
  tools: [
    // wu:*
    {
      name: 'wu:block',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'wu:brief',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'wu:claim',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'wu:cleanup',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'wu:create',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'wu:delegate',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'wu:delete',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'wu:deps',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'wu:done',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'wu:edit',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'wu:infer-lane',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'wu:preflight',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'wu:prep',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'wu:proto',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'wu:prune',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'wu:recover',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'wu:release',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'wu:repair',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'wu:sandbox',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'wu:status',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'wu:unblock',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'wu:unlock-lane',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'wu:validate',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    // mem:*
    {
      name: 'mem:checkpoint',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'mem:cleanup',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'mem:context',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'mem:create',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'mem:delete',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'mem:export',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'mem:inbox',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'mem:init',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'mem:ready',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'mem:recover',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'mem:signal',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'mem:start',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'mem:summarize',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'mem:triage',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    // initiative:*
    {
      name: 'initiative:add-wu',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'initiative:bulk-assign',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'initiative:create',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'initiative:edit',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'initiative:list',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'initiative:plan',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'initiative:remove-wu',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'initiative:status',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    // lane:*
    {
      name: 'lane:health',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'lane:suggest',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    // flow:*
    {
      name: 'flow:bottlenecks',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'flow:report',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    // gate:*
    {
      name: 'gates',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    // file:*
    {
      name: 'file:delete',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'file:edit',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'file:read',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'file:write',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    // git:*
    {
      name: 'git:branch',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'git:diff',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'git:log',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'git:status',
      entry: 'tool-impl/git-tools.ts#gitStatusTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    // agent:*
    {
      name: 'agent:issues-query',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'agent:log-issue',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'agent:session',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'agent:session-end',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    // orchestrate:*
    {
      name: 'orchestrate:init-status',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'orchestrate:initiative',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'orchestrate:monitor',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    // state:*
    {
      name: 'state:bootstrap',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'state:cleanup',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'state:doctor',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    // plan:*
    {
      name: 'plan:create',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'plan:edit',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'plan:link',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'plan:promote',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    // setup:*
    {
      name: 'backlog:prune',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'delegation:list',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'docs:sync',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'init:plan',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'lumenflow',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'lumenflow:doctor',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'lumenflow:integrate',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'lumenflow:release',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'lumenflow:upgrade',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'metrics',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'metrics:snapshot',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'signal:cleanup',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'sync:templates',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
    },
    {
      name: 'validate',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'validate:agent-skills',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'validate:agent-sync',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'validate:backlog-sync',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
    {
      name: 'validate:skills-spec',
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    },
  ],
  policies: [
    {
      id: `${SOFTWARE_DELIVERY_POLICY_ID_PREFIX}.format`,
      trigger: 'on_completion',
      decision: 'allow',
    },
    {
      id: `${SOFTWARE_DELIVERY_POLICY_ID_PREFIX}.lint`,
      trigger: 'on_completion',
      decision: 'allow',
    },
    {
      id: `${SOFTWARE_DELIVERY_POLICY_ID_PREFIX}.typecheck`,
      trigger: 'on_completion',
      decision: 'allow',
    },
    {
      id: `${SOFTWARE_DELIVERY_POLICY_ID_PREFIX}.test`,
      trigger: 'on_completion',
      decision: 'allow',
    },
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

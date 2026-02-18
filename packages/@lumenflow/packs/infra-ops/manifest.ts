// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import {
  MANIFEST_POLICY_DECISIONS,
  MANIFEST_POLICY_TRIGGERS,
  type SoftwareDeliveryManifestTool,
  type SoftwareDeliveryPackManifest,
} from '../software-delivery/manifest-schema.js';
import {
  TOOL_PERMISSIONS,
  TOOL_SCOPE_ACCESS,
  TOOL_SCOPE_TYPES,
  type PathScope,
  type ToolPermission,
} from '../software-delivery/tools/types.js';

export type InfraOpsPackManifest = SoftwareDeliveryPackManifest;

const INFRA_OPS_PACK_ID = 'infra-ops' as const;
const INFRA_OPS_PACK_VERSION = '0.1.0' as const;
const INFRA_OPS_POLICY_ID_PREFIX = `${INFRA_OPS_PACK_ID}` as const;

const FULL_WORKSPACE_SCOPE_PATTERN = '**';
const PENDING_RUNTIME_TOOL_ENTRY = 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool';

const TOOL_DEFINITIONS = {
  'terraform:plan': TOOL_PERMISSIONS.READ,
  'terraform:apply': TOOL_PERMISSIONS.WRITE,
  'k8s:get': TOOL_PERMISSIONS.READ,
  'k8s:apply': TOOL_PERMISSIONS.WRITE,
  'dns:lookup': TOOL_PERMISSIONS.READ,
  'dns:update': TOOL_PERMISSIONS.WRITE,
  'cloud:describe': TOOL_PERMISSIONS.READ,
} as const satisfies Record<string, ToolPermission>;

type ToolName = keyof typeof TOOL_DEFINITIONS;

function requiredScopesForPermission(permission: ToolPermission): PathScope[] {
  return [
    {
      type: TOOL_SCOPE_TYPES.PATH,
      pattern: FULL_WORKSPACE_SCOPE_PATTERN,
      access:
        permission === TOOL_PERMISSIONS.READ ? TOOL_SCOPE_ACCESS.READ : TOOL_SCOPE_ACCESS.WRITE,
    },
  ];
}

function createManifestTools(): SoftwareDeliveryManifestTool[] {
  return (Object.keys(TOOL_DEFINITIONS) as ToolName[]).map((name) => {
    const permission = TOOL_DEFINITIONS[name];
    return {
      name,
      entry: PENDING_RUNTIME_TOOL_ENTRY,
      permission,
      required_scopes: requiredScopesForPermission(permission),
    };
  });
}

export const INFRA_OPS_MANIFEST: InfraOpsPackManifest = {
  id: INFRA_OPS_PACK_ID,
  version: INFRA_OPS_PACK_VERSION,
  task_types: ['infra-task'],
  tools: createManifestTools(),
  policies: [
    {
      id: `${INFRA_OPS_POLICY_ID_PREFIX}.change-window`,
      trigger: MANIFEST_POLICY_TRIGGERS.ON_COMPLETION,
      decision: MANIFEST_POLICY_DECISIONS.DENY,
    },
    {
      id: `${INFRA_OPS_POLICY_ID_PREFIX}.blast-radius-limit`,
      trigger: MANIFEST_POLICY_TRIGGERS.ON_TOOL_REQUEST,
      decision: MANIFEST_POLICY_DECISIONS.DENY,
    },
    {
      id: `${INFRA_OPS_POLICY_ID_PREFIX}.approval-chain`,
      trigger: MANIFEST_POLICY_TRIGGERS.ON_CLAIM,
      decision: MANIFEST_POLICY_DECISIONS.DENY,
    },
  ],
  evidence_types: ['infra-change-record'],
  state_aliases: { active: 'in_progress' },
  lane_templates: [],
};

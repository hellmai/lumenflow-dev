// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import {
  SOFTWARE_DELIVERY_PACK_ID,
  SOFTWARE_DELIVERY_PACK_VERSION,
  SOFTWARE_DELIVERY_POLICY_ID_PREFIX,
} from './constants.js';
import {
  MANIFEST_POLICY_DECISIONS,
  MANIFEST_POLICY_TRIGGERS,
  SoftwareDeliveryManifestSchema,
  type SoftwareDeliveryManifestTool,
  type SoftwareDeliveryPackManifest,
} from './manifest-schema.js';
import {
  TOOL_PERMISSIONS as TOOL_PERMISSION_VALUES,
  TOOL_SCOPE_ACCESS,
  TOOL_SCOPE_TYPES,
  type PathScope,
  type ToolPermission,
} from './tools/types.js';

export { SoftwareDeliveryManifestSchema };
export type {
  ManifestPolicyDecision,
  ManifestPolicyTrigger,
  SoftwareDeliveryManifestPolicy,
  SoftwareDeliveryManifestTool,
  SoftwareDeliveryPackManifest,
} from './manifest-schema.js';

const FULL_WORKSPACE_SCOPE_PATTERN = '**';
const PENDING_RUNTIME_TOOL_ENTRY = 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool';
const GIT_STATUS_TOOL_ENTRY = 'tool-impl/git-tools.ts#gitStatusTool';
const WU_STATUS_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuStatusTool';
const WU_CREATE_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuCreateTool';
const WU_CLAIM_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuClaimTool';
const WU_DONE_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuDoneTool';
const WU_PREP_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuPrepTool';
const WU_PREFLIGHT_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuPreflightTool';
const WU_VALIDATE_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuValidateTool';
const WU_BLOCK_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuBlockTool';
const WU_UNBLOCK_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuUnblockTool';
const WU_RELEASE_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuReleaseTool';
const WU_RECOVER_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuRecoverTool';
const WU_REPAIR_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuRepairTool';
const GATES_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#gatesTool';

const TOOL_PERMISSIONS = {
  'wu:block': 'write',
  'wu:brief': 'read',
  'wu:claim': 'write',
  'wu:cleanup': 'write',
  'wu:create': 'write',
  'wu:delegate': 'write',
  'wu:delete': 'write',
  'wu:deps': 'read',
  'wu:done': 'write',
  'wu:edit': 'write',
  'wu:infer-lane': 'read',
  'wu:preflight': 'read',
  'wu:prep': 'write',
  'wu:proto': 'write',
  'wu:prune': 'write',
  'wu:recover': 'write',
  'wu:release': 'write',
  'wu:repair': 'write',
  'wu:sandbox': 'write',
  'wu:status': 'read',
  'wu:unblock': 'write',
  'wu:unlock-lane': 'write',
  'wu:validate': 'read',
  'mem:checkpoint': 'write',
  'mem:cleanup': 'write',
  'mem:context': 'read',
  'mem:create': 'write',
  'mem:delete': 'write',
  'mem:export': 'read',
  'mem:inbox': 'read',
  'mem:init': 'write',
  'mem:ready': 'read',
  'mem:recover': 'write',
  'mem:signal': 'write',
  'mem:start': 'write',
  'mem:summarize': 'read',
  'mem:triage': 'write',
  'initiative:add-wu': 'write',
  'initiative:bulk-assign': 'write',
  'initiative:create': 'write',
  'initiative:edit': 'write',
  'initiative:list': 'read',
  'initiative:plan': 'read',
  'initiative:remove-wu': 'write',
  'initiative:status': 'read',
  'lane:health': 'read',
  'lane:suggest': 'write',
  'flow:bottlenecks': 'read',
  'flow:report': 'read',
  gates: 'write',
  'file:delete': 'write',
  'file:edit': 'write',
  'file:read': 'read',
  'file:write': 'write',
  'git:branch': 'write',
  'git:diff': 'read',
  'git:log': 'read',
  'git:status': 'read',
  'agent:issues-query': 'read',
  'agent:log-issue': 'write',
  'agent:session': 'write',
  'agent:session-end': 'write',
  'orchestrate:init-status': 'read',
  'orchestrate:initiative': 'write',
  'orchestrate:monitor': 'read',
  'state:bootstrap': 'write',
  'state:cleanup': 'write',
  'state:doctor': 'read',
  'plan:create': 'write',
  'plan:edit': 'write',
  'plan:link': 'write',
  'plan:promote': 'write',
  'backlog:prune': 'write',
  'delegation:list': 'read',
  'docs:sync': 'write',
  'init:plan': 'read',
  lumenflow: 'write',
  'lumenflow:doctor': 'read',
  'lumenflow:integrate': 'write',
  'lumenflow:release': 'write',
  'lumenflow:upgrade': 'write',
  metrics: 'read',
  'metrics:snapshot': 'read',
  'signal:cleanup': 'write',
  'sync:templates': 'write',
  validate: 'read',
  'validate:agent-skills': 'read',
  'validate:agent-sync': 'read',
  'validate:backlog-sync': 'read',
  'validate:skills-spec': 'read',
} as const satisfies Record<string, ToolPermission>;

type ToolName = keyof typeof TOOL_PERMISSIONS;

const TOOL_ENTRY_OVERRIDES: Partial<Record<ToolName, string>> = {
  'git:status': GIT_STATUS_TOOL_ENTRY,
  'wu:status': WU_STATUS_TOOL_ENTRY,
  'wu:create': WU_CREATE_TOOL_ENTRY,
  'wu:claim': WU_CLAIM_TOOL_ENTRY,
  'wu:done': WU_DONE_TOOL_ENTRY,
  'wu:prep': WU_PREP_TOOL_ENTRY,
  'wu:preflight': WU_PREFLIGHT_TOOL_ENTRY,
  'wu:validate': WU_VALIDATE_TOOL_ENTRY,
  'wu:block': WU_BLOCK_TOOL_ENTRY,
  'wu:unblock': WU_UNBLOCK_TOOL_ENTRY,
  'wu:release': WU_RELEASE_TOOL_ENTRY,
  'wu:recover': WU_RECOVER_TOOL_ENTRY,
  'wu:repair': WU_REPAIR_TOOL_ENTRY,
  gates: GATES_TOOL_ENTRY,
};

export interface SoftwareDeliveryMigrationScorecard {
  declaredTools: number;
  pendingRuntimeEntries: number;
  realHandlerEntries: number;
}

function requiredScopesForPermission(permission: ToolPermission): PathScope[] {
  return [
    {
      type: TOOL_SCOPE_TYPES.PATH,
      pattern: FULL_WORKSPACE_SCOPE_PATTERN,
      access:
        permission === TOOL_PERMISSION_VALUES.READ
          ? TOOL_SCOPE_ACCESS.READ
          : TOOL_SCOPE_ACCESS.WRITE,
    },
  ];
}

function createManifestTools(): SoftwareDeliveryManifestTool[] {
  return (Object.keys(TOOL_PERMISSIONS) as ToolName[]).map((name) => {
    const permission = TOOL_PERMISSIONS[name];
    return {
      name,
      entry: TOOL_ENTRY_OVERRIDES[name] ?? PENDING_RUNTIME_TOOL_ENTRY,
      permission,
      required_scopes: requiredScopesForPermission(permission),
    };
  });
}

function countPendingRuntimeEntries(tools: SoftwareDeliveryManifestTool[]): number {
  return tools.reduce((total, tool) => {
    if (tool.entry === PENDING_RUNTIME_TOOL_ENTRY) {
      return total + 1;
    }
    return total;
  }, 0);
}

export function getSoftwareDeliveryMigrationScorecard(
  manifest: SoftwareDeliveryPackManifest = SOFTWARE_DELIVERY_MANIFEST,
): SoftwareDeliveryMigrationScorecard {
  const declaredTools = manifest.tools.length;
  const pendingRuntimeEntries = countPendingRuntimeEntries(manifest.tools);
  return {
    declaredTools,
    pendingRuntimeEntries,
    realHandlerEntries: declaredTools - pendingRuntimeEntries,
  };
}

export function renderSoftwareDeliveryMigrationScorecard(
  manifest: SoftwareDeliveryPackManifest = SOFTWARE_DELIVERY_MANIFEST,
): string {
  return JSON.stringify(getSoftwareDeliveryMigrationScorecard(manifest));
}

const POLICY_SUFFIXES = ['format', 'lint', 'typecheck', 'test', 'coverage'] as const;

export const SOFTWARE_DELIVERY_MANIFEST: SoftwareDeliveryPackManifest = {
  id: SOFTWARE_DELIVERY_PACK_ID,
  version: SOFTWARE_DELIVERY_PACK_VERSION,
  task_types: ['work-unit'],
  tools: createManifestTools(),
  policies: POLICY_SUFFIXES.map((suffix) => ({
    id: `${SOFTWARE_DELIVERY_POLICY_ID_PREFIX}.${suffix}`,
    trigger: MANIFEST_POLICY_TRIGGERS.ON_COMPLETION,
    decision: MANIFEST_POLICY_DECISIONS.ALLOW,
  })),
  evidence_types: ['gate-run'],
  state_aliases: { active: 'in_progress' },
  lane_templates: [],
};

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
const GIT_STATUS_TOOL_ENTRY = 'tool-impl/git-tools.ts#gitStatusTool';
const WU_STATUS_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuStatusTool';
const WU_CREATE_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuCreateTool';
const WU_CLAIM_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuClaimTool';
const WU_DONE_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuDoneTool';
const WU_PREP_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuPrepTool';
const WU_PREFLIGHT_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuPreflightTool';
const WU_VALIDATE_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuValidateTool';
const WU_SANDBOX_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuSandboxTool';
const WU_PRUNE_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuPruneTool';
const WU_DELETE_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuDeleteTool';
const WU_CLEANUP_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuCleanupTool';
const WU_UNLOCK_LANE_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuUnlockLaneTool';
const WU_BRIEF_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuBriefTool';
const WU_DELEGATE_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuDelegateTool';
const WU_DEPS_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuDepsTool';
const WU_EDIT_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuEditTool';
const WU_PROTO_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuProtoTool';
const WU_BLOCK_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuBlockTool';
const WU_UNBLOCK_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuUnblockTool';
const WU_RELEASE_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuReleaseTool';
const WU_RECOVER_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuRecoverTool';
const WU_REPAIR_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#wuRepairTool';
const GATES_TOOL_ENTRY = 'tool-impl/wu-lifecycle-tools.ts#gatesTool';
const CONFIG_SET_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#configSetTool';
const CONFIG_GET_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#configGetTool';
const MEM_INIT_TOOL_ENTRY = 'tool-impl/memory-tools.ts#memInitTool';
const MEM_START_TOOL_ENTRY = 'tool-impl/memory-tools.ts#memStartTool';
const MEM_READY_TOOL_ENTRY = 'tool-impl/memory-tools.ts#memReadyTool';
const MEM_CHECKPOINT_TOOL_ENTRY = 'tool-impl/memory-tools.ts#memCheckpointTool';
const MEM_CLEANUP_TOOL_ENTRY = 'tool-impl/memory-tools.ts#memCleanupTool';
const MEM_CONTEXT_TOOL_ENTRY = 'tool-impl/memory-tools.ts#memContextTool';
const MEM_CREATE_TOOL_ENTRY = 'tool-impl/memory-tools.ts#memCreateTool';
const MEM_DELETE_TOOL_ENTRY = 'tool-impl/memory-tools.ts#memDeleteTool';
const MEM_EXPORT_TOOL_ENTRY = 'tool-impl/memory-tools.ts#memExportTool';
const MEM_INBOX_TOOL_ENTRY = 'tool-impl/memory-tools.ts#memInboxTool';
const MEM_SIGNAL_TOOL_ENTRY = 'tool-impl/memory-tools.ts#memSignalTool';
const MEM_SUMMARIZE_TOOL_ENTRY = 'tool-impl/memory-tools.ts#memSummarizeTool';
const MEM_TRIAGE_TOOL_ENTRY = 'tool-impl/memory-tools.ts#memTriageTool';
const MEM_RECOVER_TOOL_ENTRY = 'tool-impl/memory-tools.ts#memRecoverTool';
const AGENT_SESSION_TOOL_ENTRY = 'tool-impl/agent-tools.ts#agentSessionTool';
const AGENT_SESSION_END_TOOL_ENTRY = 'tool-impl/agent-tools.ts#agentSessionEndTool';
const AGENT_LOG_ISSUE_TOOL_ENTRY = 'tool-impl/agent-tools.ts#agentLogIssueTool';
const AGENT_ISSUES_QUERY_TOOL_ENTRY = 'tool-impl/agent-tools.ts#agentIssuesQueryTool';
const FLOW_BOTTLENECKS_TOOL_ENTRY = 'tool-impl/flow-metrics-tools.ts#flowBottlenecksTool';
const FLOW_REPORT_TOOL_ENTRY = 'tool-impl/flow-metrics-tools.ts#flowReportTool';
const METRICS_TOOL_ENTRY = 'tool-impl/flow-metrics-tools.ts#metricsTool';
const METRICS_SNAPSHOT_TOOL_ENTRY = 'tool-impl/flow-metrics-tools.ts#metricsSnapshotTool';
const WU_INFER_LANE_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#wuInferLaneTool';
const LANE_HEALTH_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#laneHealthTool';
const LANE_SUGGEST_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#laneSuggestTool';
const FILE_READ_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#fileReadTool';
const FILE_WRITE_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#fileWriteTool';
const FILE_EDIT_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#fileEditTool';
const FILE_DELETE_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#fileDeleteTool';
const GIT_BRANCH_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#gitBranchTool';
const GIT_DIFF_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#gitDiffTool';
const GIT_LOG_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#gitLogTool';
const STATE_BOOTSTRAP_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#stateBootstrapTool';
const STATE_CLEANUP_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#stateCleanupTool';
const STATE_DOCTOR_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#stateDoctorTool';
const BACKLOG_PRUNE_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#backlogPruneTool';
const SIGNAL_CLEANUP_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#signalCleanupTool';
const LUMENFLOW_METRICS_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#lumenflowMetricsTool';
const VALIDATE_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#validateTool';
const LUMENFLOW_VALIDATE_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#lumenflowValidateTool';
const VALIDATE_AGENT_SKILLS_TOOL_ENTRY =
  'tool-impl/runtime-native-tools.ts#validateAgentSkillsTool';
const VALIDATE_AGENT_SYNC_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#validateAgentSyncTool';
const VALIDATE_BACKLOG_SYNC_TOOL_ENTRY =
  'tool-impl/runtime-native-tools.ts#validateBacklogSyncTool';
const VALIDATE_SKILLS_SPEC_TOOL_ENTRY = 'tool-impl/runtime-native-tools.ts#validateSkillsSpecTool';
const INITIATIVE_ADD_WU_TOOL_ENTRY =
  'tool-impl/initiative-orchestration-tools.ts#initiativeAddWuTool';
const INITIATIVE_BULK_ASSIGN_TOOL_ENTRY =
  'tool-impl/initiative-orchestration-tools.ts#initiativeBulkAssignTool';
const INITIATIVE_CREATE_TOOL_ENTRY =
  'tool-impl/initiative-orchestration-tools.ts#initiativeCreateTool';
const INITIATIVE_EDIT_TOOL_ENTRY = 'tool-impl/initiative-orchestration-tools.ts#initiativeEditTool';
const INITIATIVE_LIST_TOOL_ENTRY = 'tool-impl/initiative-orchestration-tools.ts#initiativeListTool';
const INITIATIVE_PLAN_TOOL_ENTRY = 'tool-impl/initiative-orchestration-tools.ts#initiativePlanTool';
const INITIATIVE_REMOVE_WU_TOOL_ENTRY =
  'tool-impl/initiative-orchestration-tools.ts#initiativeRemoveWuTool';
const INITIATIVE_STATUS_TOOL_ENTRY =
  'tool-impl/initiative-orchestration-tools.ts#initiativeStatusTool';
const ORCHESTRATE_INIT_STATUS_TOOL_ENTRY =
  'tool-impl/initiative-orchestration-tools.ts#orchestrateInitStatusTool';
const ORCHESTRATE_INITIATIVE_TOOL_ENTRY =
  'tool-impl/initiative-orchestration-tools.ts#orchestrateInitiativeTool';
const ORCHESTRATE_MONITOR_TOOL_ENTRY =
  'tool-impl/initiative-orchestration-tools.ts#orchestrateMonitorTool';
const PLAN_CREATE_TOOL_ENTRY = 'tool-impl/initiative-orchestration-tools.ts#planCreateTool';
const PLAN_EDIT_TOOL_ENTRY = 'tool-impl/initiative-orchestration-tools.ts#planEditTool';
const PLAN_LINK_TOOL_ENTRY = 'tool-impl/initiative-orchestration-tools.ts#planLinkTool';
const PLAN_PROMOTE_TOOL_ENTRY = 'tool-impl/initiative-orchestration-tools.ts#planPromoteTool';
const DELEGATION_LIST_TOOL_ENTRY = 'tool-impl/initiative-orchestration-tools.ts#delegationListTool';
const CLOUD_CONNECT_TOOL_ENTRY = 'tool-impl/initiative-orchestration-tools.ts#cloudConnectTool';
const DOCS_SYNC_TOOL_ENTRY = 'tool-impl/initiative-orchestration-tools.ts#docsSyncTool';
const INIT_PLAN_TOOL_ENTRY = 'tool-impl/initiative-orchestration-tools.ts#initPlanTool';
const LUMENFLOW_TOOL_ENTRY = 'tool-impl/initiative-orchestration-tools.ts#lumenflowTool';
const LUMENFLOW_DOCTOR_TOOL_ENTRY =
  'tool-impl/initiative-orchestration-tools.ts#lumenflowDoctorTool';
const LUMENFLOW_INTEGRATE_TOOL_ENTRY =
  'tool-impl/initiative-orchestration-tools.ts#lumenflowIntegrateTool';
const LUMENFLOW_RELEASE_TOOL_ENTRY =
  'tool-impl/initiative-orchestration-tools.ts#lumenflowReleaseTool';
const LUMENFLOW_UPGRADE_TOOL_ENTRY =
  'tool-impl/initiative-orchestration-tools.ts#lumenflowUpgradeTool';
const WORKSPACE_INIT_TOOL_ENTRY = 'tool-impl/initiative-orchestration-tools.ts#workspaceInitTool';
const SYNC_TEMPLATES_TOOL_ENTRY = 'tool-impl/initiative-orchestration-tools.ts#syncTemplatesTool';

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
  'cloud:connect': 'write',
  'config:get': 'read',
  'config:set': 'write',
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
  'lumenflow:metrics': 'read',
  'signal:cleanup': 'write',
  'sync:templates': 'write',
  validate: 'read',
  'lumenflow:validate': 'read',
  'validate:agent-skills': 'read',
  'validate:agent-sync': 'read',
  'validate:backlog-sync': 'read',
  'validate:skills-spec': 'read',
  'workspace:init': 'write',
} as const satisfies Record<string, ToolPermission>;

type ToolName = keyof typeof TOOL_PERMISSIONS;

const TOOL_ENTRY_OVERRIDES: Partial<Record<ToolName, string>> = {
  'git:status': GIT_STATUS_TOOL_ENTRY,
  'git:branch': GIT_BRANCH_TOOL_ENTRY,
  'git:diff': GIT_DIFF_TOOL_ENTRY,
  'git:log': GIT_LOG_TOOL_ENTRY,
  'wu:status': WU_STATUS_TOOL_ENTRY,
  'wu:create': WU_CREATE_TOOL_ENTRY,
  'wu:claim': WU_CLAIM_TOOL_ENTRY,
  'wu:done': WU_DONE_TOOL_ENTRY,
  'wu:prep': WU_PREP_TOOL_ENTRY,
  'wu:preflight': WU_PREFLIGHT_TOOL_ENTRY,
  'wu:validate': WU_VALIDATE_TOOL_ENTRY,
  'wu:sandbox': WU_SANDBOX_TOOL_ENTRY,
  'wu:prune': WU_PRUNE_TOOL_ENTRY,
  'wu:delete': WU_DELETE_TOOL_ENTRY,
  'wu:cleanup': WU_CLEANUP_TOOL_ENTRY,
  'wu:unlock-lane': WU_UNLOCK_LANE_TOOL_ENTRY,
  'wu:brief': WU_BRIEF_TOOL_ENTRY,
  'wu:delegate': WU_DELEGATE_TOOL_ENTRY,
  'wu:deps': WU_DEPS_TOOL_ENTRY,
  'wu:edit': WU_EDIT_TOOL_ENTRY,
  'wu:proto': WU_PROTO_TOOL_ENTRY,
  'wu:block': WU_BLOCK_TOOL_ENTRY,
  'wu:unblock': WU_UNBLOCK_TOOL_ENTRY,
  'wu:release': WU_RELEASE_TOOL_ENTRY,
  'wu:recover': WU_RECOVER_TOOL_ENTRY,
  'wu:repair': WU_REPAIR_TOOL_ENTRY,
  'wu:infer-lane': WU_INFER_LANE_TOOL_ENTRY,
  gates: GATES_TOOL_ENTRY,
  'mem:init': MEM_INIT_TOOL_ENTRY,
  'mem:start': MEM_START_TOOL_ENTRY,
  'mem:ready': MEM_READY_TOOL_ENTRY,
  'mem:checkpoint': MEM_CHECKPOINT_TOOL_ENTRY,
  'mem:cleanup': MEM_CLEANUP_TOOL_ENTRY,
  'mem:context': MEM_CONTEXT_TOOL_ENTRY,
  'mem:create': MEM_CREATE_TOOL_ENTRY,
  'mem:delete': MEM_DELETE_TOOL_ENTRY,
  'mem:export': MEM_EXPORT_TOOL_ENTRY,
  'mem:inbox': MEM_INBOX_TOOL_ENTRY,
  'mem:signal': MEM_SIGNAL_TOOL_ENTRY,
  'mem:summarize': MEM_SUMMARIZE_TOOL_ENTRY,
  'mem:triage': MEM_TRIAGE_TOOL_ENTRY,
  'mem:recover': MEM_RECOVER_TOOL_ENTRY,
  'agent:session': AGENT_SESSION_TOOL_ENTRY,
  'agent:session-end': AGENT_SESSION_END_TOOL_ENTRY,
  'agent:log-issue': AGENT_LOG_ISSUE_TOOL_ENTRY,
  'agent:issues-query': AGENT_ISSUES_QUERY_TOOL_ENTRY,
  'flow:bottlenecks': FLOW_BOTTLENECKS_TOOL_ENTRY,
  'flow:report': FLOW_REPORT_TOOL_ENTRY,
  metrics: METRICS_TOOL_ENTRY,
  'metrics:snapshot': METRICS_SNAPSHOT_TOOL_ENTRY,
  'lumenflow:metrics': LUMENFLOW_METRICS_TOOL_ENTRY,
  'lane:health': LANE_HEALTH_TOOL_ENTRY,
  'lane:suggest': LANE_SUGGEST_TOOL_ENTRY,
  'file:read': FILE_READ_TOOL_ENTRY,
  'file:write': FILE_WRITE_TOOL_ENTRY,
  'file:edit': FILE_EDIT_TOOL_ENTRY,
  'file:delete': FILE_DELETE_TOOL_ENTRY,
  'state:bootstrap': STATE_BOOTSTRAP_TOOL_ENTRY,
  'state:cleanup': STATE_CLEANUP_TOOL_ENTRY,
  'state:doctor': STATE_DOCTOR_TOOL_ENTRY,
  'backlog:prune': BACKLOG_PRUNE_TOOL_ENTRY,
  'config:set': CONFIG_SET_TOOL_ENTRY,
  'config:get': CONFIG_GET_TOOL_ENTRY,
  'signal:cleanup': SIGNAL_CLEANUP_TOOL_ENTRY,
  validate: VALIDATE_TOOL_ENTRY,
  'lumenflow:validate': LUMENFLOW_VALIDATE_TOOL_ENTRY,
  'validate:agent-skills': VALIDATE_AGENT_SKILLS_TOOL_ENTRY,
  'validate:agent-sync': VALIDATE_AGENT_SYNC_TOOL_ENTRY,
  'validate:backlog-sync': VALIDATE_BACKLOG_SYNC_TOOL_ENTRY,
  'validate:skills-spec': VALIDATE_SKILLS_SPEC_TOOL_ENTRY,
  'initiative:add-wu': INITIATIVE_ADD_WU_TOOL_ENTRY,
  'initiative:bulk-assign': INITIATIVE_BULK_ASSIGN_TOOL_ENTRY,
  'initiative:create': INITIATIVE_CREATE_TOOL_ENTRY,
  'initiative:edit': INITIATIVE_EDIT_TOOL_ENTRY,
  'initiative:list': INITIATIVE_LIST_TOOL_ENTRY,
  'initiative:plan': INITIATIVE_PLAN_TOOL_ENTRY,
  'initiative:remove-wu': INITIATIVE_REMOVE_WU_TOOL_ENTRY,
  'initiative:status': INITIATIVE_STATUS_TOOL_ENTRY,
  'orchestrate:init-status': ORCHESTRATE_INIT_STATUS_TOOL_ENTRY,
  'orchestrate:initiative': ORCHESTRATE_INITIATIVE_TOOL_ENTRY,
  'orchestrate:monitor': ORCHESTRATE_MONITOR_TOOL_ENTRY,
  'plan:create': PLAN_CREATE_TOOL_ENTRY,
  'plan:edit': PLAN_EDIT_TOOL_ENTRY,
  'plan:link': PLAN_LINK_TOOL_ENTRY,
  'plan:promote': PLAN_PROMOTE_TOOL_ENTRY,
  'cloud:connect': CLOUD_CONNECT_TOOL_ENTRY,
  'delegation:list': DELEGATION_LIST_TOOL_ENTRY,
  'docs:sync': DOCS_SYNC_TOOL_ENTRY,
  'init:plan': INIT_PLAN_TOOL_ENTRY,
  lumenflow: LUMENFLOW_TOOL_ENTRY,
  'lumenflow:doctor': LUMENFLOW_DOCTOR_TOOL_ENTRY,
  'lumenflow:integrate': LUMENFLOW_INTEGRATE_TOOL_ENTRY,
  'lumenflow:release': LUMENFLOW_RELEASE_TOOL_ENTRY,
  'lumenflow:upgrade': LUMENFLOW_UPGRADE_TOOL_ENTRY,
  'workspace:init': WORKSPACE_INIT_TOOL_ENTRY,
  'sync:templates': SYNC_TEMPLATES_TOOL_ENTRY,
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
      entry: resolveToolEntry(name),
      permission,
      required_scopes: requiredScopesForPermission(permission),
    };
  });
}

function resolveToolEntry(name: ToolName): string {
  const entry = TOOL_ENTRY_OVERRIDES[name];
  if (!entry) {
    throw new Error(`Missing runtime-native tool entry mapping for "${name}"`);
  }
  return entry;
}

export function getSoftwareDeliveryMigrationScorecard(
  manifest: SoftwareDeliveryPackManifest = SOFTWARE_DELIVERY_MANIFEST,
): SoftwareDeliveryMigrationScorecard {
  const declaredTools = manifest.tools.length;
  const pendingRuntimeEntries = 0;
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
  config_key: 'software_delivery',
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

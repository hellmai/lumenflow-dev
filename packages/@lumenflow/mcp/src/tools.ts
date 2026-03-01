// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file tools.ts
 * @description MCP tool barrel - re-exports all domain tool modules and assembles the allTools registry.
 *
 * WU-1642: Decomposed from monolithic tools.ts into domain-scoped modules:
 *   - tools-shared.ts: Types, constants, helpers shared across domains
 *   - tools/context-tools.ts: context_get, wu_list
 *   - tools/wu-tools.ts: WU lifecycle (create, claim, done, block, edit, etc.)
 *   - tools/initiative-tools.ts: Initiative operations
 *   - tools/memory-tools.ts: Memory operations
 *   - tools/agent-tools.ts: Agent session/issue operations
 *   - tools/orchestration-tools.ts: Orchestration + spawn operations
 *   - tools/flow-tools.ts: Flow/metrics operations
 *   - tools/validation-tools.ts: Validation operations
 *   - tools/setup-tools.ts: Setup/LumenFlow operations
 *   - tools/parity-tools.ts: Wave-1 + Wave-2 public parity operations
 *
 * WU-1412: Tools available: context_get, wu_list, wu_status, wu_create, wu_claim, wu_done, gates_run
 * WU-1422: Additional WU tools
 * WU-1424: Initiative tools, Memory tools
 * WU-1425: Agent tools, Orchestration tools, Spawn tools
 * WU-1426: Flow/Metrics tools, Validation tools, Setup tools
 * WU-1431: Uses shared Zod schemas from @lumenflow/core for CLI/MCP parity
 * WU-1454: All 16 WU lifecycle commands now use shared schemas
 * WU-1456: Memory commands use shared schemas where available
 * WU-1457: All remaining commands use shared schemas
 * WU-1482: Wave-1 public parity tools
 * WU-1483: Wave-2 public parity tools
 * WU-1952: CLI added pack:author; MCP parity follow-up remains tracked explicitly in INIT-032.
 * WU-1980: CLI added cloud:connect; MCP parity implementation is intentionally
 * tracked in WU-1983 (INIT-033 phase sequence).
 * WU-2275: CLI added lumenflow:pre-commit-check for local hook/CI delegation.
 * No MCP exposure required because this command is intentionally local-only.
 */

// Re-export shared types and helpers
export type { ToolResult, ToolDefinition } from './tools-shared.js';

// Re-export domain tools -- context/read operations
export { contextGetTool, wuListTool } from './tools/context-tools.js';

// Re-export domain tools -- WU lifecycle
export {
  wuStatusTool,
  wuCreateTool,
  wuClaimTool,
  wuSandboxTool,
  wuDoneTool,
  gatesRunTool,
  wuBlockTool,
  wuUnblockTool,
  wuEditTool,
  wuReleaseTool,
  wuRecoverTool,
  wuRepairTool,
  wuDepsTool,
  wuPrepTool,
  wuPreflightTool,
  wuPruneTool,
  wuDeleteTool,
  wuCleanupTool,
  wuBriefTool,
  wuDelegateTool,
  wuValidateTool,
  wuInferLaneTool,
  wuUnlockLaneTool,
} from './tools/wu-tools.js';

// Re-export runtime tracer-bullet tools
export {
  taskBlockTool,
  taskClaimTool,
  taskCompleteTool,
  taskCreateTool,
  taskInspectTool,
  taskToolExecuteTool,
  taskUnblockTool,
} from './tools/runtime-task-tools.js';

// Re-export domain tools -- initiative
export {
  initiativeListTool,
  initiativeStatusTool,
  initiativeCreateTool,
  initiativeEditTool,
  initiativeAddWuTool,
  initiativeRemoveWuTool,
  initiatiBulkAssignTool,
  initiativePlanTool,
} from './tools/initiative-tools.js';

// Re-export domain tools -- memory
export {
  memInitTool,
  memStartTool,
  memReadyTool,
  memCheckpointTool,
  memCleanupTool,
  memContextTool,
  memCreateTool,
  memDeleteTool,
  memExportTool,
  memInboxTool,
  memSignalTool,
  memSummarizeTool,
  memTriageTool,
  memRecoverTool,
} from './tools/memory-tools.js';

// Re-export domain tools -- agent
export {
  agentSessionTool,
  agentSessionEndTool,
  agentLogIssueTool,
  agentIssuesQueryTool,
} from './tools/agent-tools.js';

// Re-export domain tools -- orchestration + delegation
export {
  orchestrateInitiativeTool,
  orchestrateInitStatusTool,
  orchestrateMonitorTool,
  delegationListTool,
} from './tools/orchestration-tools.js';

// Re-export domain tools -- flow/metrics
export {
  flowBottlenecksTool,
  flowReportTool,
  metricsSnapshotTool,
  lumenflowMetricsTool,
  metricsTool,
} from './tools/flow-tools.js';

// Re-export domain tools -- validation
export {
  validateTool,
  validateAgentSkillsTool,
  validateAgentSyncTool,
  validateBacklogSyncTool,
  validateSkillsSpecTool,
  lumenflowValidateTool,
} from './tools/validation-tools.js';

// Re-export domain tools -- setup
export {
  lumenflowInitTool,
  lumenflowDoctorTool,
  lumenflowIntegrateTool,
  lumenflowUpgradeTool,
  lumenflowCommandsTool,
  lumenflowDocsSyncTool,
  lumenflowReleaseTool,
  lumenflowSyncTemplatesTool,
} from './tools/setup-tools.js';

// Re-export domain tools -- wave-1/wave-2 parity
export {
  backlogPruneTool,
  docsSyncTool,
  gatesTool,
  gatesDocsTool,
  laneHealthTool,
  laneSuggestTool,
  lumenflowTool,
  lumenflowGatesTool,
  stateBootstrapTool,
  stateCleanupTool,
  stateDoctorTool,
  syncTemplatesTool,
  fileReadTool,
  fileWriteTool,
  fileEditTool,
  fileDeleteTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitBranchTool,
  initPlanTool,
  planCreateTool,
  planEditTool,
  planLinkTool,
  planPromoteTool,
  signalCleanupTool,
  configSetTool,
  configGetTool,
  cloudConnectTool,
  onboardTool,
  lumenflowOnboardTool,
  workspaceInitTool,
  wuProtoTool,
} from './tools/parity-tools.js';

// Import all tools for the allTools array
import type { ToolDefinition } from './tools-shared.js';
import { contextGetTool, wuListTool } from './tools/context-tools.js';
import {
  wuStatusTool,
  wuCreateTool,
  wuClaimTool,
  wuSandboxTool,
  wuDoneTool,
  gatesRunTool,
  wuBlockTool,
  wuUnblockTool,
  wuEditTool,
  wuReleaseTool,
  wuRecoverTool,
  wuRepairTool,
  wuDepsTool,
  wuPrepTool,
  wuPreflightTool,
  wuPruneTool,
  wuDeleteTool,
  wuCleanupTool,
  wuBriefTool,
  wuDelegateTool,
  wuValidateTool,
  wuInferLaneTool,
  wuUnlockLaneTool,
} from './tools/wu-tools.js';
import {
  taskBlockTool,
  taskClaimTool,
  taskCompleteTool,
  taskCreateTool,
  taskInspectTool,
  taskToolExecuteTool,
  taskUnblockTool,
} from './tools/runtime-task-tools.js';
import { RuntimeTaskToolNames } from './tools/runtime-task-constants.js';
import {
  initiativeListTool,
  initiativeStatusTool,
  initiativeCreateTool,
  initiativeEditTool,
  initiativeAddWuTool,
  initiativeRemoveWuTool,
  initiatiBulkAssignTool,
  initiativePlanTool,
} from './tools/initiative-tools.js';
import {
  memInitTool,
  memStartTool,
  memReadyTool,
  memCheckpointTool,
  memCleanupTool,
  memContextTool,
  memCreateTool,
  memDeleteTool,
  memExportTool,
  memInboxTool,
  memSignalTool,
  memSummarizeTool,
  memTriageTool,
  memRecoverTool,
} from './tools/memory-tools.js';
import {
  agentSessionTool,
  agentSessionEndTool,
  agentLogIssueTool,
  agentIssuesQueryTool,
} from './tools/agent-tools.js';
import {
  orchestrateInitiativeTool,
  orchestrateInitStatusTool,
  orchestrateMonitorTool,
  delegationListTool,
} from './tools/orchestration-tools.js';
import {
  flowBottlenecksTool,
  flowReportTool,
  metricsSnapshotTool,
  lumenflowMetricsTool,
  metricsTool,
} from './tools/flow-tools.js';
import {
  validateTool,
  validateAgentSkillsTool,
  validateAgentSyncTool,
  validateBacklogSyncTool,
  validateSkillsSpecTool,
  lumenflowValidateTool,
} from './tools/validation-tools.js';
import {
  lumenflowInitTool,
  lumenflowDoctorTool,
  lumenflowIntegrateTool,
  lumenflowUpgradeTool,
  lumenflowCommandsTool,
  lumenflowDocsSyncTool,
  lumenflowReleaseTool,
  lumenflowSyncTemplatesTool,
} from './tools/setup-tools.js';
import {
  backlogPruneTool,
  docsSyncTool,
  gatesTool,
  gatesDocsTool,
  laneHealthTool,
  laneSuggestTool,
  lumenflowTool,
  lumenflowGatesTool,
  stateBootstrapTool,
  stateCleanupTool,
  stateDoctorTool,
  syncTemplatesTool,
  fileReadTool,
  fileWriteTool,
  fileEditTool,
  fileDeleteTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitBranchTool,
  initPlanTool,
  planCreateTool,
  planEditTool,
  planLinkTool,
  planPromoteTool,
  signalCleanupTool,
  configSetTool,
  configGetTool,
  cloudConnectTool,
  onboardTool,
  lumenflowOnboardTool,
  workspaceInitTool,
  wuProtoTool,
} from './tools/parity-tools.js';

/**
 * MCP parity exclusions for tools that are intentionally MCP-only or maintainer-only.
 *
 * These names are excluded from strict public CLI parity comparison because
 * they have no public command in packages/@lumenflow/cli/src/public-manifest.ts.
 */
export const MCP_PUBLIC_PARITY_ALLOWED_EXTRA_TOOLS = [
  'context_get',
  'gates_run',
  'initiative_remove_wu',
  RuntimeTaskToolNames.TASK_BLOCK,
  RuntimeTaskToolNames.TASK_COMPLETE,
  RuntimeTaskToolNames.TASK_CREATE,
  RuntimeTaskToolNames.TASK_INSPECT,
  RuntimeTaskToolNames.TASK_UNBLOCK,
  RuntimeTaskToolNames.TOOL_EXECUTE,
  'validate_agent_skills',
  'validate_agent_sync',
  'validate_backlog_sync',
  'validate_skills_spec',
  'wu_list',
] as const;

/**
 * Public CLI commands intentionally out of MCP scope.
 *
 * These normalized command names are excluded from the "missing" parity
 * calculation so MCP parity reflects the supported public MCP surface.
 */
export const MCP_PUBLIC_PARITY_ALLOWED_MISSING_TOOLS = [
  'lane_create',
  'lane_edit',
  'lane_lock',
  'lane_setup',
  'lane_status',
  'lane_validate',
  'pack_scaffold',
] as const;

export interface McpManifestParityReport {
  missing: string[];
  allowedExtra: string[];
  unexpectedExtra: string[];
}

/**
 * Normalize public CLI command names to MCP tool naming.
 *
 * Example:
 * - "wu:create" -> "wu_create"
 * - "plan:promote" -> "plan_promote"
 */
export function normalizePublicManifestCommandName(commandName: string): string {
  return commandName.replace(/[:-]/g, '_');
}

/**
 * Compare public CLI manifest command names against MCP tool names.
 */
export function buildMcpManifestParityReport(
  manifestCommandNames: readonly string[],
  mcpToolNames: readonly string[],
): McpManifestParityReport {
  const normalizedManifest = new Set(
    manifestCommandNames.map((commandName) => normalizePublicManifestCommandName(commandName)),
  );
  const mcpToolSet = new Set(mcpToolNames);
  const allowedExtraSet = new Set<string>(MCP_PUBLIC_PARITY_ALLOWED_EXTRA_TOOLS);
  const allowedMissingSet = new Set<string>(MCP_PUBLIC_PARITY_ALLOWED_MISSING_TOOLS);

  const missing = [...normalizedManifest]
    .filter((name) => !mcpToolSet.has(name) && !allowedMissingSet.has(name))
    .sort();
  const allowedExtra = [...mcpToolSet]
    .filter((name) => !normalizedManifest.has(name) && allowedExtraSet.has(name))
    .sort();
  const unexpectedExtra = [...mcpToolSet]
    .filter((name) => !normalizedManifest.has(name) && !allowedExtraSet.has(name))
    .sort();

  return { missing, allowedExtra, unexpectedExtra };
}

/**
 * All available tools
 */
export const allTools: ToolDefinition[] = [
  contextGetTool,
  wuListTool,
  wuStatusTool,
  wuCreateTool,
  wuClaimTool,
  wuSandboxTool,
  wuDoneTool,
  gatesRunTool,
  // WU-1482: Wave-1 public parity tools
  backlogPruneTool,
  docsSyncTool,
  gatesTool,
  gatesDocsTool,
  laneHealthTool,
  laneSuggestTool,
  lumenflowTool,
  lumenflowGatesTool,
  lumenflowValidateTool,
  lumenflowMetricsTool,
  metricsTool,
  stateBootstrapTool,
  stateCleanupTool,
  stateDoctorTool,
  syncTemplatesTool,
  // WU-1483: Wave-2 public parity tools
  fileReadTool,
  fileWriteTool,
  fileEditTool,
  fileDeleteTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitBranchTool,
  initPlanTool,
  planCreateTool,
  planEditTool,
  planLinkTool,
  planPromoteTool,
  signalCleanupTool,
  // WU-1902: Config tools
  configSetTool,
  configGetTool,
  // WU-1983: Bootstrap/cloud parity tools
  cloudConnectTool,
  onboardTool,
  lumenflowOnboardTool,
  workspaceInitTool,
  wuProtoTool,
  // WU-1422: Additional WU tools
  wuBlockTool,
  wuUnblockTool,
  wuEditTool,
  wuReleaseTool,
  wuRecoverTool,
  wuRepairTool,
  wuDepsTool,
  wuPrepTool,
  wuPreflightTool,
  wuPruneTool,
  wuDeleteTool,
  wuCleanupTool,
  wuBriefTool,
  wuDelegateTool,
  wuValidateTool,
  wuInferLaneTool,
  wuUnlockLaneTool,
  // WU-1424: Initiative tools
  initiativeListTool,
  initiativeStatusTool,
  initiativeCreateTool,
  initiativeEditTool,
  initiativeAddWuTool,
  initiativeRemoveWuTool,
  initiatiBulkAssignTool,
  initiativePlanTool,
  // WU-1424: Memory tools
  memInitTool,
  memStartTool,
  memReadyTool,
  memCheckpointTool,
  memCleanupTool,
  memContextTool,
  memCreateTool,
  memDeleteTool,
  memExportTool,
  memInboxTool,
  memSignalTool,
  memSummarizeTool,
  memTriageTool,
  memRecoverTool,
  // WU-1425: Agent tools
  agentSessionTool,
  agentSessionEndTool,
  agentLogIssueTool,
  agentIssuesQueryTool,
  // WU-1425: Orchestration tools
  orchestrateInitiativeTool,
  orchestrateInitStatusTool,
  orchestrateMonitorTool,
  // WU-1425: Delegation tools
  delegationListTool,
  // WU-1426: Flow/Metrics tools
  flowBottlenecksTool,
  flowReportTool,
  metricsSnapshotTool,
  // WU-1426: Validation tools
  validateTool,
  validateAgentSkillsTool,
  validateAgentSyncTool,
  validateBacklogSyncTool,
  validateSkillsSpecTool,
  // WU-1426: Setup tools
  lumenflowInitTool,
  lumenflowDoctorTool,
  lumenflowIntegrateTool,
  lumenflowUpgradeTool,
  lumenflowCommandsTool,
  lumenflowDocsSyncTool,
  lumenflowReleaseTool,
  lumenflowSyncTemplatesTool,
];

/**
 * Runtime-backed additive MCP tools.
 *
 * These are intentionally isolated from legacy CLI-shell tools so we can
 * migrate command-by-command without breaking parity gates.
 *
 * NOTE:
 * `allTools` remains the legacy parity baseline for strict CLI parity checks
 * that intentionally ignore runtime migration deltas.
 *
 * Phase-4 closure metrics use `registeredTools` (production registry) so
 * runtime-migrated tools are measured against the real server surface.
 */
export const runtimeTaskTools: ToolDefinition[] = [
  taskClaimTool,
  taskCreateTool,
  taskCompleteTool,
  taskBlockTool,
  taskUnblockTool,
  taskInspectTool,
  taskToolExecuteTool,
];

/**
 * Production MCP registry consumed by server startup.
 */
export const registeredTools: ToolDefinition[] = [...allTools, ...runtimeTaskTools];

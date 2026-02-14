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
  wuProtoTool,
} from './tools/parity-tools.js';

// Import all tools for the allTools array
import type { ToolDefinition } from './tools-shared.js';
import { contextGetTool, wuListTool } from './tools/context-tools.js';
import {
  wuStatusTool,
  wuCreateTool,
  wuClaimTool,
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
  'validate_agent_skills',
  'validate_agent_sync',
  'validate_backlog_sync',
  'validate_skills_spec',
  'wu_list',
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

  const missing = [...normalizedManifest].filter((name) => !mcpToolSet.has(name)).sort();
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

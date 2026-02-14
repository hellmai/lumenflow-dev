/**
 * @file schemas/index.ts
 * @description Shared command schemas and utilities for CLI/MCP parity (WU-1431, WU-1454, WU-1455, WU-1456, WU-1457)
 *
 * This module exports:
 * - Zod schemas for all commands (wu:create, wu:claim, wu:status, wu:done, gates) (WU-1431)
 * - Zod schemas for 16 WU lifecycle commands (WU-1454)
 * - Zod schemas for 8 initiative commands (WU-1455)
 * - Zod schemas for 13 memory commands (WU-1456)
 * - Zod schemas for 4 flow/metrics commands (WU-1457)
 * - Zod schemas for 5 validation commands (WU-1457)
 * - Zod schemas for 18 setup/agent/orchestration/delegation commands (WU-1457)
 * - MCP inputSchema generation utilities
 * - CLI option generation utilities
 * - CLI argument validators
 * - Parity validation utilities
 */

// Command schemas (WU-1431: 5 original commands)
export {
  // Schemas
  wuCreateSchema,
  wuClaimSchema,
  wuStatusSchema,
  wuDoneSchema,
  gatesSchema,
  // Enums
  exposureEnum,
  wuStatusEnum,
  // Types
  type WuCreateInput,
  type WuClaimInput,
  type WuStatusInput,
  type WuDoneInput,
  type GatesInput,
  type Exposure,
  type WuStatus,
  // Registry
  commandSchemas,
  type CommandName,
} from './command-schemas.js';

// WU Lifecycle schemas (WU-1454: 16 lifecycle commands)
export {
  // Schemas
  wuBlockSchema,
  wuUnblockSchema,
  wuEditSchema,
  wuReleaseSchema,
  wuRecoverSchema,
  wuRepairSchema,
  wuDepsSchema,
  wuPrepSchema,
  wuPreflightSchema,
  wuPruneSchema,
  wuDeleteSchema,
  wuCleanupSchema,
  wuSpawnSchema,
  wuValidateSchema,
  wuInferLaneSchema,
  wuUnlockLaneSchema,
  // Types
  type WuBlockInput,
  type WuUnblockInput,
  type WuEditInput,
  type WuReleaseInput,
  type WuRecoverInput,
  type WuRepairInput,
  type WuDepsInput,
  type WuPrepInput,
  type WuPreflightInput,
  type WuPruneInput,
  type WuDeleteInput,
  type WuCleanupInput,
  type WuSpawnInput,
  type WuValidateInput,
  type WuInferLaneInput,
  type WuUnlockLaneInput,
  // Registry
  lifecycleCommandSchemas,
  type LifecycleCommandName,
} from './wu-lifecycle-schemas.js';

// Schema utilities
export {
  // MCP utilities
  zodToMcpInputSchema,
  // CLI utilities
  zodToCliOptions,
  getCliOnlyAliases,
  // Parity validation
  validateCliMcpParity,
  // Types
  type JsonSchema,
  type JsonSchemaProperty,
  type CliOption,
  type CliAlias,
  type ParityValidationResult,
} from './schema-utils.js';

// Argument validators (WU-1431: 5 original commands)
export {
  validateWuCreateArgs,
  validateWuClaimArgs,
  validateWuStatusArgs,
  validateWuDoneArgs,
  validateGatesArgs,
  // Renamed to avoid conflict with validation/index.js ValidationResult
  type ValidationResult as ArgValidationResult,
} from './arg-validators.js';

// WU Lifecycle argument validators (WU-1454: 16 lifecycle commands)
export {
  validateWuBlockArgs,
  validateWuUnblockArgs,
  validateWuEditArgs,
  validateWuReleaseArgs,
  validateWuRecoverArgs,
  validateWuRepairArgs,
  validateWuDepsArgs,
  validateWuPrepArgs,
  validateWuPreflightArgs,
  validateWuPruneArgs,
  validateWuDeleteArgs,
  validateWuCleanupArgs,
  validateWuBriefArgs,
  validateWuSpawnArgs,
  validateWuValidateArgs,
  validateWuInferLaneArgs,
  validateWuUnlockLaneArgs,
} from './wu-lifecycle-arg-validators.js';

// Initiative schemas (WU-1455: 8 initiative commands)
export {
  // Schemas
  initiativeCreateSchema,
  initiativeEditSchema,
  initiativeListSchema,
  initiativeStatusSchema,
  initiativeAddWuSchema,
  initiativeRemoveWuSchema,
  initiativeBulkAssignSchema,
  initiativePlanSchema,
  // Enums
  initiativeStatusEnum,
  phaseStatusEnum,
  outputFormatEnum,
  // Types
  type InitiativeCreateInput,
  type InitiativeEditInput,
  type InitiativeListInput,
  type InitiativeStatusInput,
  type InitiativeAddWuInput,
  type InitiativeRemoveWuInput,
  type InitiativeBulkAssignInput,
  type InitiativePlanInput,
  type InitiativeStatus,
  type PhaseStatus,
  // Registry
  initiativeCommandSchemas,
  type InitiativeCommandName,
} from './initiative-schemas.js';

// Initiative argument validators (WU-1455: 8 initiative commands)
export {
  validateInitiativeCreateArgs,
  validateInitiativeEditArgs,
  validateInitiativeListArgs,
  validateInitiativeStatusArgs,
  validateInitiativeAddWuArgs,
  validateInitiativeRemoveWuArgs,
  validateInitiativeBulkAssignArgs,
  validateInitiativePlanArgs,
} from './initiative-arg-validators.js';

// Memory schemas (WU-1456: 13 memory commands)
export {
  // Schemas
  memInitSchema,
  memStartSchema,
  memReadySchema,
  memCheckpointSchema,
  memCleanupSchema,
  memContextSchema,
  memCreateSchema,
  memDeleteSchema,
  memExportSchema,
  memInboxSchema,
  memSignalSchema,
  memSummarizeSchema,
  memTriageSchema,
  // Types
  type MemInitInput,
  type MemStartInput,
  type MemReadyInput,
  type MemCheckpointInput,
  type MemCleanupInput,
  type MemContextInput,
  type MemCreateInput,
  type MemDeleteInput,
  type MemExportInput,
  type MemInboxInput,
  type MemSignalInput,
  type MemSummarizeInput,
  type MemTriageInput,
  // Registry
  memoryCommandSchemas,
  type MemoryCommandName,
} from './memory-schemas.js';

// Memory argument validators (WU-1456: 13 memory commands)
export {
  validateMemInitArgs,
  validateMemStartArgs,
  validateMemReadyArgs,
  validateMemCheckpointArgs,
  validateMemCleanupArgs,
  validateMemContextArgs,
  validateMemCreateArgs,
  validateMemDeleteArgs,
  validateMemExportArgs,
  validateMemInboxArgs,
  validateMemSignalArgs,
  validateMemSummarizeArgs,
  validateMemTriageArgs,
} from './memory-arg-validators.js';

// Flow schemas (WU-1457: 4 flow/metrics commands)
export {
  // Schemas
  flowBottlenecksSchema,
  flowReportSchema,
  metricsSnapshotSchema,
  metricsSchema,
  // Types
  type FlowBottlenecksInput,
  type FlowReportInput,
  type MetricsSnapshotInput,
  type MetricsInput,
  // Registry
  flowCommandSchemas,
  type FlowCommandName,
} from './flow-schemas.js';

// Flow argument validators (WU-1457: 4 flow/metrics commands)
export {
  validateFlowBottlenecksArgs,
  validateFlowReportArgs,
  validateMetricsSnapshotArgs,
  validateMetricsArgs,
} from './flow-arg-validators.js';

// Validation schemas (WU-1457: 5 validation commands)
export {
  // Schemas
  validateSchema,
  validateAgentSkillsSchema,
  validateAgentSyncSchema,
  validateBacklogSyncSchema,
  validateSkillsSpecSchema,
  // Types
  type ValidateInput,
  type ValidateAgentSkillsInput,
  type ValidateAgentSyncInput,
  type ValidateBacklogSyncInput,
  type ValidateSkillsSpecInput,
  // Registry
  validationCommandSchemas,
  type ValidationCommandName,
} from './validation-schemas.js';

// Validation argument validators (WU-1457: 5 validation commands)
export {
  validateValidateArgs,
  validateValidateAgentSkillsArgs,
  validateValidateAgentSyncArgs,
  validateValidateBacklogSyncArgs,
  validateValidateSkillsSpecArgs,
} from './validation-arg-validators.js';

// Setup + Agent + Orchestration + Delegation schemas (WU-1457: 18 commands)
export {
  // Setup schemas
  lumenflowInitSchema,
  lumenflowDoctorSchema,
  lumenflowIntegrateSchema,
  lumenflowUpgradeSchema,
  lumenflowCommandsSchema,
  docsSyncSchema,
  releaseSchema,
  syncTemplatesSchema,
  // Agent schemas
  agentSessionSchema,
  agentSessionEndSchema,
  agentLogIssueSchema,
  agentIssuesQuerySchema,
  // Orchestration schemas
  orchestrateInitiativeSchema,
  orchestrateInitStatusSchema,
  orchestrateMonitorSchema,
  // Delegation schemas
  delegationListSchema,
  // Coordination schemas
  sessionCoordinatorSchema,
  rotateProgressSchema,
  // Types
  type LumenflowInitInput,
  type LumenflowDoctorInput,
  type LumenflowIntegrateInput,
  type LumenflowUpgradeInput,
  type LumenflowCommandsInput,
  type DocsSyncInput,
  type ReleaseInput,
  type SyncTemplatesInput,
  type AgentSessionInput,
  type AgentSessionEndInput,
  type AgentLogIssueInput,
  type AgentIssuesQueryInput,
  type OrchestrateInitiativeInput,
  type OrchestrateInitStatusInput,
  type OrchestrateMonitorInput,
  type DelegationListInput,
  type SessionCoordinatorInput,
  type RotateProgressInput,
  // Registry
  setupCommandSchemas,
  type SetupCommandName,
} from './setup-schemas.js';

// Setup + Agent + Orchestration + Delegation argument validators (WU-1457: 18 commands)
export {
  validateLumenflowInitArgs,
  validateLumenflowDoctorArgs,
  validateLumenflowIntegrateArgs,
  validateLumenflowUpgradeArgs,
  validateLumenflowCommandsArgs,
  validateDocsSyncArgs,
  validateReleaseArgs,
  validateSyncTemplatesArgs,
  validateAgentSessionArgs,
  validateAgentSessionEndArgs,
  validateAgentLogIssueArgs,
  validateAgentIssuesQueryArgs,
  validateOrchestrateInitiativeArgs,
  validateOrchestrateInitStatusArgs,
  validateOrchestrateMonitorArgs,
  validateDelegationListArgs,
  validateSessionCoordinatorArgs,
  validateRotateProgressArgs,
} from './setup-arg-validators.js';

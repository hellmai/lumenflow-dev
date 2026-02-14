/**
 * @file setup-arg-validators.ts
 * @description CLI argument validators for setup, agent, orchestration, delegation, and coordination
 * commands using shared schemas (WU-1457)
 *
 * These validators use the shared Zod schemas to validate CLI arguments for the
 * 18 setup/agent/orchestration/delegation/coordination commands. They follow the same
 * pattern as memory-arg-validators.ts (WU-1456).
 */

import {
  lumenflowInitSchema,
  lumenflowDoctorSchema,
  lumenflowIntegrateSchema,
  lumenflowUpgradeSchema,
  lumenflowCommandsSchema,
  docsSyncSchema,
  releaseSchema,
  syncTemplatesSchema,
  agentSessionSchema,
  agentSessionEndSchema,
  agentLogIssueSchema,
  agentIssuesQuerySchema,
  orchestrateInitiativeSchema,
  orchestrateInitStatusSchema,
  orchestrateMonitorSchema,
  delegationListSchema,
  sessionCoordinatorSchema,
  rotateProgressSchema,
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
} from './setup-schemas.js';

import type { ValidationResult } from './arg-validators.js';

// =============================================================================
// Zod Error Formatting (shared with arg-validators.ts)
// =============================================================================

/**
 * Zod error issue interface (compatible with both Zod 3 and 4)
 */
interface ZodIssue {
  path: (string | number | symbol)[];
  message: string;
  code?: string;
}

interface ZodErrorLike {
  issues: ZodIssue[];
}

function formatZodErrors(error: ZodErrorLike): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.filter((p): p is string | number => typeof p !== 'symbol').join('.');
    if (issue.code === 'invalid_type' && issue.message.includes('received undefined')) {
      return `${path} is required`;
    }
    if (issue.message === 'Required') {
      return `${path} is required`;
    }
    return `${path}: ${issue.message}`;
  });
}

// =============================================================================
// Generic Validator Factory
// =============================================================================

/**
 * Zod safeParse result type (compatible with both Zod 3 and 4)
 */
interface ZodSafeParseResult<T> {
  success: boolean;
  data?: T;
  error?: ZodErrorLike;
}

/**
 * Create a validator function from a Zod schema
 */
function createValidator<T>(schema: {
  safeParse: (data: unknown) => ZodSafeParseResult<T>;
}): (args: Record<string, unknown>) => ValidationResult<T> {
  return (args: Record<string, unknown>): ValidationResult<T> => {
    const result = schema.safeParse(args);

    if (result.success && result.data !== undefined) {
      return {
        valid: true,
        errors: [],
        warnings: [],
        normalized: result.data,
      };
    }

    return {
      valid: false,
      errors: result.error ? formatZodErrors(result.error) : ['Validation failed'],
      warnings: [],
      normalized: args as T,
    };
  };
}

// =============================================================================
// Setup Validators
// =============================================================================

/** Validate lumenflow:init arguments */
export const validateLumenflowInitArgs = createValidator<LumenflowInitInput>(lumenflowInitSchema);

/** Validate lumenflow:doctor arguments */
export const validateLumenflowDoctorArgs =
  createValidator<LumenflowDoctorInput>(lumenflowDoctorSchema);

/** Validate lumenflow:integrate arguments */
export const validateLumenflowIntegrateArgs =
  createValidator<LumenflowIntegrateInput>(lumenflowIntegrateSchema);

/** Validate lumenflow:upgrade arguments */
export const validateLumenflowUpgradeArgs =
  createValidator<LumenflowUpgradeInput>(lumenflowUpgradeSchema);

/** Validate lumenflow:commands arguments */
export const validateLumenflowCommandsArgs =
  createValidator<LumenflowCommandsInput>(lumenflowCommandsSchema);

/** Validate docs:sync arguments */
export const validateDocsSyncArgs = createValidator<DocsSyncInput>(docsSyncSchema);

/** Validate release arguments */
export const validateReleaseArgs = createValidator<ReleaseInput>(releaseSchema);

/** Validate sync:templates arguments */
export const validateSyncTemplatesArgs = createValidator<SyncTemplatesInput>(syncTemplatesSchema);

// =============================================================================
// Agent Validators
// =============================================================================

/** Validate agent:session arguments */
export const validateAgentSessionArgs = createValidator<AgentSessionInput>(agentSessionSchema);

/** Validate agent:session:end arguments */
export const validateAgentSessionEndArgs =
  createValidator<AgentSessionEndInput>(agentSessionEndSchema);

/** Validate agent:log-issue arguments */
export const validateAgentLogIssueArgs = createValidator<AgentLogIssueInput>(agentLogIssueSchema);

/** Validate agent:issues-query arguments */
export const validateAgentIssuesQueryArgs =
  createValidator<AgentIssuesQueryInput>(agentIssuesQuerySchema);

// =============================================================================
// Orchestration Validators
// =============================================================================

/** Validate orchestrate:initiative arguments */
export const validateOrchestrateInitiativeArgs = createValidator<OrchestrateInitiativeInput>(
  orchestrateInitiativeSchema,
);

/** Validate orchestrate:init-status arguments */
export const validateOrchestrateInitStatusArgs = createValidator<OrchestrateInitStatusInput>(
  orchestrateInitStatusSchema,
);

/** Validate orchestrate:monitor arguments */
export const validateOrchestrateMonitorArgs =
  createValidator<OrchestrateMonitorInput>(orchestrateMonitorSchema);

// =============================================================================
// Delegation Validators
// =============================================================================

/** Validate delegation:list arguments */
export const validateDelegationListArgs =
  createValidator<DelegationListInput>(delegationListSchema);

// =============================================================================
// Coordination Validators
// =============================================================================

/** Validate session:coordinator arguments */
export const validateSessionCoordinatorArgs =
  createValidator<SessionCoordinatorInput>(sessionCoordinatorSchema);

/** Validate rotate:progress arguments */
export const validateRotateProgressArgs =
  createValidator<RotateProgressInput>(rotateProgressSchema);

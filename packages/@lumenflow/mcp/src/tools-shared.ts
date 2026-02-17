/**
 * @file tools-shared.ts
 * @description Shared types, constants, error codes, and helpers used across MCP tool domain modules.
 *
 * WU-1642: Extracted from tools.ts during domain decomposition.
 */

import { z } from 'zod';
import { runCliCommand, type CliRunnerOptions } from './cli-runner.js';

// Import core functions for context operations only (async to avoid circular deps)
let coreModule: typeof import('@lumenflow/core') | null = null;

export async function getCore() {
  if (!coreModule) {
    coreModule = await import('@lumenflow/core');
  }
  return coreModule;
}

/**
 * Tool result structure matching MCP SDK expectations
 */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: {
    message: string;
    code?: string;
  };
}

/**
 * Base tool definition
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  execute: (
    input: Record<string, unknown>,
    options?: { projectRoot?: string },
  ) => Promise<ToolResult>;
}

/**
 * Error codes used by tool implementations
 */
export const ErrorCodes = {
  MISSING_PARAMETER: 'MISSING_PARAMETER',
  CONTEXT_ERROR: 'CONTEXT_ERROR',
  WU_LIST_ERROR: 'WU_LIST_ERROR',
  WU_STATUS_ERROR: 'WU_STATUS_ERROR',
  WU_CREATE_ERROR: 'WU_CREATE_ERROR',
  WU_CLAIM_ERROR: 'WU_CLAIM_ERROR',
  WU_DONE_ERROR: 'WU_DONE_ERROR',
  WRONG_LOCATION: 'WRONG_LOCATION',
  GATES_ERROR: 'GATES_ERROR',
  WU_BLOCK_ERROR: 'WU_BLOCK_ERROR',
  WU_UNBLOCK_ERROR: 'WU_UNBLOCK_ERROR',
  WU_EDIT_ERROR: 'WU_EDIT_ERROR',
  WU_RELEASE_ERROR: 'WU_RELEASE_ERROR',
  WU_RECOVER_ERROR: 'WU_RECOVER_ERROR',
  WU_REPAIR_ERROR: 'WU_REPAIR_ERROR',
  WU_DEPS_ERROR: 'WU_DEPS_ERROR',
  WU_PREP_ERROR: 'WU_PREP_ERROR',
  WU_PREFLIGHT_ERROR: 'WU_PREFLIGHT_ERROR',
  WU_PRUNE_ERROR: 'WU_PRUNE_ERROR',
  WU_DELETE_ERROR: 'WU_DELETE_ERROR',
  WU_CLEANUP_ERROR: 'WU_CLEANUP_ERROR',
  WU_BRIEF_ERROR: 'WU_BRIEF_ERROR',
  WU_DELEGATE_ERROR: 'WU_DELEGATE_ERROR',
  WU_VALIDATE_ERROR: 'WU_VALIDATE_ERROR',
  WU_INFER_LANE_ERROR: 'WU_INFER_LANE_ERROR',
  WU_UNLOCK_LANE_ERROR: 'WU_UNLOCK_LANE_ERROR',
  TASK_CLAIM_ERROR: 'TASK_CLAIM_ERROR',
  TASK_CREATE_ERROR: 'TASK_CREATE_ERROR',
  BACKLOG_PRUNE_ERROR: 'BACKLOG_PRUNE_ERROR',
  DOCS_SYNC_ERROR: 'DOCS_SYNC_ERROR',
  GATES_ALIAS_ERROR: 'GATES_ALIAS_ERROR',
  LANE_HEALTH_ERROR: 'LANE_HEALTH_ERROR',
  LANE_SUGGEST_ERROR: 'LANE_SUGGEST_ERROR',
  LUMENFLOW_ALIAS_ERROR: 'LUMENFLOW_ALIAS_ERROR',
  LUMENFLOW_GATES_ERROR: 'LUMENFLOW_GATES_ERROR',
  LUMENFLOW_VALIDATE_ERROR: 'LUMENFLOW_VALIDATE_ERROR',
  LUMENFLOW_METRICS_ERROR: 'LUMENFLOW_METRICS_ERROR',
  METRICS_ERROR: 'METRICS_ERROR',
  STATE_BOOTSTRAP_ERROR: 'STATE_BOOTSTRAP_ERROR',
  STATE_CLEANUP_ERROR: 'STATE_CLEANUP_ERROR',
  STATE_DOCTOR_ERROR: 'STATE_DOCTOR_ERROR',
  SYNC_TEMPLATES_ALIAS_ERROR: 'SYNC_TEMPLATES_ALIAS_ERROR',
  FILE_READ_ERROR: 'FILE_READ_ERROR',
  FILE_WRITE_ERROR: 'FILE_WRITE_ERROR',
  FILE_EDIT_ERROR: 'FILE_EDIT_ERROR',
  FILE_DELETE_ERROR: 'FILE_DELETE_ERROR',
  GIT_STATUS_ERROR: 'GIT_STATUS_ERROR',
  GIT_DIFF_ERROR: 'GIT_DIFF_ERROR',
  GIT_LOG_ERROR: 'GIT_LOG_ERROR',
  GIT_BRANCH_ERROR: 'GIT_BRANCH_ERROR',
  INIT_PLAN_ERROR: 'INIT_PLAN_ERROR',
  PLAN_CREATE_ERROR: 'PLAN_CREATE_ERROR',
  PLAN_EDIT_ERROR: 'PLAN_EDIT_ERROR',
  PLAN_LINK_ERROR: 'PLAN_LINK_ERROR',
  PLAN_PROMOTE_ERROR: 'PLAN_PROMOTE_ERROR',
  SIGNAL_CLEANUP_ERROR: 'SIGNAL_CLEANUP_ERROR',
  WU_PROTO_ERROR: 'WU_PROTO_ERROR',
  // WU-1426: Flow/Metrics error codes
  FLOW_BOTTLENECKS_ERROR: 'FLOW_BOTTLENECKS_ERROR',
  FLOW_REPORT_ERROR: 'FLOW_REPORT_ERROR',
  METRICS_SNAPSHOT_ERROR: 'METRICS_SNAPSHOT_ERROR',
  // WU-1426: Validation error codes
  VALIDATE_ERROR: 'VALIDATE_ERROR',
  VALIDATE_AGENT_SKILLS_ERROR: 'VALIDATE_AGENT_SKILLS_ERROR',
  VALIDATE_AGENT_SYNC_ERROR: 'VALIDATE_AGENT_SYNC_ERROR',
  VALIDATE_BACKLOG_SYNC_ERROR: 'VALIDATE_BACKLOG_SYNC_ERROR',
  VALIDATE_SKILLS_SPEC_ERROR: 'VALIDATE_SKILLS_SPEC_ERROR',
  // WU-1426: Setup error codes
  LUMENFLOW_INIT_ERROR: 'LUMENFLOW_INIT_ERROR',
  LUMENFLOW_DOCTOR_ERROR: 'LUMENFLOW_DOCTOR_ERROR',
  LUMENFLOW_INTEGRATE_ERROR: 'LUMENFLOW_INTEGRATE_ERROR',
  LUMENFLOW_UPGRADE_ERROR: 'LUMENFLOW_UPGRADE_ERROR',
  LUMENFLOW_COMMANDS_ERROR: 'LUMENFLOW_COMMANDS_ERROR',
  LUMENFLOW_DOCS_SYNC_ERROR: 'LUMENFLOW_DOCS_SYNC_ERROR',
  LUMENFLOW_RELEASE_ERROR: 'LUMENFLOW_RELEASE_ERROR',
  LUMENFLOW_SYNC_TEMPLATES_ERROR: 'LUMENFLOW_SYNC_TEMPLATES_ERROR',
} as const;

/**
 * Error messages used by tool implementations
 */
export const ErrorMessages = {
  ID_REQUIRED: 'id is required',
  LANE_REQUIRED: 'lane is required',
  TITLE_REQUIRED: 'title is required',
  PATH_REQUIRED: 'path is required',
  CONTENT_REQUIRED: 'content is required',
  OLD_STRING_REQUIRED: 'old_string is required',
  NEW_STRING_REQUIRED: 'new_string is required',
  REASON_REQUIRED: 'reason is required',
  CLIENT_REQUIRED: 'client is required',
  PARENT_WU_REQUIRED: 'parent_wu is required',
  SECTION_REQUIRED: 'section is required',
  PLAN_REQUIRED: 'plan is required',
} as const;

/**
 * CLI argument constants for commonly used flags
 */
export const CliArgs = {
  DESCRIPTION: '--description',
  INITIATIVE: '--initiative',
  PHASE: '--phase',
  JSON: '--json',
  DOCS_ONLY: '--docs-only',
  CODE_PATHS: '--code-paths',
  BASE_DIR: '--base-dir',
  ENCODING: '--encoding',
  // WU-1452: Commands using --format json (initiative:*, flow:*, metrics)
  FORMAT_JSON: ['--format', 'json'] as const,
  DRY_RUN: '--dry-run',
  THRESHOLD: '--threshold',
  RECOVER: '--recover',
  WU: '--wu',
} as const;

/**
 * Shared error messages to avoid duplication across different tool categories
 */
export const SharedErrorMessages = {
  WU_REQUIRED: 'wu is required',
  INITIATIVE_REQUIRED: 'initiative is required',
} as const;

export const SuccessMessages = {
  ALL_GATES_PASSED: 'All gates passed',
} as const;

/**
 * Create a successful tool result
 */
export function success(data: unknown): ToolResult {
  return { success: true, data };
}

/**
 * Create an error tool result
 */
export function error(message: string, code?: string): ToolResult {
  return { success: false, error: { message, code } };
}

export function buildGatesArgs(
  input: Record<string, unknown>,
  options: { forceDocsOnly?: boolean } = {},
): string[] {
  const args: string[] = [];
  if (options.forceDocsOnly || input.docs_only) args.push(CliArgs.DOCS_ONLY);
  if (input.full_lint) args.push('--full-lint');
  if (input.full_tests) args.push('--full-tests');
  if (input.full_coverage) args.push('--full-coverage');
  if (input.coverage_mode) args.push('--coverage-mode', input.coverage_mode as string);
  if (input.verbose) args.push('--verbose');
  return args;
}

export function buildMetricsArgs(input: Record<string, unknown>): string[] {
  const args: string[] = [];
  if (input.subcommand) args.push(input.subcommand as string);
  if (input.days !== undefined) args.push('--days', String(input.days));
  if (input.format) args.push('--format', input.format as string);
  if (input.output) args.push('--output', input.output as string);
  if (input.dry_run) args.push('--dry-run');
  return args;
}

/**
 * Build common argument list for wu:brief / wu:delegate prompt tools.
 */
export function buildWuPromptArgs(input: Record<string, unknown>): string[] {
  const args = ['--id', input.id as string];
  if (input.client) args.push('--client', input.client as string);
  if (input.thinking) args.push('--thinking');
  if (input.budget) args.push('--budget', String(input.budget));
  if (input.parent_wu) args.push('--parent-wu', input.parent_wu as string);
  if (input.no_context) args.push('--no-context');
  return args;
}

// Re-export cli-runner types used by domain modules
export { runCliCommand, type CliRunnerOptions };

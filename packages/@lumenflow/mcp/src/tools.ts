/**
 * @file tools.ts
 * @description MCP tool implementations for LumenFlow operations
 *
 * WU-1412: Tools available: context_get, wu_list, wu_status, wu_create, wu_claim, wu_done, gates_run
 * WU-1422: Additional WU tools: wu_block, wu_unblock, wu_edit, wu_release, wu_recover, wu_repair,
 *          wu_deps, wu_prep, wu_preflight, wu_prune, wu_delete, wu_cleanup, wu_validate,
 *          wu_infer_lane, wu_unlock_lane
 * WU-1424: Initiative tools: initiative_list, initiative_status, initiative_create, initiative_edit,
 *          initiative_add_wu, initiative_remove_wu, initiative_bulk_assign, initiative_plan
 *          Memory tools: mem_init, mem_start, mem_ready, mem_checkpoint, mem_cleanup, mem_context,
 *          mem_create, mem_delete, mem_export, mem_inbox, mem_signal, mem_summarize, mem_triage,
 *          mem_recover
 * WU-1425: Agent tools: agent_session, agent_session_end, agent_log_issue, agent_issues_query
 *          Orchestration tools: orchestrate_initiative, orchestrate_init_status, orchestrate_monitor
 *          Spawn tools: spawn_list
 * WU-1426: Flow/Metrics tools: flow_bottlenecks, flow_report, metrics_snapshot
 *          Validation tools: validate, validate_agent_skills, validate_agent_sync,
 *          validate_backlog_sync, validate_skills_spec
 *          Setup tools: lumenflow_init, lumenflow_doctor, lumenflow_integrate, lumenflow_upgrade,
 *          lumenflow_commands, lumenflow_docs_sync, lumenflow_release, lumenflow_sync_templates
 * WU-1431: Uses shared Zod schemas from @lumenflow/core for CLI/MCP parity
 * WU-1454: All 16 WU lifecycle commands now use shared schemas
 * WU-1456: Memory commands use shared schemas where available
 * WU-1457: All remaining commands (flow, validation, setup, agent, orchestration, spawn) use shared schemas
 *
 * Architecture:
 * - Read operations (context_get) use @lumenflow/core directly for context
 * - All other operations shell out to CLI for consistency and safety
 * - Input schemas are derived from shared schemas in @lumenflow/core (WU-1431, WU-1454)
 */

import { z } from 'zod';
import { runCliCommand, type CliRunnerOptions } from './cli-runner.js';

// WU-1431: Import shared command schemas for CLI/MCP parity
// WU-1454: Import WU lifecycle schemas for full coverage
// WU-1457: Import flow, validation, setup, agent, orchestration, spawn schemas
// These are the single source of truth for command validation
import {
  wuCreateSchema,
  wuClaimSchema,
  wuStatusSchema,
  wuDoneSchema,
  gatesSchema,
  wuStatusEnum,
  // WU-1454: Lifecycle command schemas
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
  // WU-1455: Initiative command schemas
  initiativeCreateSchema,
  initiativeEditSchema,
  initiativeListSchema,
  initiativeStatusSchema,
  initiativeAddWuSchema,
  initiativeRemoveWuSchema,
  initiativeBulkAssignSchema,
  initiativePlanSchema,
  // WU-1456: Memory command schemas
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
  // WU-1457: Flow/Metrics command schemas
  flowBottlenecksSchema,
  flowReportSchema,
  metricsSnapshotSchema,
  metricsSchema,
  // WU-1457: Validation command schemas
  validateSchema,
  validateAgentSkillsSchema,
  validateAgentSyncSchema,
  validateBacklogSyncSchema,
  validateSkillsSpecSchema,
  // WU-1457: Setup command schemas
  lumenflowInitSchema,
  lumenflowDoctorSchema,
  lumenflowIntegrateSchema,
  lumenflowUpgradeSchema,
  lumenflowCommandsSchema,
  docsSyncSchema,
  releaseSchema,
  syncTemplatesSchema,
  // WU-1457: Agent command schemas
  agentSessionSchema,
  agentSessionEndSchema,
  agentLogIssueSchema,
  agentIssuesQuerySchema,
  // WU-1457: Orchestration command schemas
  orchestrateInitiativeSchema,
  orchestrateInitStatusSchema,
  orchestrateMonitorSchema,
  // WU-1457: Spawn command schemas
  spawnListSchema,
} from '@lumenflow/core';

// Import core functions for context operations only (async to avoid circular deps)
let coreModule: typeof import('@lumenflow/core') | null = null;

async function getCore() {
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
const ErrorCodes = {
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
const ErrorMessages = {
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
const CliArgs = {
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
const SharedErrorMessages = {
  WU_REQUIRED: 'wu is required',
  INITIATIVE_REQUIRED: 'initiative is required',
} as const;

const SuccessMessages = {
  ALL_GATES_PASSED: 'All gates passed',
} as const;

// WU-1482: Schemas for wave-1 parity commands not yet modeled in @lumenflow/core
const backlogPruneSchema = z.object({
  execute: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  stale_days_in_progress: z.number().optional(),
  stale_days_ready: z.number().optional(),
  archive_days: z.number().optional(),
});

const docsSyncMcpSchema = z.object({
  vendor: z.enum(['claude', 'cursor', 'aider', 'all', 'none']).optional(),
  force: z.boolean().optional(),
});

const laneHealthSchema = z.object({
  json: z.boolean().optional(),
  verbose: z.boolean().optional(),
  no_coverage: z.boolean().optional(),
});

const laneSuggestSchema = z.object({
  dry_run: z.boolean().optional(),
  interactive: z.boolean().optional(),
  output: z.string().optional(),
  json: z.boolean().optional(),
  no_llm: z.boolean().optional(),
  include_git: z.boolean().optional(),
});

const stateBootstrapSchema = z.object({
  execute: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  force: z.boolean().optional(),
  wu_dir: z.string().optional(),
  state_dir: z.string().optional(),
});

const stateCleanupSchema = z.object({
  dry_run: z.boolean().optional(),
  signals_only: z.boolean().optional(),
  memory_only: z.boolean().optional(),
  events_only: z.boolean().optional(),
  json: z.boolean().optional(),
  quiet: z.boolean().optional(),
  base_dir: z.string().optional(),
});

const stateDoctorSchema = z.object({
  fix: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  json: z.boolean().optional(),
  quiet: z.boolean().optional(),
  base_dir: z.string().optional(),
});

const syncTemplatesMcpSchema = z.object({
  dry_run: z.boolean().optional(),
  verbose: z.boolean().optional(),
  check_drift: z.boolean().optional(),
});

// mem:recover public parity schema (not yet modeled in @lumenflow/core memory schemas)
const memRecoverSchema = z.object({
  wu: z.string().optional(),
  max_size: z.number().optional(),
  format: z.enum(['json', 'human']).optional(),
  quiet: z.boolean().optional(),
  base_dir: z.string().optional(),
});

// WU-1483: Schemas for wave-2 parity commands not yet modeled in @lumenflow/core
const fileReadSchema = z.object({
  path: z.string().optional(),
  encoding: z.string().optional(),
  start_line: z.number().optional(),
  end_line: z.number().optional(),
  max_size: z.number().optional(),
});

const fileWriteSchema = z.object({
  path: z.string().optional(),
  content: z.string().optional(),
  encoding: z.string().optional(),
  no_create_dirs: z.boolean().optional(),
  scan_phi: z.boolean().optional(),
});

const fileEditSchema = z.object({
  path: z.string().optional(),
  old_string: z.string().optional(),
  new_string: z.string().optional(),
  encoding: z.string().optional(),
  replace_all: z.boolean().optional(),
});

const fileDeleteSchema = z.object({
  path: z.string().optional(),
  recursive: z.boolean().optional(),
  force: z.boolean().optional(),
});

const gitStatusSchema = z.object({
  base_dir: z.string().optional(),
  path: z.string().optional(),
  porcelain: z.boolean().optional(),
  short: z.boolean().optional(),
});

const gitDiffSchema = z.object({
  base_dir: z.string().optional(),
  ref: z.string().optional(),
  staged: z.boolean().optional(),
  name_only: z.boolean().optional(),
  stat: z.boolean().optional(),
  path: z.string().optional(),
});

const gitLogSchema = z.object({
  base_dir: z.string().optional(),
  ref: z.string().optional(),
  oneline: z.boolean().optional(),
  max_count: z.number().optional(),
  format: z.string().optional(),
  since: z.string().optional(),
  author: z.string().optional(),
});

const gitBranchSchema = z.object({
  base_dir: z.string().optional(),
  list: z.boolean().optional(),
  all: z.boolean().optional(),
  remotes: z.boolean().optional(),
  show_current: z.boolean().optional(),
  contains: z.string().optional(),
});

const planCreateSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
});

const planEditSchema = z.object({
  id: z.string().optional(),
  section: z.string().optional(),
  content: z.string().optional(),
  append: z.string().optional(),
});

const planLinkSchema = z.object({
  id: z.string().optional(),
  plan: z.string().optional(),
});

const planPromoteSchema = z.object({
  id: z.string().optional(),
  force: z.boolean().optional(),
});

const signalCleanupSchema = z.object({
  dry_run: z.boolean().optional(),
  ttl: z.string().optional(),
  unread_ttl: z.string().optional(),
  max_entries: z.number().optional(),
  json: z.boolean().optional(),
  quiet: z.boolean().optional(),
  base_dir: z.string().optional(),
});

const wuProtoSchema = z.object({
  lane: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  code_paths: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  assigned_to: z.string().optional(),
});

function buildGatesArgs(
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

function buildMetricsArgs(input: Record<string, unknown>): string[] {
  const args: string[] = [];
  if (input.subcommand) args.push(input.subcommand as string);
  if (input.days !== undefined) args.push('--days', String(input.days));
  if (input.format) args.push('--format', input.format as string);
  if (input.output) args.push('--output', input.output as string);
  if (input.dry_run) args.push('--dry-run');
  return args;
}

/**
 * Create a successful tool result
 */
function success(data: unknown): ToolResult {
  return { success: true, data };
}

/**
 * Create an error tool result
 */
function error(message: string, code?: string): ToolResult {
  return { success: false, error: { message, code } };
}

// ============================================================================
// Read Operations (via @lumenflow/core)
// ============================================================================

/**
 * context_get - Get current WU context (location, git state, WU state)
 */
export const contextGetTool: ToolDefinition = {
  name: 'context_get',
  description: 'Get current LumenFlow context including location, git state, and active WU',
  inputSchema: z.object({}).optional(),

  async execute(_input, options) {
    try {
      const core = await getCore();
      const context = await core.computeWuContext({
        cwd: options?.projectRoot,
      });
      return success(context);
    } catch (err) {
      return error(err instanceof Error ? err.message : String(err), ErrorCodes.CONTEXT_ERROR);
    }
  },
};

/**
 * wu_list - List all WUs with optional status filter
 * Uses CLI shell-out for consistency with other tools
 *
 * WU-1431: Uses shared wuStatusEnum for status filter
 */
export const wuListTool: ToolDefinition = {
  name: 'wu_list',
  description: 'List all Work Units (WUs) with optional status filter',
  // WU-1431: Uses shared wuStatusEnum for status filter
  // (wu_list is MCP-specific, not a shared CLI command, so inline schema is OK)
  inputSchema: z.object({
    status: wuStatusEnum.optional(),
    lane: z.string().optional(),
  }),

  async execute(input, options) {
    // Use spec:linter which validates and lists all WUs
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };

    // Shell out to get all WU YAMLs via validate --all
    const result = await runCliCommand('wu:validate', ['--all', '--json'], cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        let wus = Array.isArray(data) ? data : data.wus || [];

        // Apply filters
        if (input.status) {
          wus = wus.filter((wu: Record<string, unknown>) => wu.status === input.status);
        }
        if (input.lane) {
          wus = wus.filter((wu: Record<string, unknown>) => wu.lane === input.lane);
        }

        return success(wus);
      } catch {
        // If JSON parse fails, return raw output
        return success({ message: result.stdout });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'wu_list failed',
        ErrorCodes.WU_LIST_ERROR,
      );
    }
  },
};

/**
 * wu_status - Get status of a specific WU
 * Uses CLI shell-out for consistency
 *
 * WU-1431: Uses shared wuStatusSchema for parity with CLI
 * Note: CLI allows id to be optional (auto-detect from worktree), but MCP requires it
 * since there's no "current directory" concept for MCP clients
 */
export const wuStatusTool: ToolDefinition = {
  name: 'wu_status',
  description: 'Get detailed status of a specific Work Unit',
  // WU-1431: Extend shared schema to require id for MCP (CLI allows optional for auto-detect)
  inputSchema: wuStatusSchema.extend({
    id: z.string().describe('WU ID (e.g., WU-1412)'),
  }),

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string, '--json'];
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:status', args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:status failed',
        ErrorCodes.WU_STATUS_ERROR,
      );
    }
  },
};

// ============================================================================
// Write Operations (via CLI shell-out)
// ============================================================================

/**
 * wu_create - Create a new WU
 *
 * WU-1431: Uses shared wuCreateSchema for CLI/MCP parity
 */
export const wuCreateTool: ToolDefinition = {
  name: 'wu_create',
  description: 'Create a new Work Unit specification',
  // WU-1431: Use shared schema - CLI-only aliases are not exposed here
  inputSchema: wuCreateSchema,

  async execute(input, options) {
    if (!input.lane) {
      return error(ErrorMessages.LANE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.title) {
      return error(ErrorMessages.TITLE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args: string[] = ['--lane', input.lane as string, '--title', input.title as string];

    if (input.id) args.push('--id', input.id as string);
    if (input.description) args.push(CliArgs.DESCRIPTION, input.description as string);
    if (input.acceptance) {
      for (const criterion of input.acceptance as string[]) {
        args.push('--acceptance', criterion);
      }
    }
    if (input.code_paths) {
      for (const p of input.code_paths as string[]) {
        args.push(CliArgs.CODE_PATHS, p);
      }
    }
    if (input.exposure) args.push('--exposure', input.exposure as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:create', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'WU created successfully' });
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:create failed',
        ErrorCodes.WU_CREATE_ERROR,
      );
    }
  },
};

/**
 * wu_claim - Claim a WU and create worktree
 *
 * WU-1431: Uses shared wuClaimSchema for CLI/MCP parity
 * WU-1491: Supports --cloud, --branch-only, and --pr-mode passthrough
 */
export const wuClaimTool: ToolDefinition = {
  name: 'wu_claim',
  description: 'Claim a Work Unit and create worktree for implementation',
  // WU-1431: Use shared schema
  inputSchema: wuClaimSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.lane) {
      return error(ErrorMessages.LANE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string, '--lane', input.lane as string];
    // WU-1491: Pass mode flags through to CLI
    if (input.cloud) args.push('--cloud');
    if (input.branch_only) args.push('--branch-only');
    if (input.pr_mode) args.push('--pr-mode');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:claim', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'WU claimed successfully' });
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:claim failed',
        ErrorCodes.WU_CLAIM_ERROR,
      );
    }
  },
};

/**
 * wu_done - Complete a WU (must be run from main checkout)
 *
 * WU-1431: Uses shared wuDoneSchema for CLI/MCP parity
 */
export const wuDoneTool: ToolDefinition = {
  name: 'wu_done',
  description: 'Complete a Work Unit (merge, stamp, cleanup). MUST be run from main checkout.',
  // WU-1431: Use shared schema
  inputSchema: wuDoneSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    // Fail fast if not on main checkout (AC: wu_done fails fast if not on main checkout)
    try {
      const core = await getCore();
      const context = await core.computeWuContext({
        cwd: options?.projectRoot,
      });

      if (context.location.type === 'worktree') {
        return error(
          'wu_done must be run from main checkout, not from a worktree. ' +
            'Run "pnpm wu:prep" first from the worktree, then cd to main and run wu:done.',
          ErrorCodes.WRONG_LOCATION,
        );
      }
    } catch {
      // If we can't determine context, proceed anyway - CLI will validate
    }

    const args = ['--id', input.id as string];
    if (input.skip_gates) {
      args.push('--skip-gates');
      if (input.reason) args.push('--reason', input.reason as string);
      if (input.fix_wu) args.push('--fix-wu', input.fix_wu as string);
    }

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:done', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'WU completed successfully' });
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:done failed',
        ErrorCodes.WU_DONE_ERROR,
      );
    }
  },
};

/**
 * gates_run - Run quality gates
 *
 * WU-1431: Uses shared gatesSchema for CLI/MCP parity
 */
export const gatesRunTool: ToolDefinition = {
  name: 'gates_run',
  description: 'Run LumenFlow quality gates (lint, typecheck, tests)',
  // WU-1431: Use shared schema
  inputSchema: gatesSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.docs_only) {
      args.push(CliArgs.DOCS_ONLY);
    }

    const cliOptions: CliRunnerOptions = {
      projectRoot: options?.projectRoot,
      timeout: 600000, // 10 minutes for gates
    };
    const result = await runCliCommand('gates', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || SuccessMessages.ALL_GATES_PASSED });
    } else {
      return error(
        result.stderr || result.error?.message || 'Gates failed',
        ErrorCodes.GATES_ERROR,
      );
    }
  },
};

// ============================================================================
// Wave-1 Public Parity Operations (WU-1482)
// ============================================================================

/**
 * backlog_prune - Clean stale backlog entries
 */
export const backlogPruneTool: ToolDefinition = {
  name: 'backlog_prune',
  description: 'Clean stale backlog entries and archive old completed WUs',
  inputSchema: backlogPruneSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.execute) args.push('--execute');
    if (input.dry_run) args.push('--dry-run');
    if (input.stale_days_in_progress !== undefined) {
      args.push('--stale-days-in-progress', String(input.stale_days_in_progress));
    }
    if (input.stale_days_ready !== undefined) {
      args.push('--stale-days-ready', String(input.stale_days_ready));
    }
    if (input.archive_days !== undefined) {
      args.push('--archive-days', String(input.archive_days));
    }

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('backlog:prune', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Backlog prune complete' });
    }
    return error(
      result.stderr || result.error?.message || 'backlog:prune failed',
      ErrorCodes.BACKLOG_PRUNE_ERROR,
    );
  },
};

/**
 * docs_sync - Sync agent docs to existing project
 */
export const docsSyncTool: ToolDefinition = {
  name: 'docs_sync',
  description: 'Sync agent onboarding docs and skills to existing projects',
  inputSchema: docsSyncMcpSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.vendor) args.push('--vendor', input.vendor as string);
    if (input.force) args.push('--force');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('docs:sync', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Docs sync complete' });
    }
    return error(
      result.stderr || result.error?.message || 'docs:sync failed',
      ErrorCodes.DOCS_SYNC_ERROR,
    );
  },
};

/**
 * gates - Public gates command
 */
export const gatesTool: ToolDefinition = {
  name: 'gates',
  description: 'Run LumenFlow quality gates',
  inputSchema: gatesSchema,

  async execute(input, options) {
    const args = buildGatesArgs(input);
    const cliOptions: CliRunnerOptions = {
      projectRoot: options?.projectRoot,
      timeout: 600000,
    };
    const result = await runCliCommand('gates', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || SuccessMessages.ALL_GATES_PASSED });
    }
    return error(
      result.stderr || result.error?.message || 'gates failed',
      ErrorCodes.GATES_ALIAS_ERROR,
    );
  },
};

/**
 * gates_docs - Public docs-only gates alias
 */
export const gatesDocsTool: ToolDefinition = {
  name: 'gates_docs',
  description: 'Run docs-only quality gates',
  inputSchema: gatesSchema,

  async execute(input, options) {
    const args = buildGatesArgs(input, { forceDocsOnly: true });
    const cliOptions: CliRunnerOptions = {
      projectRoot: options?.projectRoot,
      timeout: 600000,
    };
    const result = await runCliCommand('gates', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Docs-only gates passed' });
    }
    return error(
      result.stderr || result.error?.message || 'gates:docs failed',
      ErrorCodes.GATES_ALIAS_ERROR,
    );
  },
};

/**
 * lane_health - Diagnose lane configuration issues
 */
export const laneHealthTool: ToolDefinition = {
  name: 'lane_health',
  description: 'Check lane configuration health (overlaps and coverage gaps)',
  inputSchema: laneHealthSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.json) args.push('--json');
    if (input.verbose) args.push('--verbose');
    if (input.no_coverage) args.push('--no-coverage');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('lane:health', args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout || 'Lane health check complete' });
      }
    }
    return error(
      result.stderr || result.error?.message || 'lane:health failed',
      ErrorCodes.LANE_HEALTH_ERROR,
    );
  },
};

/**
 * lane_suggest - Suggest lane definitions from project context
 */
export const laneSuggestTool: ToolDefinition = {
  name: 'lane_suggest',
  description: 'Generate lane suggestions from codebase context',
  inputSchema: laneSuggestSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.dry_run) args.push('--dry-run');
    if (input.interactive) args.push('--interactive');
    if (input.output) args.push('--output', input.output as string);
    if (input.json) args.push('--json');
    if (input.no_llm) args.push('--no-llm');
    if (input.include_git) args.push('--include-git');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('lane:suggest', args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout || 'Lane suggestions generated' });
      }
    }
    return error(
      result.stderr || result.error?.message || 'lane:suggest failed',
      ErrorCodes.LANE_SUGGEST_ERROR,
    );
  },
};

/**
 * lumenflow - Public initializer command
 */
export const lumenflowTool: ToolDefinition = {
  name: 'lumenflow',
  description: 'Initialize LumenFlow in a project',
  inputSchema: lumenflowInitSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.client) args.push('--client', input.client as string);
    if (input.merge) args.push('--merge');
    if (input.full) args.push('--full');
    if (input.minimal) args.push('--minimal');
    if (input.framework) args.push('--framework', input.framework as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('lumenflow', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'LumenFlow initialized' });
    }
    return error(
      result.stderr || result.error?.message || 'lumenflow failed',
      ErrorCodes.LUMENFLOW_ALIAS_ERROR,
    );
  },
};

/**
 * lumenflow_gates - Public gates alias
 */
export const lumenflowGatesTool: ToolDefinition = {
  name: 'lumenflow_gates',
  description: 'Run quality gates (lumenflow-gates alias)',
  inputSchema: gatesSchema,

  async execute(input, options) {
    const args = buildGatesArgs(input);
    const cliOptions: CliRunnerOptions = {
      projectRoot: options?.projectRoot,
      timeout: 600000,
    };
    const result = await runCliCommand('gates', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || SuccessMessages.ALL_GATES_PASSED });
    }
    return error(
      result.stderr || result.error?.message || 'lumenflow-gates failed',
      ErrorCodes.LUMENFLOW_GATES_ERROR,
    );
  },
};

/**
 * lumenflow_validate - Public validate alias
 */
export const lumenflowValidateTool: ToolDefinition = {
  name: 'lumenflow_validate',
  description: 'Run validation checks (lumenflow-validate alias)',
  inputSchema: validateSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.id) args.push('--id', input.id as string);
    if (input.strict) args.push('--strict');
    if (input.done_only) args.push('--done-only');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('validate', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Validation passed' });
    }
    return error(
      result.stderr || result.error?.message || 'lumenflow-validate failed',
      ErrorCodes.LUMENFLOW_VALIDATE_ERROR,
    );
  },
};

/**
 * lumenflow_metrics - Public metrics alias
 */
export const lumenflowMetricsTool: ToolDefinition = {
  name: 'lumenflow_metrics',
  description: 'View workflow metrics (lumenflow:metrics alias)',
  inputSchema: metricsSchema,

  async execute(input, options) {
    const args = buildMetricsArgs(input);
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('metrics', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Metrics generated' });
    }
    return error(
      result.stderr || result.error?.message || 'lumenflow:metrics failed',
      ErrorCodes.LUMENFLOW_METRICS_ERROR,
    );
  },
};

/**
 * metrics - Unified workflow metrics command
 */
export const metricsTool: ToolDefinition = {
  name: 'metrics',
  description: 'View workflow metrics (lanes, dora, flow, all)',
  inputSchema: metricsSchema,

  async execute(input, options) {
    const args = buildMetricsArgs(input);
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('metrics', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Metrics generated' });
    }
    return error(
      result.stderr || result.error?.message || 'metrics failed',
      ErrorCodes.METRICS_ERROR,
    );
  },
};

/**
 * state_bootstrap - Bootstrap event store from WU YAMLs
 */
export const stateBootstrapTool: ToolDefinition = {
  name: 'state_bootstrap',
  description: 'Bootstrap state store from existing WU YAML files',
  inputSchema: stateBootstrapSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.execute) args.push('--execute');
    if (input.dry_run) args.push('--dry-run');
    if (input.force) args.push('--force');
    if (input.wu_dir) args.push('--wu-dir', input.wu_dir as string);
    if (input.state_dir) args.push('--state-dir', input.state_dir as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('state:bootstrap', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'State bootstrap complete' });
    }
    return error(
      result.stderr || result.error?.message || 'state:bootstrap failed',
      ErrorCodes.STATE_BOOTSTRAP_ERROR,
    );
  },
};

/**
 * state_cleanup - Run unified state cleanup
 */
export const stateCleanupTool: ToolDefinition = {
  name: 'state_cleanup',
  description: 'Clean stale state, memory, and signal data',
  inputSchema: stateCleanupSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.dry_run) args.push('--dry-run');
    if (input.signals_only) args.push('--signals-only');
    if (input.memory_only) args.push('--memory-only');
    if (input.events_only) args.push('--events-only');
    if (input.json) args.push('--json');
    if (input.quiet) args.push('--quiet');
    if (input.base_dir) args.push(CliArgs.BASE_DIR, input.base_dir as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('state:cleanup', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'State cleanup complete' });
    }
    return error(
      result.stderr || result.error?.message || 'state:cleanup failed',
      ErrorCodes.STATE_CLEANUP_ERROR,
    );
  },
};

/**
 * state_doctor - Diagnose and repair state issues
 */
export const stateDoctorTool: ToolDefinition = {
  name: 'state_doctor',
  description: 'Diagnose state store integrity issues',
  inputSchema: stateDoctorSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.fix) args.push('--fix');
    if (input.dry_run) args.push('--dry-run');
    if (input.json) args.push('--json');
    if (input.quiet) args.push('--quiet');
    if (input.base_dir) args.push(CliArgs.BASE_DIR, input.base_dir as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('state:doctor', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'State doctor complete' });
    }
    return error(
      result.stderr || result.error?.message || 'state:doctor failed',
      ErrorCodes.STATE_DOCTOR_ERROR,
    );
  },
};

/**
 * sync_templates - Sync templates from source docs
 */
export const syncTemplatesTool: ToolDefinition = {
  name: 'sync_templates',
  description: 'Sync internal docs to CLI templates',
  inputSchema: syncTemplatesMcpSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.dry_run) args.push('--dry-run');
    if (input.verbose) args.push('--verbose');
    if (input.check_drift) args.push('--check-drift');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('sync:templates', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Template sync complete' });
    }
    return error(
      result.stderr || result.error?.message || 'sync:templates failed',
      ErrorCodes.SYNC_TEMPLATES_ALIAS_ERROR,
    );
  },
};

// ============================================================================
// Wave-2 Public Parity Operations (WU-1483)
// ============================================================================

/**
 * file_read - Read file content with audit trail
 */
export const fileReadTool: ToolDefinition = {
  name: 'file_read',
  description: 'Read a file with optional line ranges and encoding',
  inputSchema: fileReadSchema,

  async execute(input, options) {
    if (!input.path) {
      return error(ErrorMessages.PATH_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args: string[] = ['--path', input.path as string];
    if (input.encoding) args.push(CliArgs.ENCODING, input.encoding as string);
    if (input.start_line !== undefined) args.push('--start-line', String(input.start_line));
    if (input.end_line !== undefined) args.push('--end-line', String(input.end_line));
    if (input.max_size !== undefined) args.push('--max-size', String(input.max_size));

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('file:read', args, cliOptions);

    if (result.success) {
      return success({ content: result.stdout });
    }
    return error(
      result.stderr || result.error?.message || 'file:read failed',
      ErrorCodes.FILE_READ_ERROR,
    );
  },
};

/**
 * file_write - Write file content with audit trail
 */
export const fileWriteTool: ToolDefinition = {
  name: 'file_write',
  description: 'Write content to a file with optional PHI scan',
  inputSchema: fileWriteSchema,

  async execute(input, options) {
    if (!input.path) {
      return error(ErrorMessages.PATH_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (input.content === undefined) {
      return error(ErrorMessages.CONTENT_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args: string[] = ['--path', input.path as string, '--content', input.content as string];
    if (input.encoding) args.push(CliArgs.ENCODING, input.encoding as string);
    if (input.no_create_dirs) args.push('--no-create-dirs');
    if (input.scan_phi) args.push('--scan-phi');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('file:write', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'File written' });
    }
    return error(
      result.stderr || result.error?.message || 'file:write failed',
      ErrorCodes.FILE_WRITE_ERROR,
    );
  },
};

/**
 * file_edit - Replace exact string matches in a file
 */
export const fileEditTool: ToolDefinition = {
  name: 'file_edit',
  description: 'Edit a file via exact string replacement',
  inputSchema: fileEditSchema,

  async execute(input, options) {
    if (!input.path) {
      return error(ErrorMessages.PATH_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.old_string) {
      return error(ErrorMessages.OLD_STRING_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (input.new_string === undefined) {
      return error(ErrorMessages.NEW_STRING_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args: string[] = [
      '--path',
      input.path as string,
      '--old-string',
      input.old_string as string,
      '--new-string',
      input.new_string as string,
    ];
    if (input.encoding) args.push(CliArgs.ENCODING, input.encoding as string);
    if (input.replace_all) args.push('--replace-all');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('file:edit', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'File edited' });
    }
    return error(
      result.stderr || result.error?.message || 'file:edit failed',
      ErrorCodes.FILE_EDIT_ERROR,
    );
  },
};

/**
 * file_delete - Delete file or directory with audit trail
 */
export const fileDeleteTool: ToolDefinition = {
  name: 'file_delete',
  description: 'Delete files or directories with safety flags',
  inputSchema: fileDeleteSchema,

  async execute(input, options) {
    if (!input.path) {
      return error(ErrorMessages.PATH_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args: string[] = ['--path', input.path as string];
    if (input.recursive) args.push('--recursive');
    if (input.force) args.push('--force');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('file:delete', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Delete complete' });
    }
    return error(
      result.stderr || result.error?.message || 'file:delete failed',
      ErrorCodes.FILE_DELETE_ERROR,
    );
  },
};

/**
 * git_status - Show git status
 */
export const gitStatusTool: ToolDefinition = {
  name: 'git_status',
  description: 'Show git status with optional porcelain/short modes',
  inputSchema: gitStatusSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.base_dir) args.push(CliArgs.BASE_DIR, input.base_dir as string);
    if (input.porcelain) args.push('--porcelain');
    if (input.short) args.push('--short');
    if (input.path) args.push(input.path as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('git:status', args, cliOptions);

    if (result.success) {
      return success({ output: result.stdout });
    }
    return error(
      result.stderr || result.error?.message || 'git:status failed',
      ErrorCodes.GIT_STATUS_ERROR,
    );
  },
};

/**
 * git_diff - Show git diff
 */
export const gitDiffTool: ToolDefinition = {
  name: 'git_diff',
  description: 'Show git diff with staged/name-only/stat modes',
  inputSchema: gitDiffSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.base_dir) args.push(CliArgs.BASE_DIR, input.base_dir as string);
    if (input.staged) args.push('--staged');
    if (input.name_only) args.push('--name-only');
    if (input.stat) args.push('--stat');
    if (input.ref) args.push(input.ref as string);
    if (input.path) args.push('--', input.path as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('git:diff', args, cliOptions);

    if (result.success) {
      return success({ output: result.stdout });
    }
    return error(
      result.stderr || result.error?.message || 'git:diff failed',
      ErrorCodes.GIT_DIFF_ERROR,
    );
  },
};

/**
 * git_log - Show commit history
 */
export const gitLogTool: ToolDefinition = {
  name: 'git_log',
  description: 'Show git commit log with filters',
  inputSchema: gitLogSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.base_dir) args.push(CliArgs.BASE_DIR, input.base_dir as string);
    if (input.oneline) args.push('--oneline');
    if (input.max_count !== undefined) args.push('-n', String(input.max_count));
    if (input.format) args.push('--format', input.format as string);
    if (input.since) args.push('--since', input.since as string);
    if (input.author) args.push('--author', input.author as string);
    if (input.ref) args.push(input.ref as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('git:log', args, cliOptions);

    if (result.success) {
      return success({ output: result.stdout });
    }
    return error(
      result.stderr || result.error?.message || 'git:log failed',
      ErrorCodes.GIT_LOG_ERROR,
    );
  },
};

/**
 * git_branch - Show branch information
 */
export const gitBranchTool: ToolDefinition = {
  name: 'git_branch',
  description: 'Show git branch listing and current branch',
  inputSchema: gitBranchSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.base_dir) args.push(CliArgs.BASE_DIR, input.base_dir as string);
    if (input.list) args.push('--list');
    if (input.all) args.push('--all');
    if (input.remotes) args.push('--remotes');
    if (input.show_current) args.push('--show-current');
    if (input.contains) args.push('--contains', input.contains as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('git:branch', args, cliOptions);

    if (result.success) {
      return success({ output: result.stdout });
    }
    return error(
      result.stderr || result.error?.message || 'git:branch failed',
      ErrorCodes.GIT_BRANCH_ERROR,
    );
  },
};

/**
 * init_plan - Link plan to initiative (alias)
 */
export const initPlanTool: ToolDefinition = {
  name: 'init_plan',
  description: 'Link or create a plan for an initiative',
  inputSchema: initiativePlanSchema,

  async execute(input, options) {
    if (!input.initiative) {
      return error(SharedErrorMessages.INITIATIVE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.plan && !input.create) {
      return error(ErrorMessages.PLAN_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args: string[] = ['--initiative', input.initiative as string];
    if (input.plan) args.push('--plan', input.plan as string);
    if (input.create) args.push('--create');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('init:plan', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Plan linked' });
    }
    return error(
      result.stderr || result.error?.message || 'init:plan failed',
      ErrorCodes.INIT_PLAN_ERROR,
    );
  },
};

/**
 * plan_create - Create a plan file
 */
export const planCreateTool: ToolDefinition = {
  name: 'plan_create',
  description: 'Create a new plan for a WU or initiative',
  inputSchema: planCreateSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.title) {
      return error(ErrorMessages.TITLE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string, '--title', input.title as string];
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('plan:create', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Plan created' });
    }
    return error(
      result.stderr || result.error?.message || 'plan:create failed',
      ErrorCodes.PLAN_CREATE_ERROR,
    );
  },
};

/**
 * plan_edit - Edit an existing plan section
 */
export const planEditTool: ToolDefinition = {
  name: 'plan_edit',
  description: 'Edit or append content to a plan section',
  inputSchema: planEditSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.section) {
      return error(ErrorMessages.SECTION_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.content && !input.append) {
      return error(ErrorMessages.CONTENT_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string, '--section', input.section as string];
    if (input.content) args.push('--content', input.content as string);
    if (input.append) args.push('--append', input.append as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('plan:edit', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Plan edited' });
    }
    return error(
      result.stderr || result.error?.message || 'plan:edit failed',
      ErrorCodes.PLAN_EDIT_ERROR,
    );
  },
};

/**
 * plan_link - Link plan URI to WU/initiative
 */
export const planLinkTool: ToolDefinition = {
  name: 'plan_link',
  description: 'Link an existing plan URI to a WU or initiative',
  inputSchema: planLinkSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.plan) {
      return error(ErrorMessages.PLAN_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string, '--plan', input.plan as string];
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('plan:link', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Plan linked' });
    }
    return error(
      result.stderr || result.error?.message || 'plan:link failed',
      ErrorCodes.PLAN_LINK_ERROR,
    );
  },
};

/**
 * plan_promote - Promote plan to approved status
 */
export const planPromoteTool: ToolDefinition = {
  name: 'plan_promote',
  description: 'Promote plan from draft to approved status',
  inputSchema: planPromoteSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string];
    if (input.force) args.push('--force');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('plan:promote', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Plan promoted' });
    }
    return error(
      result.stderr || result.error?.message || 'plan:promote failed',
      ErrorCodes.PLAN_PROMOTE_ERROR,
    );
  },
};

/**
 * signal_cleanup - Clean stale signals
 */
export const signalCleanupTool: ToolDefinition = {
  name: 'signal_cleanup',
  description: 'Cleanup stale signals using TTL policy',
  inputSchema: signalCleanupSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.dry_run) args.push('--dry-run');
    if (input.ttl) args.push('--ttl', input.ttl as string);
    if (input.unread_ttl) args.push('--unread-ttl', input.unread_ttl as string);
    if (input.max_entries !== undefined) args.push('--max-entries', String(input.max_entries));
    if (input.json) args.push('--json');
    if (input.quiet) args.push('--quiet');
    if (input.base_dir) args.push(CliArgs.BASE_DIR, input.base_dir as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('signal:cleanup', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Signal cleanup complete' });
    }
    return error(
      result.stderr || result.error?.message || 'signal:cleanup failed',
      ErrorCodes.SIGNAL_CLEANUP_ERROR,
    );
  },
};

/**
 * wu_proto - Create and claim a prototype WU
 */
export const wuProtoTool: ToolDefinition = {
  name: 'wu_proto',
  description: 'Create and claim a prototype WU with relaxed validation',
  inputSchema: wuProtoSchema,

  async execute(input, options) {
    if (!input.lane) {
      return error(ErrorMessages.LANE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.title) {
      return error(ErrorMessages.TITLE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--lane', input.lane as string, '--title', input.title as string];
    if (input.description) args.push(CliArgs.DESCRIPTION, input.description as string);
    if (Array.isArray(input.code_paths)) {
      for (const codePath of input.code_paths) {
        args.push(CliArgs.CODE_PATHS, String(codePath));
      }
    }
    if (Array.isArray(input.labels) && input.labels.length > 0) {
      args.push('--labels', input.labels.join(','));
    }
    if (input.assigned_to) args.push('--assigned-to', input.assigned_to as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:proto', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Prototype WU created' });
    }
    return error(
      result.stderr || result.error?.message || 'wu:proto failed',
      ErrorCodes.WU_PROTO_ERROR,
    );
  },
};

// ============================================================================
// Additional WU Operations (WU-1422)
// ============================================================================

/**
 * wu_block - Block a WU and move it to blocked status
 */
export const wuBlockTool: ToolDefinition = {
  name: 'wu_block',
  description: 'Block a Work Unit and move it from in_progress to blocked status',
  // WU-1454: Use shared schema
  inputSchema: wuBlockSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.reason) {
      return error(ErrorMessages.REASON_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string, '--reason', input.reason as string];
    if (input.remove_worktree) {
      args.push('--remove-worktree');
    }

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:block', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'WU blocked successfully' });
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:block failed',
        ErrorCodes.WU_BLOCK_ERROR,
      );
    }
  },
};

/**
 * wu_unblock - Unblock a WU and move it back to in_progress status
 */
export const wuUnblockTool: ToolDefinition = {
  name: 'wu_unblock',
  description: 'Unblock a Work Unit and move it from blocked to in_progress status',
  // WU-1454: Use shared schema
  inputSchema: wuUnblockSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string];
    if (input.reason) args.push('--reason', input.reason as string);
    if (input.create_worktree) args.push('--create-worktree');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:unblock', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'WU unblocked successfully' });
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:unblock failed',
        ErrorCodes.WU_UNBLOCK_ERROR,
      );
    }
  },
};

/**
 * wu_edit - Edit WU spec fields
 */
export const wuEditTool: ToolDefinition = {
  name: 'wu_edit',
  description: 'Edit Work Unit spec fields with micro-worktree isolation',
  // WU-1454: Use shared schema
  inputSchema: wuEditSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string];
    if (input.description) args.push(CliArgs.DESCRIPTION, input.description as string);
    if (input.acceptance) {
      for (const criterion of input.acceptance as string[]) {
        args.push('--acceptance', criterion);
      }
    }
    if (input.notes) args.push('--notes', input.notes as string);
    if (input.code_paths) {
      for (const p of input.code_paths as string[]) {
        args.push(CliArgs.CODE_PATHS, p);
      }
    }
    if (input.lane) args.push('--lane', input.lane as string);
    if (input.priority) args.push('--priority', input.priority as string);
    if (input.initiative) args.push(CliArgs.INITIATIVE, input.initiative as string);
    if (input.phase) args.push(CliArgs.PHASE, String(input.phase));
    if (input.no_strict) args.push('--no-strict');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:edit', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'WU edited successfully' });
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:edit failed',
        ErrorCodes.WU_EDIT_ERROR,
      );
    }
  },
};

/**
 * wu_release - Release an orphaned WU from in_progress to ready status
 */
export const wuReleaseTool: ToolDefinition = {
  name: 'wu_release',
  description: 'Release an orphaned WU from in_progress back to ready state for reclaiming',
  // WU-1454: Use shared schema
  inputSchema: wuReleaseSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string];
    if (input.reason) args.push('--reason', input.reason as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:release', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'WU released successfully' });
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:release failed',
        ErrorCodes.WU_RELEASE_ERROR,
      );
    }
  },
};

/**
 * wu_recover - Analyze and fix WU state inconsistencies
 */
export const wuRecoverTool: ToolDefinition = {
  name: 'wu_recover',
  description: 'Analyze and fix WU state inconsistencies',
  // WU-1454: Use shared schema
  inputSchema: wuRecoverSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string];
    if (input.action) args.push('--action', input.action as string);
    if (input.force) args.push('--force');
    if (input.json) args.push(CliArgs.JSON);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:recover', args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout || 'WU recovered successfully' });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:recover failed',
        ErrorCodes.WU_RECOVER_ERROR,
      );
    }
  },
};

/**
 * wu_repair - Unified WU repair tool for state issues
 */
export const wuRepairTool: ToolDefinition = {
  name: 'wu_repair',
  description: 'Unified WU repair tool - detect and fix WU state issues',
  // WU-1454: Use shared schema
  inputSchema: wuRepairSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.id) args.push('--id', input.id as string);
    if (input.check) args.push('--check');
    if (input.all) args.push('--all');
    if (input.claim) args.push('--claim');
    if (input.admin) args.push('--admin');
    if (input.repair_state) args.push('--repair-state');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:repair', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'WU repair completed' });
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:repair failed',
        ErrorCodes.WU_REPAIR_ERROR,
      );
    }
  },
};

/**
 * wu_deps - Visualize WU dependency graph
 */
export const wuDepsTool: ToolDefinition = {
  name: 'wu_deps',
  description: 'Visualize WU dependency graph',
  // WU-1454: Use shared schema
  inputSchema: wuDepsSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string];
    if (input.format) args.push('--format', input.format as string);
    if (input.depth) args.push('--depth', String(input.depth));
    if (input.direction) args.push('--direction', input.direction as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:deps', args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:deps failed',
        ErrorCodes.WU_DEPS_ERROR,
      );
    }
  },
};

/**
 * wu_prep - Prepare WU for completion (run gates in worktree)
 */
export const wuPrepTool: ToolDefinition = {
  name: 'wu_prep',
  description: 'Prepare WU for completion by running gates in worktree',
  // WU-1454: Use shared schema
  inputSchema: wuPrepSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string];
    if (input.docs_only) args.push(CliArgs.DOCS_ONLY);

    const cliOptions: CliRunnerOptions = {
      projectRoot: options?.projectRoot,
      timeout: 600000, // 10 minutes for gates
    };
    const result = await runCliCommand('wu:prep', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'WU prep completed' });
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:prep failed',
        ErrorCodes.WU_PREP_ERROR,
      );
    }
  },
};

/**
 * wu_preflight - Fast validation before gates run
 */
export const wuPreflightTool: ToolDefinition = {
  name: 'wu_preflight',
  description:
    'Fast validation of code_paths and test paths before gates run (under 5 seconds vs 2+ minutes)',
  // WU-1454: Use shared schema
  inputSchema: wuPreflightSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string];
    if (input.worktree) args.push('--worktree', input.worktree as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:preflight', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Preflight checks passed' });
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:preflight failed',
        ErrorCodes.WU_PREFLIGHT_ERROR,
      );
    }
  },
};

/**
 * wu_prune - Clean stale worktrees
 */
export const wuPruneTool: ToolDefinition = {
  name: 'wu_prune',
  description: 'Clean stale worktrees (dry-run by default)',
  // WU-1454: Use shared schema
  inputSchema: wuPruneSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.execute) args.push('--execute');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:prune', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Prune completed' });
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:prune failed',
        ErrorCodes.WU_PRUNE_ERROR,
      );
    }
  },
};

/**
 * wu_delete - Safely delete WU YAML files
 */
export const wuDeleteTool: ToolDefinition = {
  name: 'wu_delete',
  description: 'Safely delete WU YAML files with micro-worktree isolation',
  // WU-1454: Use shared schema
  inputSchema: wuDeleteSchema,

  async execute(input, options) {
    if (!input.id && !input.batch) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args: string[] = [];
    if (input.id) args.push('--id', input.id as string);
    if (input.dry_run) args.push(CliArgs.DRY_RUN);
    if (input.batch) args.push('--batch', input.batch as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:delete', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'WU deleted' });
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:delete failed',
        ErrorCodes.WU_DELETE_ERROR,
      );
    }
  },
};

/**
 * wu_cleanup - Clean up worktree and branch after PR merge
 */
export const wuCleanupTool: ToolDefinition = {
  name: 'wu_cleanup',
  description: 'Clean up worktree and branch after PR merge (PR-based completion workflow)',
  // WU-1454: Use shared schema
  inputSchema: wuCleanupSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string];
    if (input.artifacts) args.push('--artifacts');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:cleanup', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Cleanup complete' });
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:cleanup failed',
        ErrorCodes.WU_CLEANUP_ERROR,
      );
    }
  },
};

/**
 * Build common argument list for wu:brief / wu:delegate prompt tools.
 */
function buildWuPromptArgs(input: Record<string, unknown>): string[] {
  const args = ['--id', input.id as string];
  if (input.client) args.push('--client', input.client as string);
  if (input.thinking) args.push('--thinking');
  if (input.budget) args.push('--budget', String(input.budget));
  if (input.parent_wu) args.push('--parent-wu', input.parent_wu as string);
  if (input.no_context) args.push('--no-context');
  return args;
}

/**
 * wu_brief - Generate handoff prompt for sub-agent WU execution (WU-1603)
 *
 * This is the canonical prompt-generation tool.
 */
export const wuBriefTool: ToolDefinition = {
  name: 'wu_brief',
  description: 'Generate handoff prompt for sub-agent WU execution',
  // WU-1454: Use shared schema (same parameters as wu:delegate)
  inputSchema: wuSpawnSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = buildWuPromptArgs(input);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:brief', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Brief prompt generated' });
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:brief failed',
        ErrorCodes.WU_BRIEF_ERROR,
      );
    }
  },
};

/**
 * wu_delegate - Generate prompt and explicitly record delegation lineage intent
 */
export const wuDelegateTool: ToolDefinition = {
  name: 'wu_delegate',
  description: 'Generate delegation prompt and record explicit lineage intent',
  inputSchema: wuSpawnSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.parent_wu) {
      return error(ErrorMessages.PARENT_WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = buildWuPromptArgs(input);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:delegate', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Delegation prompt generated' });
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:delegate failed',
        ErrorCodes.WU_DELEGATE_ERROR,
      );
    }
  },
};

/**
 * wu_validate - Validate WU YAML files
 */
export const wuValidateTool: ToolDefinition = {
  name: 'wu_validate',
  description: 'Validate WU YAML files against schema (strict mode by default)',
  // WU-1454: Use shared schema
  inputSchema: wuValidateSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string];
    if (input.no_strict) args.push('--no-strict');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:validate', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'WU is valid' });
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:validate failed',
        ErrorCodes.WU_VALIDATE_ERROR,
      );
    }
  },
};

/**
 * wu_infer_lane - Suggest lane for a WU based on code paths and description
 */
export const wuInferLaneTool: ToolDefinition = {
  name: 'wu_infer_lane',
  description: 'Suggest lane for a WU based on code paths and description',
  // WU-1454: Use shared schema
  inputSchema: wuInferLaneSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.id) args.push('--id', input.id as string);
    if (input.paths) {
      for (const p of input.paths as string[]) {
        args.push('--paths', p);
      }
    }
    if (input.desc) args.push('--desc', input.desc as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:infer-lane', args, cliOptions);

    if (result.success) {
      return success({ lane: result.stdout?.trim() || 'Unknown' });
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:infer-lane failed',
        ErrorCodes.WU_INFER_LANE_ERROR,
      );
    }
  },
};

/**
 * wu_unlock_lane - Safely unlock a lane lock with audit logging
 */
export const wuUnlockLaneTool: ToolDefinition = {
  name: 'wu_unlock_lane',
  description: 'Safely unlock a lane lock with audit logging',
  // WU-1454: Use shared schema
  inputSchema: wuUnlockLaneSchema,

  async execute(input, options) {
    // If list mode, no lane required
    if (!input.list && !input.lane) {
      return error(ErrorMessages.LANE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args: string[] = [];
    if (input.lane) args.push('--lane', input.lane as string);
    if (input.reason) args.push('--reason', input.reason as string);
    if (input.force) args.push('--force');
    if (input.list) args.push('--list');
    if (input.status) args.push('--status');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:unlock-lane', args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout || 'Lane unlocked' });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:unlock-lane failed',
        ErrorCodes.WU_UNLOCK_LANE_ERROR,
      );
    }
  },
};

// ============================================================================
// Initiative Operations (WU-1424)
// ============================================================================

/**
 * Error codes for initiative tools
 */
const InitiativeErrorCodes = {
  INITIATIVE_LIST_ERROR: 'INITIATIVE_LIST_ERROR',
  INITIATIVE_STATUS_ERROR: 'INITIATIVE_STATUS_ERROR',
  INITIATIVE_CREATE_ERROR: 'INITIATIVE_CREATE_ERROR',
  INITIATIVE_EDIT_ERROR: 'INITIATIVE_EDIT_ERROR',
  INITIATIVE_ADD_WU_ERROR: 'INITIATIVE_ADD_WU_ERROR',
  INITIATIVE_REMOVE_WU_ERROR: 'INITIATIVE_REMOVE_WU_ERROR',
  INITIATIVE_BULK_ASSIGN_ERROR: 'INITIATIVE_BULK_ASSIGN_ERROR',
  INITIATIVE_PLAN_ERROR: 'INITIATIVE_PLAN_ERROR',
} as const;

/**
 * Error messages for initiative tools (uses shared messages to avoid duplication)
 */
const InitiativeErrorMessages = {
  INITIATIVE_REQUIRED: SharedErrorMessages.INITIATIVE_REQUIRED,
  WU_REQUIRED: SharedErrorMessages.WU_REQUIRED,
} as const;

/**
 * initiative_list - List all initiatives
 */
export const initiativeListTool: ToolDefinition = {
  name: 'initiative_list',
  description: 'List all initiatives with optional status filter',
  // WU-1455: Use shared schema from @lumenflow/core
  inputSchema: initiativeListSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.status) args.push('--status', input.status as string);
    // WU-1455: Use format field from shared schema
    if (input.format) args.push('--format', input.format as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('initiative:list', args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'initiative:list failed',
        InitiativeErrorCodes.INITIATIVE_LIST_ERROR,
      );
    }
  },
};

/**
 * initiative_status - Get status of a specific initiative
 */
export const initiativeStatusTool: ToolDefinition = {
  name: 'initiative_status',
  description: 'Get detailed status of a specific initiative including WUs and progress',
  // WU-1455: Use shared schema from @lumenflow/core
  inputSchema: initiativeStatusSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string];
    // WU-1455: Use format field from shared schema
    if (input.format) args.push('--format', input.format as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('initiative:status', args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'initiative:status failed',
        InitiativeErrorCodes.INITIATIVE_STATUS_ERROR,
      );
    }
  },
};

/**
 * initiative_create - Create a new initiative
 */
export const initiativeCreateTool: ToolDefinition = {
  name: 'initiative_create',
  description: 'Create a new initiative for multi-phase project orchestration',
  // WU-1455: Use shared schema from @lumenflow/core
  inputSchema: initiativeCreateSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.title) {
      return error(ErrorMessages.TITLE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    // WU-1455: Map shared schema fields to CLI flags
    const args = [
      '--id',
      input.id as string,
      '--slug',
      input.slug as string,
      '--title',
      input.title as string,
    ];
    if (input.priority) args.push('--priority', input.priority as string);
    if (input.owner) args.push('--owner', input.owner as string);
    if (input.target_date) args.push('--target-date', input.target_date as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('initiative:create', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Initiative created successfully' });
    } else {
      return error(
        result.stderr || result.error?.message || 'initiative:create failed',
        InitiativeErrorCodes.INITIATIVE_CREATE_ERROR,
      );
    }
  },
};

/**
 * initiative_edit - Edit initiative fields
 */
export const initiativeEditTool: ToolDefinition = {
  name: 'initiative_edit',
  description: 'Edit initiative fields',
  // WU-1455: Use shared schema from @lumenflow/core
  inputSchema: initiativeEditSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    // WU-1455: Map shared schema fields to CLI flags
    const args = ['--id', input.id as string];
    if (input.description) args.push(CliArgs.DESCRIPTION, input.description as string);
    if (input.status) args.push('--status', input.status as string);
    if (input.blocked_by) args.push('--blocked-by', input.blocked_by as string);
    if (input.blocked_reason) args.push('--blocked-reason', input.blocked_reason as string);
    if (input.unblock) args.push('--unblock');
    if (input.notes) args.push('--notes', input.notes as string);
    if (input.phase_id) args.push('--phase-id', input.phase_id as string);
    if (input.phase_status) args.push('--phase-status', input.phase_status as string);
    if (input.created) args.push('--created', input.created as string);
    if (input.add_lane) {
      for (const lane of input.add_lane as string[]) {
        args.push('--add-lane', lane);
      }
    }
    if (input.remove_lane) {
      for (const lane of input.remove_lane as string[]) {
        args.push('--remove-lane', lane);
      }
    }
    if (input.add_phase) {
      for (const phase of input.add_phase as string[]) {
        args.push('--add-phase', phase);
      }
    }
    if (input.add_success_metric) {
      for (const metric of input.add_success_metric as string[]) {
        args.push('--add-success-metric', metric);
      }
    }

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('initiative:edit', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Initiative edited successfully' });
    } else {
      return error(
        result.stderr || result.error?.message || 'initiative:edit failed',
        InitiativeErrorCodes.INITIATIVE_EDIT_ERROR,
      );
    }
  },
};

/**
 * initiative_add_wu - Add a WU to an initiative
 */
export const initiativeAddWuTool: ToolDefinition = {
  name: 'initiative_add_wu',
  description: 'Add a Work Unit to an initiative, optionally assigning to a phase',
  // WU-1455: Use shared schema from @lumenflow/core
  inputSchema: initiativeAddWuSchema,

  async execute(input, options) {
    if (!input.initiative) {
      return error(InitiativeErrorMessages.INITIATIVE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.wu) {
      return error(InitiativeErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [CliArgs.INITIATIVE, input.initiative as string, '--wu', input.wu as string];
    if (input.phase !== undefined) args.push(CliArgs.PHASE, String(input.phase));

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('initiative:add-wu', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'WU added to initiative' });
    } else {
      return error(
        result.stderr || result.error?.message || 'initiative:add-wu failed',
        InitiativeErrorCodes.INITIATIVE_ADD_WU_ERROR,
      );
    }
  },
};

/**
 * initiative_remove_wu - Remove a WU from an initiative
 */
export const initiativeRemoveWuTool: ToolDefinition = {
  name: 'initiative_remove_wu',
  description: 'Remove a Work Unit from an initiative',
  // WU-1455: Use shared schema from @lumenflow/core
  inputSchema: initiativeRemoveWuSchema,

  async execute(input, options) {
    if (!input.initiative) {
      return error(InitiativeErrorMessages.INITIATIVE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.wu) {
      return error(InitiativeErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [CliArgs.INITIATIVE, input.initiative as string, '--wu', input.wu as string];

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('initiative:remove-wu', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'WU removed from initiative' });
    } else {
      return error(
        result.stderr || result.error?.message || 'initiative:remove-wu failed',
        InitiativeErrorCodes.INITIATIVE_REMOVE_WU_ERROR,
      );
    }
  },
};

/**
 * initiative_bulk_assign - Bulk assign WUs to an initiative
 */
export const initiatiBulkAssignTool: ToolDefinition = {
  name: 'initiative_bulk_assign',
  description: 'Bulk assign WUs to an initiative based on lane prefix rules',
  // WU-1455: Use shared schema from @lumenflow/core
  inputSchema: initiativeBulkAssignSchema,

  async execute(input, options) {
    // WU-1455: Map shared schema fields to CLI flags
    const args: string[] = [];
    if (input.config) args.push('--config', input.config as string);
    if (input.apply) args.push('--apply');
    if (input.sync_from_initiative)
      args.push('--reconcile-initiative', input.sync_from_initiative as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('initiative:bulk-assign', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Bulk assignment completed' });
    } else {
      return error(
        result.stderr || result.error?.message || 'initiative:bulk-assign failed',
        InitiativeErrorCodes.INITIATIVE_BULK_ASSIGN_ERROR,
      );
    }
  },
};

/**
 * initiative_plan - Link or create a plan for an initiative
 */
export const initiativePlanTool: ToolDefinition = {
  name: 'initiative_plan',
  description: 'Link an existing plan or create a new plan template for an initiative',
  // WU-1455: Use shared schema from @lumenflow/core
  inputSchema: initiativePlanSchema,

  async execute(input, options) {
    if (!input.initiative) {
      return error(InitiativeErrorMessages.INITIATIVE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [CliArgs.INITIATIVE, input.initiative as string];
    if (input.plan) args.push('--plan', input.plan as string);
    if (input.create) args.push('--create');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('initiative:plan', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Plan linked to initiative' });
    } else {
      return error(
        result.stderr || result.error?.message || 'initiative:plan failed',
        InitiativeErrorCodes.INITIATIVE_PLAN_ERROR,
      );
    }
  },
};

// ============================================================================
// Memory Operations (WU-1424)
// ============================================================================

/**
 * Error codes for memory tools
 */
const MemoryErrorCodes = {
  MEM_INIT_ERROR: 'MEM_INIT_ERROR',
  MEM_START_ERROR: 'MEM_START_ERROR',
  MEM_READY_ERROR: 'MEM_READY_ERROR',
  MEM_CHECKPOINT_ERROR: 'MEM_CHECKPOINT_ERROR',
  MEM_CLEANUP_ERROR: 'MEM_CLEANUP_ERROR',
  MEM_CONTEXT_ERROR: 'MEM_CONTEXT_ERROR',
  MEM_CREATE_ERROR: 'MEM_CREATE_ERROR',
  MEM_DELETE_ERROR: 'MEM_DELETE_ERROR',
  MEM_EXPORT_ERROR: 'MEM_EXPORT_ERROR',
  MEM_INBOX_ERROR: 'MEM_INBOX_ERROR',
  MEM_SIGNAL_ERROR: 'MEM_SIGNAL_ERROR',
  MEM_SUMMARIZE_ERROR: 'MEM_SUMMARIZE_ERROR',
  MEM_TRIAGE_ERROR: 'MEM_TRIAGE_ERROR',
  MEM_RECOVER_ERROR: 'MEM_RECOVER_ERROR',
} as const;

/**
 * Error messages for memory tools (uses shared messages to avoid duplication)
 */
const MemoryErrorMessages = {
  WU_REQUIRED: SharedErrorMessages.WU_REQUIRED,
  MESSAGE_REQUIRED: 'message is required',
} as const;

/**
 * mem_init - Initialize memory for a WU
 */
export const memInitTool: ToolDefinition = {
  name: 'mem_init',
  description: 'Initialize memory layer for a Work Unit',
  inputSchema: memInitSchema,

  async execute(input, options) {
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--wu', input.wu as string];

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('mem:init', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Memory initialized' });
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:init failed',
        MemoryErrorCodes.MEM_INIT_ERROR,
      );
    }
  },
};

/**
 * mem_start - Start a memory session
 */
export const memStartTool: ToolDefinition = {
  name: 'mem_start',
  description: 'Start a memory session for a Work Unit',
  inputSchema: memStartSchema,

  async execute(input, options) {
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--wu', input.wu as string];
    if (input.lane) args.push('--lane', input.lane as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('mem:start', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Session started' });
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:start failed',
        MemoryErrorCodes.MEM_START_ERROR,
      );
    }
  },
};

/**
 * mem_ready - Check pending nodes
 */
export const memReadyTool: ToolDefinition = {
  name: 'mem_ready',
  description: 'Check pending memory nodes for a Work Unit',
  inputSchema: memReadySchema,

  async execute(input, options) {
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--wu', input.wu as string];

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('mem:ready', args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:ready failed',
        MemoryErrorCodes.MEM_READY_ERROR,
      );
    }
  },
};

/**
 * mem_checkpoint - Save progress checkpoint
 */
export const memCheckpointTool: ToolDefinition = {
  name: 'mem_checkpoint',
  description: 'Save a progress checkpoint for a Work Unit',
  inputSchema: memCheckpointSchema,

  async execute(input, options) {
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--wu', input.wu as string];
    if (input.message) args.push('--message', input.message as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('mem:checkpoint', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Checkpoint saved' });
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:checkpoint failed',
        MemoryErrorCodes.MEM_CHECKPOINT_ERROR,
      );
    }
  },
};

/**
 * mem_cleanup - Clean up stale memory data
 */
export const memCleanupTool: ToolDefinition = {
  name: 'mem_cleanup',
  description: 'Clean up stale memory data',
  inputSchema: memCleanupSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.dry_run) args.push(CliArgs.DRY_RUN);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('mem:cleanup', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Cleanup completed' });
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:cleanup failed',
        MemoryErrorCodes.MEM_CLEANUP_ERROR,
      );
    }
  },
};

/**
 * mem_context - Get context for current lane/WU
 */
export const memContextTool: ToolDefinition = {
  name: 'mem_context',
  description: 'Get memory context for a Work Unit, optionally filtered by lane',
  inputSchema: memContextSchema,

  async execute(input, options) {
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--wu', input.wu as string];
    if (input.lane) args.push('--lane', input.lane as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('mem:context', args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:context failed',
        MemoryErrorCodes.MEM_CONTEXT_ERROR,
      );
    }
  },
};

/**
 * mem_create - Create a memory node
 */
export const memCreateTool: ToolDefinition = {
  name: 'mem_create',
  description: 'Create a memory node (e.g., for bug discovery)',
  inputSchema: memCreateSchema,

  async execute(input, options) {
    if (!input.message) {
      return error(MemoryErrorMessages.MESSAGE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [input.message as string, '--wu', input.wu as string];
    if (input.type) args.push('--type', input.type as string);
    if (input.tags) args.push('--tags', (input.tags as string[]).join(','));

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('mem:create', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Memory node created' });
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:create failed',
        MemoryErrorCodes.MEM_CREATE_ERROR,
      );
    }
  },
};

/**
 * mem_delete - Delete/archive a memory node
 */
export const memDeleteTool: ToolDefinition = {
  name: 'mem_delete',
  description: 'Delete or archive a memory node',
  inputSchema: memDeleteSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string];

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('mem:delete', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Memory node deleted' });
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:delete failed',
        MemoryErrorCodes.MEM_DELETE_ERROR,
      );
    }
  },
};

/**
 * mem_export - Export memory as markdown
 */
export const memExportTool: ToolDefinition = {
  name: 'mem_export',
  description: 'Export memory for a Work Unit as markdown or JSON',
  inputSchema: memExportSchema,

  async execute(input, options) {
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--wu', input.wu as string];
    if (input.format) args.push('--format', input.format as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('mem:export', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout });
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:export failed',
        MemoryErrorCodes.MEM_EXPORT_ERROR,
      );
    }
  },
};

/**
 * mem_inbox - Check coordination signals
 */
export const memInboxTool: ToolDefinition = {
  name: 'mem_inbox',
  description: 'Check coordination signals from other agents',
  inputSchema: memInboxSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.since) args.push('--since', input.since as string);
    if (input.wu) args.push(CliArgs.WU, input.wu as string);
    if (input.lane) args.push('--lane', input.lane as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('mem:inbox', args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:inbox failed',
        MemoryErrorCodes.MEM_INBOX_ERROR,
      );
    }
  },
};

/**
 * mem_signal - Broadcast coordination signal
 */
export const memSignalTool: ToolDefinition = {
  name: 'mem_signal',
  description: 'Broadcast a coordination signal to other agents',
  inputSchema: memSignalSchema,

  async execute(input, options) {
    if (!input.message) {
      return error(MemoryErrorMessages.MESSAGE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [input.message as string, '--wu', input.wu as string];

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('mem:signal', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Signal broadcast' });
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:signal failed',
        MemoryErrorCodes.MEM_SIGNAL_ERROR,
      );
    }
  },
};

/**
 * mem_summarize - Summarize memory context
 */
export const memSummarizeTool: ToolDefinition = {
  name: 'mem_summarize',
  description: 'Summarize memory context for a Work Unit',
  inputSchema: memSummarizeSchema,

  async execute(input, options) {
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--wu', input.wu as string];

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('mem:summarize', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout });
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:summarize failed',
        MemoryErrorCodes.MEM_SUMMARIZE_ERROR,
      );
    }
  },
};

/**
 * mem_triage - Triage discovered bugs
 */
export const memTriageTool: ToolDefinition = {
  name: 'mem_triage',
  description: 'Triage discovered bugs for a Work Unit, optionally promoting to WU',
  inputSchema: memTriageSchema,

  async execute(input, options) {
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--wu', input.wu as string];
    if (input.promote) args.push('--promote', input.promote as string);
    if (input.lane) args.push('--lane', input.lane as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('mem:triage', args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:triage failed',
        MemoryErrorCodes.MEM_TRIAGE_ERROR,
      );
    }
  },
};

/**
 * mem_recover - Generate post-compaction recovery context for a Work Unit
 */
export const memRecoverTool: ToolDefinition = {
  name: 'mem_recover',
  description: 'Generate recovery context after compaction for a Work Unit',
  inputSchema: memRecoverSchema,

  async execute(input, options) {
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--wu', input.wu as string];
    if (input.max_size !== undefined) args.push('--max-size', String(input.max_size));
    if (input.format) args.push('--format', input.format as string);
    if (input.quiet) args.push('--quiet');
    if (input.base_dir) args.push(CliArgs.BASE_DIR, input.base_dir as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('mem:recover', args, cliOptions);

    if (result.success) {
      if (input.format === 'json') {
        try {
          const data = JSON.parse(result.stdout);
          return success(data);
        } catch {
          return success({ message: result.stdout || 'Recovery context generated' });
        }
      }
      return success({ message: result.stdout || 'Recovery context generated' });
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:recover failed',
        MemoryErrorCodes.MEM_RECOVER_ERROR,
      );
    }
  },
};

// ============================================================================
// Agent Operations (WU-1425)
// ============================================================================

/**
 * Error codes for agent tools
 */
const AgentErrorCodes = {
  AGENT_SESSION_ERROR: 'AGENT_SESSION_ERROR',
  AGENT_SESSION_END_ERROR: 'AGENT_SESSION_END_ERROR',
  AGENT_LOG_ISSUE_ERROR: 'AGENT_LOG_ISSUE_ERROR',
  AGENT_ISSUES_QUERY_ERROR: 'AGENT_ISSUES_QUERY_ERROR',
} as const;

/**
 * Error messages for agent tools
 */
const AgentErrorMessages = {
  WU_REQUIRED: SharedErrorMessages.WU_REQUIRED,
  TIER_REQUIRED: 'tier is required',
  CATEGORY_REQUIRED: 'category is required',
  SEVERITY_REQUIRED: 'severity is required',
  TITLE_REQUIRED: 'title is required',
  DESCRIPTION_REQUIRED: 'description is required',
} as const;

/**
 * agent_session - Start an agent session for tracking WU execution
 */
export const agentSessionTool: ToolDefinition = {
  name: 'agent_session',
  description: 'Start an agent session for tracking WU execution',
  inputSchema: agentSessionSchema,

  async execute(input, options) {
    if (!input.wu) {
      return error(AgentErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (input.tier === undefined || input.tier === null) {
      return error(AgentErrorMessages.TIER_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--wu', input.wu as string, '--tier', String(input.tier)];
    if (input.agent_type) args.push('--agent-type', input.agent_type as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('agent:session', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Session started' });
    } else {
      return error(
        result.stderr || result.error?.message || 'agent:session failed',
        AgentErrorCodes.AGENT_SESSION_ERROR,
      );
    }
  },
};

/**
 * agent_session_end - End the current agent session
 */
export const agentSessionEndTool: ToolDefinition = {
  name: 'agent_session_end',
  description: 'End the current agent session and return summary',
  inputSchema: agentSessionEndSchema,

  async execute(_input, options) {
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('agent:session-end', [], cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout || 'Session ended' });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'agent:session-end failed',
        AgentErrorCodes.AGENT_SESSION_END_ERROR,
      );
    }
  },
};

/**
 * agent_log_issue - Log a workflow issue or incident during agent execution
 */
export const agentLogIssueTool: ToolDefinition = {
  name: 'agent_log_issue',
  description: 'Log a workflow issue or incident during agent execution',
  inputSchema: agentLogIssueSchema,

  async execute(input, options) {
    if (!input.category) {
      return error(AgentErrorMessages.CATEGORY_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.severity) {
      return error(AgentErrorMessages.SEVERITY_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.title) {
      return error(AgentErrorMessages.TITLE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.description) {
      return error(AgentErrorMessages.DESCRIPTION_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [
      '--category',
      input.category as string,
      '--severity',
      input.severity as string,
      '--title',
      input.title as string,
      CliArgs.DESCRIPTION,
      input.description as string,
    ];
    if (input.resolution) args.push('--resolution', input.resolution as string);
    if (input.tags) {
      for (const tag of input.tags as string[]) {
        args.push('--tag', tag);
      }
    }
    if (input.step) args.push('--step', input.step as string);
    if (input.files) {
      for (const file of input.files as string[]) {
        args.push('--file', file);
      }
    }

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('agent:log-issue', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Issue logged' });
    } else {
      return error(
        result.stderr || result.error?.message || 'agent:log-issue failed',
        AgentErrorCodes.AGENT_LOG_ISSUE_ERROR,
      );
    }
  },
};

/**
 * agent_issues_query - Query and display logged agent incidents
 */
export const agentIssuesQueryTool: ToolDefinition = {
  name: 'agent_issues_query',
  description: 'Query and display logged agent incidents/issues summary',
  inputSchema: agentIssuesQuerySchema,

  async execute(input, options) {
    const args = ['summary'];
    if (input.since) args.push('--since', String(input.since));
    if (input.category) args.push('--category', input.category as string);
    if (input.severity) args.push('--severity', input.severity as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('agent:issues-query', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Query complete' });
    } else {
      return error(
        result.stderr || result.error?.message || 'agent:issues-query failed',
        AgentErrorCodes.AGENT_ISSUES_QUERY_ERROR,
      );
    }
  },
};

// ============================================================================
// Orchestration Operations (WU-1425)
// ============================================================================

/**
 * Error codes for orchestration tools
 */
const OrchestrationErrorCodes = {
  ORCHESTRATE_INITIATIVE_ERROR: 'ORCHESTRATE_INITIATIVE_ERROR',
  ORCHESTRATE_INIT_STATUS_ERROR: 'ORCHESTRATE_INIT_STATUS_ERROR',
  ORCHESTRATE_MONITOR_ERROR: 'ORCHESTRATE_MONITOR_ERROR',
} as const;

/**
 * Error messages for orchestration tools
 */
const OrchestrationErrorMessages = {
  INITIATIVE_REQUIRED: SharedErrorMessages.INITIATIVE_REQUIRED,
} as const;

/**
 * orchestrate_initiative - Orchestrate initiative execution with parallel agent spawning
 */
export const orchestrateInitiativeTool: ToolDefinition = {
  name: 'orchestrate_initiative',
  description: 'Orchestrate initiative execution with parallel agent spawning',
  inputSchema: orchestrateInitiativeSchema,

  async execute(input, options) {
    if (!input.initiative) {
      return error(OrchestrationErrorMessages.INITIATIVE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [CliArgs.INITIATIVE, input.initiative as string];
    if (input.dry_run) args.push(CliArgs.DRY_RUN);
    if (input.progress) args.push('--progress');
    if (input.checkpoint_per_wave) args.push('--checkpoint-per-wave');

    const cliOptions: CliRunnerOptions = {
      projectRoot: options?.projectRoot,
      timeout: 300000, // 5 minutes for orchestration
    };
    const result = await runCliCommand('orchestrate:initiative', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Orchestration complete' });
    } else {
      return error(
        result.stderr || result.error?.message || 'orchestrate:initiative failed',
        OrchestrationErrorCodes.ORCHESTRATE_INITIATIVE_ERROR,
      );
    }
  },
};

/**
 * orchestrate_init_status - Show initiative progress status
 */
export const orchestrateInitStatusTool: ToolDefinition = {
  name: 'orchestrate_init_status',
  description: 'Show compact initiative progress status including WUs and lane availability',
  inputSchema: orchestrateInitStatusSchema,

  async execute(input, options) {
    if (!input.initiative) {
      return error(OrchestrationErrorMessages.INITIATIVE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [CliArgs.INITIATIVE, input.initiative as string];

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('orchestrate:init-status', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Status displayed' });
    } else {
      return error(
        result.stderr || result.error?.message || 'orchestrate:init-status failed',
        OrchestrationErrorCodes.ORCHESTRATE_INIT_STATUS_ERROR,
      );
    }
  },
};

/**
 * orchestrate_monitor - Monitor spawned agent progress and spawn health
 */
export const orchestrateMonitorTool: ToolDefinition = {
  name: 'orchestrate_monitor',
  description: 'Monitor spawned agent progress and spawn health (stuck detection, zombie locks)',
  inputSchema: orchestrateMonitorSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.threshold) args.push(CliArgs.THRESHOLD, String(input.threshold));
    if (input.recover) args.push(CliArgs.RECOVER);
    if (input.dry_run) args.push(CliArgs.DRY_RUN);
    if (input.since) args.push('--since', input.since as string);
    if (input.wu) args.push(CliArgs.WU, input.wu as string);
    if (input.signals_only) args.push('--signals-only');

    const cliOptions: CliRunnerOptions = {
      projectRoot: options?.projectRoot,
      timeout: 180000, // 3 minutes for monitoring
    };
    const result = await runCliCommand('orchestrate:monitor', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Monitor complete' });
    } else {
      return error(
        result.stderr || result.error?.message || 'orchestrate:monitor failed',
        OrchestrationErrorCodes.ORCHESTRATE_MONITOR_ERROR,
      );
    }
  },
};

// ============================================================================
// Spawn Operations (WU-1425)
// ============================================================================

/**
 * Error codes for spawn tools
 */
const SpawnErrorCodes = {
  SPAWN_LIST_ERROR: 'SPAWN_LIST_ERROR',
} as const;

/**
 * Error messages for spawn tools
 */
const SpawnErrorMessages = {
  WU_OR_INITIATIVE_REQUIRED: 'Either wu or initiative is required',
} as const;

/**
 * spawn_list - Display spawn trees for WUs or initiatives
 */
export const spawnListTool: ToolDefinition = {
  name: 'spawn_list',
  description: 'Display spawn trees for WUs or initiatives',
  inputSchema: spawnListSchema,

  async execute(input, options) {
    if (!input.wu && !input.initiative) {
      return error(SpawnErrorMessages.WU_OR_INITIATIVE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args: string[] = [];
    if (input.wu) args.push(CliArgs.WU, input.wu as string);
    if (input.initiative) args.push(CliArgs.INITIATIVE, input.initiative as string);
    if (input.json) args.push('--json');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('spawn:list', args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout || 'Spawn list displayed' });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'spawn:list failed',
        SpawnErrorCodes.SPAWN_LIST_ERROR,
      );
    }
  },
};

// ============================================================================
// Flow/Metrics Operations (WU-1426)
// ============================================================================

/**
 * flow_bottlenecks - Identify flow bottlenecks
 */
export const flowBottlenecksTool: ToolDefinition = {
  name: 'flow_bottlenecks',
  description: 'Identify flow bottlenecks in the workflow (WIP violations, stuck WUs, etc.)',
  inputSchema: flowBottlenecksSchema,

  async execute(input, options) {
    const args: string[] = [];
    // WU-1457: Use shared schema fields (limit, format match CLI flags)
    if (input.limit) args.push('--limit', String(input.limit));
    if (input.format) args.push('--format', input.format as string);
    // WU-1452: flow:bottlenecks uses --format json, not --json
    if (input.json) args.push(...CliArgs.FORMAT_JSON);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('flow:bottlenecks', args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout || 'Bottleneck analysis complete' });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'flow:bottlenecks failed',
        ErrorCodes.FLOW_BOTTLENECKS_ERROR,
      );
    }
  },
};

/**
 * flow_report - Generate flow metrics report
 */
export const flowReportTool: ToolDefinition = {
  name: 'flow_report',
  description: 'Generate flow metrics report with cycle time, throughput, and other DORA metrics',
  inputSchema: flowReportSchema,

  async execute(input, options) {
    const args: string[] = [];
    // WU-1457: Use shared schema field names (start/end match CLI flags)
    if (input.start) args.push('--start', input.start as string);
    if (input.end) args.push('--end', input.end as string);
    if (input.days) args.push('--days', String(input.days));
    // WU-1452: flow:report uses --format, not --json
    if (input.format) args.push('--format', input.format as string);
    if (input.json) args.push(...CliArgs.FORMAT_JSON);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('flow:report', args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout || 'Flow report generated' });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'flow:report failed',
        ErrorCodes.FLOW_REPORT_ERROR,
      );
    }
  },
};

/**
 * metrics_snapshot - Capture metrics snapshot
 */
export const metricsSnapshotTool: ToolDefinition = {
  name: 'metrics_snapshot',
  description: 'Capture a snapshot of current LumenFlow metrics',
  inputSchema: metricsSnapshotSchema,

  async execute(_input, options) {
    // WU-1452: metrics:snapshot always outputs JSON (writes to file); no --json flag exists
    const args: string[] = [];

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('metrics:snapshot', args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout || 'Metrics snapshot captured' });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'metrics:snapshot failed',
        ErrorCodes.METRICS_SNAPSHOT_ERROR,
      );
    }
  },
};

// ============================================================================
// Validation Operations (WU-1426)
// ============================================================================

/**
 * validate - Validate WU YAML files
 */
export const validateTool: ToolDefinition = {
  name: 'validate',
  description: 'Validate WU YAML files and status consistency',
  inputSchema: validateSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.id) args.push('--id', input.id as string);
    if (input.strict) args.push('--strict');
    if (input.done_only) args.push('--done-only');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('validate', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Validation passed' });
    } else {
      return error(
        result.stderr || result.error?.message || 'Validation failed',
        ErrorCodes.VALIDATE_ERROR,
      );
    }
  },
};

/**
 * validate_agent_skills - Validate agent skill definitions
 */
export const validateAgentSkillsTool: ToolDefinition = {
  name: 'validate_agent_skills',
  description: 'Validate agent skill definitions in .claude/skills/',
  inputSchema: validateAgentSkillsSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.skill) args.push('--skill', input.skill as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('validate:agent-skills', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'All skills valid' });
    } else {
      return error(
        result.stderr || result.error?.message || 'validate:agent-skills failed',
        ErrorCodes.VALIDATE_AGENT_SKILLS_ERROR,
      );
    }
  },
};

/**
 * validate_agent_sync - Validate agent sync state
 */
export const validateAgentSyncTool: ToolDefinition = {
  name: 'validate_agent_sync',
  description: 'Validate agent synchronization state',
  inputSchema: validateAgentSyncSchema,

  async execute(_input, options) {
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('validate:agent-sync', [], cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Agent sync valid' });
    } else {
      return error(
        result.stderr || result.error?.message || 'validate:agent-sync failed',
        ErrorCodes.VALIDATE_AGENT_SYNC_ERROR,
      );
    }
  },
};

/**
 * validate_backlog_sync - Validate backlog synchronization
 */
export const validateBacklogSyncTool: ToolDefinition = {
  name: 'validate_backlog_sync',
  description: 'Validate backlog synchronization between WU YAMLs and backlog.md',
  inputSchema: validateBacklogSyncSchema,

  async execute(_input, options) {
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('validate:backlog-sync', [], cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Backlog sync valid' });
    } else {
      return error(
        result.stderr || result.error?.message || 'validate:backlog-sync failed',
        ErrorCodes.VALIDATE_BACKLOG_SYNC_ERROR,
      );
    }
  },
};

/**
 * validate_skills_spec - Validate skills specification
 */
export const validateSkillsSpecTool: ToolDefinition = {
  name: 'validate_skills_spec',
  description: 'Validate skills specification files',
  inputSchema: validateSkillsSpecSchema,

  async execute(_input, options) {
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('validate:skills-spec', [], cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Skills spec valid' });
    } else {
      return error(
        result.stderr || result.error?.message || 'validate:skills-spec failed',
        ErrorCodes.VALIDATE_SKILLS_SPEC_ERROR,
      );
    }
  },
};

// ============================================================================
// Setup/LumenFlow Operations (WU-1426)
// ============================================================================

/**
 * lumenflow_init - Initialize LumenFlow in a project
 */
export const lumenflowInitTool: ToolDefinition = {
  name: 'lumenflow_init',
  description: 'Initialize LumenFlow workflow framework in a project',
  inputSchema: lumenflowInitSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.client) args.push('--client', input.client as string);
    if (input.merge) args.push('--merge');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('lumenflow', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'LumenFlow initialized' });
    } else {
      return error(
        result.stderr || result.error?.message || 'lumenflow failed',
        ErrorCodes.LUMENFLOW_INIT_ERROR,
      );
    }
  },
};

/**
 * lumenflow_doctor - Diagnose LumenFlow configuration
 */
export const lumenflowDoctorTool: ToolDefinition = {
  name: 'lumenflow_doctor',
  description: 'Diagnose LumenFlow configuration and safety components',
  inputSchema: lumenflowDoctorSchema,

  async execute(_input, options) {
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('lumenflow:doctor', [], cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'LumenFlow safety: ACTIVE' });
    } else {
      return error(
        result.stderr || result.error?.message || 'Doctor found issues',
        ErrorCodes.LUMENFLOW_DOCTOR_ERROR,
      );
    }
  },
};

/**
 * lumenflow_integrate - Generate enforcement hooks for a client
 */
export const lumenflowIntegrateTool: ToolDefinition = {
  name: 'lumenflow_integrate',
  description: 'Generate enforcement hooks for a specific client (e.g., claude-code)',
  inputSchema: lumenflowIntegrateSchema,

  async execute(input, options) {
    if (!input.client) {
      return error(ErrorMessages.CLIENT_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--client', input.client as string];

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('lumenflow:integrate', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Hooks generated' });
    } else {
      return error(
        result.stderr || result.error?.message || 'lumenflow:integrate failed',
        ErrorCodes.LUMENFLOW_INTEGRATE_ERROR,
      );
    }
  },
};

/**
 * lumenflow_upgrade - Upgrade LumenFlow packages
 */
export const lumenflowUpgradeTool: ToolDefinition = {
  name: 'lumenflow_upgrade',
  description: 'Upgrade LumenFlow packages to latest versions',
  inputSchema: lumenflowUpgradeSchema,

  async execute(_input, options) {
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('lumenflow:upgrade', [], cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'LumenFlow upgraded' });
    } else {
      return error(
        result.stderr || result.error?.message || 'lumenflow:upgrade failed',
        ErrorCodes.LUMENFLOW_UPGRADE_ERROR,
      );
    }
  },
};

/**
 * lumenflow_commands - List all available CLI commands
 */
export const lumenflowCommandsTool: ToolDefinition = {
  name: 'lumenflow_commands',
  description: 'List all available LumenFlow CLI commands',
  inputSchema: lumenflowCommandsSchema,

  async execute(_input, options) {
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('lumenflow', ['commands'], cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Commands listed' });
    } else {
      return error(
        result.stderr || result.error?.message || 'lumenflow commands failed',
        ErrorCodes.LUMENFLOW_COMMANDS_ERROR,
      );
    }
  },
};

/**
 * lumenflow_docs_sync - Sync agent documentation
 */
export const lumenflowDocsSyncTool: ToolDefinition = {
  name: 'lumenflow_docs_sync',
  description: 'Sync agent documentation after upgrading LumenFlow packages',
  inputSchema: docsSyncSchema,

  async execute(_input, options) {
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('docs:sync', [], cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Docs synced' });
    } else {
      return error(
        result.stderr || result.error?.message || 'docs:sync failed',
        ErrorCodes.LUMENFLOW_DOCS_SYNC_ERROR,
      );
    }
  },
};

/**
 * lumenflow_release - Run release workflow
 */
export const lumenflowReleaseTool: ToolDefinition = {
  name: 'lumenflow_release',
  description: 'Run LumenFlow release workflow (versioning, npm publish)',
  inputSchema: releaseSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.dry_run) args.push(CliArgs.DRY_RUN);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('lumenflow:release', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Release complete' });
    } else {
      return error(
        result.stderr || result.error?.message || 'release failed',
        ErrorCodes.LUMENFLOW_RELEASE_ERROR,
      );
    }
  },
};

/**
 * lumenflow_sync_templates - Sync templates to project
 */
export const lumenflowSyncTemplatesTool: ToolDefinition = {
  name: 'lumenflow_sync_templates',
  description: 'Sync LumenFlow templates to the project',
  inputSchema: syncTemplatesSchema,

  async execute(_input, options) {
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('sync:templates', [], cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Templates synced' });
    } else {
      return error(
        result.stderr || result.error?.message || 'sync:templates failed',
        ErrorCodes.LUMENFLOW_SYNC_TEMPLATES_ERROR,
      );
    }
  },
};

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
  // WU-1425: Spawn tools
  spawnListTool,
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

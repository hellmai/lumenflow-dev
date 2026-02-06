/**
 * @file tools.ts
 * @description MCP tool implementations for LumenFlow operations
 *
 * WU-1412: Tools available: context_get, wu_list, wu_status, wu_create, wu_claim, wu_done, gates_run
 * WU-1422: Additional WU tools: wu_block, wu_unblock, wu_edit, wu_release, wu_recover, wu_repair,
 *          wu_deps, wu_prep, wu_preflight, wu_prune, wu_delete, wu_cleanup, wu_spawn, wu_validate,
 *          wu_infer_lane, wu_unlock_lane
 * WU-1424: Initiative tools: initiative_list, initiative_status, initiative_create, initiative_edit,
 *          initiative_add_wu, initiative_remove_wu, initiative_bulk_assign, initiative_plan
 *          Memory tools: mem_init, mem_start, mem_ready, mem_checkpoint, mem_cleanup, mem_context,
 *          mem_create, mem_delete, mem_export, mem_inbox, mem_signal, mem_summarize, mem_triage
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
 * WU-1456: All 13 memory commands now use shared schemas
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
  WU_SPAWN_ERROR: 'WU_SPAWN_ERROR',
  WU_VALIDATE_ERROR: 'WU_VALIDATE_ERROR',
  WU_INFER_LANE_ERROR: 'WU_INFER_LANE_ERROR',
  WU_UNLOCK_LANE_ERROR: 'WU_UNLOCK_LANE_ERROR',
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
  REASON_REQUIRED: 'reason is required',
  CLIENT_REQUIRED: 'client is required',
} as const;

/**
 * CLI argument constants for commonly used flags
 */
const CliArgs = {
  DESCRIPTION: '--description',
  INITIATIVE: '--initiative',
  PHASE: '--phase',
  JSON: '--json',
  // WU-1452: Commands using --format json (initiative:*, flow:*, metrics)
  FORMAT_JSON: ['--format', 'json'] as const,
  DRY_RUN: '--dry-run',
  THRESHOLD: '--threshold',
  RECOVER: '--recover',
  WU: '--wu',
} as const;

/**
 * Schema description constants for commonly used descriptions
 */
const SchemaDescriptions = {
  INITIATIVE_ID: 'Initiative ID',
  INITIATIVE_ID_EXAMPLE: 'Initiative ID (e.g., INIT-001)',
  OUTPUT_AS_JSON: 'Output as JSON',
  PHASE_NUMBER: 'Phase number within initiative',
} as const;

/**
 * Shared error messages to avoid duplication across different tool categories
 */
const SharedErrorMessages = {
  WU_REQUIRED: 'wu is required',
  INITIATIVE_REQUIRED: 'initiative is required',
} as const;

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
        args.push('--code-paths', p);
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
      args.push('--docs-only');
    }

    const cliOptions: CliRunnerOptions = {
      projectRoot: options?.projectRoot,
      timeout: 600000, // 10 minutes for gates
    };
    const result = await runCliCommand('gates', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'All gates passed' });
    } else {
      return error(
        result.stderr || result.error?.message || 'Gates failed',
        ErrorCodes.GATES_ERROR,
      );
    }
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
        args.push('--code-paths', p);
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
    if (input.docs_only) args.push('--docs-only');

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
 * wu_spawn - Generate Task tool invocation for sub-agent WU execution
 */
export const wuSpawnTool: ToolDefinition = {
  name: 'wu_spawn',
  description: 'Generate sub-agent spawn prompt for WU execution',
  // WU-1454: Use shared schema
  inputSchema: wuSpawnSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string];
    if (input.client) args.push('--client', input.client as string);
    if (input.thinking) args.push('--thinking');
    if (input.budget) args.push('--budget', String(input.budget));
    if (input.parent_wu) args.push('--parent-wu', input.parent_wu as string);
    if (input.no_context) args.push('--no-context');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('wu:spawn', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Spawn prompt generated' });
    } else {
      return error(
        result.stderr || result.error?.message || 'wu:spawn failed',
        ErrorCodes.WU_SPAWN_ERROR,
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
  inputSchema: z.object({
    wu: z.string().describe('WU ID to work on (e.g., WU-1234)'),
    tier: z.number().min(1).max(3).describe('Context tier (1, 2, or 3)'),
    agent_type: z.string().optional().describe('Agent type (default: claude-code)'),
  }),

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
  inputSchema: z.object({}),

  async execute(_input, options) {
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('agent:session:end', [], cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout || 'Session ended' });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'agent:session:end failed',
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
  inputSchema: z.object({
    category: z
      .enum(['workflow', 'tooling', 'confusion', 'violation', 'error'])
      .describe('Issue category'),
    severity: z.enum(['blocker', 'major', 'minor', 'info']).describe('Severity level'),
    title: z.string().describe('Short description (5-100 chars)'),
    description: z.string().describe('Detailed context (10-2000 chars)'),
    resolution: z.string().optional().describe('How the issue was resolved'),
    tags: z.array(z.string()).optional().describe('Tags for categorization'),
    step: z.string().optional().describe('Current workflow step (e.g., wu:done, gates)'),
    files: z.array(z.string()).optional().describe('Related file paths'),
  }),

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
      '--description',
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
  inputSchema: z.object({
    since: z.number().optional().describe('Days to include (default: 7)'),
    category: z.string().optional().describe('Filter by category'),
    severity: z
      .enum(['blocker', 'major', 'minor', 'trivial'])
      .optional()
      .describe('Filter by severity'),
  }),

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
  inputSchema: z.object({
    initiative: z.string().describe('Initiative ID to orchestrate (e.g., INIT-001)'),
    dry_run: z.boolean().optional().describe('Show execution plan without spawning agents'),
    progress: z.boolean().optional().describe('Show current progress only'),
    checkpoint_per_wave: z.boolean().optional().describe('Spawn next wave then exit (no polling)'),
  }),

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
  inputSchema: z.object({
    initiative: z.string().describe(SchemaDescriptions.INITIATIVE_ID_EXAMPLE),
  }),

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
  inputSchema: z.object({
    threshold: z.number().optional().describe('Stuck detection threshold in minutes (default: 30)'),
    recover: z.boolean().optional().describe('Run recovery actions for stuck spawns'),
    dry_run: z.boolean().optional().describe('Show what would be done without taking action'),
    since: z.string().optional().describe('Show signals since (e.g., 30m, 1h)'),
    wu: z.string().optional().describe('Filter by WU ID'),
    signals_only: z.boolean().optional().describe('Only show signals (skip spawn analysis)'),
  }),

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
  inputSchema: z.object({
    wu: z.string().optional().describe('WU ID to show spawns for (e.g., WU-1234)'),
    initiative: z
      .string()
      .optional()
      .describe('Initiative ID to show all spawns for (e.g., INIT-001)'),
    json: z.boolean().optional().describe('Output as JSON'),
  }),

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
  inputSchema: z.object({
    json: z.boolean().optional().describe(SchemaDescriptions.OUTPUT_AS_JSON),
  }),

  async execute(input, options) {
    const args: string[] = [];
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
  inputSchema: z.object({
    since: z.string().optional().describe('Start date or duration (e.g., "7d", "2025-01-01")'),
    until: z.string().optional().describe('End date (e.g., "now", "2025-01-31")'),
    json: z.boolean().optional().describe(SchemaDescriptions.OUTPUT_AS_JSON),
  }),

  async execute(input, options) {
    const args: string[] = [];
    if (input.since) args.push('--since', input.since as string);
    if (input.until) args.push('--until', input.until as string);
    // WU-1452: flow:report uses --format json, not --json
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
  inputSchema: z.object({
    json: z.boolean().optional().describe(SchemaDescriptions.OUTPUT_AS_JSON),
  }),

  async execute(input, options) {
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
  inputSchema: z.object({
    id: z.string().optional().describe('Specific WU ID to validate'),
    strict: z.boolean().optional().describe('Fail on warnings too'),
    done_only: z.boolean().optional().describe('Only validate done WUs'),
  }),

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
  inputSchema: z.object({
    skill: z.string().optional().describe('Specific skill to validate (e.g., "wu-lifecycle")'),
  }),

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
  inputSchema: z.object({}),

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
  inputSchema: z.object({}),

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
  inputSchema: z.object({}),

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
  inputSchema: z.object({
    client: z.string().optional().describe('Client type (claude, cursor, windsurf, all)'),
    merge: z.boolean().optional().describe('Merge into existing files using bounded markers'),
  }),

  async execute(input, options) {
    const args: string[] = [];
    if (input.client) args.push('--client', input.client as string);
    if (input.merge) args.push('--merge');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('lumenflow:init', args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'LumenFlow initialized' });
    } else {
      return error(
        result.stderr || result.error?.message || 'lumenflow:init failed',
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
  inputSchema: z.object({}),

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
  inputSchema: z.object({
    client: z.string().describe('Client name (claude-code, cursor, etc.)'),
  }),

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
  inputSchema: z.object({}),

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
  inputSchema: z.object({}),

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
  inputSchema: z.object({}),

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
  inputSchema: z.object({
    dry_run: z.boolean().optional().describe('Preview release without publishing'),
  }),

  async execute(input, options) {
    const args: string[] = [];
    if (input.dry_run) args.push(CliArgs.DRY_RUN);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('release', args, cliOptions);

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
  inputSchema: z.object({}),

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
  wuSpawnTool,
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

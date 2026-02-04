/**
 * @file tools.ts
 * @description MCP tool implementations for LumenFlow operations
 *
 * WU-1412: Tools available: context_get, wu_list, wu_status, wu_create, wu_claim, wu_done, gates_run
 * WU-1422: Additional WU tools: wu_block, wu_unblock, wu_edit, wu_release, wu_recover, wu_repair,
 *          wu_deps, wu_prep, wu_preflight, wu_prune, wu_delete, wu_cleanup, wu_spawn, wu_validate,
 *          wu_infer_lane, wu_unlock_lane
 * WU-1431: Uses shared Zod schemas from @lumenflow/core for CLI/MCP parity
 *
 * Architecture:
 * - Read operations (context_get) use @lumenflow/core directly for context
 * - All other operations shell out to CLI for consistency and safety
 * - Input schemas are derived from shared schemas in @lumenflow/core (WU-1431)
 */

import { z } from 'zod';
import { runCliCommand, type CliRunnerOptions } from './cli-runner.js';

// WU-1431: Import shared command schemas for CLI/MCP parity
// These are the single source of truth for command validation
import {
  wuCreateSchema,
  wuClaimSchema,
  wuStatusSchema,
  wuDoneSchema,
  gatesSchema,
  wuStatusEnum,
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
} as const;

/**
 * Error messages used by tool implementations
 */
const ErrorMessages = {
  ID_REQUIRED: 'id is required',
  LANE_REQUIRED: 'lane is required',
  TITLE_REQUIRED: 'title is required',
  REASON_REQUIRED: 'reason is required',
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
    if (input.description) args.push('--description', input.description as string);
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
  inputSchema: z.object({
    id: z.string().describe('WU ID to block'),
    reason: z.string().describe('Reason for blocking'),
    remove_worktree: z.boolean().optional().describe('Remove worktree when blocking'),
  }),

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
  inputSchema: z.object({
    id: z.string().describe('WU ID to unblock'),
    reason: z.string().optional().describe('Reason for unblocking'),
    create_worktree: z.boolean().optional().describe('Create worktree when unblocking'),
  }),

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
  inputSchema: z.object({
    id: z.string().describe('WU ID to edit'),
    description: z.string().optional().describe('New description text'),
    acceptance: z.array(z.string()).optional().describe('Acceptance criteria to add'),
    notes: z.string().optional().describe('Notes text to add'),
    code_paths: z.array(z.string()).optional().describe('Code paths to add'),
    lane: z.string().optional().describe('New lane assignment'),
    priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional().describe('New priority'),
    initiative: z.string().optional().describe('Initiative ID'),
    phase: z.number().optional().describe('Phase number within initiative'),
    no_strict: z.boolean().optional().describe('Bypass strict validation'),
  }),

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string];
    if (input.description) args.push('--description', input.description as string);
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
    if (input.initiative) args.push('--initiative', input.initiative as string);
    if (input.phase) args.push('--phase', String(input.phase));
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
  inputSchema: z.object({
    id: z.string().describe('WU ID to release'),
    reason: z.string().optional().describe('Reason for releasing'),
  }),

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
  inputSchema: z.object({
    id: z.string().describe('WU ID to recover'),
    action: z
      .enum(['resume', 'reset', 'nuke', 'cleanup'])
      .optional()
      .describe('Recovery action to take'),
    force: z.boolean().optional().describe('Required for destructive actions like nuke'),
    json: z.boolean().optional().describe('Output as JSON'),
  }),

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = ['--id', input.id as string];
    if (input.action) args.push('--action', input.action as string);
    if (input.force) args.push('--force');
    if (input.json) args.push('--json');

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
  inputSchema: z.object({
    id: z.string().optional().describe('WU ID to check/repair'),
    check: z.boolean().optional().describe('Audit only, no changes'),
    all: z.boolean().optional().describe('Check/repair all WUs'),
    claim: z.boolean().optional().describe('Claim repair mode'),
    admin: z.boolean().optional().describe('Admin repair mode'),
    repair_state: z.boolean().optional().describe('State repair mode'),
  }),

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
  inputSchema: z.object({
    id: z.string().describe('WU ID to analyze'),
    format: z.enum(['table', 'json', 'ascii', 'mermaid']).optional().describe('Output format'),
    depth: z.number().optional().describe('Maximum traversal depth'),
    direction: z.enum(['up', 'down', 'both']).optional().describe('Graph direction'),
  }),

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
  inputSchema: z.object({
    id: z.string().describe('WU ID to prepare'),
    docs_only: z.boolean().optional().describe('Run docs-only gates'),
  }),

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
  inputSchema: z.object({
    id: z.string().describe('WU ID to preflight'),
    worktree: z.string().optional().describe('Override worktree path'),
  }),

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
  inputSchema: z.object({
    execute: z.boolean().optional().describe('Execute cleanup (default is dry-run)'),
  }),

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
  inputSchema: z.object({
    id: z.string().describe('WU ID to delete'),
    dry_run: z.boolean().optional().describe('Show what would be deleted without making changes'),
    batch: z.string().optional().describe('Delete multiple WUs (comma-separated)'),
  }),

  async execute(input, options) {
    if (!input.id && !input.batch) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args: string[] = [];
    if (input.id) args.push('--id', input.id as string);
    if (input.dry_run) args.push('--dry-run');
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
  inputSchema: z.object({
    id: z.string().describe('WU ID to cleanup'),
    artifacts: z.boolean().optional().describe('Remove build artifacts'),
  }),

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
  inputSchema: z.object({
    id: z.string().describe('WU ID to spawn'),
    client: z.string().optional().describe('Client name (claude-code, gemini-cli, etc)'),
    thinking: z.boolean().optional().describe('Enable extended thinking'),
    budget: z.number().optional().describe('Token budget for extended thinking'),
    parent_wu: z.string().optional().describe('Parent WU ID for orchestrator context'),
    no_context: z.boolean().optional().describe('Skip memory context injection'),
  }),

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
  inputSchema: z.object({
    id: z.string().describe('WU ID to validate'),
    no_strict: z.boolean().optional().describe('Bypass strict validation'),
  }),

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
  inputSchema: z.object({
    id: z.string().optional().describe('WU ID to analyze (reads YAML)'),
    paths: z.array(z.string()).optional().describe('Code paths to analyze'),
    desc: z.string().optional().describe('WU description/title text'),
  }),

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
  inputSchema: z.object({
    lane: z.string().optional().describe('Lane name to unlock'),
    reason: z.string().optional().describe('Reason for unlocking'),
    force: z.boolean().optional().describe('Force operation'),
    list: z.boolean().optional().describe('List all current lane locks'),
    status: z.boolean().optional().describe('Show detailed status for the lane'),
  }),

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
];

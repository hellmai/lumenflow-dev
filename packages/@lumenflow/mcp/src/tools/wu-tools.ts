/**
 * @file wu-tools.ts
 * @description WU lifecycle tool implementations (create, claim, done, block, edit, etc.)
 *
 * WU-1642: Extracted from tools.ts during domain decomposition.
 * WU-1412: Core WU tools: wu_status, wu_create, wu_claim, wu_done, gates_run
 * WU-1422: Additional WU tools
 * WU-1431: Uses shared Zod schemas from @lumenflow/core for CLI/MCP parity
 * WU-1454: All 16 WU lifecycle commands now use shared schemas
 */

import { z } from 'zod';
import {
  wuCreateSchema,
  wuClaimSchema,
  wuStatusSchema,
  wuDoneSchema,
  gatesSchema,
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
} from '@lumenflow/core';
import {
  type ToolDefinition,
  ErrorCodes,
  ErrorMessages,
  CliArgs,
  SuccessMessages,
  getCore,
  success,
  error,
  buildWuPromptArgs,
  runCliCommand,
  type CliRunnerOptions,
} from '../tools-shared.js';

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
    if (input.full_tests) args.push('--full-tests');

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

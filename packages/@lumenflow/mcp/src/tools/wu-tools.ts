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
  executeViaPack,
  type CliRunnerOptions,
} from '../tools-shared.js';
import { CliCommands, MetadataKeys } from '../mcp-constants.js';

/**
 * WU-1805: Fallback messages for WU query tools when executeViaPack
 * returns no structured data.
 */
const WuQueryMessages = {
  STATUS_FAILED: 'wu:status failed',
  CREATE_PASSED: 'WU created successfully',
  CREATE_FAILED: 'wu:create failed',
  CLAIM_PASSED: 'WU claimed successfully',
  CLAIM_FAILED: 'wu:claim failed',
  DEPS_FAILED: 'wu:deps failed',
  PREFLIGHT_PASSED: 'Preflight checks passed',
  PREFLIGHT_FAILED: 'wu:preflight failed',
  VALIDATE_PASSED: 'WU is valid',
  VALIDATE_FAILED: 'wu:validate failed',
  INFER_LANE_FAILED: 'wu:infer-lane failed',
} as const;

const WuStateTransitionMessages = {
  BLOCK_PASSED: 'WU blocked successfully',
  BLOCK_FAILED: 'wu:block failed',
  UNBLOCK_PASSED: 'WU unblocked successfully',
  UNBLOCK_FAILED: 'wu:unblock failed',
  EDIT_PASSED: 'WU edited successfully',
  EDIT_FAILED: 'wu:edit failed',
  RELEASE_PASSED: 'WU released successfully',
  RELEASE_FAILED: 'wu:release failed',
} as const;

const WuCompletionLifecycleMessages = {
  SANDBOX_PASSED: 'WU sandbox command completed successfully',
  SANDBOX_FAILED: 'wu:sandbox failed',
  DONE_PASSED: 'WU completed successfully',
  DONE_FAILED: 'wu:done failed',
  PREP_PASSED: 'WU prep completed',
  PREP_FAILED: 'wu:prep failed',
  PRUNE_PASSED: 'Prune completed',
  PRUNE_FAILED: 'wu:prune failed',
  DELETE_PASSED: 'WU deleted',
  DELETE_FAILED: 'wu:delete failed',
  CLEANUP_PASSED: 'Cleanup complete',
  CLEANUP_FAILED: 'wu:cleanup failed',
} as const;

const WuDelegationAndGatesMessages = {
  GATES_FAILED: 'Gates failed',
  BRIEF_PASSED: 'Brief prompt generated',
  BRIEF_FAILED: 'wu:brief failed',
  DELEGATE_PASSED: 'Delegation prompt generated',
  DELEGATE_FAILED: 'wu:delegate failed',
  UNLOCK_PASSED: 'Lane unlocked',
  UNLOCK_FAILED: 'wu:unlock-lane failed',
} as const;

const GatesRuntimeConstants = {
  FALLBACK_TIMEOUT_MS: 600000,
} as const;

const WuQueryFlags = {
  NO_STRICT: '--no-strict',
  WORKTREE: '--worktree',
  DEPTH: '--depth',
  DIRECTION: '--direction',
  PATHS: '--paths',
  DESC: '--desc',
} as const;

/**
 * wu_status - Get status of a specific WU
 *
 * WU-1431: Uses shared wuStatusSchema for parity with CLI
 * WU-1805: Migrated from runCliCommand to executeViaPack (runtime-first)
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

    const args = [CliArgs.ID, input.id as string, CliArgs.JSON];

    const result = await executeViaPack(CliCommands.WU_STATUS, input, {
      projectRoot: options?.projectRoot,
      fallback: {
        command: CliCommands.WU_STATUS,
        args,
        errorCode: ErrorCodes.WU_STATUS_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: result.data })
      : error(result.error?.message ?? WuQueryMessages.STATUS_FAILED, ErrorCodes.WU_STATUS_ERROR);
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

    const args: string[] = [CliArgs.LANE, input.lane as string, '--title', input.title as string];

    if (input.id) args.push(CliArgs.ID, input.id as string);
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

    const result = await executeViaPack(CliCommands.WU_CREATE, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.WU_CREATE,
        args,
        errorCode: ErrorCodes.WU_CREATE_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: WuQueryMessages.CREATE_PASSED })
      : error(result.error?.message ?? WuQueryMessages.CREATE_FAILED, ErrorCodes.WU_CREATE_ERROR);
  },
};

/**
 * wu_claim - Claim a WU and create worktree
 *
 * WU-1431: Uses shared wuClaimSchema for CLI/MCP parity
 * WU-1491: Supports --cloud, --branch-only, and --pr-mode passthrough
 */
const wuClaimToolSchema = wuClaimSchema.extend({
  sandbox: z
    .boolean()
    .optional()
    .describe('Launch post-claim session through wu:sandbox (requires sandbox_command in MCP)'),
  sandbox_command: z
    .array(z.string())
    .optional()
    .describe('Command argv to run with --sandbox (e.g., ["node", "-v"])'),
});

export const wuClaimTool: ToolDefinition = {
  name: 'wu_claim',
  description: 'Claim a Work Unit and create worktree for implementation',
  // WU-1431: Extend shared schema with MCP-safe sandbox launch controls
  inputSchema: wuClaimToolSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.lane) {
      return error(ErrorMessages.LANE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [CliArgs.ID, input.id as string, CliArgs.LANE, input.lane as string];
    // WU-1491: Pass mode flags through to CLI
    if (input.cloud) args.push('--cloud');
    if (input.branch_only) args.push('--branch-only');
    if (input.pr_mode) args.push('--pr-mode');
    if (input.sandbox) {
      const sandboxCommand = Array.isArray(input.sandbox_command)
        ? (input.sandbox_command as string[])
        : [];
      if (sandboxCommand.length === 0) {
        return error(
          'sandbox_command is required when sandbox=true for MCP execution',
          ErrorCodes.MISSING_PARAMETER,
        );
      }
      args.push('--sandbox', '--', ...sandboxCommand);
    }

    const result = await executeViaPack(CliCommands.WU_CLAIM, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.WU_CLAIM,
        args,
        errorCode: ErrorCodes.WU_CLAIM_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: WuQueryMessages.CLAIM_PASSED })
      : error(result.error?.message ?? WuQueryMessages.CLAIM_FAILED, ErrorCodes.WU_CLAIM_ERROR);
  },
};

/**
 * wu_sandbox - Execute a command through the sandbox backend for this platform
 */
const wuSandboxSchema = z.object({
  id: z.string().describe('WU ID (e.g., WU-1687)'),
  worktree: z.string().optional().describe('Optional worktree path override'),
  command: z
    .array(z.string())
    .min(1)
    .describe('Command argv to execute (e.g., ["node", "-e", "process.exit(0)"])'),
});

export const wuSandboxTool: ToolDefinition = {
  name: 'wu_sandbox',
  description: 'Run a command through the hardened WU sandbox backend',
  inputSchema: wuSandboxSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const command = Array.isArray(input.command) ? (input.command as string[]) : [];
    if (command.length === 0) {
      return error('command is required', ErrorCodes.MISSING_PARAMETER);
    }

    const args = [CliArgs.ID, input.id as string];
    if (input.worktree) {
      args.push('--worktree', input.worktree as string);
    }
    args.push('--', ...command);

    const result = await executeViaPack(CliCommands.WU_SANDBOX, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.WU_SANDBOX,
        args,
        errorCode: ErrorCodes.WU_CLAIM_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: WuCompletionLifecycleMessages.SANDBOX_PASSED })
      : error(
          result.error?.message ?? WuCompletionLifecycleMessages.SANDBOX_FAILED,
          ErrorCodes.WU_CLAIM_ERROR,
        );
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

    const args = [CliArgs.ID, input.id as string];
    if (input.skip_gates) {
      args.push('--skip-gates');
      if (input.reason) args.push(CliArgs.REASON, input.reason as string);
      if (input.fix_wu) args.push('--fix-wu', input.fix_wu as string);
    }

    const result = await executeViaPack(CliCommands.WU_DONE, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.WU_DONE,
        args,
        errorCode: ErrorCodes.WU_DONE_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: WuCompletionLifecycleMessages.DONE_PASSED })
      : error(
          result.error?.message ?? WuCompletionLifecycleMessages.DONE_FAILED,
          ErrorCodes.WU_DONE_ERROR,
        );
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

    const result = await executeViaPack(CliCommands.GATES, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.GATES,
        args,
        errorCode: ErrorCodes.GATES_ERROR,
      },
      fallbackCliOptions: {
        timeout: GatesRuntimeConstants.FALLBACK_TIMEOUT_MS,
      },
    });

    return result.success
      ? success(result.data ?? { message: SuccessMessages.ALL_GATES_PASSED })
      : error(
          result.error?.message ?? WuDelegationAndGatesMessages.GATES_FAILED,
          ErrorCodes.GATES_ERROR,
        );
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

    const args = [CliArgs.ID, input.id as string, CliArgs.REASON, input.reason as string];
    if (input.remove_worktree) {
      args.push('--remove-worktree');
    }

    const result = await executeViaPack(CliCommands.WU_BLOCK, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.WU_BLOCK,
        args,
        errorCode: ErrorCodes.WU_BLOCK_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: WuStateTransitionMessages.BLOCK_PASSED })
      : error(
          result.error?.message ?? WuStateTransitionMessages.BLOCK_FAILED,
          ErrorCodes.WU_BLOCK_ERROR,
        );
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

    const args = [CliArgs.ID, input.id as string];
    if (input.reason) args.push(CliArgs.REASON, input.reason as string);
    if (input.create_worktree) args.push('--create-worktree');

    const result = await executeViaPack(CliCommands.WU_UNBLOCK, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.WU_UNBLOCK,
        args,
        errorCode: ErrorCodes.WU_UNBLOCK_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: WuStateTransitionMessages.UNBLOCK_PASSED })
      : error(
          result.error?.message ?? WuStateTransitionMessages.UNBLOCK_FAILED,
          ErrorCodes.WU_UNBLOCK_ERROR,
        );
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

    const args = [CliArgs.ID, input.id as string];
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
    if (input.lane) args.push(CliArgs.LANE, input.lane as string);
    if (input.priority) args.push('--priority', input.priority as string);
    if (input.initiative) args.push(CliArgs.INITIATIVE, input.initiative as string);
    if (input.phase) args.push(CliArgs.PHASE, String(input.phase));
    if (input.no_strict) args.push('--no-strict');

    const result = await executeViaPack(CliCommands.WU_EDIT, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.WU_EDIT,
        args,
        errorCode: ErrorCodes.WU_EDIT_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: WuStateTransitionMessages.EDIT_PASSED })
      : error(
          result.error?.message ?? WuStateTransitionMessages.EDIT_FAILED,
          ErrorCodes.WU_EDIT_ERROR,
        );
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

    const args = [CliArgs.ID, input.id as string];
    if (input.reason) args.push(CliArgs.REASON, input.reason as string);

    const result = await executeViaPack(CliCommands.WU_RELEASE, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.WU_RELEASE,
        args,
        errorCode: ErrorCodes.WU_RELEASE_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: WuStateTransitionMessages.RELEASE_PASSED })
      : error(
          result.error?.message ?? WuStateTransitionMessages.RELEASE_FAILED,
          ErrorCodes.WU_RELEASE_ERROR,
        );
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

    const args = [CliArgs.ID, input.id as string];
    if (input.action) args.push('--action', input.action as string);
    if (input.force) args.push(CliArgs.FORCE);
    if (input.json) args.push(CliArgs.JSON);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.WU_RECOVER, args, cliOptions);

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
    if (input.id) args.push(CliArgs.ID, input.id as string);
    if (input.check) args.push('--check');
    if (input.all) args.push('--all');
    if (input.claim) args.push('--claim');
    if (input.admin) args.push('--admin');
    if (input.repair_state) args.push('--repair-state');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.WU_REPAIR, args, cliOptions);

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

    const args = [CliArgs.ID, input.id as string];
    if (input.format) args.push(CliArgs.FORMAT, input.format as string);
    if (input.depth) args.push(WuQueryFlags.DEPTH, String(input.depth));
    if (input.direction) args.push(WuQueryFlags.DIRECTION, input.direction as string);

    const result = await executeViaPack(CliCommands.WU_DEPS, input, {
      projectRoot: options?.projectRoot,
      fallback: {
        command: CliCommands.WU_DEPS,
        args,
        errorCode: ErrorCodes.WU_DEPS_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: result.data })
      : error(result.error?.message ?? WuQueryMessages.DEPS_FAILED, ErrorCodes.WU_DEPS_ERROR);
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

    const args = [CliArgs.ID, input.id as string];
    if (input.docs_only) args.push(CliArgs.DOCS_ONLY);
    if (input.full_tests) args.push('--full-tests');

    const result = await executeViaPack(CliCommands.WU_PREP, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.WU_PREP,
        args,
        errorCode: ErrorCodes.WU_PREP_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: WuCompletionLifecycleMessages.PREP_PASSED })
      : error(
          result.error?.message ?? WuCompletionLifecycleMessages.PREP_FAILED,
          ErrorCodes.WU_PREP_ERROR,
        );
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

    const args = [CliArgs.ID, input.id as string];
    if (input.worktree) args.push(WuQueryFlags.WORKTREE, input.worktree as string);

    const result = await executeViaPack(CliCommands.WU_PREFLIGHT, input, {
      projectRoot: options?.projectRoot,
      fallback: {
        command: CliCommands.WU_PREFLIGHT,
        args,
        errorCode: ErrorCodes.WU_PREFLIGHT_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: WuQueryMessages.PREFLIGHT_PASSED })
      : error(
          result.error?.message ?? WuQueryMessages.PREFLIGHT_FAILED,
          ErrorCodes.WU_PREFLIGHT_ERROR,
        );
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
    if (input.execute) args.push(CliArgs.EXECUTE);

    const result = await executeViaPack(CliCommands.WU_PRUNE, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.WU_PRUNE,
        args,
        errorCode: ErrorCodes.WU_PRUNE_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: WuCompletionLifecycleMessages.PRUNE_PASSED })
      : error(
          result.error?.message ?? WuCompletionLifecycleMessages.PRUNE_FAILED,
          ErrorCodes.WU_PRUNE_ERROR,
        );
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
    if (input.id) args.push(CliArgs.ID, input.id as string);
    if (input.dry_run) args.push(CliArgs.DRY_RUN);
    if (input.batch) args.push('--batch', input.batch as string);

    const result = await executeViaPack(CliCommands.WU_DELETE, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.WU_DELETE,
        args,
        errorCode: ErrorCodes.WU_DELETE_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: WuCompletionLifecycleMessages.DELETE_PASSED })
      : error(
          result.error?.message ?? WuCompletionLifecycleMessages.DELETE_FAILED,
          ErrorCodes.WU_DELETE_ERROR,
        );
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

    const args = [CliArgs.ID, input.id as string];
    if (input.artifacts) args.push('--artifacts');

    const result = await executeViaPack(CliCommands.WU_CLEANUP, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.WU_CLEANUP,
        args,
        errorCode: ErrorCodes.WU_CLEANUP_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: WuCompletionLifecycleMessages.CLEANUP_PASSED })
      : error(
          result.error?.message ?? WuCompletionLifecycleMessages.CLEANUP_FAILED,
          ErrorCodes.WU_CLEANUP_ERROR,
        );
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
    const result = await executeViaPack(CliCommands.WU_BRIEF, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.WU_BRIEF,
        args,
        errorCode: ErrorCodes.WU_BRIEF_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: WuDelegationAndGatesMessages.BRIEF_PASSED })
      : error(
          result.error?.message ?? WuDelegationAndGatesMessages.BRIEF_FAILED,
          ErrorCodes.WU_BRIEF_ERROR,
        );
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
    const result = await executeViaPack(CliCommands.WU_DELEGATE, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.WU_DELEGATE,
        args,
        errorCode: ErrorCodes.WU_DELEGATE_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: WuDelegationAndGatesMessages.DELEGATE_PASSED })
      : error(
          result.error?.message ?? WuDelegationAndGatesMessages.DELEGATE_FAILED,
          ErrorCodes.WU_DELEGATE_ERROR,
        );
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

    const args = [CliArgs.ID, input.id as string];
    if (input.no_strict) args.push(WuQueryFlags.NO_STRICT);

    const result = await executeViaPack(CliCommands.WU_VALIDATE, input, {
      projectRoot: options?.projectRoot,
      fallback: {
        command: CliCommands.WU_VALIDATE,
        args,
        errorCode: ErrorCodes.WU_VALIDATE_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: WuQueryMessages.VALIDATE_PASSED })
      : error(
          result.error?.message ?? WuQueryMessages.VALIDATE_FAILED,
          ErrorCodes.WU_VALIDATE_ERROR,
        );
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
    if (input.id) args.push(CliArgs.ID, input.id as string);
    if (input.paths) {
      for (const p of input.paths as string[]) {
        args.push(WuQueryFlags.PATHS, p);
      }
    }
    if (input.desc) args.push(WuQueryFlags.DESC, input.desc as string);

    const result = await executeViaPack(CliCommands.WU_INFER_LANE, input, {
      projectRoot: options?.projectRoot,
      fallback: {
        command: CliCommands.WU_INFER_LANE,
        args,
        errorCode: ErrorCodes.WU_INFER_LANE_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { lane: 'Unknown' })
      : error(
          result.error?.message ?? WuQueryMessages.INFER_LANE_FAILED,
          ErrorCodes.WU_INFER_LANE_ERROR,
        );
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
    if (input.lane) args.push(CliArgs.LANE, input.lane as string);
    if (input.reason) args.push(CliArgs.REASON, input.reason as string);
    if (input.force) args.push(CliArgs.FORCE);
    if (input.list) args.push('--list');
    if (input.status) args.push(CliArgs.STATUS);

    const result = await executeViaPack(CliCommands.WU_UNLOCK_LANE, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.WU_UNLOCK_LANE,
        args,
        errorCode: ErrorCodes.WU_UNLOCK_LANE_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: WuDelegationAndGatesMessages.UNLOCK_PASSED })
      : error(
          result.error?.message ?? WuDelegationAndGatesMessages.UNLOCK_FAILED,
          ErrorCodes.WU_UNLOCK_LANE_ERROR,
        );
  },
};

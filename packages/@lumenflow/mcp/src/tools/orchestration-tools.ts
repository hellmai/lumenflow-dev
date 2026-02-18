/**
 * @file orchestration-tools.ts
 * @description Orchestration and delegation tool implementations
 *
 * WU-1642: Extracted from tools.ts during domain decomposition.
 * WU-1425: Orchestration tools + delegation tools
 * WU-1457: All orchestration/delegation commands use shared schemas
 */

import {
  orchestrateInitiativeSchema,
  orchestrateInitStatusSchema,
  orchestrateMonitorSchema,
  delegationListSchema,
} from '@lumenflow/core';
import {
  type ToolDefinition,
  ErrorCodes,
  CliArgs,
  SharedErrorMessages,
  buildExecutionContext,
  success,
  error,
  runCliCommand,
  type CliRunnerOptions,
} from '../tools-shared.js';
import { getRuntimeForWorkspace } from '../runtime-cache.js';
import { packToolCapabilityResolver } from '../runtime-tool-resolver.js';
import { CliCommands, MetadataKeys } from '../mcp-constants.js';

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
 * Error codes for delegation tools
 */
const DelegationErrorCodes = {
  DELEGATION_LIST_ERROR: 'DELEGATION_LIST_ERROR',
} as const;

/**
 * Error messages for delegation tools
 */
const DelegationErrorMessages = {
  WU_OR_INITIATIVE_REQUIRED: 'Either wu or initiative is required',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toMessagePayload(data: unknown, fallbackMessage: string): { message: string } {
  if (typeof data === 'string' && data.trim().length > 0) {
    return { message: data };
  }
  if (isRecord(data) && typeof data.message === 'string' && data.message.trim().length > 0) {
    return { message: data.message };
  }
  return { message: fallbackMessage };
}

async function executeRuntimeTool(
  toolName: string,
  input: Record<string, unknown>,
  options: { projectRoot?: string } | undefined,
): Promise<{ success: boolean; data?: unknown; error?: { message: string } }> {
  const projectRoot = options?.projectRoot ?? process.cwd();
  const runtime = await getRuntimeForWorkspace(projectRoot, packToolCapabilityResolver);
  const executionContext = buildExecutionContext({
    metadata: {
      [MetadataKeys.PROJECT_ROOT]: projectRoot,
    },
  });
  return runtime.executeTool(toolName, input, executionContext);
}

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
    const result = await runCliCommand(CliCommands.ORCHESTRATE_INITIATIVE, args, cliOptions);

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

    try {
      const result = await executeRuntimeTool(
        CliCommands.ORCHESTRATE_INIT_STATUS,
        { initiative: input.initiative as string },
        options,
      );
      if (!result.success) {
        return error(
          result.error?.message || 'orchestrate:init-status failed',
          OrchestrationErrorCodes.ORCHESTRATE_INIT_STATUS_ERROR,
        );
      }
      return success(toMessagePayload(result.data, 'Status displayed'));
    } catch (cause) {
      return error(
        (cause as Error).message || 'orchestrate:init-status failed',
        OrchestrationErrorCodes.ORCHESTRATE_INIT_STATUS_ERROR,
      );
    }
  },
};

/**
 * orchestrate_monitor - Monitor delegated agent progress and delegation health
 */
export const orchestrateMonitorTool: ToolDefinition = {
  name: 'orchestrate_monitor',
  description:
    'Monitor delegated agent progress and delegation health (stuck detection, zombie locks)',
  inputSchema: orchestrateMonitorSchema,

  async execute(input, options) {
    try {
      const result = await executeRuntimeTool(
        CliCommands.ORCHESTRATE_MONITOR,
        {
          threshold: input.threshold,
          recover: input.recover,
          dry_run: input.dry_run,
          since: input.since,
          wu: input.wu,
          signals_only: input.signals_only,
        },
        options,
      );
      if (!result.success) {
        return error(
          result.error?.message || 'orchestrate:monitor failed',
          OrchestrationErrorCodes.ORCHESTRATE_MONITOR_ERROR,
        );
      }
      return success(toMessagePayload(result.data, 'Monitor complete'));
    } catch (cause) {
      return error(
        (cause as Error).message || 'orchestrate:monitor failed',
        OrchestrationErrorCodes.ORCHESTRATE_MONITOR_ERROR,
      );
    }
  },
};

/**
 * delegation_list - Display delegation trees for WUs or initiatives
 */
export const delegationListTool: ToolDefinition = {
  name: 'delegation_list',
  description: 'Display delegation trees for WUs or initiatives',
  inputSchema: delegationListSchema,

  async execute(input, options) {
    if (!input.wu && !input.initiative) {
      return error(DelegationErrorMessages.WU_OR_INITIATIVE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    try {
      const result = await executeRuntimeTool(
        CliCommands.DELEGATION_LIST,
        {
          wu: input.wu,
          initiative: input.initiative,
          json: input.json,
        },
        options,
      );
      if (!result.success) {
        return error(
          result.error?.message || 'delegation:list failed',
          DelegationErrorCodes.DELEGATION_LIST_ERROR,
        );
      }
      if (input.json) {
        return success(result.data ?? []);
      }
      const messagePayload = toMessagePayload(result.data, 'Delegation list displayed');
      return success(messagePayload);
    } catch (cause) {
      return error(
        (cause as Error).message || 'delegation:list failed',
        DelegationErrorCodes.DELEGATION_LIST_ERROR,
      );
    }
  },
};

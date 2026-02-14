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
  success,
  error,
  runCliCommand,
  type CliRunnerOptions,
} from '../tools-shared.js';

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
 * orchestrate_monitor - Monitor delegated agent progress and delegation health
 */
export const orchestrateMonitorTool: ToolDefinition = {
  name: 'orchestrate_monitor',
  description:
    'Monitor delegated agent progress and delegation health (stuck detection, zombie locks)',
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

    const args: string[] = [];
    if (input.wu) args.push(CliArgs.WU, input.wu as string);
    if (input.initiative) args.push(CliArgs.INITIATIVE, input.initiative as string);
    if (input.json) args.push('--json');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand('delegation:list', args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout || 'Delegation list displayed' });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'delegation:list failed',
        DelegationErrorCodes.DELEGATION_LIST_ERROR,
      );
    }
  },
};

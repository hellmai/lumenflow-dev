/**
 * @file initiative-tools.ts
 * @description Initiative tool implementations
 *
 * WU-1642: Extracted from tools.ts during domain decomposition.
 * WU-1424: Initiative tools
 * WU-1455: Initiative command schemas from @lumenflow/core
 */

import {
  initiativeCreateSchema,
  initiativeEditSchema,
  initiativeListSchema,
  initiativeStatusSchema,
  initiativeAddWuSchema,
  initiativeRemoveWuSchema,
  initiativeBulkAssignSchema,
  initiativePlanSchema,
} from '@lumenflow/core';
import {
  type ToolDefinition,
  ErrorCodes,
  ErrorMessages,
  CliArgs,
  SharedErrorMessages,
  success,
  error,
  runCliCommand,
  type CliRunnerOptions,
} from '../tools-shared.js';
import { CliCommands } from '../mcp-constants.js';

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
    if (input.status) args.push(CliArgs.STATUS, input.status as string);
    // WU-1455: Use format field from shared schema
    if (input.format) args.push(CliArgs.FORMAT, input.format as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.INITIATIVE_LIST, args, cliOptions);

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

    const args = [CliArgs.ID, input.id as string];
    // WU-1455: Use format field from shared schema
    if (input.format) args.push(CliArgs.FORMAT, input.format as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.INITIATIVE_STATUS, args, cliOptions);

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
      CliArgs.ID,
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
    const result = await runCliCommand(CliCommands.INITIATIVE_CREATE, args, cliOptions);

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
    const args = [CliArgs.ID, input.id as string];
    if (input.description) args.push(CliArgs.DESCRIPTION, input.description as string);
    if (input.status) args.push(CliArgs.STATUS, input.status as string);
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
    const result = await runCliCommand(CliCommands.INITIATIVE_EDIT, args, cliOptions);

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
    const result = await runCliCommand(CliCommands.INITIATIVE_ADD_WU, args, cliOptions);

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
    const result = await runCliCommand(CliCommands.INITIATIVE_REMOVE_WU, args, cliOptions);

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
    const result = await runCliCommand(CliCommands.INITIATIVE_BULK_ASSIGN, args, cliOptions);

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
    const result = await runCliCommand(CliCommands.INITIATIVE_PLAN, args, cliOptions);

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

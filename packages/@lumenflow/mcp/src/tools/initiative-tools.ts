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
  executeViaPack,
} from '../tools-shared.js';
import { CliCommands, MetadataKeys } from '../mcp-constants.js';

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

const InitiativeResultMessages = {
  INITIATIVE_LIST_FAILED: 'initiative:list failed',
  INITIATIVE_STATUS_FAILED: 'initiative:status failed',
  INITIATIVE_CREATE_PASSED: 'Initiative created successfully',
  INITIATIVE_CREATE_FAILED: 'initiative:create failed',
  INITIATIVE_EDIT_PASSED: 'Initiative edited successfully',
  INITIATIVE_EDIT_FAILED: 'initiative:edit failed',
  INITIATIVE_ADD_WU_PASSED: 'WU added to initiative',
  INITIATIVE_ADD_WU_FAILED: 'initiative:add-wu failed',
  INITIATIVE_REMOVE_WU_PASSED: 'WU removed from initiative',
  INITIATIVE_REMOVE_WU_FAILED: 'initiative:remove-wu failed',
  INITIATIVE_BULK_ASSIGN_PASSED: 'Bulk assignment completed',
  INITIATIVE_BULK_ASSIGN_FAILED: 'initiative:bulk-assign failed',
  INITIATIVE_PLAN_PASSED: 'Plan linked to initiative',
  INITIATIVE_PLAN_FAILED: 'initiative:plan failed',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function unwrapExecuteViaPackData(data: unknown): unknown {
  if (!isRecord(data) || !('success' in data)) {
    return data;
  }

  const successValue = data.success;
  if (typeof successValue !== 'boolean' || !successValue) {
    return data;
  }
  const outputData = data.data;
  return outputData ?? {};
}

function parseJsonPayload(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return { message: value };
    }
  }

  if (isRecord(value) && typeof value.message === 'string') {
    try {
      return JSON.parse(value.message);
    } catch {
      return value;
    }
  }

  return value;
}

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

    const result = await executeViaPack(CliCommands.INITIATIVE_LIST, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.INITIATIVE_LIST,
        args,
        errorCode: InitiativeErrorCodes.INITIATIVE_LIST_ERROR,
      },
    });

    return result.success
      ? success(parseJsonPayload(unwrapExecuteViaPackData(result.data)))
      : error(
          result.error?.message ?? InitiativeResultMessages.INITIATIVE_LIST_FAILED,
          InitiativeErrorCodes.INITIATIVE_LIST_ERROR,
        );
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

    const result = await executeViaPack(CliCommands.INITIATIVE_STATUS, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.INITIATIVE_STATUS,
        args,
        errorCode: InitiativeErrorCodes.INITIATIVE_STATUS_ERROR,
      },
    });

    return result.success
      ? success(parseJsonPayload(unwrapExecuteViaPackData(result.data)))
      : error(
          result.error?.message ?? InitiativeResultMessages.INITIATIVE_STATUS_FAILED,
          InitiativeErrorCodes.INITIATIVE_STATUS_ERROR,
        );
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

    const result = await executeViaPack(CliCommands.INITIATIVE_CREATE, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.INITIATIVE_CREATE,
        args,
        errorCode: InitiativeErrorCodes.INITIATIVE_CREATE_ERROR,
      },
    });

    return result.success
      ? success(
          unwrapExecuteViaPackData(result.data) ?? {
            message: InitiativeResultMessages.INITIATIVE_CREATE_PASSED,
          },
        )
      : error(
          result.error?.message ?? InitiativeResultMessages.INITIATIVE_CREATE_FAILED,
          InitiativeErrorCodes.INITIATIVE_CREATE_ERROR,
        );
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

    const result = await executeViaPack(CliCommands.INITIATIVE_EDIT, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.INITIATIVE_EDIT,
        args,
        errorCode: InitiativeErrorCodes.INITIATIVE_EDIT_ERROR,
      },
    });

    return result.success
      ? success(
          unwrapExecuteViaPackData(result.data) ?? {
            message: InitiativeResultMessages.INITIATIVE_EDIT_PASSED,
          },
        )
      : error(
          result.error?.message ?? InitiativeResultMessages.INITIATIVE_EDIT_FAILED,
          InitiativeErrorCodes.INITIATIVE_EDIT_ERROR,
        );
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

    const result = await executeViaPack(CliCommands.INITIATIVE_ADD_WU, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.INITIATIVE_ADD_WU,
        args,
        errorCode: InitiativeErrorCodes.INITIATIVE_ADD_WU_ERROR,
      },
    });

    return result.success
      ? success(
          unwrapExecuteViaPackData(result.data) ?? {
            message: InitiativeResultMessages.INITIATIVE_ADD_WU_PASSED,
          },
        )
      : error(
          result.error?.message ?? InitiativeResultMessages.INITIATIVE_ADD_WU_FAILED,
          InitiativeErrorCodes.INITIATIVE_ADD_WU_ERROR,
        );
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

    const result = await executeViaPack(CliCommands.INITIATIVE_REMOVE_WU, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.INITIATIVE_REMOVE_WU,
        args,
        errorCode: InitiativeErrorCodes.INITIATIVE_REMOVE_WU_ERROR,
      },
    });

    return result.success
      ? success(
          unwrapExecuteViaPackData(result.data) ?? {
            message: InitiativeResultMessages.INITIATIVE_REMOVE_WU_PASSED,
          },
        )
      : error(
          result.error?.message ?? InitiativeResultMessages.INITIATIVE_REMOVE_WU_FAILED,
          InitiativeErrorCodes.INITIATIVE_REMOVE_WU_ERROR,
        );
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

    const result = await executeViaPack(CliCommands.INITIATIVE_BULK_ASSIGN, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.INITIATIVE_BULK_ASSIGN,
        args,
        errorCode: InitiativeErrorCodes.INITIATIVE_BULK_ASSIGN_ERROR,
      },
    });

    return result.success
      ? success(
          unwrapExecuteViaPackData(result.data) ?? {
            message: InitiativeResultMessages.INITIATIVE_BULK_ASSIGN_PASSED,
          },
        )
      : error(
          result.error?.message ?? InitiativeResultMessages.INITIATIVE_BULK_ASSIGN_FAILED,
          InitiativeErrorCodes.INITIATIVE_BULK_ASSIGN_ERROR,
        );
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

    const result = await executeViaPack(CliCommands.INITIATIVE_PLAN, input, {
      projectRoot: options?.projectRoot,
      contextInput: {
        metadata: {
          [MetadataKeys.PROJECT_ROOT]: options?.projectRoot,
        },
      },
      fallback: {
        command: CliCommands.INITIATIVE_PLAN,
        args,
        errorCode: InitiativeErrorCodes.INITIATIVE_PLAN_ERROR,
      },
    });

    return result.success
      ? success(
          unwrapExecuteViaPackData(result.data) ?? {
            message: InitiativeResultMessages.INITIATIVE_PLAN_PASSED,
          },
        )
      : error(
          result.error?.message ?? InitiativeResultMessages.INITIATIVE_PLAN_FAILED,
          InitiativeErrorCodes.INITIATIVE_PLAN_ERROR,
        );
  },
};

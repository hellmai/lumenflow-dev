/**
 * @file setup-tools.ts
 * @description Setup/LumenFlow tool implementations
 *
 * WU-1642: Extracted from tools.ts during domain decomposition.
 * WU-1426: Setup tools
 * WU-1457: All setup commands use shared schemas
 * WU-1812: Migrated setup tools from CLI shell-out to executeViaPack runtime path
 */

import {
  lumenflowInitSchema,
  lumenflowDoctorSchema,
  lumenflowIntegrateSchema,
  lumenflowUpgradeSchema,
  lumenflowCommandsSchema,
  docsSyncSchema,
  releaseSchema,
  syncTemplatesSchema,
} from '@lumenflow/core';
import {
  type ToolDefinition,
  ErrorCodes,
  ErrorMessages,
  CliArgs,
  success,
  error,
  executeViaPack,
} from '../tools-shared.js';
import { CliCommands, MetadataKeys } from '../mcp-constants.js';

const SetupResultMessages = {
  LUMENFLOW_INIT_PASSED: 'LumenFlow initialized',
  LUMENFLOW_INIT_FAILED: 'lumenflow failed',
  LUMENFLOW_DOCTOR_PASSED: 'LumenFlow safety: ACTIVE',
  LUMENFLOW_DOCTOR_FAILED: 'Doctor found issues',
  LUMENFLOW_INTEGRATE_PASSED: 'Hooks generated',
  LUMENFLOW_INTEGRATE_FAILED: 'lumenflow:integrate failed',
  LUMENFLOW_UPGRADE_PASSED: 'LumenFlow upgraded',
  LUMENFLOW_UPGRADE_FAILED: 'lumenflow:upgrade failed',
  LUMENFLOW_COMMANDS_PASSED: 'Commands listed',
  LUMENFLOW_COMMANDS_FAILED: 'lumenflow commands failed',
  LUMENFLOW_DOCS_SYNC_PASSED: 'Docs synced',
  LUMENFLOW_DOCS_SYNC_FAILED: 'docs:sync failed',
  LUMENFLOW_RELEASE_PASSED: 'Release complete',
  LUMENFLOW_RELEASE_FAILED: 'release failed',
  LUMENFLOW_SYNC_TEMPLATES_PASSED: 'Templates synced',
  LUMENFLOW_SYNC_TEMPLATES_FAILED: 'sync:templates failed',
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

  return data.data ?? {};
}

function resolveMessage(value: unknown, fallbackMessage: string): string {
  if (typeof value === 'string') {
    return value;
  }

  if (isRecord(value) && typeof value.message === 'string') {
    return value.message;
  }

  return fallbackMessage;
}

function buildExecutionOptions(
  projectRoot: string | undefined,
  fallback: { command: string; args: string[]; errorCode: string },
): Parameters<typeof executeViaPack>[2] {
  return {
    projectRoot,
    contextInput: {
      metadata: {
        [MetadataKeys.PROJECT_ROOT]: projectRoot,
      },
    },
    fallback,
  };
}

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

    const result = await executeViaPack(CliCommands.LUMENFLOW, input, {
      ...buildExecutionOptions(options?.projectRoot, {
        command: CliCommands.LUMENFLOW,
        args,
        errorCode: ErrorCodes.LUMENFLOW_INIT_ERROR,
      }),
    });

    return result.success
      ? success({
          message: resolveMessage(
            unwrapExecuteViaPackData(result.data),
            SetupResultMessages.LUMENFLOW_INIT_PASSED,
          ),
        })
      : error(
          result.error?.message ?? SetupResultMessages.LUMENFLOW_INIT_FAILED,
          ErrorCodes.LUMENFLOW_INIT_ERROR,
        );
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
    const result = await executeViaPack(
      CliCommands.LUMENFLOW_DOCTOR,
      {},
      {
        ...buildExecutionOptions(options?.projectRoot, {
          command: CliCommands.LUMENFLOW_DOCTOR,
          args: [],
          errorCode: ErrorCodes.LUMENFLOW_DOCTOR_ERROR,
        }),
      },
    );

    return result.success
      ? success({
          message: resolveMessage(
            unwrapExecuteViaPackData(result.data),
            SetupResultMessages.LUMENFLOW_DOCTOR_PASSED,
          ),
        })
      : error(
          result.error?.message ?? SetupResultMessages.LUMENFLOW_DOCTOR_FAILED,
          ErrorCodes.LUMENFLOW_DOCTOR_ERROR,
        );
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

    const result = await executeViaPack(CliCommands.LUMENFLOW_INTEGRATE, input, {
      ...buildExecutionOptions(options?.projectRoot, {
        command: CliCommands.LUMENFLOW_INTEGRATE,
        args,
        errorCode: ErrorCodes.LUMENFLOW_INTEGRATE_ERROR,
      }),
    });

    return result.success
      ? success({
          message: resolveMessage(
            unwrapExecuteViaPackData(result.data),
            SetupResultMessages.LUMENFLOW_INTEGRATE_PASSED,
          ),
        })
      : error(
          result.error?.message ?? SetupResultMessages.LUMENFLOW_INTEGRATE_FAILED,
          ErrorCodes.LUMENFLOW_INTEGRATE_ERROR,
        );
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
    const result = await executeViaPack(
      CliCommands.LUMENFLOW_UPGRADE,
      {},
      {
        ...buildExecutionOptions(options?.projectRoot, {
          command: CliCommands.LUMENFLOW_UPGRADE,
          args: [],
          errorCode: ErrorCodes.LUMENFLOW_UPGRADE_ERROR,
        }),
      },
    );

    return result.success
      ? success({
          message: resolveMessage(
            unwrapExecuteViaPackData(result.data),
            SetupResultMessages.LUMENFLOW_UPGRADE_PASSED,
          ),
        })
      : error(
          result.error?.message ?? SetupResultMessages.LUMENFLOW_UPGRADE_FAILED,
          ErrorCodes.LUMENFLOW_UPGRADE_ERROR,
        );
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
    const result = await executeViaPack(
      CliCommands.LUMENFLOW,
      {},
      {
        ...buildExecutionOptions(options?.projectRoot, {
          command: CliCommands.LUMENFLOW,
          args: ['commands'],
          errorCode: ErrorCodes.LUMENFLOW_COMMANDS_ERROR,
        }),
      },
    );

    return result.success
      ? success({
          message: resolveMessage(
            unwrapExecuteViaPackData(result.data),
            SetupResultMessages.LUMENFLOW_COMMANDS_PASSED,
          ),
        })
      : error(
          result.error?.message ?? SetupResultMessages.LUMENFLOW_COMMANDS_FAILED,
          ErrorCodes.LUMENFLOW_COMMANDS_ERROR,
        );
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
    const result = await executeViaPack(
      CliCommands.DOCS_SYNC,
      {},
      {
        ...buildExecutionOptions(options?.projectRoot, {
          command: CliCommands.DOCS_SYNC,
          args: [],
          errorCode: ErrorCodes.LUMENFLOW_DOCS_SYNC_ERROR,
        }),
      },
    );

    return result.success
      ? success({
          message: resolveMessage(
            unwrapExecuteViaPackData(result.data),
            SetupResultMessages.LUMENFLOW_DOCS_SYNC_PASSED,
          ),
        })
      : error(
          result.error?.message ?? SetupResultMessages.LUMENFLOW_DOCS_SYNC_FAILED,
          ErrorCodes.LUMENFLOW_DOCS_SYNC_ERROR,
        );
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

    const result = await executeViaPack(CliCommands.LUMENFLOW_RELEASE, input, {
      ...buildExecutionOptions(options?.projectRoot, {
        command: CliCommands.LUMENFLOW_RELEASE,
        args,
        errorCode: ErrorCodes.LUMENFLOW_RELEASE_ERROR,
      }),
    });

    return result.success
      ? success({
          message: resolveMessage(
            unwrapExecuteViaPackData(result.data),
            SetupResultMessages.LUMENFLOW_RELEASE_PASSED,
          ),
        })
      : error(
          result.error?.message ?? SetupResultMessages.LUMENFLOW_RELEASE_FAILED,
          ErrorCodes.LUMENFLOW_RELEASE_ERROR,
        );
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
    const result = await executeViaPack(
      CliCommands.SYNC_TEMPLATES,
      {},
      {
        ...buildExecutionOptions(options?.projectRoot, {
          command: CliCommands.SYNC_TEMPLATES,
          args: [],
          errorCode: ErrorCodes.LUMENFLOW_SYNC_TEMPLATES_ERROR,
        }),
      },
    );

    return result.success
      ? success({
          message: resolveMessage(
            unwrapExecuteViaPackData(result.data),
            SetupResultMessages.LUMENFLOW_SYNC_TEMPLATES_PASSED,
          ),
        })
      : error(
          result.error?.message ?? SetupResultMessages.LUMENFLOW_SYNC_TEMPLATES_FAILED,
          ErrorCodes.LUMENFLOW_SYNC_TEMPLATES_ERROR,
        );
  },
};

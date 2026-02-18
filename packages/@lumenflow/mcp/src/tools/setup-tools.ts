/**
 * @file setup-tools.ts
 * @description Setup/LumenFlow tool implementations
 *
 * WU-1642: Extracted from tools.ts during domain decomposition.
 * WU-1426: Setup tools
 * WU-1457: All setup commands use shared schemas
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
  runCliCommand,
  type CliRunnerOptions,
} from '../tools-shared.js';
import { CliCommands } from '../mcp-constants.js';

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
    const result = await runCliCommand(CliCommands.LUMENFLOW, args, cliOptions);

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
    const result = await runCliCommand(CliCommands.LUMENFLOW_DOCTOR, [], cliOptions);

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
    const result = await runCliCommand(CliCommands.LUMENFLOW_INTEGRATE, args, cliOptions);

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
    const result = await runCliCommand(CliCommands.LUMENFLOW_UPGRADE, [], cliOptions);

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
    const result = await runCliCommand(CliCommands.LUMENFLOW, ['commands'], cliOptions);

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
    const result = await runCliCommand(CliCommands.DOCS_SYNC, [], cliOptions);

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
    const result = await runCliCommand(CliCommands.LUMENFLOW_RELEASE, args, cliOptions);

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
    const result = await runCliCommand(CliCommands.SYNC_TEMPLATES, [], cliOptions);

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

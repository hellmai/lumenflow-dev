/**
 * @file validation-tools.ts
 * @description Validation tool implementations
 *
 * WU-1642: Extracted from tools.ts during domain decomposition.
 * WU-1426: Validation tools
 * WU-1457: All validation commands use shared schemas
 */

import {
  validateSchema,
  validateAgentSkillsSchema,
  validateAgentSyncSchema,
  validateBacklogSyncSchema,
  validateSkillsSpecSchema,
} from '@lumenflow/core';
import {
  type ToolDefinition,
  ErrorCodes,
  CliArgs,
  success,
  error,
  runCliCommand,
  type CliRunnerOptions,
} from '../tools-shared.js';
import { CliCommands } from '../mcp-constants.js';

/**
 * validate - Validate WU YAML files
 */
export const validateTool: ToolDefinition = {
  name: 'validate',
  description: 'Validate WU YAML files and status consistency',
  inputSchema: validateSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.id) args.push(CliArgs.ID, input.id as string);
    if (input.strict) args.push('--strict');
    if (input.done_only) args.push('--done-only');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.VALIDATE, args, cliOptions);

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
  inputSchema: validateAgentSkillsSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.skill) args.push('--skill', input.skill as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.VALIDATE_AGENT_SKILLS, args, cliOptions);

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
  inputSchema: validateAgentSyncSchema,

  async execute(_input, options) {
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.VALIDATE_AGENT_SYNC, [], cliOptions);

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
  inputSchema: validateBacklogSyncSchema,

  async execute(_input, options) {
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.VALIDATE_BACKLOG_SYNC, [], cliOptions);

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
  inputSchema: validateSkillsSpecSchema,

  async execute(_input, options) {
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.VALIDATE_SKILLS_SPEC, [], cliOptions);

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

/**
 * lumenflow_validate - Public validate alias
 */
export const lumenflowValidateTool: ToolDefinition = {
  name: 'lumenflow_validate',
  description: 'Run validation checks (lumenflow-validate alias)',
  inputSchema: validateSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.id) args.push(CliArgs.ID, input.id as string);
    if (input.strict) args.push('--strict');
    if (input.done_only) args.push('--done-only');

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.VALIDATE, args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Validation passed' });
    }
    return error(
      result.stderr || result.error?.message || 'lumenflow-validate failed',
      ErrorCodes.LUMENFLOW_VALIDATE_ERROR,
    );
  },
};

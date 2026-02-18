/**
 * @file validation-tools.ts
 * @description Validation tool implementations
 *
 * WU-1642: Extracted from tools.ts during domain decomposition.
 * WU-1426: Validation tools
 * WU-1457: All validation commands use shared schemas
 * WU-1802: Migrated from CLI shell-out to executeViaPack (runtime-first)
 * WU-1856: Fix duplicate message constants, tighten constant naming
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
  executeViaPack,
} from '../tools-shared.js';
import { CliCommands } from '../mcp-constants.js';

/**
 * Fallback messages when executeViaPack returns no structured data/error.
 */
const ValidationMessages = {
  VALIDATE_PASSED: 'Validation passed',
  VALIDATE_FAILED: 'Validation failed',
  AGENT_SKILLS_VALID: 'All skills valid',
  AGENT_SKILLS_FAILED: 'validate:agent-skills failed',
  AGENT_SYNC_VALID: 'Agent sync valid',
  AGENT_SYNC_FAILED: 'validate:agent-sync failed',
  BACKLOG_SYNC_VALID: 'Backlog sync valid',
  BACKLOG_SYNC_FAILED: 'validate:backlog-sync failed',
  SKILLS_SPEC_VALID: 'Skills spec valid',
  SKILLS_SPEC_FAILED: 'validate:skills-spec failed',
  LUMENFLOW_VALIDATE_FAILED: 'lumenflow-validate failed',
} as const;

const CliFlags = {
  STRICT: '--strict',
  DONE_ONLY: '--done-only',
  SKILL: '--skill',
} as const;

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
    if (input.strict) args.push(CliFlags.STRICT);
    if (input.done_only) args.push(CliFlags.DONE_ONLY);

    const result = await executeViaPack(CliCommands.VALIDATE, input, {
      projectRoot: options?.projectRoot,
      fallback: {
        command: CliCommands.VALIDATE,
        args,
        errorCode: ErrorCodes.VALIDATE_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: ValidationMessages.VALIDATE_PASSED })
      : error(
          result.error?.message ?? ValidationMessages.VALIDATE_FAILED,
          ErrorCodes.VALIDATE_ERROR,
        );
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
    if (input.skill) args.push(CliFlags.SKILL, input.skill as string);

    const result = await executeViaPack(CliCommands.VALIDATE_AGENT_SKILLS, input, {
      projectRoot: options?.projectRoot,
      fallback: {
        command: CliCommands.VALIDATE_AGENT_SKILLS,
        args,
        errorCode: ErrorCodes.VALIDATE_AGENT_SKILLS_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: ValidationMessages.AGENT_SKILLS_VALID })
      : error(
          result.error?.message ?? ValidationMessages.AGENT_SKILLS_FAILED,
          ErrorCodes.VALIDATE_AGENT_SKILLS_ERROR,
        );
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
    const result = await executeViaPack(
      CliCommands.VALIDATE_AGENT_SYNC,
      {},
      {
        projectRoot: options?.projectRoot,
        fallback: {
          command: CliCommands.VALIDATE_AGENT_SYNC,
          args: [],
          errorCode: ErrorCodes.VALIDATE_AGENT_SYNC_ERROR,
        },
      },
    );

    return result.success
      ? success(result.data ?? { message: ValidationMessages.AGENT_SYNC_VALID })
      : error(
          result.error?.message ?? ValidationMessages.AGENT_SYNC_FAILED,
          ErrorCodes.VALIDATE_AGENT_SYNC_ERROR,
        );
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
    const result = await executeViaPack(
      CliCommands.VALIDATE_BACKLOG_SYNC,
      {},
      {
        projectRoot: options?.projectRoot,
        fallback: {
          command: CliCommands.VALIDATE_BACKLOG_SYNC,
          args: [],
          errorCode: ErrorCodes.VALIDATE_BACKLOG_SYNC_ERROR,
        },
      },
    );

    return result.success
      ? success(result.data ?? { message: ValidationMessages.BACKLOG_SYNC_VALID })
      : error(
          result.error?.message ?? ValidationMessages.BACKLOG_SYNC_FAILED,
          ErrorCodes.VALIDATE_BACKLOG_SYNC_ERROR,
        );
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
    const result = await executeViaPack(
      CliCommands.VALIDATE_SKILLS_SPEC,
      {},
      {
        projectRoot: options?.projectRoot,
        fallback: {
          command: CliCommands.VALIDATE_SKILLS_SPEC,
          args: [],
          errorCode: ErrorCodes.VALIDATE_SKILLS_SPEC_ERROR,
        },
      },
    );

    return result.success
      ? success(result.data ?? { message: ValidationMessages.SKILLS_SPEC_VALID })
      : error(
          result.error?.message ?? ValidationMessages.SKILLS_SPEC_FAILED,
          ErrorCodes.VALIDATE_SKILLS_SPEC_ERROR,
        );
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
    if (input.strict) args.push(CliFlags.STRICT);
    if (input.done_only) args.push(CliFlags.DONE_ONLY);

    const result = await executeViaPack(CliCommands.LUMENFLOW_VALIDATE, input, {
      projectRoot: options?.projectRoot,
      fallback: {
        command: CliCommands.VALIDATE,
        args,
        errorCode: ErrorCodes.LUMENFLOW_VALIDATE_ERROR,
      },
    });

    return result.success
      ? success(result.data ?? { message: ValidationMessages.VALIDATE_PASSED })
      : error(
          result.error?.message ?? ValidationMessages.LUMENFLOW_VALIDATE_FAILED,
          ErrorCodes.LUMENFLOW_VALIDATE_ERROR,
        );
  },
};

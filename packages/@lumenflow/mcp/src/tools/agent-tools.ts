/**
 * @file agent-tools.ts
 * @description Agent tool implementations
 *
 * WU-1642: Extracted from tools.ts during domain decomposition.
 * WU-1425: Agent tools: agent_session, agent_session_end, agent_log_issue, agent_issues_query
 * WU-1457: All agent commands use shared schemas
 * WU-1812: Migrated agent tools from CLI shell-out to executeViaPack runtime path
 */

import {
  agentSessionSchema,
  agentSessionEndSchema,
  agentLogIssueSchema,
  agentIssuesQuerySchema,
} from '@lumenflow/core';
import {
  type ToolDefinition,
  ErrorCodes,
  CliArgs,
  SharedErrorMessages,
  success,
  error,
  executeViaPack,
} from '../tools-shared.js';
import { CliCommands, MetadataKeys } from '../mcp-constants.js';

/**
 * Error codes for agent tools
 */
const AgentErrorCodes = {
  AGENT_SESSION_ERROR: 'AGENT_SESSION_ERROR',
  AGENT_SESSION_END_ERROR: 'AGENT_SESSION_END_ERROR',
  AGENT_LOG_ISSUE_ERROR: 'AGENT_LOG_ISSUE_ERROR',
  AGENT_ISSUES_QUERY_ERROR: 'AGENT_ISSUES_QUERY_ERROR',
} as const;

/**
 * Error messages for agent tools
 */
const AgentErrorMessages = {
  WU_REQUIRED: SharedErrorMessages.WU_REQUIRED,
  TIER_REQUIRED: 'tier is required',
  CATEGORY_REQUIRED: 'category is required',
  SEVERITY_REQUIRED: 'severity is required',
  TITLE_REQUIRED: 'title is required',
  DESCRIPTION_REQUIRED: 'description is required',
} as const;

const AgentResultMessages = {
  AGENT_SESSION_PASSED: 'Session started',
  AGENT_SESSION_FAILED: 'agent:session failed',
  AGENT_SESSION_END_PASSED: 'Session ended',
  AGENT_SESSION_END_FAILED: 'agent:session-end failed',
  AGENT_LOG_ISSUE_PASSED: 'Issue logged',
  AGENT_LOG_ISSUE_FAILED: 'agent:log-issue failed',
  AGENT_ISSUES_QUERY_PASSED: 'Query complete',
  AGENT_ISSUES_QUERY_FAILED: 'agent:issues-query failed',
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
 * agent_session - Start an agent session for tracking WU execution
 */
export const agentSessionTool: ToolDefinition = {
  name: 'agent_session',
  description: 'Start an agent session for tracking WU execution',
  inputSchema: agentSessionSchema,

  async execute(input, options) {
    if (!input.wu) {
      return error(AgentErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (input.tier === undefined || input.tier === null) {
      return error(AgentErrorMessages.TIER_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [CliArgs.WU, input.wu as string, '--tier', String(input.tier)];
    if (input.agent_type) args.push('--agent-type', input.agent_type as string);

    const result = await executeViaPack(CliCommands.AGENT_SESSION, input, {
      ...buildExecutionOptions(options?.projectRoot, {
        command: CliCommands.AGENT_SESSION,
        args,
        errorCode: AgentErrorCodes.AGENT_SESSION_ERROR,
      }),
    });

    return result.success
      ? success({
          message: resolveMessage(
            unwrapExecuteViaPackData(result.data),
            AgentResultMessages.AGENT_SESSION_PASSED,
          ),
        })
      : error(
          result.error?.message ?? AgentResultMessages.AGENT_SESSION_FAILED,
          AgentErrorCodes.AGENT_SESSION_ERROR,
        );
  },
};

/**
 * agent_session_end - End the current agent session
 */
export const agentSessionEndTool: ToolDefinition = {
  name: 'agent_session_end',
  description: 'End the current agent session and return summary',
  inputSchema: agentSessionEndSchema,

  async execute(_input, options) {
    const result = await executeViaPack(
      CliCommands.AGENT_SESSION_END,
      {},
      {
        ...buildExecutionOptions(options?.projectRoot, {
          command: CliCommands.AGENT_SESSION_END,
          args: [],
          errorCode: AgentErrorCodes.AGENT_SESSION_END_ERROR,
        }),
      },
    );

    return result.success
      ? success(parseJsonPayload(unwrapExecuteViaPackData(result.data)))
      : error(
          result.error?.message ?? AgentResultMessages.AGENT_SESSION_END_FAILED,
          AgentErrorCodes.AGENT_SESSION_END_ERROR,
        );
  },
};

/**
 * agent_log_issue - Log a workflow issue or incident during agent execution
 */
export const agentLogIssueTool: ToolDefinition = {
  name: 'agent_log_issue',
  description: 'Log a workflow issue or incident during agent execution',
  inputSchema: agentLogIssueSchema,

  async execute(input, options) {
    if (!input.category) {
      return error(AgentErrorMessages.CATEGORY_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.severity) {
      return error(AgentErrorMessages.SEVERITY_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.title) {
      return error(AgentErrorMessages.TITLE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.description) {
      return error(AgentErrorMessages.DESCRIPTION_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [
      '--category',
      input.category as string,
      '--severity',
      input.severity as string,
      '--title',
      input.title as string,
      CliArgs.DESCRIPTION,
      input.description as string,
    ];
    if (input.resolution) args.push('--resolution', input.resolution as string);
    if (input.tags) {
      for (const tag of input.tags as string[]) {
        args.push('--tag', tag);
      }
    }
    if (input.step) args.push('--step', input.step as string);
    if (input.files) {
      for (const file of input.files as string[]) {
        args.push('--file', file);
      }
    }

    const result = await executeViaPack(CliCommands.AGENT_LOG_ISSUE, input, {
      ...buildExecutionOptions(options?.projectRoot, {
        command: CliCommands.AGENT_LOG_ISSUE,
        args,
        errorCode: AgentErrorCodes.AGENT_LOG_ISSUE_ERROR,
      }),
    });

    return result.success
      ? success({
          message: resolveMessage(
            unwrapExecuteViaPackData(result.data),
            AgentResultMessages.AGENT_LOG_ISSUE_PASSED,
          ),
        })
      : error(
          result.error?.message ?? AgentResultMessages.AGENT_LOG_ISSUE_FAILED,
          AgentErrorCodes.AGENT_LOG_ISSUE_ERROR,
        );
  },
};

/**
 * agent_issues_query - Query and display logged agent incidents
 */
export const agentIssuesQueryTool: ToolDefinition = {
  name: 'agent_issues_query',
  description: 'Query and display logged agent incidents/issues summary',
  inputSchema: agentIssuesQuerySchema,

  async execute(input, options) {
    const args = ['summary'];
    if (input.since) args.push(CliArgs.SINCE, String(input.since));
    if (input.category) args.push('--category', input.category as string);
    if (input.severity) args.push('--severity', input.severity as string);

    const result = await executeViaPack(CliCommands.AGENT_ISSUES_QUERY, input, {
      ...buildExecutionOptions(options?.projectRoot, {
        command: CliCommands.AGENT_ISSUES_QUERY,
        args,
        errorCode: AgentErrorCodes.AGENT_ISSUES_QUERY_ERROR,
      }),
    });

    return result.success
      ? success({
          message: resolveMessage(
            unwrapExecuteViaPackData(result.data),
            AgentResultMessages.AGENT_ISSUES_QUERY_PASSED,
          ),
        })
      : error(
          result.error?.message ?? AgentResultMessages.AGENT_ISSUES_QUERY_FAILED,
          AgentErrorCodes.AGENT_ISSUES_QUERY_ERROR,
        );
  },
};

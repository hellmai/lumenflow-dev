/**
 * @file agent-tools.ts
 * @description Agent tool implementations
 *
 * WU-1642: Extracted from tools.ts during domain decomposition.
 * WU-1425: Agent tools: agent_session, agent_session_end, agent_log_issue, agent_issues_query
 * WU-1457: All agent commands use shared schemas
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
  runCliCommand,
  type CliRunnerOptions,
} from '../tools-shared.js';
import { CliCommands } from '../mcp-constants.js';

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

    const args = ['--wu', input.wu as string, '--tier', String(input.tier)];
    if (input.agent_type) args.push('--agent-type', input.agent_type as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.AGENT_SESSION, args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Session started' });
    } else {
      return error(
        result.stderr || result.error?.message || 'agent:session failed',
        AgentErrorCodes.AGENT_SESSION_ERROR,
      );
    }
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
    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.AGENT_SESSION_END, [], cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout || 'Session ended' });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'agent:session-end failed',
        AgentErrorCodes.AGENT_SESSION_END_ERROR,
      );
    }
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

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.AGENT_LOG_ISSUE, args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Issue logged' });
    } else {
      return error(
        result.stderr || result.error?.message || 'agent:log-issue failed',
        AgentErrorCodes.AGENT_LOG_ISSUE_ERROR,
      );
    }
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

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.AGENT_ISSUES_QUERY, args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Query complete' });
    } else {
      return error(
        result.stderr || result.error?.message || 'agent:issues-query failed',
        AgentErrorCodes.AGENT_ISSUES_QUERY_ERROR,
      );
    }
  },
};

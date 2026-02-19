// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ToolOutput } from '@lumenflow/kernel';
import { UTF8_ENCODING } from '../constants.js';

const AGENT_TOOLS = {
  AGENT_SESSION: 'agent:session',
  AGENT_SESSION_END: 'agent:session-end',
  AGENT_LOG_ISSUE: 'agent:log-issue',
  AGENT_ISSUES_QUERY: 'agent:issues-query',
} as const;

type AgentToolName = (typeof AGENT_TOOLS)[keyof typeof AGENT_TOOLS];

const AGENT_TOOL_ERROR_CODES: Record<AgentToolName, string> = {
  'agent:session': 'AGENT_SESSION_ERROR',
  'agent:session-end': 'AGENT_SESSION_END_ERROR',
  'agent:log-issue': 'AGENT_LOG_ISSUE_ERROR',
  'agent:issues-query': 'AGENT_ISSUES_QUERY_ERROR',
};

const AGENT_TOOL_SCRIPT_PATHS: Record<AgentToolName, string> = {
  'agent:session': 'packages/@lumenflow/cli/dist/agent-session.js',
  'agent:session-end': 'packages/@lumenflow/cli/dist/agent-session-end.js',
  'agent:log-issue': 'packages/@lumenflow/cli/dist/agent-log-issue.js',
  'agent:issues-query': 'packages/@lumenflow/cli/dist/agent-issues-query.js',
};

const MISSING_PARAMETER_MESSAGES = {
  WU_REQUIRED: 'wu is required',
  TIER_REQUIRED: 'tier is required',
  CATEGORY_REQUIRED: 'category is required',
  SEVERITY_REQUIRED: 'severity is required',
  TITLE_REQUIRED: 'title is required',
  DESCRIPTION_REQUIRED: 'description is required',
} as const;

interface CommandExecutionResult {
  ok: boolean;
  status: number;
  stdout: string;
  stderr: string;
  spawnError?: string;
}

function toRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object') {
    return input as Record<string, unknown>;
  }
  return {};
}

function toStringValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => toStringValue(entry))
    .filter((entry): entry is string => entry !== null);
}

function toIntegerString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function runAgentCommand(toolName: AgentToolName, args: string[]): CommandExecutionResult {
  const scriptPath = AGENT_TOOL_SCRIPT_PATHS[toolName];
  const absoluteScriptPath = path.resolve(process.cwd(), scriptPath);
  const result = spawnSync(process.execPath, [absoluteScriptPath, ...args], {
    cwd: process.cwd(),
    encoding: UTF8_ENCODING,
  });

  return {
    ok: result.status === 0 && !result.error,
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    spawnError: result.error?.message,
  };
}

function createMissingParameterOutput(message: string): ToolOutput {
  return {
    success: false,
    error: {
      code: 'MISSING_PARAMETER',
      message,
    },
  };
}

function createFailureOutput(
  toolName: AgentToolName,
  execution: CommandExecutionResult,
): ToolOutput {
  const stderrMessage = execution.stderr.trim();
  const stdoutMessage = execution.stdout.trim();
  const message =
    execution.spawnError ??
    (stderrMessage.length > 0
      ? stderrMessage
      : stdoutMessage.length > 0
        ? stdoutMessage
        : `${toolName} failed`);
  return {
    success: false,
    error: {
      code: AGENT_TOOL_ERROR_CODES[toolName],
      message,
      details: {
        exit_code: execution.status,
        stdout: execution.stdout,
        stderr: execution.stderr,
      },
    },
  };
}

function parseJsonOutput(stdout: string): unknown | null {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function createSuccessOutput(
  toolName: AgentToolName,
  execution: CommandExecutionResult,
): ToolOutput {
  const parsedJson = parseJsonOutput(execution.stdout);
  if (parsedJson !== null) {
    return {
      success: true,
      data: parsedJson,
    };
  }

  const message = execution.stdout.trim().length > 0 ? execution.stdout.trim() : `${toolName} ran`;
  return {
    success: true,
    data: {
      message,
    },
  };
}

function executeAgentTool(toolName: AgentToolName, args: string[]): ToolOutput {
  const execution = runAgentCommand(toolName, args);
  if (!execution.ok) {
    return createFailureOutput(toolName, execution);
  }
  return createSuccessOutput(toolName, execution);
}

export async function agentSessionTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const wu = toStringValue(parsed.wu);
  if (!wu) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.WU_REQUIRED);
  }

  const tier = toIntegerString(parsed.tier);
  if (!tier) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.TIER_REQUIRED);
  }

  const args = ['--wu', wu, '--tier', tier];
  const agentType = toStringValue(parsed.agent_type);
  if (agentType) {
    args.push('--agent-type', agentType);
  }

  return executeAgentTool(AGENT_TOOLS.AGENT_SESSION, args);
}

export async function agentSessionEndTool(_input: unknown): Promise<ToolOutput> {
  return executeAgentTool(AGENT_TOOLS.AGENT_SESSION_END, []);
}

export async function agentLogIssueTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const category = toStringValue(parsed.category);
  if (!category) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.CATEGORY_REQUIRED);
  }
  const severity = toStringValue(parsed.severity);
  if (!severity) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.SEVERITY_REQUIRED);
  }
  const title = toStringValue(parsed.title);
  if (!title) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.TITLE_REQUIRED);
  }
  const description = toStringValue(parsed.description);
  if (!description) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.DESCRIPTION_REQUIRED);
  }

  const args = [
    '--category',
    category,
    '--severity',
    severity,
    '--title',
    title,
    '--description',
    description,
  ];
  const resolution = toStringValue(parsed.resolution);
  if (resolution) {
    args.push('--resolution', resolution);
  }

  for (const tag of toStringArray(parsed.tags)) {
    args.push('--tag', tag);
  }

  const step = toStringValue(parsed.step);
  if (step) {
    args.push('--step', step);
  }

  for (const file of toStringArray(parsed.files)) {
    args.push('--file', file);
  }

  return executeAgentTool(AGENT_TOOLS.AGENT_LOG_ISSUE, args);
}

export async function agentIssuesQueryTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args = ['summary'];

  const since = toIntegerString(parsed.since);
  if (since) {
    args.push('--since', since);
  }
  const category = toStringValue(parsed.category);
  if (category) {
    args.push('--category', category);
  }
  const severity = toStringValue(parsed.severity);
  if (severity) {
    args.push('--severity', severity);
  }

  return executeAgentTool(AGENT_TOOLS.AGENT_ISSUES_QUERY, args);
}

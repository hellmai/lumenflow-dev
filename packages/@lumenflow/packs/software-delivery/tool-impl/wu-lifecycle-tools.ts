// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ToolOutput } from '@lumenflow/kernel';
import { UTF8_ENCODING } from '../constants.js';

const CLI_ENTRY_SCRIPT = 'tools/cli-entry.mjs';

const LIFECYCLE_TOOLS = {
  WU_STATUS: 'wu:status',
  WU_CREATE: 'wu:create',
  WU_CLAIM: 'wu:claim',
  WU_PREP: 'wu:prep',
  WU_DONE: 'wu:done',
  WU_PREFLIGHT: 'wu:preflight',
  WU_VALIDATE: 'wu:validate',
  GATES: 'gates',
} as const;

type LifecycleToolName = (typeof LIFECYCLE_TOOLS)[keyof typeof LIFECYCLE_TOOLS];

const LIFECYCLE_TOOL_ERROR_CODES: Record<LifecycleToolName, string> = {
  'wu:status': 'WU_STATUS_ERROR',
  'wu:create': 'WU_CREATE_ERROR',
  'wu:claim': 'WU_CLAIM_ERROR',
  'wu:prep': 'WU_PREP_ERROR',
  'wu:done': 'WU_DONE_ERROR',
  'wu:preflight': 'WU_PREFLIGHT_ERROR',
  'wu:validate': 'WU_VALIDATE_ERROR',
  gates: 'GATES_ERROR',
};

interface LifecycleToolCommandSpec {
  scriptPath: string;
  scriptSubcommand?: string;
}

const LIFECYCLE_TOOL_COMMAND_SPECS: Record<LifecycleToolName, LifecycleToolCommandSpec> = {
  'wu:status': {
    scriptPath: 'packages/@lumenflow/cli/dist/wu-status.js',
  },
  'wu:create': {
    scriptPath: 'packages/@lumenflow/cli/dist/wu-create.js',
  },
  'wu:claim': {
    scriptPath: CLI_ENTRY_SCRIPT,
    scriptSubcommand: 'wu-claim',
  },
  'wu:prep': {
    scriptPath: CLI_ENTRY_SCRIPT,
    scriptSubcommand: 'wu-prep',
  },
  'wu:done': {
    scriptPath: CLI_ENTRY_SCRIPT,
    scriptSubcommand: 'wu-done',
  },
  'wu:preflight': {
    scriptPath: 'packages/@lumenflow/cli/dist/wu-preflight.js',
  },
  'wu:validate': {
    scriptPath: CLI_ENTRY_SCRIPT,
    scriptSubcommand: 'wu-validate',
  },
  gates: {
    scriptPath: CLI_ENTRY_SCRIPT,
    scriptSubcommand: 'gates',
  },
};

const MISSING_PARAMETER_MESSAGES = {
  ID_REQUIRED: 'id is required',
  LANE_REQUIRED: 'lane is required',
  TITLE_REQUIRED: 'title is required',
  SANDBOX_COMMAND_REQUIRED: 'sandbox_command is required when sandbox=true',
} as const;

interface CommandExecutionResult {
  ok: boolean;
  status: number;
  stdout: string;
  stderr: string;
  spawnError?: string;
}

interface RunOptions {
  parseJson?: boolean;
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

function runLifecycleCommand(toolName: LifecycleToolName, args: string[]): CommandExecutionResult {
  const spec = LIFECYCLE_TOOL_COMMAND_SPECS[toolName];
  const absoluteScriptPath = path.resolve(process.cwd(), spec.scriptPath);
  const nodeArgs = spec.scriptSubcommand
    ? [absoluteScriptPath, spec.scriptSubcommand, ...args]
    : [absoluteScriptPath, ...args];

  const result = spawnSync(process.execPath, nodeArgs, {
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
  toolName: LifecycleToolName,
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
      code: LIFECYCLE_TOOL_ERROR_CODES[toolName],
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
  toolName: LifecycleToolName,
  execution: CommandExecutionResult,
  options: RunOptions,
): ToolOutput {
  const parsedJson = options.parseJson ? parseJsonOutput(execution.stdout) : null;
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

function executeLifecycleTool(
  toolName: LifecycleToolName,
  args: string[],
  options: RunOptions = {},
): ToolOutput {
  const execution = runLifecycleCommand(toolName, args);
  if (!execution.ok) {
    return createFailureOutput(toolName, execution);
  }
  return createSuccessOutput(toolName, execution, options);
}

function pushRepeatedFlag(args: string[], flag: string, values: string[]): void {
  for (const value of values) {
    args.push(flag, value);
  }
}

export async function wuCreateTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const lane = toStringValue(parsed.lane);
  const title = toStringValue(parsed.title);
  if (!lane) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.LANE_REQUIRED);
  }
  if (!title) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.TITLE_REQUIRED);
  }

  const args: string[] = ['--lane', lane, '--title', title];
  const id = toStringValue(parsed.id);
  if (id) {
    args.push('--id', id);
  }
  const description = toStringValue(parsed.description);
  if (description) {
    args.push('--description', description);
  }
  pushRepeatedFlag(args, '--acceptance', toStringArray(parsed.acceptance));
  pushRepeatedFlag(args, '--code-paths', toStringArray(parsed.code_paths));
  const exposure = toStringValue(parsed.exposure);
  if (exposure) {
    args.push('--exposure', exposure);
  }

  return executeLifecycleTool(LIFECYCLE_TOOLS.WU_CREATE, args);
}

export async function wuClaimTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = toStringValue(parsed.id);
  const lane = toStringValue(parsed.lane);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }
  if (!lane) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.LANE_REQUIRED);
  }

  const args: string[] = ['--id', id, '--lane', lane];
  if (parsed.cloud === true) {
    args.push('--cloud');
  }
  if (parsed.branch_only === true) {
    args.push('--branch-only');
  }
  if (parsed.pr_mode === true) {
    args.push('--pr-mode');
  }
  if (parsed.sandbox === true) {
    const sandboxCommand = toStringArray(parsed.sandbox_command);
    if (sandboxCommand.length === 0) {
      return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.SANDBOX_COMMAND_REQUIRED);
    }
    args.push('--sandbox', '--', ...sandboxCommand);
  }

  return executeLifecycleTool(LIFECYCLE_TOOLS.WU_CLAIM, args);
}

export async function wuPrepTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = toStringValue(parsed.id);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }

  const args = ['--id', id];
  if (parsed.docs_only === true) {
    args.push('--docs-only');
  }
  if (parsed.full_tests === true) {
    args.push('--full-tests');
  }

  return executeLifecycleTool(LIFECYCLE_TOOLS.WU_PREP, args);
}

export async function wuDoneTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = toStringValue(parsed.id);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }

  const args = ['--id', id];
  if (parsed.skip_gates === true) {
    args.push('--skip-gates');
    const reason = toStringValue(parsed.reason);
    if (reason) {
      args.push('--reason', reason);
    }
    const fixWu = toStringValue(parsed.fix_wu);
    if (fixWu) {
      args.push('--fix-wu', fixWu);
    }
  }

  return executeLifecycleTool(LIFECYCLE_TOOLS.WU_DONE, args);
}

export async function wuStatusTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = toStringValue(parsed.id);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }

  return executeLifecycleTool(LIFECYCLE_TOOLS.WU_STATUS, ['--id', id, '--json'], {
    parseJson: true,
  });
}

export async function wuPreflightTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = toStringValue(parsed.id);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }

  const args = ['--id', id];
  const worktree = toStringValue(parsed.worktree);
  if (worktree) {
    args.push('--worktree', worktree);
  }

  return executeLifecycleTool(LIFECYCLE_TOOLS.WU_PREFLIGHT, args);
}

export async function wuValidateTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = toStringValue(parsed.id);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }

  const args = ['--id', id];
  if (parsed.no_strict === true) {
    args.push('--no-strict');
  }

  return executeLifecycleTool(LIFECYCLE_TOOLS.WU_VALIDATE, args);
}

export async function gatesTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];
  if (parsed.docs_only === true) {
    args.push('--docs-only');
  }
  if (parsed.full_lint === true) {
    args.push('--full-lint');
  }
  const coverageMode = toStringValue(parsed.coverage_mode);
  if (coverageMode) {
    args.push('--coverage-mode', coverageMode);
  }

  return executeLifecycleTool(LIFECYCLE_TOOLS.GATES, args);
}

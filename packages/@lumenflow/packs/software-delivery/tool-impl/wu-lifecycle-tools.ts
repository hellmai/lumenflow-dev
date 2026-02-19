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
  WU_BRIEF: 'wu:brief',
  WU_DELEGATE: 'wu:delegate',
  WU_DEPS: 'wu:deps',
  WU_EDIT: 'wu:edit',
  WU_PROTO: 'wu:proto',
  WU_PREFLIGHT: 'wu:preflight',
  WU_VALIDATE: 'wu:validate',
  WU_BLOCK: 'wu:block',
  WU_UNBLOCK: 'wu:unblock',
  WU_RELEASE: 'wu:release',
  WU_RECOVER: 'wu:recover',
  WU_REPAIR: 'wu:repair',
  GATES: 'gates',
} as const;

type LifecycleToolName = (typeof LIFECYCLE_TOOLS)[keyof typeof LIFECYCLE_TOOLS];

const LIFECYCLE_TOOL_ERROR_CODES: Record<LifecycleToolName, string> = {
  'wu:status': 'WU_STATUS_ERROR',
  'wu:create': 'WU_CREATE_ERROR',
  'wu:claim': 'WU_CLAIM_ERROR',
  'wu:prep': 'WU_PREP_ERROR',
  'wu:done': 'WU_DONE_ERROR',
  'wu:brief': 'WU_BRIEF_ERROR',
  'wu:delegate': 'WU_DELEGATE_ERROR',
  'wu:deps': 'WU_DEPS_ERROR',
  'wu:edit': 'WU_EDIT_ERROR',
  'wu:proto': 'WU_PROTO_ERROR',
  'wu:preflight': 'WU_PREFLIGHT_ERROR',
  'wu:validate': 'WU_VALIDATE_ERROR',
  'wu:block': 'WU_BLOCK_ERROR',
  'wu:unblock': 'WU_UNBLOCK_ERROR',
  'wu:release': 'WU_RELEASE_ERROR',
  'wu:recover': 'WU_RECOVER_ERROR',
  'wu:repair': 'WU_REPAIR_ERROR',
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
  'wu:brief': {
    scriptPath: CLI_ENTRY_SCRIPT,
    scriptSubcommand: 'wu-brief',
  },
  'wu:delegate': {
    scriptPath: CLI_ENTRY_SCRIPT,
    scriptSubcommand: 'wu-delegate',
  },
  'wu:deps': {
    scriptPath: CLI_ENTRY_SCRIPT,
    scriptSubcommand: 'wu-deps',
  },
  'wu:edit': {
    scriptPath: CLI_ENTRY_SCRIPT,
    scriptSubcommand: 'wu-edit',
  },
  'wu:proto': {
    scriptPath: CLI_ENTRY_SCRIPT,
    scriptSubcommand: 'wu-proto',
  },
  'wu:preflight': {
    scriptPath: 'packages/@lumenflow/cli/dist/wu-preflight.js',
  },
  'wu:validate': {
    scriptPath: CLI_ENTRY_SCRIPT,
    scriptSubcommand: 'wu-validate',
  },
  'wu:block': {
    scriptPath: CLI_ENTRY_SCRIPT,
    scriptSubcommand: 'wu-block',
  },
  'wu:unblock': {
    scriptPath: CLI_ENTRY_SCRIPT,
    scriptSubcommand: 'wu-unblock',
  },
  'wu:release': {
    scriptPath: CLI_ENTRY_SCRIPT,
    scriptSubcommand: 'wu-release',
  },
  'wu:recover': {
    scriptPath: CLI_ENTRY_SCRIPT,
    scriptSubcommand: 'wu-recover',
  },
  'wu:repair': {
    scriptPath: CLI_ENTRY_SCRIPT,
    scriptSubcommand: 'wu-repair',
  },
  gates: {
    scriptPath: CLI_ENTRY_SCRIPT,
    scriptSubcommand: 'gates',
  },
};

const MISSING_PARAMETER_MESSAGES = {
  ID_REQUIRED: 'id is required',
  PARENT_WU_REQUIRED: 'parent_wu is required',
  LANE_REQUIRED: 'lane is required',
  TITLE_REQUIRED: 'title is required',
  REASON_REQUIRED: 'reason is required',
  SANDBOX_COMMAND_REQUIRED: 'sandbox_command is required when sandbox=true',
} as const;

const LIFECYCLE_FLAGS = {
  DESCRIPTION: '--description',
  CODE_PATHS: '--code-paths',
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

function appendWuPromptArgs(parsed: Record<string, unknown>, args: string[]): void {
  const client = toStringValue(parsed.client);
  if (client) {
    args.push('--client', client);
  }
  if (parsed.thinking === true) {
    args.push('--thinking');
  }
  const budget = toIntegerString(parsed.budget);
  if (budget) {
    args.push('--budget', budget);
  }
  const parentWu = toStringValue(parsed.parent_wu);
  if (parentWu) {
    args.push('--parent-wu', parentWu);
  }
  if (parsed.no_context === true) {
    args.push('--no-context');
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
    args.push(LIFECYCLE_FLAGS.DESCRIPTION, description);
  }
  pushRepeatedFlag(args, '--acceptance', toStringArray(parsed.acceptance));
  pushRepeatedFlag(args, LIFECYCLE_FLAGS.CODE_PATHS, toStringArray(parsed.code_paths));
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

export async function wuProtoTool(input: unknown): Promise<ToolOutput> {
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
  const description = toStringValue(parsed.description);
  if (description) {
    args.push(LIFECYCLE_FLAGS.DESCRIPTION, description);
  }
  pushRepeatedFlag(args, LIFECYCLE_FLAGS.CODE_PATHS, toStringArray(parsed.code_paths));
  const labels = toStringArray(parsed.labels);
  if (labels.length > 0) {
    args.push('--labels', labels.join(','));
  }
  const assignedTo = toStringValue(parsed.assigned_to);
  if (assignedTo) {
    args.push('--assigned-to', assignedTo);
  }

  return executeLifecycleTool(LIFECYCLE_TOOLS.WU_PROTO, args);
}

export async function wuBriefTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = toStringValue(parsed.id);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }

  const args: string[] = ['--id', id];
  appendWuPromptArgs(parsed, args);

  return executeLifecycleTool(LIFECYCLE_TOOLS.WU_BRIEF, args);
}

export async function wuDelegateTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = toStringValue(parsed.id);
  const parentWu = toStringValue(parsed.parent_wu);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }
  if (!parentWu) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.PARENT_WU_REQUIRED);
  }

  const args: string[] = ['--id', id];
  appendWuPromptArgs(parsed, args);

  return executeLifecycleTool(LIFECYCLE_TOOLS.WU_DELEGATE, args);
}

export async function wuDepsTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = toStringValue(parsed.id);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }

  const args: string[] = ['--id', id];
  const format = toStringValue(parsed.format);
  if (format) {
    args.push('--format', format);
  }
  const depth = toIntegerString(parsed.depth);
  if (depth) {
    args.push('--depth', depth);
  }
  const direction = toStringValue(parsed.direction);
  if (direction) {
    args.push('--direction', direction);
  }

  return executeLifecycleTool(LIFECYCLE_TOOLS.WU_DEPS, args);
}

export async function wuEditTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = toStringValue(parsed.id);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }

  const args: string[] = ['--id', id];
  const description = toStringValue(parsed.description);
  if (description) {
    args.push(LIFECYCLE_FLAGS.DESCRIPTION, description);
  }
  pushRepeatedFlag(args, '--acceptance', toStringArray(parsed.acceptance));
  const notes = toStringValue(parsed.notes);
  if (notes) {
    args.push('--notes', notes);
  }
  pushRepeatedFlag(args, LIFECYCLE_FLAGS.CODE_PATHS, toStringArray(parsed.code_paths));
  const lane = toStringValue(parsed.lane);
  if (lane) {
    args.push('--lane', lane);
  }
  const priority = toStringValue(parsed.priority);
  if (priority) {
    args.push('--priority', priority);
  }
  const initiative = toStringValue(parsed.initiative);
  if (initiative) {
    args.push('--initiative', initiative);
  }
  const phase = toIntegerString(parsed.phase);
  if (phase) {
    args.push('--phase', phase);
  }
  if (parsed.no_strict === true) {
    args.push('--no-strict');
  }

  return executeLifecycleTool(LIFECYCLE_TOOLS.WU_EDIT, args);
}

export async function wuBlockTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = toStringValue(parsed.id);
  const reason = toStringValue(parsed.reason);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }
  if (!reason) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.REASON_REQUIRED);
  }

  const args = ['--id', id, '--reason', reason];
  if (parsed.remove_worktree === true) {
    args.push('--remove-worktree');
  }

  return executeLifecycleTool(LIFECYCLE_TOOLS.WU_BLOCK, args);
}

export async function wuUnblockTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = toStringValue(parsed.id);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }

  const args = ['--id', id];
  const reason = toStringValue(parsed.reason);
  if (reason) {
    args.push('--reason', reason);
  }
  if (parsed.create_worktree === true) {
    args.push('--create-worktree');
  }

  return executeLifecycleTool(LIFECYCLE_TOOLS.WU_UNBLOCK, args);
}

export async function wuReleaseTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = toStringValue(parsed.id);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }

  const args = ['--id', id];
  const reason = toStringValue(parsed.reason);
  if (reason) {
    args.push('--reason', reason);
  }

  return executeLifecycleTool(LIFECYCLE_TOOLS.WU_RELEASE, args);
}

export async function wuRecoverTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = toStringValue(parsed.id);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }

  const args = ['--id', id];
  const action = toStringValue(parsed.action);
  if (action) {
    args.push('--action', action);
  }
  if (parsed.force === true) {
    args.push('--force');
  }
  if (parsed.json === true) {
    args.push('--json');
  }

  return executeLifecycleTool(LIFECYCLE_TOOLS.WU_RECOVER, args, {
    parseJson: parsed.json === true,
  });
}

export async function wuRepairTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);

  const args: string[] = [];
  const id = toStringValue(parsed.id);
  if (id) {
    args.push('--id', id);
  }
  if (parsed.check === true) {
    args.push('--check');
  }
  if (parsed.all === true) {
    args.push('--all');
  }
  if (parsed.claim === true) {
    args.push('--claim');
  }
  if (parsed.admin === true) {
    args.push('--admin');
  }
  if (parsed.repair_state === true) {
    args.push('--repair-state');
  }

  return executeLifecycleTool(LIFECYCLE_TOOLS.WU_REPAIR, args);
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

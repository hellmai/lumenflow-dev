// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import type { ToolOutput } from '@lumenflow/kernel';
import { RUNTIME_CLI_COMMANDS, runtimeCliAdapter } from './runtime-cli-adapter.js';

const MEMORY_TOOLS = {
  MEM_INIT: 'mem:init',
  MEM_START: 'mem:start',
  MEM_READY: 'mem:ready',
  MEM_CHECKPOINT: 'mem:checkpoint',
  MEM_CLEANUP: 'mem:cleanup',
  MEM_CONTEXT: 'mem:context',
  MEM_CREATE: 'mem:create',
  MEM_DELETE: 'mem:delete',
  MEM_EXPORT: 'mem:export',
  MEM_INBOX: 'mem:inbox',
  MEM_SIGNAL: 'mem:signal',
  MEM_SUMMARIZE: 'mem:summarize',
  MEM_TRIAGE: 'mem:triage',
  MEM_RECOVER: 'mem:recover',
} as const;

type MemoryToolName = (typeof MEMORY_TOOLS)[keyof typeof MEMORY_TOOLS];

const MEMORY_TOOL_ERROR_CODES: Record<MemoryToolName, string> = {
  'mem:init': 'MEM_INIT_ERROR',
  'mem:start': 'MEM_START_ERROR',
  'mem:ready': 'MEM_READY_ERROR',
  'mem:checkpoint': 'MEM_CHECKPOINT_ERROR',
  'mem:cleanup': 'MEM_CLEANUP_ERROR',
  'mem:context': 'MEM_CONTEXT_ERROR',
  'mem:create': 'MEM_CREATE_ERROR',
  'mem:delete': 'MEM_DELETE_ERROR',
  'mem:export': 'MEM_EXPORT_ERROR',
  'mem:inbox': 'MEM_INBOX_ERROR',
  'mem:signal': 'MEM_SIGNAL_ERROR',
  'mem:summarize': 'MEM_SUMMARIZE_ERROR',
  'mem:triage': 'MEM_TRIAGE_ERROR',
  'mem:recover': 'MEM_RECOVER_ERROR',
};

const MEMORY_TOOL_COMMANDS: Record<
  MemoryToolName,
  (typeof RUNTIME_CLI_COMMANDS)[keyof typeof RUNTIME_CLI_COMMANDS]
> = {
  'mem:init': RUNTIME_CLI_COMMANDS.MEM_INIT,
  'mem:start': RUNTIME_CLI_COMMANDS.MEM_START,
  'mem:ready': RUNTIME_CLI_COMMANDS.MEM_READY,
  'mem:checkpoint': RUNTIME_CLI_COMMANDS.MEM_CHECKPOINT,
  'mem:cleanup': RUNTIME_CLI_COMMANDS.MEM_CLEANUP,
  'mem:context': RUNTIME_CLI_COMMANDS.MEM_CONTEXT,
  'mem:create': RUNTIME_CLI_COMMANDS.MEM_CREATE,
  'mem:delete': RUNTIME_CLI_COMMANDS.MEM_DELETE,
  'mem:export': RUNTIME_CLI_COMMANDS.MEM_EXPORT,
  'mem:inbox': RUNTIME_CLI_COMMANDS.MEM_INBOX,
  'mem:signal': RUNTIME_CLI_COMMANDS.MEM_SIGNAL,
  'mem:summarize': RUNTIME_CLI_COMMANDS.MEM_SUMMARIZE,
  'mem:triage': RUNTIME_CLI_COMMANDS.MEM_TRIAGE,
  'mem:recover': RUNTIME_CLI_COMMANDS.MEM_RECOVER,
};

const MISSING_PARAMETER_MESSAGES = {
  ID_REQUIRED: 'id is required',
  WU_REQUIRED: 'wu is required',
  MESSAGE_REQUIRED: 'message is required',
} as const;

interface CommandExecutionResult {
  ok: boolean;
  status: number;
  stdout: string;
  stderr: string;
  executionError?: string;
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

async function runMemoryCommand(
  toolName: MemoryToolName,
  args: string[],
): Promise<CommandExecutionResult> {
  return runtimeCliAdapter.run(MEMORY_TOOL_COMMANDS[toolName], args);
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
  toolName: MemoryToolName,
  execution: CommandExecutionResult,
): ToolOutput {
  const stderrMessage = execution.stderr.trim();
  const stdoutMessage = execution.stdout.trim();
  const message =
    execution.executionError ??
    (stderrMessage.length > 0
      ? stderrMessage
      : stdoutMessage.length > 0
        ? stdoutMessage
        : `${toolName} failed`);
  return {
    success: false,
    error: {
      code: MEMORY_TOOL_ERROR_CODES[toolName],
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
  toolName: MemoryToolName,
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

async function executeMemoryTool(toolName: MemoryToolName, args: string[]): Promise<ToolOutput> {
  const execution = await runMemoryCommand(toolName, args);
  if (!execution.ok) {
    return createFailureOutput(toolName, execution);
  }
  return createSuccessOutput(toolName, execution);
}

export async function memInitTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const wu = toStringValue(parsed.wu);
  if (!wu) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.WU_REQUIRED);
  }

  return executeMemoryTool(MEMORY_TOOLS.MEM_INIT, ['--wu', wu]);
}

export async function memStartTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const wu = toStringValue(parsed.wu);
  if (!wu) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.WU_REQUIRED);
  }

  const args = ['--wu', wu];
  const lane = toStringValue(parsed.lane);
  if (lane) {
    args.push('--lane', lane);
  }

  return executeMemoryTool(MEMORY_TOOLS.MEM_START, args);
}

export async function memReadyTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const wu = toStringValue(parsed.wu);
  if (!wu) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.WU_REQUIRED);
  }

  return executeMemoryTool(MEMORY_TOOLS.MEM_READY, ['--wu', wu]);
}

export async function memCheckpointTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const wu = toStringValue(parsed.wu);
  if (!wu) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.WU_REQUIRED);
  }

  const args = ['--wu', wu];
  const message = toStringValue(parsed.message);
  if (message) {
    args.push('--message', message);
  }

  return executeMemoryTool(MEMORY_TOOLS.MEM_CHECKPOINT, args);
}

export async function memCleanupTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];
  if (parsed.dry_run === true) {
    args.push('--dry-run');
  }

  return executeMemoryTool(MEMORY_TOOLS.MEM_CLEANUP, args);
}

export async function memContextTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const wu = toStringValue(parsed.wu);
  if (!wu) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.WU_REQUIRED);
  }

  const args = ['--wu', wu];
  const lane = toStringValue(parsed.lane);
  if (lane) {
    args.push('--lane', lane);
  }

  return executeMemoryTool(MEMORY_TOOLS.MEM_CONTEXT, args);
}

export async function memCreateTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const message = toStringValue(parsed.message);
  if (!message) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.MESSAGE_REQUIRED);
  }

  const wu = toStringValue(parsed.wu);
  if (!wu) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.WU_REQUIRED);
  }

  const args = [message, '--wu', wu];
  const type = toStringValue(parsed.type);
  if (type) {
    args.push('--type', type);
  }
  const tags = toStringArray(parsed.tags);
  if (tags.length > 0) {
    args.push('--tags', tags.join(','));
  }

  return executeMemoryTool(MEMORY_TOOLS.MEM_CREATE, args);
}

export async function memDeleteTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = toStringValue(parsed.id);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }

  return executeMemoryTool(MEMORY_TOOLS.MEM_DELETE, ['--id', id]);
}

export async function memExportTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const wu = toStringValue(parsed.wu);
  if (!wu) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.WU_REQUIRED);
  }

  const args = ['--wu', wu];
  const format = toStringValue(parsed.format);
  if (format) {
    args.push('--format', format);
  }

  return executeMemoryTool(MEMORY_TOOLS.MEM_EXPORT, args);
}

export async function memInboxTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];
  const since = toStringValue(parsed.since);
  if (since) {
    args.push('--since', since);
  }
  const wu = toStringValue(parsed.wu);
  if (wu) {
    args.push('--wu', wu);
  }
  const lane = toStringValue(parsed.lane);
  if (lane) {
    args.push('--lane', lane);
  }

  return executeMemoryTool(MEMORY_TOOLS.MEM_INBOX, args);
}

export async function memSignalTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const message = toStringValue(parsed.message);
  if (!message) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.MESSAGE_REQUIRED);
  }

  const wu = toStringValue(parsed.wu);
  if (!wu) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.WU_REQUIRED);
  }

  return executeMemoryTool(MEMORY_TOOLS.MEM_SIGNAL, [message, '--wu', wu]);
}

export async function memSummarizeTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const wu = toStringValue(parsed.wu);
  if (!wu) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.WU_REQUIRED);
  }

  return executeMemoryTool(MEMORY_TOOLS.MEM_SUMMARIZE, ['--wu', wu]);
}

export async function memTriageTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const wu = toStringValue(parsed.wu);
  if (!wu) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.WU_REQUIRED);
  }

  const args = ['--wu', wu];
  const promote = toStringValue(parsed.promote);
  if (promote) {
    args.push('--promote', promote);
  }
  const lane = toStringValue(parsed.lane);
  if (lane) {
    args.push('--lane', lane);
  }

  return executeMemoryTool(MEMORY_TOOLS.MEM_TRIAGE, args);
}

export async function memRecoverTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const wu = toStringValue(parsed.wu);
  if (!wu) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.WU_REQUIRED);
  }

  const args = ['--wu', wu];
  const maxSize = toIntegerString(parsed.max_size);
  if (maxSize) {
    args.push('--max-size', maxSize);
  }
  const format = toStringValue(parsed.format);
  if (format) {
    args.push('--format', format);
  }
  if (parsed.quiet === true) {
    args.push('--quiet');
  }
  const baseDir = toStringValue(parsed.base_dir);
  if (baseDir) {
    args.push('--base-dir', baseDir);
  }

  return executeMemoryTool(MEMORY_TOOLS.MEM_RECOVER, args);
}

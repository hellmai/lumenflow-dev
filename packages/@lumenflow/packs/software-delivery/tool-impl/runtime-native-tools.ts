// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import type { ToolOutput } from '@lumenflow/kernel';
import { RUNTIME_CLI_COMMANDS, runtimeCliAdapter } from './runtime-cli-adapter.js';

const RUNTIME_NATIVE_TOOLS = {
  WU_INFER_LANE: 'wu:infer-lane',
  CONFIG_SET: 'config:set',
  CONFIG_GET: 'config:get',
  LANE_HEALTH: 'lane:health',
  LANE_SUGGEST: 'lane:suggest',
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_EDIT: 'file:edit',
  FILE_DELETE: 'file:delete',
  GIT_BRANCH: 'git:branch',
  GIT_DIFF: 'git:diff',
  GIT_LOG: 'git:log',
  STATE_BOOTSTRAP: 'state:bootstrap',
  STATE_CLEANUP: 'state:cleanup',
  STATE_DOCTOR: 'state:doctor',
  BACKLOG_PRUNE: 'backlog:prune',
  SIGNAL_CLEANUP: 'signal:cleanup',
  LUMENFLOW_METRICS: 'lumenflow:metrics',
  VALIDATE: 'validate',
  VALIDATE_AGENT_SKILLS: 'validate:agent-skills',
  VALIDATE_AGENT_SYNC: 'validate:agent-sync',
  VALIDATE_BACKLOG_SYNC: 'validate:backlog-sync',
  VALIDATE_SKILLS_SPEC: 'validate:skills-spec',
  LUMENFLOW_VALIDATE: 'lumenflow:validate',
} as const;

type RuntimeNativeToolName = (typeof RUNTIME_NATIVE_TOOLS)[keyof typeof RUNTIME_NATIVE_TOOLS];

const RUNTIME_NATIVE_TOOL_ERROR_CODES: Record<RuntimeNativeToolName, string> = {
  'wu:infer-lane': 'WU_INFER_LANE_ERROR',
  'config:set': 'CONFIG_SET_ERROR',
  'config:get': 'CONFIG_GET_ERROR',
  'lane:health': 'LANE_HEALTH_ERROR',
  'lane:suggest': 'LANE_SUGGEST_ERROR',
  'file:read': 'FILE_READ_ERROR',
  'file:write': 'FILE_WRITE_ERROR',
  'file:edit': 'FILE_EDIT_ERROR',
  'file:delete': 'FILE_DELETE_ERROR',
  'git:branch': 'GIT_BRANCH_ERROR',
  'git:diff': 'GIT_DIFF_ERROR',
  'git:log': 'GIT_LOG_ERROR',
  'state:bootstrap': 'STATE_BOOTSTRAP_ERROR',
  'state:cleanup': 'STATE_CLEANUP_ERROR',
  'state:doctor': 'STATE_DOCTOR_ERROR',
  'backlog:prune': 'BACKLOG_PRUNE_ERROR',
  'signal:cleanup': 'SIGNAL_CLEANUP_ERROR',
  'lumenflow:metrics': 'LUMENFLOW_METRICS_ERROR',
  validate: 'VALIDATE_ERROR',
  'validate:agent-skills': 'VALIDATE_AGENT_SKILLS_ERROR',
  'validate:agent-sync': 'VALIDATE_AGENT_SYNC_ERROR',
  'validate:backlog-sync': 'VALIDATE_BACKLOG_SYNC_ERROR',
  'validate:skills-spec': 'VALIDATE_SKILLS_SPEC_ERROR',
  'lumenflow:validate': 'LUMENFLOW_VALIDATE_ERROR',
};

const RUNTIME_NATIVE_TOOL_COMMANDS: Record<
  RuntimeNativeToolName,
  (typeof RUNTIME_CLI_COMMANDS)[keyof typeof RUNTIME_CLI_COMMANDS]
> = {
  'wu:infer-lane': RUNTIME_CLI_COMMANDS.WU_INFER_LANE,
  'config:set': RUNTIME_CLI_COMMANDS.CONFIG_SET,
  'config:get': RUNTIME_CLI_COMMANDS.CONFIG_GET,
  'lane:health': RUNTIME_CLI_COMMANDS.LANE_HEALTH,
  'lane:suggest': RUNTIME_CLI_COMMANDS.LANE_SUGGEST,
  'file:read': RUNTIME_CLI_COMMANDS.FILE_READ,
  'file:write': RUNTIME_CLI_COMMANDS.FILE_WRITE,
  'file:edit': RUNTIME_CLI_COMMANDS.FILE_EDIT,
  'file:delete': RUNTIME_CLI_COMMANDS.FILE_DELETE,
  'git:branch': RUNTIME_CLI_COMMANDS.GIT_BRANCH,
  'git:diff': RUNTIME_CLI_COMMANDS.GIT_DIFF,
  'git:log': RUNTIME_CLI_COMMANDS.GIT_LOG,
  'state:bootstrap': RUNTIME_CLI_COMMANDS.STATE_BOOTSTRAP,
  'state:cleanup': RUNTIME_CLI_COMMANDS.STATE_CLEANUP,
  'state:doctor': RUNTIME_CLI_COMMANDS.STATE_DOCTOR,
  'backlog:prune': RUNTIME_CLI_COMMANDS.BACKLOG_PRUNE,
  'signal:cleanup': RUNTIME_CLI_COMMANDS.SIGNAL_CLEANUP,
  'lumenflow:metrics': RUNTIME_CLI_COMMANDS.METRICS,
  validate: RUNTIME_CLI_COMMANDS.VALIDATE,
  'validate:agent-skills': RUNTIME_CLI_COMMANDS.VALIDATE_AGENT_SKILLS,
  'validate:agent-sync': RUNTIME_CLI_COMMANDS.VALIDATE_AGENT_SYNC,
  'validate:backlog-sync': RUNTIME_CLI_COMMANDS.VALIDATE_BACKLOG_SYNC,
  'validate:skills-spec': RUNTIME_CLI_COMMANDS.VALIDATE_SKILLS_SPEC,
  'lumenflow:validate': RUNTIME_CLI_COMMANDS.VALIDATE,
};

const FLAG_NAMES = {
  ALL: '--all',
  ARCHIVE_DAYS: '--archive-days',
  AUTHOR: '--author',
  BASE_DIR: '--base-dir',
  DAYS: '--days',
  CONTAINS: '--contains',
  CONTENT: '--content',
  DESC: '--desc',
  DONE_ONLY: '--done-only',
  DRY_RUN: '--dry-run',
  ENCODING: '--encoding',
  EVENTS_ONLY: '--events-only',
  EXECUTE: '--execute',
  FIX: '--fix',
  FORCE: '--force',
  FORMAT: '--format',
  ID: '--id',
  INCLUDE_GIT: '--include-git',
  INTERACTIVE: '--interactive',
  JSON: '--json',
  KEY: '--key',
  MAX_COUNT: '--max-count',
  MAX_ENTRIES: '--max-entries',
  MAX_SIZE: '--max-size',
  MEMORY_ONLY: '--memory-only',
  NAME_ONLY: '--name-only',
  NEW_STRING: '--new-string',
  NO_COVERAGE: '--no-coverage',
  NO_CREATE_DIRS: '--no-create-dirs',
  NO_LLM: '--no-llm',
  OLD_STRING: '--old-string',
  ONELINE: '--oneline',
  OUTPUT: '--output',
  PATH: '--path',
  PATHS: '--paths',
  QUIET: '--quiet',
  REF: '--ref',
  REMOTES: '--remotes',
  RECURSIVE: '--recursive',
  REPLACE_ALL: '--replace-all',
  SHOW_CURRENT: '--show-current',
  SIGNALS_ONLY: '--signals-only',
  SINCE: '--since',
  SKILL: '--skill',
  STAGED: '--staged',
  STALE_DAYS_IN_PROGRESS: '--stale-days-in-progress',
  STALE_DAYS_READY: '--stale-days-ready',
  START_LINE: '--start-line',
  STATUS: '--status',
  STATE_DIR: '--state-dir',
  STAT: '--stat',
  STRICT: '--strict',
  TTL: '--ttl',
  UNREAD_TTL: '--unread-ttl',
  VALUE: '--value',
  VERBOSE: '--verbose',
  WU_DIR: '--wu-dir',
} as const;

const MISSING_PARAMETER_MESSAGES = {
  CONTENT_REQUIRED: 'content is required',
  KEY_REQUIRED: 'key is required',
  NEW_STRING_REQUIRED: 'new_string is required',
  OLD_STRING_REQUIRED: 'old_string is required',
  PATH_REQUIRED: 'path is required',
  VALUE_REQUIRED: 'value is required',
} as const;

const CORE_RUNTIME_ERROR_CODES = {
  CONTEXT_GET: 'CONTEXT_ERROR',
  WU_LIST: 'WU_LIST_ERROR',
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

interface CoreModuleLike {
  computeWuContext: (options: { cwd: string }) => Promise<unknown>;
  listWUs: (options: Record<string, unknown>) => Promise<unknown>;
}

const CORE_MODULE_ID = '@lumenflow/core';
let coreModule: CoreModuleLike | null = null;

async function getCoreLazy(): Promise<CoreModuleLike> {
  if (!coreModule) {
    coreModule = (await import(CORE_MODULE_ID)) as CoreModuleLike;
  }
  return coreModule;
}

function toStringValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toStringPreserveEmpty(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return value;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => toStringValue(item)).filter((item): item is string => item !== null);
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

function appendFlagIfTrue(args: string[], enabled: unknown, flagName: string): void {
  if (enabled === true) {
    args.push(flagName);
  }
}

function appendValueIfPresent(
  args: string[],
  flagName: string,
  value: unknown,
  converter: (value: unknown) => string | null = toStringValue,
): void {
  const converted = converter(value);
  if (converted !== null) {
    args.push(flagName, converted);
  }
}

async function runRuntimeNativeCommand(
  toolName: RuntimeNativeToolName,
  args: string[],
): Promise<CommandExecutionResult> {
  return runtimeCliAdapter.run(RUNTIME_NATIVE_TOOL_COMMANDS[toolName], args);
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
  toolName: RuntimeNativeToolName,
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
      code: RUNTIME_NATIVE_TOOL_ERROR_CODES[toolName],
      message,
      details: {
        exit_code: execution.status,
        stdout: execution.stdout,
        stderr: execution.stderr,
      },
    },
  };
}

function createSuccessOutput(
  toolName: RuntimeNativeToolName,
  execution: CommandExecutionResult,
): ToolOutput {
  const message = execution.stdout.trim().length > 0 ? execution.stdout.trim() : `${toolName} ran`;
  return {
    success: true,
    data: {
      message,
    },
  };
}

function createCoreFailureOutput(code: string, error: unknown): ToolOutput {
  return {
    success: false,
    error: {
      code,
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

async function executeRuntimeNativeTool(
  toolName: RuntimeNativeToolName,
  args: string[],
): Promise<ToolOutput> {
  const execution = await runRuntimeNativeCommand(toolName, args);
  if (!execution.ok) {
    return createFailureOutput(toolName, execution);
  }
  return createSuccessOutput(toolName, execution);
}

export async function wuInferLaneTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];

  appendValueIfPresent(args, FLAG_NAMES.ID, parsed.id);
  for (const pathValue of toStringArray(parsed.paths)) {
    args.push(FLAG_NAMES.PATHS, pathValue);
  }
  appendValueIfPresent(args, FLAG_NAMES.DESC, parsed.desc);

  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.WU_INFER_LANE, args);
}

export async function wuListTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  try {
    const core = await getCoreLazy();
    const options: Record<string, unknown> = { projectRoot: process.cwd() };
    const status = toStringValue(parsed.status);
    if (status) {
      options.status = status;
    }
    const lane = toStringValue(parsed.lane);
    if (lane) {
      options.lane = lane;
    }
    const wus = await core.listWUs(options);
    return {
      success: true,
      data: wus,
    };
  } catch (error) {
    return createCoreFailureOutput(CORE_RUNTIME_ERROR_CODES.WU_LIST, error);
  }
}

export async function contextGetTool(_input: unknown): Promise<ToolOutput> {
  try {
    const core = await getCoreLazy();
    const context = await core.computeWuContext({ cwd: process.cwd() });
    return {
      success: true,
      data: context,
    };
  } catch (error) {
    return createCoreFailureOutput(CORE_RUNTIME_ERROR_CODES.CONTEXT_GET, error);
  }
}

export async function configSetTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const keyValue = toStringValue(parsed.key);
  if (!keyValue) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.KEY_REQUIRED);
  }
  if (parsed.value === undefined) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.VALUE_REQUIRED);
  }

  const valueString = String(parsed.value);
  const args: string[] = [FLAG_NAMES.KEY, keyValue, FLAG_NAMES.VALUE, valueString];

  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.CONFIG_SET, args);
}

export async function configGetTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const keyValue = toStringValue(parsed.key);
  if (!keyValue) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.KEY_REQUIRED);
  }

  const args: string[] = [FLAG_NAMES.KEY, keyValue];

  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.CONFIG_GET, args);
}

export async function laneHealthTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];

  appendFlagIfTrue(args, parsed.json, FLAG_NAMES.JSON);
  appendFlagIfTrue(args, parsed.verbose, FLAG_NAMES.VERBOSE);
  appendFlagIfTrue(args, parsed.no_coverage, FLAG_NAMES.NO_COVERAGE);

  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.LANE_HEALTH, args);
}

export async function laneSuggestTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];

  appendFlagIfTrue(args, parsed.dry_run, FLAG_NAMES.DRY_RUN);
  appendFlagIfTrue(args, parsed.interactive, FLAG_NAMES.INTERACTIVE);
  appendValueIfPresent(args, FLAG_NAMES.OUTPUT, parsed.output);
  appendFlagIfTrue(args, parsed.json, FLAG_NAMES.JSON);
  appendFlagIfTrue(args, parsed.no_llm, FLAG_NAMES.NO_LLM);
  appendFlagIfTrue(args, parsed.include_git, FLAG_NAMES.INCLUDE_GIT);

  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.LANE_SUGGEST, args);
}

export async function fileReadTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const pathValue = toStringValue(parsed.path);
  if (!pathValue) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.PATH_REQUIRED);
  }

  const args: string[] = [FLAG_NAMES.PATH, pathValue];
  appendValueIfPresent(args, FLAG_NAMES.ENCODING, parsed.encoding);
  appendValueIfPresent(args, FLAG_NAMES.START_LINE, parsed.start_line, toIntegerString);
  appendValueIfPresent(args, '--end-line', parsed.end_line, toIntegerString);
  appendValueIfPresent(args, FLAG_NAMES.MAX_SIZE, parsed.max_size, toIntegerString);

  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.FILE_READ, args);
}

export async function fileWriteTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const pathValue = toStringValue(parsed.path);
  if (!pathValue) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.PATH_REQUIRED);
  }
  const contentValue = toStringPreserveEmpty(parsed.content);
  if (contentValue === null) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.CONTENT_REQUIRED);
  }

  const args: string[] = [FLAG_NAMES.PATH, pathValue, FLAG_NAMES.CONTENT, contentValue];
  appendValueIfPresent(args, FLAG_NAMES.ENCODING, parsed.encoding);
  appendFlagIfTrue(args, parsed.no_create_dirs, FLAG_NAMES.NO_CREATE_DIRS);

  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.FILE_WRITE, args);
}

export async function fileEditTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const pathValue = toStringValue(parsed.path);
  if (!pathValue) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.PATH_REQUIRED);
  }
  const oldStringValue = toStringValue(parsed.old_string);
  if (oldStringValue === null) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.OLD_STRING_REQUIRED);
  }
  const newStringValue = toStringPreserveEmpty(parsed.new_string);
  if (newStringValue === null) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.NEW_STRING_REQUIRED);
  }

  const args: string[] = [
    FLAG_NAMES.PATH,
    pathValue,
    FLAG_NAMES.OLD_STRING,
    oldStringValue,
    FLAG_NAMES.NEW_STRING,
    newStringValue,
  ];
  appendValueIfPresent(args, FLAG_NAMES.ENCODING, parsed.encoding);
  appendFlagIfTrue(args, parsed.replace_all, FLAG_NAMES.REPLACE_ALL);

  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.FILE_EDIT, args);
}

export async function fileDeleteTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const pathValue = toStringValue(parsed.path);
  if (!pathValue) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.PATH_REQUIRED);
  }

  const args: string[] = [FLAG_NAMES.PATH, pathValue];
  appendFlagIfTrue(args, parsed.recursive, FLAG_NAMES.RECURSIVE);
  appendFlagIfTrue(args, parsed.force, FLAG_NAMES.FORCE);

  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.FILE_DELETE, args);
}

export async function gitBranchTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];

  appendValueIfPresent(args, FLAG_NAMES.BASE_DIR, parsed.base_dir);
  appendFlagIfTrue(args, parsed.list, '--list');
  appendFlagIfTrue(args, parsed.all, FLAG_NAMES.ALL);
  appendFlagIfTrue(args, parsed.remotes, FLAG_NAMES.REMOTES);
  appendFlagIfTrue(args, parsed.show_current, FLAG_NAMES.SHOW_CURRENT);
  appendValueIfPresent(args, FLAG_NAMES.CONTAINS, parsed.contains);

  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.GIT_BRANCH, args);
}

export async function gitDiffTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];

  appendValueIfPresent(args, FLAG_NAMES.BASE_DIR, parsed.base_dir);
  appendFlagIfTrue(args, parsed.staged, FLAG_NAMES.STAGED);
  appendFlagIfTrue(args, parsed.name_only, FLAG_NAMES.NAME_ONLY);
  appendFlagIfTrue(args, parsed.stat, FLAG_NAMES.STAT);
  const refValue = toStringValue(parsed.ref);
  if (refValue) {
    args.push(refValue);
  }
  const pathValue = toStringValue(parsed.path);
  if (pathValue) {
    args.push('--', pathValue);
  }

  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.GIT_DIFF, args);
}

export async function gitLogTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];

  appendValueIfPresent(args, FLAG_NAMES.BASE_DIR, parsed.base_dir);
  appendFlagIfTrue(args, parsed.oneline, FLAG_NAMES.ONELINE);
  appendValueIfPresent(args, '-n', parsed.max_count, toIntegerString);
  appendValueIfPresent(args, FLAG_NAMES.FORMAT, parsed.format);
  appendValueIfPresent(args, FLAG_NAMES.SINCE, parsed.since);
  appendValueIfPresent(args, FLAG_NAMES.AUTHOR, parsed.author);
  const refValue = toStringValue(parsed.ref);
  if (refValue) {
    args.push(refValue);
  }

  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.GIT_LOG, args);
}

export async function stateBootstrapTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];

  appendFlagIfTrue(args, parsed.execute, FLAG_NAMES.EXECUTE);
  appendFlagIfTrue(args, parsed.dry_run, FLAG_NAMES.DRY_RUN);
  appendFlagIfTrue(args, parsed.force, FLAG_NAMES.FORCE);
  appendValueIfPresent(args, FLAG_NAMES.WU_DIR, parsed.wu_dir);
  appendValueIfPresent(args, FLAG_NAMES.STATE_DIR, parsed.state_dir);

  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.STATE_BOOTSTRAP, args);
}

export async function stateCleanupTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];

  appendFlagIfTrue(args, parsed.dry_run, FLAG_NAMES.DRY_RUN);
  appendFlagIfTrue(args, parsed.signals_only, FLAG_NAMES.SIGNALS_ONLY);
  appendFlagIfTrue(args, parsed.memory_only, FLAG_NAMES.MEMORY_ONLY);
  appendFlagIfTrue(args, parsed.events_only, FLAG_NAMES.EVENTS_ONLY);
  appendFlagIfTrue(args, parsed.json, FLAG_NAMES.JSON);
  appendFlagIfTrue(args, parsed.quiet, FLAG_NAMES.QUIET);
  appendValueIfPresent(args, FLAG_NAMES.BASE_DIR, parsed.base_dir);

  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.STATE_CLEANUP, args);
}

export async function stateDoctorTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];

  appendFlagIfTrue(args, parsed.fix, FLAG_NAMES.FIX);
  appendFlagIfTrue(args, parsed.dry_run, FLAG_NAMES.DRY_RUN);
  appendFlagIfTrue(args, parsed.json, FLAG_NAMES.JSON);
  appendFlagIfTrue(args, parsed.quiet, FLAG_NAMES.QUIET);
  appendValueIfPresent(args, FLAG_NAMES.BASE_DIR, parsed.base_dir);

  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.STATE_DOCTOR, args);
}

export async function backlogPruneTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];

  appendFlagIfTrue(args, parsed.execute, FLAG_NAMES.EXECUTE);
  appendFlagIfTrue(args, parsed.dry_run, FLAG_NAMES.DRY_RUN);
  appendValueIfPresent(
    args,
    FLAG_NAMES.STALE_DAYS_IN_PROGRESS,
    parsed.stale_days_in_progress,
    toIntegerString,
  );
  appendValueIfPresent(args, FLAG_NAMES.STALE_DAYS_READY, parsed.stale_days_ready, toIntegerString);
  appendValueIfPresent(args, FLAG_NAMES.ARCHIVE_DAYS, parsed.archive_days, toIntegerString);

  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.BACKLOG_PRUNE, args);
}

export async function signalCleanupTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];

  appendFlagIfTrue(args, parsed.dry_run, FLAG_NAMES.DRY_RUN);
  appendValueIfPresent(args, FLAG_NAMES.TTL, parsed.ttl);
  appendValueIfPresent(args, FLAG_NAMES.UNREAD_TTL, parsed.unread_ttl);
  appendValueIfPresent(args, FLAG_NAMES.MAX_ENTRIES, parsed.max_entries, toIntegerString);
  appendFlagIfTrue(args, parsed.json, FLAG_NAMES.JSON);
  appendFlagIfTrue(args, parsed.quiet, FLAG_NAMES.QUIET);
  appendValueIfPresent(args, FLAG_NAMES.BASE_DIR, parsed.base_dir);

  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.SIGNAL_CLEANUP, args);
}

export async function lumenflowMetricsTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];

  const subcommand = toStringValue(parsed.subcommand);
  if (subcommand) {
    args.push(subcommand);
  }
  appendValueIfPresent(args, FLAG_NAMES.DAYS, parsed.days, toIntegerString);
  appendValueIfPresent(args, FLAG_NAMES.FORMAT, parsed.format);

  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.LUMENFLOW_METRICS, args);
}

export async function validateTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];

  appendValueIfPresent(args, FLAG_NAMES.ID, parsed.id);
  appendFlagIfTrue(args, parsed.strict, FLAG_NAMES.STRICT);
  appendFlagIfTrue(args, parsed.done_only, FLAG_NAMES.DONE_ONLY);

  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.VALIDATE, args);
}

export async function validateAgentSkillsTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];

  appendValueIfPresent(args, FLAG_NAMES.SKILL, parsed.skill);

  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.VALIDATE_AGENT_SKILLS, args);
}

export async function validateAgentSyncTool(_input: unknown): Promise<ToolOutput> {
  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.VALIDATE_AGENT_SYNC, []);
}

export async function validateBacklogSyncTool(_input: unknown): Promise<ToolOutput> {
  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.VALIDATE_BACKLOG_SYNC, []);
}

export async function validateSkillsSpecTool(_input: unknown): Promise<ToolOutput> {
  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.VALIDATE_SKILLS_SPEC, []);
}

export async function lumenflowValidateTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];

  appendValueIfPresent(args, FLAG_NAMES.ID, parsed.id);
  appendFlagIfTrue(args, parsed.strict, FLAG_NAMES.STRICT);
  appendFlagIfTrue(args, parsed.done_only, FLAG_NAMES.DONE_ONLY);

  return executeRuntimeNativeTool(RUNTIME_NATIVE_TOOLS.LUMENFLOW_VALIDATE, args);
}

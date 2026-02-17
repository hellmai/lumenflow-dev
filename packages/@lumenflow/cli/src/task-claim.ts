#!/usr/bin/env node

import { createWUParser } from '@lumenflow/core/arg-parser';
import { die } from '@lumenflow/core/error-handler';
import {
  type BlockTaskInput,
  type BlockTaskResult,
  type CompleteTaskInput,
  type CompleteTaskResult,
  initializeKernelRuntime,
  type ClaimTaskInput,
  type ClaimTaskResult,
  type CreateTaskResult,
  type TaskInspection,
  type TaskSpec,
  TaskSpecSchema,
  type UnblockTaskInput,
  type UnblockTaskResult,
} from '@lumenflow/kernel';
import { runCLI } from './cli-entry-point.js';

const TASK_CLAIM_COMMAND_NAME = 'task-claim';
const TASK_CLAIM_LOG_PREFIX = '[task:claim]';
const TASK_CLAIM_DESCRIPTION = 'Claim a task directly through KernelRuntime';
const TASK_CLAIM_DEFAULT_WORKSPACE_ROOT = '.';
const TASK_CREATE_COMMAND_NAME = 'task-create';
const TASK_CREATE_LOG_PREFIX = '[task:create]';
const TASK_CREATE_DESCRIPTION = 'Create a task directly through KernelRuntime';
const TASK_CREATE_DEFAULT_WORKSPACE_ROOT = '.';
const TASK_COMPLETE_COMMAND_NAME = 'task-complete';
const TASK_COMPLETE_LOG_PREFIX = '[task:complete]';
const TASK_COMPLETE_DESCRIPTION = 'Complete a task directly through KernelRuntime';
const TASK_COMPLETE_DEFAULT_WORKSPACE_ROOT = '.';
const TASK_BLOCK_COMMAND_NAME = 'task-block';
const TASK_BLOCK_LOG_PREFIX = '[task:block]';
const TASK_BLOCK_DESCRIPTION = 'Block a task directly through KernelRuntime';
const TASK_BLOCK_DEFAULT_WORKSPACE_ROOT = '.';
const TASK_UNBLOCK_COMMAND_NAME = 'task-unblock';
const TASK_UNBLOCK_LOG_PREFIX = '[task:unblock]';
const TASK_UNBLOCK_DESCRIPTION = 'Unblock a task directly through KernelRuntime';
const TASK_UNBLOCK_DEFAULT_WORKSPACE_ROOT = '.';
const TASK_INSPECT_COMMAND_NAME = 'task-inspect';
const TASK_INSPECT_LOG_PREFIX = '[task:inspect]';
const TASK_INSPECT_DESCRIPTION = 'Inspect a task directly through KernelRuntime';
const TASK_INSPECT_DEFAULT_WORKSPACE_ROOT = '.';

const TASK_CLAIM_OPTIONS = {
  taskId: {
    name: 'taskId',
    flags: '--task-id <taskId>',
    description: 'Task ID to claim (e.g., WU-1772)',
  },
  by: {
    name: 'by',
    flags: '--by <identity>',
    description: 'Actor identity for the claim (e.g., tom@hellm.ai)',
  },
  sessionId: {
    name: 'sessionId',
    flags: '--session-id <sessionId>',
    description: 'Session ID for runtime event correlation',
  },
  timestamp: {
    name: 'timestamp',
    flags: '--timestamp <iso8601>',
    description: 'Optional ISO-8601 timestamp override',
  },
  domainData: {
    name: 'domainData',
    flags: '--domain-data <json>',
    description: 'Optional JSON object payload for domain-specific metadata',
  },
  workspaceRoot: {
    name: 'workspaceRoot',
    flags: '--workspace-root <path>',
    description: 'Workspace root path (default: current directory)',
    default: TASK_CLAIM_DEFAULT_WORKSPACE_ROOT,
  },
  json: {
    name: 'json',
    flags: '--json',
    description: 'Output claim result as JSON',
    type: 'boolean' as const,
  },
} as const;

const TASK_CREATE_OPTIONS = {
  taskSpec: {
    name: 'taskSpec',
    flags: '--task-spec <json>',
    description: 'Task spec JSON payload for KernelRuntime.createTask',
  },
  workspaceRoot: {
    name: 'workspaceRoot',
    flags: '--workspace-root <path>',
    description: 'Workspace root path (default: current directory)',
    default: TASK_CREATE_DEFAULT_WORKSPACE_ROOT,
  },
  json: {
    name: 'json',
    flags: '--json',
    description: 'Output create result as JSON',
    type: 'boolean' as const,
  },
} as const;

const TASK_COMPLETE_OPTIONS = {
  complete: {
    name: 'complete',
    flags: '--complete',
    description: 'Run task completion flow',
    type: 'boolean' as const,
  },
  taskId: {
    name: 'taskId',
    flags: '--task-id <taskId>',
    description: 'Task ID to complete (e.g., WU-1786)',
  },
  runId: {
    name: 'runId',
    flags: '--run-id <runId>',
    description: 'Optional run ID override',
  },
  timestamp: {
    name: 'timestamp',
    flags: '--timestamp <iso8601>',
    description: 'Optional ISO-8601 timestamp override',
  },
  evidenceRefs: {
    name: 'evidenceRefs',
    flags: '--evidence-refs <json>',
    description: 'Optional JSON array of receipt/evidence references',
  },
  workspaceRoot: {
    name: 'workspaceRoot',
    flags: '--workspace-root <path>',
    description: 'Workspace root path (default: current directory)',
    default: TASK_COMPLETE_DEFAULT_WORKSPACE_ROOT,
  },
  json: {
    name: 'json',
    flags: '--json',
    description: 'Output complete result as JSON',
    type: 'boolean' as const,
  },
} as const;

const TASK_BLOCK_OPTIONS = {
  block: {
    name: 'block',
    flags: '--block',
    description: 'Run task block flow',
    type: 'boolean' as const,
  },
  taskId: {
    name: 'taskId',
    flags: '--task-id <taskId>',
    description: 'Task ID to block (e.g., WU-1787)',
  },
  reason: {
    name: 'reason',
    flags: '--reason <reason>',
    description: 'Reason for blocking the task',
  },
  timestamp: {
    name: 'timestamp',
    flags: '--timestamp <iso8601>',
    description: 'Optional ISO-8601 timestamp override',
  },
  workspaceRoot: {
    name: 'workspaceRoot',
    flags: '--workspace-root <path>',
    description: 'Workspace root path (default: current directory)',
    default: TASK_BLOCK_DEFAULT_WORKSPACE_ROOT,
  },
  json: {
    name: 'json',
    flags: '--json',
    description: 'Output block result as JSON',
    type: 'boolean' as const,
  },
} as const;

const TASK_UNBLOCK_OPTIONS = {
  unblock: {
    name: 'unblock',
    flags: '--unblock',
    description: 'Run task unblock flow',
    type: 'boolean' as const,
  },
  taskId: {
    name: 'taskId',
    flags: '--task-id <taskId>',
    description: 'Task ID to unblock (e.g., WU-1787)',
  },
  timestamp: {
    name: 'timestamp',
    flags: '--timestamp <iso8601>',
    description: 'Optional ISO-8601 timestamp override',
  },
  workspaceRoot: {
    name: 'workspaceRoot',
    flags: '--workspace-root <path>',
    description: 'Workspace root path (default: current directory)',
    default: TASK_UNBLOCK_DEFAULT_WORKSPACE_ROOT,
  },
  json: {
    name: 'json',
    flags: '--json',
    description: 'Output unblock result as JSON',
    type: 'boolean' as const,
  },
} as const;

const TASK_INSPECT_OPTIONS = {
  inspect: {
    name: 'inspect',
    flags: '--inspect',
    description: 'Run task inspect flow',
    type: 'boolean' as const,
  },
  taskId: {
    name: 'taskId',
    flags: '--task-id <taskId>',
    description: 'Task ID to inspect (e.g., WU-1788)',
  },
  workspaceRoot: {
    name: 'workspaceRoot',
    flags: '--workspace-root <path>',
    description: 'Workspace root path (default: current directory)',
    default: TASK_INSPECT_DEFAULT_WORKSPACE_ROOT,
  },
  json: {
    name: 'json',
    flags: '--json',
    description: 'Output inspect result as JSON',
    type: 'boolean' as const,
  },
} as const;

export interface TaskClaimCliArgs {
  input: ClaimTaskInput;
  workspaceRoot: string;
  json: boolean;
}

export interface TaskCreateCliArgs {
  input: TaskSpec;
  workspaceRoot: string;
  json: boolean;
}

export interface TaskCompleteCliArgs {
  input: CompleteTaskInput;
  workspaceRoot: string;
  json: boolean;
}

export interface TaskBlockCliArgs {
  input: BlockTaskInput;
  workspaceRoot: string;
  json: boolean;
}

export interface TaskUnblockCliArgs {
  input: UnblockTaskInput;
  workspaceRoot: string;
  json: boolean;
}

export interface TaskInspectCliArgs {
  taskId: string;
  workspaceRoot: string;
  json: boolean;
}

export function parseTaskClaimDomainData(raw?: string): Record<string, unknown> | undefined {
  if (!raw) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    die(`${TASK_CLAIM_LOG_PREFIX} --domain-data must be valid JSON`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    die(`${TASK_CLAIM_LOG_PREFIX} --domain-data must be a JSON object`);
  }

  return parsed as Record<string, unknown>;
}

export function parseTaskCreateSpec(raw?: string): TaskSpec {
  if (!raw) {
    die(`${TASK_CREATE_LOG_PREFIX} --task-spec is required`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    die(`${TASK_CREATE_LOG_PREFIX} --task-spec must be valid JSON`);
  }

  const validated = TaskSpecSchema.safeParse(parsed);
  if (!validated.success) {
    die(`${TASK_CREATE_LOG_PREFIX} --task-spec is invalid: ${validated.error.message}`);
  }

  return validated.data;
}

export function parseTaskBlockReason(raw?: string): string {
  const reason = raw?.trim() ?? '';
  if (reason.length === 0) {
    die(`${TASK_BLOCK_LOG_PREFIX} --reason is required`);
  }
  return reason;
}

export function parseTaskCompleteEvidenceRefs(raw?: string): string[] | undefined {
  if (!raw) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    die(`${TASK_COMPLETE_LOG_PREFIX} --evidence-refs must be valid JSON`);
  }

  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    die(`${TASK_COMPLETE_LOG_PREFIX} --evidence-refs must be a JSON array of strings`);
  }

  return parsed;
}

export function parseTaskClaimArgs(): TaskClaimCliArgs {
  const options = Object.values(TASK_CLAIM_OPTIONS);
  const parsed = createWUParser({
    name: TASK_CLAIM_COMMAND_NAME,
    description: TASK_CLAIM_DESCRIPTION,
    options,
    required: ['taskId', 'by', 'sessionId'],
  });

  return {
    input: {
      task_id: parsed.taskId as string,
      by: parsed.by as string,
      session_id: parsed.sessionId as string,
      timestamp: parsed.timestamp as string | undefined,
      domain_data: parseTaskClaimDomainData(parsed.domainData as string | undefined),
    },
    workspaceRoot: (parsed.workspaceRoot as string | undefined) || process.cwd(),
    json: parsed.json ?? false,
  };
}

export function parseTaskCreateArgs(): TaskCreateCliArgs {
  const options = Object.values(TASK_CREATE_OPTIONS);
  const parsed = createWUParser({
    name: TASK_CREATE_COMMAND_NAME,
    description: TASK_CREATE_DESCRIPTION,
    options,
    required: ['taskSpec'],
  });

  return {
    input: parseTaskCreateSpec(parsed.taskSpec as string | undefined),
    workspaceRoot: (parsed.workspaceRoot as string | undefined) || process.cwd(),
    json: parsed.json ?? false,
  };
}

export function parseTaskCompleteArgs(): TaskCompleteCliArgs {
  const options = Object.values(TASK_COMPLETE_OPTIONS);
  const parsed = createWUParser({
    name: TASK_COMPLETE_COMMAND_NAME,
    description: TASK_COMPLETE_DESCRIPTION,
    options,
    required: ['taskId'],
  });

  return {
    input: {
      task_id: parsed.taskId as string,
      run_id: parsed.runId as string | undefined,
      timestamp: parsed.timestamp as string | undefined,
      evidence_refs: parseTaskCompleteEvidenceRefs(parsed.evidenceRefs as string | undefined),
    },
    workspaceRoot: (parsed.workspaceRoot as string | undefined) || process.cwd(),
    json: parsed.json ?? false,
  };
}

export function parseTaskBlockArgs(): TaskBlockCliArgs {
  const options = Object.values(TASK_BLOCK_OPTIONS);
  const parsed = createWUParser({
    name: TASK_BLOCK_COMMAND_NAME,
    description: TASK_BLOCK_DESCRIPTION,
    options,
    required: ['taskId', 'reason'],
  });

  return {
    input: {
      task_id: parsed.taskId as string,
      reason: parseTaskBlockReason(parsed.reason as string | undefined),
      timestamp: parsed.timestamp as string | undefined,
    },
    workspaceRoot: (parsed.workspaceRoot as string | undefined) || process.cwd(),
    json: parsed.json ?? false,
  };
}

export function parseTaskUnblockArgs(): TaskUnblockCliArgs {
  const options = Object.values(TASK_UNBLOCK_OPTIONS);
  const parsed = createWUParser({
    name: TASK_UNBLOCK_COMMAND_NAME,
    description: TASK_UNBLOCK_DESCRIPTION,
    options,
    required: ['taskId'],
  });

  return {
    input: {
      task_id: parsed.taskId as string,
      timestamp: parsed.timestamp as string | undefined,
    },
    workspaceRoot: (parsed.workspaceRoot as string | undefined) || process.cwd(),
    json: parsed.json ?? false,
  };
}

export function parseTaskInspectArgs(): TaskInspectCliArgs {
  const options = Object.values(TASK_INSPECT_OPTIONS);
  const parsed = createWUParser({
    name: TASK_INSPECT_COMMAND_NAME,
    description: TASK_INSPECT_DESCRIPTION,
    options,
    required: ['taskId'],
  });

  return {
    taskId: parsed.taskId as string,
    workspaceRoot: (parsed.workspaceRoot as string | undefined) || process.cwd(),
    json: parsed.json ?? false,
  };
}

export async function runTaskClaim(args: TaskClaimCliArgs): Promise<ClaimTaskResult> {
  const runtime = await initializeKernelRuntime({ workspaceRoot: args.workspaceRoot });
  return runtime.claimTask(args.input);
}

export async function runTaskCreate(args: TaskCreateCliArgs): Promise<CreateTaskResult> {
  const runtime = await initializeKernelRuntime({ workspaceRoot: args.workspaceRoot });
  return runtime.createTask(args.input);
}

export async function runTaskComplete(args: TaskCompleteCliArgs): Promise<CompleteTaskResult> {
  const runtime = await initializeKernelRuntime({ workspaceRoot: args.workspaceRoot });
  return runtime.completeTask(args.input);
}

export async function runTaskBlock(args: TaskBlockCliArgs): Promise<BlockTaskResult> {
  const runtime = await initializeKernelRuntime({ workspaceRoot: args.workspaceRoot });
  return runtime.blockTask(args.input);
}

export async function runTaskUnblock(args: TaskUnblockCliArgs): Promise<UnblockTaskResult> {
  const runtime = await initializeKernelRuntime({ workspaceRoot: args.workspaceRoot });
  return runtime.unblockTask(args.input);
}

export async function runTaskInspect(args: TaskInspectCliArgs): Promise<TaskInspection> {
  const runtime = await initializeKernelRuntime({ workspaceRoot: args.workspaceRoot });
  return runtime.inspectTask(args.taskId);
}

function formatTaskClaimSummary(result: ClaimTaskResult): string {
  const eventKinds = result.events.map((event) => event.kind).join(', ');
  return [
    `${TASK_CLAIM_LOG_PREFIX} Claimed task ${result.task_id}`,
    `${TASK_CLAIM_LOG_PREFIX} Run ID: ${result.run.run_id}`,
    `${TASK_CLAIM_LOG_PREFIX} Events: ${eventKinds}`,
  ].join('\n');
}

function formatTaskCreateSummary(result: CreateTaskResult): string {
  return [
    `${TASK_CREATE_LOG_PREFIX} Created task ${result.task.id}`,
    `${TASK_CREATE_LOG_PREFIX} Task spec: ${result.task_spec_path}`,
    `${TASK_CREATE_LOG_PREFIX} Event: ${result.event.kind}`,
  ].join('\n');
}

function formatTaskCompleteSummary(result: CompleteTaskResult): string {
  const eventKinds = result.events.map((event) => event.kind).join(', ');
  return [
    `${TASK_COMPLETE_LOG_PREFIX} Completed task ${result.task_id}`,
    `${TASK_COMPLETE_LOG_PREFIX} Run ID: ${result.run_id}`,
    `${TASK_COMPLETE_LOG_PREFIX} Events: ${eventKinds}`,
  ].join('\n');
}

function formatTaskBlockSummary(result: BlockTaskResult): string {
  return [
    `${TASK_BLOCK_LOG_PREFIX} Blocked task ${result.task_id}`,
    `${TASK_BLOCK_LOG_PREFIX} Event: ${result.event.kind}`,
    `${TASK_BLOCK_LOG_PREFIX} Reason: ${result.event.reason}`,
  ].join('\n');
}

function formatTaskUnblockSummary(result: UnblockTaskResult): string {
  return [
    `${TASK_UNBLOCK_LOG_PREFIX} Unblocked task ${result.task_id}`,
    `${TASK_UNBLOCK_LOG_PREFIX} Event: ${result.event.kind}`,
  ].join('\n');
}

function formatTaskInspectSummary(result: TaskInspection): string {
  return [
    `${TASK_INSPECT_LOG_PREFIX} Inspected task ${result.task_id}`,
    `${TASK_INSPECT_LOG_PREFIX} State: ${result.state.status}`,
    `${TASK_INSPECT_LOG_PREFIX} Runs: ${result.run_history.length}`,
    `${TASK_INSPECT_LOG_PREFIX} Events: ${result.events.length}`,
  ].join('\n');
}

export async function main(): Promise<void> {
  if (process.argv.includes('--task-spec')) {
    const args = parseTaskCreateArgs();
    const result = await runTaskCreate(args);

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(formatTaskCreateSummary(result));
    return;
  }

  if (process.argv.includes('--complete')) {
    const args = parseTaskCompleteArgs();
    const result = await runTaskComplete(args);

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(formatTaskCompleteSummary(result));
    return;
  }

  if (process.argv.includes('--block')) {
    const args = parseTaskBlockArgs();
    const result = await runTaskBlock(args);

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(formatTaskBlockSummary(result));
    return;
  }

  if (process.argv.includes('--unblock')) {
    const args = parseTaskUnblockArgs();
    const result = await runTaskUnblock(args);

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(formatTaskUnblockSummary(result));
    return;
  }

  if (process.argv.includes('--inspect')) {
    const args = parseTaskInspectArgs();
    const result = await runTaskInspect(args);

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(formatTaskInspectSummary(result));
    return;
  }

  const args = parseTaskClaimArgs();
  const result = await runTaskClaim(args);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(formatTaskClaimSummary(result));
}

if (import.meta.main) {
  void runCLI(main);
}

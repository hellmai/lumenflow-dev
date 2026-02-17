#!/usr/bin/env node

import { createWUParser } from '@lumenflow/core/arg-parser';
import { die } from '@lumenflow/core/error-handler';
import {
  initializeKernelRuntime,
  type ClaimTaskInput,
  type ClaimTaskResult,
  type CreateTaskResult,
  type TaskSpec,
  TaskSpecSchema,
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

export async function runTaskClaim(args: TaskClaimCliArgs): Promise<ClaimTaskResult> {
  const runtime = await initializeKernelRuntime({ workspaceRoot: args.workspaceRoot });
  return runtime.claimTask(args.input);
}

export async function runTaskCreate(args: TaskCreateCliArgs): Promise<CreateTaskResult> {
  const runtime = await initializeKernelRuntime({ workspaceRoot: args.workspaceRoot });
  return runtime.createTask(args.input);
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

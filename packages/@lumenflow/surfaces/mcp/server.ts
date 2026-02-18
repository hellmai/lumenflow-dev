// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import {
  ExecutionContextSchema,
  TaskSpecSchema,
  toMcpJsonSchema,
  type ClaimTaskInput,
  type CompleteTaskInput,
  type ExecutionContext,
  type KernelRuntime,
  type TaskInspection,
  type TaskSpec,
} from '@lumenflow/kernel';

export interface McpInvocation {
  name: string;
  arguments?: unknown;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface McpServer {
  listTools(): McpToolDefinition[];
  handleInvocation(invocation: McpInvocation, context?: ExecutionContext): Promise<unknown>;
}

const CLAIM_TASK_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    task_id: { type: 'string' },
    by: { type: 'string' },
    session_id: { type: 'string' },
    timestamp: { type: 'string' },
    domain_data: { type: 'object' },
  },
  required: ['task_id', 'by', 'session_id'],
};

const COMPLETE_TASK_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    task_id: { type: 'string' },
    run_id: { type: 'string' },
    timestamp: { type: 'string' },
    evidence_refs: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['task_id'],
};

function requireObject(args: unknown, message: string): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error(message);
  }
  return args as Record<string, unknown>;
}

function parseRequiredString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(message);
  }
  return value;
}

function parseOptionalString(value: unknown, message: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(message);
  }
  return value;
}

function parseOptionalDomainData(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('task:claim requires domain_data to be an object when provided.');
  }
  return value as Record<string, unknown>;
}

function parseOptionalEvidenceRefs(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    throw new Error('task:complete requires evidence_refs to be an array of non-empty strings.');
  }
  return value;
}

function parseTaskId(args: unknown): string {
  if (typeof args === 'string' && args.trim().length > 0) {
    return args;
  }
  if (!args || typeof args !== 'object') {
    throw new Error('task:inspect expects task_id input.');
  }
  const taskId = (args as { task_id?: unknown }).task_id;
  if (typeof taskId !== 'string' || taskId.trim().length === 0) {
    throw new Error('task:inspect expects task_id input.');
  }
  return taskId;
}

function parseTaskSpec(args: unknown): TaskSpec {
  return TaskSpecSchema.parse(args);
}

function parseClaimTaskInput(args: unknown): ClaimTaskInput {
  const input = requireObject(args, 'task:claim expects object input.');
  return {
    task_id: parseRequiredString(input.task_id, 'task:claim requires task_id.'),
    by: parseRequiredString(input.by, 'task:claim requires by.'),
    session_id: parseRequiredString(input.session_id, 'task:claim requires session_id.'),
    timestamp: parseOptionalString(
      input.timestamp,
      'task:claim requires timestamp to be a string when provided.',
    ),
    domain_data: parseOptionalDomainData(input.domain_data),
  };
}

function parseCompleteTaskInput(args: unknown): CompleteTaskInput {
  const input = requireObject(args, 'task:complete expects object input.');
  return {
    task_id: parseRequiredString(input.task_id, 'task:complete requires task_id.'),
    run_id: parseOptionalString(
      input.run_id,
      'task:complete requires run_id to be a string when provided.',
    ),
    timestamp: parseOptionalString(
      input.timestamp,
      'task:complete requires timestamp to be a string when provided.',
    ),
    evidence_refs: parseOptionalEvidenceRefs(input.evidence_refs),
  };
}

function useCaseToolDefinitions(): McpToolDefinition[] {
  return [
    {
      name: 'task:create',
      description: 'Create a task using KernelRuntime.createTask.',
      input_schema: toMcpJsonSchema(TaskSpecSchema),
    },
    {
      name: 'task:claim',
      description: 'Claim a task using KernelRuntime.claimTask.',
      input_schema: CLAIM_TASK_INPUT_SCHEMA,
    },
    {
      name: 'task:complete',
      description: 'Complete a task using KernelRuntime.completeTask.',
      input_schema: COMPLETE_TASK_INPUT_SCHEMA,
    },
    {
      name: 'task:inspect',
      description: 'Inspect a task using KernelRuntime.inspectTask.',
      input_schema: toMcpJsonSchema(TaskSpecSchema.pick({ id: true })),
    },
  ];
}

export function createMcpServer(runtime: KernelRuntime): McpServer {
  return {
    listTools(): McpToolDefinition[] {
      return useCaseToolDefinitions();
    },

    async handleInvocation(
      invocation: McpInvocation,
      context?: ExecutionContext,
    ): Promise<unknown> {
      if (invocation.name === 'task:create') {
        return runtime.createTask(parseTaskSpec(invocation.arguments));
      }
      if (invocation.name === 'task:claim') {
        return runtime.claimTask(parseClaimTaskInput(invocation.arguments));
      }
      if (invocation.name === 'task:complete') {
        return runtime.completeTask(parseCompleteTaskInput(invocation.arguments));
      }
      if (invocation.name === 'task:inspect' || invocation.name === 'task:status') {
        return runtime.inspectTask(parseTaskId(invocation.arguments));
      }

      if (!context) {
        throw new Error(`Tool invocation for ${invocation.name} requires execution context.`);
      }

      const validatedContext = ExecutionContextSchema.parse(context);
      return runtime.executeTool(invocation.name, invocation.arguments, validatedContext);
    },
  };
}

export function asTaskInspection(result: unknown): TaskInspection {
  return result as TaskInspection;
}

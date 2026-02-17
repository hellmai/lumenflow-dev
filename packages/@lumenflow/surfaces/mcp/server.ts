import {
  ExecutionContextSchema,
  TaskSpecSchema,
  toMcpJsonSchema,
  type ExecutionContext,
  type TaskSpec,
} from '../../kernel/src/kernel.schemas.js';
import type {
  ClaimTaskInput,
  CompleteTaskInput,
  KernelRuntime,
  TaskInspection,
} from '../../kernel/src/runtime/index.js';

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
  if (!args || typeof args !== 'object') {
    throw new Error('task:claim expects object input.');
  }

  const task_id = (args as { task_id?: unknown }).task_id;
  const by = (args as { by?: unknown }).by;
  const session_id = (args as { session_id?: unknown }).session_id;

  if (typeof task_id !== 'string' || task_id.trim().length === 0) {
    throw new Error('task:claim requires task_id.');
  }
  if (typeof by !== 'string' || by.trim().length === 0) {
    throw new Error('task:claim requires by.');
  }
  if (typeof session_id !== 'string' || session_id.trim().length === 0) {
    throw new Error('task:claim requires session_id.');
  }

  const domain_data =
    'domain_data' in (args as Record<string, unknown>)
      ? (args as { domain_data?: Record<string, unknown> }).domain_data
      : undefined;

  return {
    task_id,
    by,
    session_id,
    domain_data,
  };
}

function parseCompleteTaskInput(args: unknown): CompleteTaskInput {
  if (!args || typeof args !== 'object') {
    throw new Error('task:complete expects object input.');
  }

  const task_id = (args as { task_id?: unknown }).task_id;
  if (typeof task_id !== 'string' || task_id.trim().length === 0) {
    throw new Error('task:complete requires task_id.');
  }

  const run_id =
    typeof (args as { run_id?: unknown }).run_id === 'string'
      ? (args as { run_id: string }).run_id
      : undefined;
  const evidence_refs = Array.isArray((args as { evidence_refs?: unknown }).evidence_refs)
    ? ((args as { evidence_refs: unknown[] }).evidence_refs.filter(
        (item) => typeof item === 'string',
      ) as string[])
    : undefined;

  return {
    task_id,
    run_id,
    evidence_refs,
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
      input_schema: toMcpJsonSchema(TaskSpecSchema.pick({ id: true })),
    },
    {
      name: 'task:complete',
      description: 'Complete a task using KernelRuntime.completeTask.',
      input_schema: toMcpJsonSchema(TaskSpecSchema.pick({ id: true })),
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

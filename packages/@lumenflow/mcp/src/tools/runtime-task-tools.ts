import path from 'node:path';
import { initializeKernelRuntime, TaskSpecSchema } from '@lumenflow/kernel';
import { z } from 'zod';
import { error, success, ErrorCodes, type ToolDefinition } from '../tools-shared.js';
import { RuntimeTaskToolDescriptions, RuntimeTaskToolNames } from './runtime-task-constants.js';

const taskClaimInputSchema = z.object({
  task_id: z.string().min(1),
  by: z.string().min(1),
  session_id: z.string().min(1),
  timestamp: z.string().optional(),
  domain_data: z.record(z.string(), z.unknown()).optional(),
});

const taskCreateInputSchema = TaskSpecSchema;
const taskCompleteInputSchema = z.object({
  task_id: z.string().min(1),
  run_id: z.string().min(1).optional(),
  timestamp: z.string().optional(),
  evidence_refs: z.array(z.string().min(1)).optional(),
});
const taskBlockInputSchema = z.object({
  task_id: z.string().min(1),
  reason: z.string().min(1),
  timestamp: z.string().optional(),
});
const taskUnblockInputSchema = z.object({
  task_id: z.string().min(1),
  timestamp: z.string().optional(),
});

type RuntimeInstance = Awaited<ReturnType<typeof initializeKernelRuntime>>;

const runtimeCacheByRoot = new Map<string, Promise<RuntimeInstance>>();

export function resetRuntimeTaskToolCache(): void {
  runtimeCacheByRoot.clear();
}

async function getRuntimeForWorkspace(workspaceRoot: string): Promise<RuntimeInstance> {
  const normalizedRoot = path.resolve(workspaceRoot);
  const cached = runtimeCacheByRoot.get(normalizedRoot);
  if (cached) {
    return cached;
  }

  const runtimePromise = initializeKernelRuntime({ workspaceRoot: normalizedRoot });
  runtimeCacheByRoot.set(normalizedRoot, runtimePromise);

  try {
    return await runtimePromise;
  } catch (cause) {
    runtimeCacheByRoot.delete(normalizedRoot);
    throw cause;
  }
}

export const taskClaimTool: ToolDefinition = {
  name: RuntimeTaskToolNames.TASK_CLAIM,
  description: RuntimeTaskToolDescriptions.TASK_CLAIM,
  inputSchema: taskClaimInputSchema,

  async execute(input, options) {
    const parsedInput = taskClaimInputSchema.safeParse(input);
    if (!parsedInput.success) {
      return error(parsedInput.error.message, ErrorCodes.TASK_CLAIM_ERROR);
    }

    const workspaceRoot = options?.projectRoot || process.cwd();

    try {
      const runtime = await getRuntimeForWorkspace(workspaceRoot);
      const claimResult = await runtime.claimTask(parsedInput.data);
      return success(claimResult);
    } catch (cause) {
      return error((cause as Error).message, ErrorCodes.TASK_CLAIM_ERROR);
    }
  },
};

export const taskCreateTool: ToolDefinition = {
  name: RuntimeTaskToolNames.TASK_CREATE,
  description: RuntimeTaskToolDescriptions.TASK_CREATE,
  inputSchema: taskCreateInputSchema,

  async execute(input, options) {
    const parsedInput = taskCreateInputSchema.safeParse(input);
    if (!parsedInput.success) {
      return error(parsedInput.error.message, ErrorCodes.TASK_CREATE_ERROR);
    }

    const workspaceRoot = options?.projectRoot || process.cwd();

    try {
      const runtime = await getRuntimeForWorkspace(workspaceRoot);
      const createResult = await runtime.createTask(parsedInput.data);
      return success(createResult);
    } catch (cause) {
      return error((cause as Error).message, ErrorCodes.TASK_CREATE_ERROR);
    }
  },
};

export const taskCompleteTool: ToolDefinition = {
  name: RuntimeTaskToolNames.TASK_COMPLETE,
  description: RuntimeTaskToolDescriptions.TASK_COMPLETE,
  inputSchema: taskCompleteInputSchema,

  async execute(input, options) {
    const parsedInput = taskCompleteInputSchema.safeParse(input);
    if (!parsedInput.success) {
      return error(parsedInput.error.message, ErrorCodes.TASK_COMPLETE_ERROR);
    }

    const workspaceRoot = options?.projectRoot || process.cwd();

    try {
      const runtime = await getRuntimeForWorkspace(workspaceRoot);
      const completeResult = await runtime.completeTask(parsedInput.data);
      return success(completeResult);
    } catch (cause) {
      return error((cause as Error).message, ErrorCodes.TASK_COMPLETE_ERROR);
    }
  },
};

export const taskBlockTool: ToolDefinition = {
  name: RuntimeTaskToolNames.TASK_BLOCK,
  description: RuntimeTaskToolDescriptions.TASK_BLOCK,
  inputSchema: taskBlockInputSchema,

  async execute(input, options) {
    const parsedInput = taskBlockInputSchema.safeParse(input);
    if (!parsedInput.success) {
      return error(parsedInput.error.message, ErrorCodes.TASK_BLOCK_ERROR);
    }

    const workspaceRoot = options?.projectRoot || process.cwd();

    try {
      const runtime = await getRuntimeForWorkspace(workspaceRoot);
      const blockResult = await runtime.blockTask(parsedInput.data);
      return success(blockResult);
    } catch (cause) {
      return error((cause as Error).message, ErrorCodes.TASK_BLOCK_ERROR);
    }
  },
};

export const taskUnblockTool: ToolDefinition = {
  name: RuntimeTaskToolNames.TASK_UNBLOCK,
  description: RuntimeTaskToolDescriptions.TASK_UNBLOCK,
  inputSchema: taskUnblockInputSchema,

  async execute(input, options) {
    const parsedInput = taskUnblockInputSchema.safeParse(input);
    if (!parsedInput.success) {
      return error(parsedInput.error.message, ErrorCodes.TASK_UNBLOCK_ERROR);
    }

    const workspaceRoot = options?.projectRoot || process.cwd();

    try {
      const runtime = await getRuntimeForWorkspace(workspaceRoot);
      const unblockResult = await runtime.unblockTask(parsedInput.data);
      return success(unblockResult);
    } catch (cause) {
      return error((cause as Error).message, ErrorCodes.TASK_UNBLOCK_ERROR);
    }
  },
};

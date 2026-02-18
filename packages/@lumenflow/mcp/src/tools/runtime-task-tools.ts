import { ExecutionContextSchema, TaskSpecSchema } from '@lumenflow/kernel';
import { z } from 'zod';
import { error, success, ErrorCodes, type ToolDefinition } from '../tools-shared.js';
import {
  getRuntimeForWorkspace,
  resetMcpRuntimeCache,
  type RuntimeInstance,
} from '../runtime-cache.js';
import { packToolCapabilityResolver } from '../runtime-tool-resolver.js';
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
const taskInspectInputSchema = z.object({
  task_id: z.string().min(1),
});
const toolExecuteInputSchema = z.object({
  tool_name: z.string().min(1),
  tool_input: z.unknown().optional(),
  context: ExecutionContextSchema,
});

export function resetRuntimeTaskToolCache(): void {
  resetMcpRuntimeCache();
}

function resolveWorkspaceRoot(options?: { projectRoot?: string }): string {
  return options?.projectRoot ?? process.cwd();
}

interface RuntimeToolFactoryConfig<TSchema extends z.ZodType> {
  name: string;
  description: string;
  inputSchema: TSchema;
  errorCode: string;
  executeWithRuntime: (runtime: RuntimeInstance, parsedInput: z.infer<TSchema>) => Promise<unknown>;
}

function createRuntimeTool<TSchema extends z.ZodType>(
  config: RuntimeToolFactoryConfig<TSchema>,
): ToolDefinition {
  return {
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
    async execute(input, options) {
      const parsedInput = config.inputSchema.safeParse(input);
      if (!parsedInput.success) {
        return error(parsedInput.error.message, config.errorCode);
      }

      try {
        const runtime = await getRuntimeForWorkspace(
          resolveWorkspaceRoot(options),
          packToolCapabilityResolver,
        );
        const result = await config.executeWithRuntime(runtime, parsedInput.data);
        return success(result);
      } catch (cause) {
        return error((cause as Error).message, config.errorCode);
      }
    },
  };
}

export const taskClaimTool = createRuntimeTool({
  name: RuntimeTaskToolNames.TASK_CLAIM,
  description: RuntimeTaskToolDescriptions.TASK_CLAIM,
  inputSchema: taskClaimInputSchema,
  errorCode: ErrorCodes.TASK_CLAIM_ERROR,
  executeWithRuntime: (runtime, parsedInput) => runtime.claimTask(parsedInput),
});

export const taskCreateTool = createRuntimeTool({
  name: RuntimeTaskToolNames.TASK_CREATE,
  description: RuntimeTaskToolDescriptions.TASK_CREATE,
  inputSchema: taskCreateInputSchema,
  errorCode: ErrorCodes.TASK_CREATE_ERROR,
  executeWithRuntime: (runtime, parsedInput) => runtime.createTask(parsedInput),
});

export const taskCompleteTool = createRuntimeTool({
  name: RuntimeTaskToolNames.TASK_COMPLETE,
  description: RuntimeTaskToolDescriptions.TASK_COMPLETE,
  inputSchema: taskCompleteInputSchema,
  errorCode: ErrorCodes.TASK_COMPLETE_ERROR,
  executeWithRuntime: (runtime, parsedInput) => runtime.completeTask(parsedInput),
});

export const taskBlockTool = createRuntimeTool({
  name: RuntimeTaskToolNames.TASK_BLOCK,
  description: RuntimeTaskToolDescriptions.TASK_BLOCK,
  inputSchema: taskBlockInputSchema,
  errorCode: ErrorCodes.TASK_BLOCK_ERROR,
  executeWithRuntime: (runtime, parsedInput) => runtime.blockTask(parsedInput),
});

export const taskUnblockTool = createRuntimeTool({
  name: RuntimeTaskToolNames.TASK_UNBLOCK,
  description: RuntimeTaskToolDescriptions.TASK_UNBLOCK,
  inputSchema: taskUnblockInputSchema,
  errorCode: ErrorCodes.TASK_UNBLOCK_ERROR,
  executeWithRuntime: (runtime, parsedInput) => runtime.unblockTask(parsedInput),
});

export const taskInspectTool = createRuntimeTool({
  name: RuntimeTaskToolNames.TASK_INSPECT,
  description: RuntimeTaskToolDescriptions.TASK_INSPECT,
  inputSchema: taskInspectInputSchema,
  errorCode: ErrorCodes.TASK_INSPECT_ERROR,
  executeWithRuntime: (runtime, parsedInput) => runtime.inspectTask(parsedInput.task_id),
});

export const taskToolExecuteTool = createRuntimeTool({
  name: RuntimeTaskToolNames.TOOL_EXECUTE,
  description: RuntimeTaskToolDescriptions.TOOL_EXECUTE,
  inputSchema: toolExecuteInputSchema,
  errorCode: ErrorCodes.TOOL_EXECUTE_ERROR,
  executeWithRuntime: (runtime, parsedInput) =>
    runtime.executeTool(parsedInput.tool_name, parsedInput.tool_input ?? {}, parsedInput.context),
});

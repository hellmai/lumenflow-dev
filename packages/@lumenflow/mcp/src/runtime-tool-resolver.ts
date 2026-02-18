import {
  TOOL_HANDLER_KINDS,
  defaultRuntimeToolCapabilityResolver,
  type InProcessToolFn,
  type RuntimeToolCapabilityResolver,
} from '@lumenflow/kernel';
import { z } from 'zod';

const DEFAULT_IN_PROCESS_INPUT_SCHEMA = z.record(z.string(), z.unknown());
const DEFAULT_IN_PROCESS_OUTPUT_SCHEMA = z.record(z.string(), z.unknown());
const RUNTIME_TOOL_NOT_MIGRATED_CODE = 'RUNTIME_TOOL_NOT_MIGRATED';
const RUNTIME_TOOL_NOT_MIGRATED_MESSAGE =
  'Tool is registered for runtime migration but in-process implementation has not landed yet.';

interface RegisteredInProcessToolHandler {
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema?: z.ZodTypeAny;
  fn: InProcessToolFn;
}

const registeredInProcessToolHandlers = new Map<string, RegisteredInProcessToolHandler>([
  [
    'wu:status',
    {
      description: 'In-process runtime placeholder for wu:status',
      inputSchema: DEFAULT_IN_PROCESS_INPUT_SCHEMA,
      outputSchema: DEFAULT_IN_PROCESS_OUTPUT_SCHEMA,
      fn: async () => ({
        success: false,
        error: {
          code: RUNTIME_TOOL_NOT_MIGRATED_CODE,
          message: RUNTIME_TOOL_NOT_MIGRATED_MESSAGE,
        },
      }),
    },
  ],
]);

export function isInProcessPackToolRegistered(toolName: string): boolean {
  return registeredInProcessToolHandlers.has(toolName);
}

export const packToolCapabilityResolver: RuntimeToolCapabilityResolver = async (input) => {
  const registeredHandler = registeredInProcessToolHandlers.get(input.tool.name);
  if (!registeredHandler) {
    return defaultRuntimeToolCapabilityResolver(input);
  }

  return {
    name: input.tool.name,
    domain: input.loadedPack.manifest.id,
    version: input.loadedPack.manifest.version,
    input_schema: registeredHandler.inputSchema,
    output_schema: registeredHandler.outputSchema,
    permission: input.tool.permission,
    required_scopes: input.tool.required_scopes,
    handler: {
      kind: TOOL_HANDLER_KINDS.IN_PROCESS,
      fn: registeredHandler.fn,
    },
    description: registeredHandler.description,
    pack: input.loadedPack.pin.id,
  };
};

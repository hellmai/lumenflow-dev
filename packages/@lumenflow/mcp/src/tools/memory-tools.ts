/**
 * @file memory-tools.ts
 * @description Memory tool implementations
 *
 * WU-1642: Extracted from tools.ts during domain decomposition.
 * WU-1424: Memory tools
 * WU-1456: Memory commands use shared schemas where available
 * WU-1811: Migrated memory tools from CLI shell-out to executeViaPack runtime path
 */

import { z } from 'zod';
import {
  memInitSchema,
  memStartSchema,
  memReadySchema,
  memCheckpointSchema,
  memCleanupSchema,
  memContextSchema,
  memCreateSchema,
  memDeleteSchema,
  memExportSchema,
  memInboxSchema,
  memSignalSchema,
  memSummarizeSchema,
  memTriageSchema,
} from '@lumenflow/core';
import {
  type ToolDefinition,
  ErrorCodes,
  ErrorMessages,
  CliArgs,
  SharedErrorMessages,
  success,
  error,
  executeViaPack,
} from '../tools-shared.js';
import { CliCommands, MetadataKeys } from '../mcp-constants.js';

/**
 * Error codes for memory tools
 */
const MemoryErrorCodes = {
  MEM_INIT_ERROR: 'MEM_INIT_ERROR',
  MEM_START_ERROR: 'MEM_START_ERROR',
  MEM_READY_ERROR: 'MEM_READY_ERROR',
  MEM_CHECKPOINT_ERROR: 'MEM_CHECKPOINT_ERROR',
  MEM_CLEANUP_ERROR: 'MEM_CLEANUP_ERROR',
  MEM_CONTEXT_ERROR: 'MEM_CONTEXT_ERROR',
  MEM_CREATE_ERROR: 'MEM_CREATE_ERROR',
  MEM_DELETE_ERROR: 'MEM_DELETE_ERROR',
  MEM_EXPORT_ERROR: 'MEM_EXPORT_ERROR',
  MEM_INBOX_ERROR: 'MEM_INBOX_ERROR',
  MEM_SIGNAL_ERROR: 'MEM_SIGNAL_ERROR',
  MEM_SUMMARIZE_ERROR: 'MEM_SUMMARIZE_ERROR',
  MEM_TRIAGE_ERROR: 'MEM_TRIAGE_ERROR',
  MEM_RECOVER_ERROR: 'MEM_RECOVER_ERROR',
} as const;

/**
 * Error messages for memory tools (uses shared messages to avoid duplication)
 */
const MemoryErrorMessages = {
  WU_REQUIRED: SharedErrorMessages.WU_REQUIRED,
  MESSAGE_REQUIRED: 'message is required',
} as const;

const MemoryResultMessages = {
  MEM_INIT_PASSED: 'Memory initialized',
  MEM_INIT_FAILED: 'mem:init failed',
  MEM_START_PASSED: 'Session started',
  MEM_START_FAILED: 'mem:start failed',
  MEM_READY_FAILED: 'mem:ready failed',
  MEM_CHECKPOINT_PASSED: 'Checkpoint saved',
  MEM_CHECKPOINT_FAILED: 'mem:checkpoint failed',
  MEM_CLEANUP_PASSED: 'Cleanup completed',
  MEM_CLEANUP_FAILED: 'mem:cleanup failed',
  MEM_CONTEXT_FAILED: 'mem:context failed',
  MEM_CREATE_PASSED: 'Memory node created',
  MEM_CREATE_FAILED: 'mem:create failed',
  MEM_DELETE_PASSED: 'Memory node deleted',
  MEM_DELETE_FAILED: 'mem:delete failed',
  MEM_EXPORT_PASSED: 'Memory exported',
  MEM_EXPORT_FAILED: 'mem:export failed',
  MEM_INBOX_FAILED: 'mem:inbox failed',
  MEM_SIGNAL_PASSED: 'Signal broadcast',
  MEM_SIGNAL_FAILED: 'mem:signal failed',
  MEM_SUMMARIZE_PASSED: 'Memory summary generated',
  MEM_SUMMARIZE_FAILED: 'mem:summarize failed',
  MEM_TRIAGE_FAILED: 'mem:triage failed',
  MEM_RECOVER_PASSED: 'Recovery context generated',
  MEM_RECOVER_FAILED: 'mem:recover failed',
} as const;

// mem:recover public parity schema (not yet modeled in @lumenflow/core memory schemas)
const memRecoverSchema = z.object({
  wu: z.string().optional(),
  max_size: z.number().optional(),
  format: z.enum(['json', 'human']).optional(),
  quiet: z.boolean().optional(),
  base_dir: z.string().optional(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function unwrapExecuteViaPackData(data: unknown): unknown {
  if (!isRecord(data) || !('success' in data)) {
    return data;
  }

  const successValue = data.success;
  if (typeof successValue !== 'boolean' || !successValue) {
    return data;
  }

  const outputData = data.data;
  return outputData ?? {};
}

function parseJsonPayload(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return { message: value };
    }
  }

  if (isRecord(value) && typeof value.message === 'string') {
    try {
      return JSON.parse(value.message);
    } catch {
      return value;
    }
  }

  return value;
}

function resolveMessage(value: unknown, fallbackMessage: string): string {
  if (typeof value === 'string') {
    return value;
  }

  if (isRecord(value) && typeof value.message === 'string') {
    return value.message;
  }

  return fallbackMessage;
}

function buildExecutionOptions(
  projectRoot: string | undefined,
  fallback: { command: string; args: string[]; errorCode: string },
): Parameters<typeof executeViaPack>[2] {
  return {
    projectRoot,
    contextInput: {
      metadata: {
        [MetadataKeys.PROJECT_ROOT]: projectRoot,
      },
    },
    fallback,
  };
}

/**
 * mem_init - Initialize memory for a WU
 */
export const memInitTool: ToolDefinition = {
  name: 'mem_init',
  description: 'Initialize memory layer for a Work Unit',
  inputSchema: memInitSchema,

  async execute(input, options) {
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [CliArgs.WU, input.wu as string];
    const result = await executeViaPack(CliCommands.MEM_INIT, input, {
      ...buildExecutionOptions(options?.projectRoot, {
        command: CliCommands.MEM_INIT,
        args,
        errorCode: MemoryErrorCodes.MEM_INIT_ERROR,
      }),
    });

    return result.success
      ? success({
          message: resolveMessage(
            unwrapExecuteViaPackData(result.data),
            MemoryResultMessages.MEM_INIT_PASSED,
          ),
        })
      : error(
          result.error?.message ?? MemoryResultMessages.MEM_INIT_FAILED,
          MemoryErrorCodes.MEM_INIT_ERROR,
        );
  },
};

/**
 * mem_start - Start a memory session
 */
export const memStartTool: ToolDefinition = {
  name: 'mem_start',
  description: 'Start a memory session for a Work Unit',
  inputSchema: memStartSchema,

  async execute(input, options) {
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [CliArgs.WU, input.wu as string];
    if (input.lane) args.push(CliArgs.LANE, input.lane as string);

    const result = await executeViaPack(CliCommands.MEM_START, input, {
      ...buildExecutionOptions(options?.projectRoot, {
        command: CliCommands.MEM_START,
        args,
        errorCode: MemoryErrorCodes.MEM_START_ERROR,
      }),
    });

    return result.success
      ? success({
          message: resolveMessage(
            unwrapExecuteViaPackData(result.data),
            MemoryResultMessages.MEM_START_PASSED,
          ),
        })
      : error(
          result.error?.message ?? MemoryResultMessages.MEM_START_FAILED,
          MemoryErrorCodes.MEM_START_ERROR,
        );
  },
};

/**
 * mem_ready - Check pending nodes
 */
export const memReadyTool: ToolDefinition = {
  name: 'mem_ready',
  description: 'Check pending memory nodes for a Work Unit',
  inputSchema: memReadySchema,

  async execute(input, options) {
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [CliArgs.WU, input.wu as string];
    const result = await executeViaPack(CliCommands.MEM_READY, input, {
      ...buildExecutionOptions(options?.projectRoot, {
        command: CliCommands.MEM_READY,
        args,
        errorCode: MemoryErrorCodes.MEM_READY_ERROR,
      }),
    });

    return result.success
      ? success(parseJsonPayload(unwrapExecuteViaPackData(result.data)))
      : error(
          result.error?.message ?? MemoryResultMessages.MEM_READY_FAILED,
          MemoryErrorCodes.MEM_READY_ERROR,
        );
  },
};

/**
 * mem_checkpoint - Save progress checkpoint
 */
export const memCheckpointTool: ToolDefinition = {
  name: 'mem_checkpoint',
  description: 'Save a progress checkpoint for a Work Unit',
  inputSchema: memCheckpointSchema,

  async execute(input, options) {
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [CliArgs.WU, input.wu as string];
    if (input.message) args.push('--message', input.message as string);

    const result = await executeViaPack(CliCommands.MEM_CHECKPOINT, input, {
      ...buildExecutionOptions(options?.projectRoot, {
        command: CliCommands.MEM_CHECKPOINT,
        args,
        errorCode: MemoryErrorCodes.MEM_CHECKPOINT_ERROR,
      }),
    });

    return result.success
      ? success({
          message: resolveMessage(
            unwrapExecuteViaPackData(result.data),
            MemoryResultMessages.MEM_CHECKPOINT_PASSED,
          ),
        })
      : error(
          result.error?.message ?? MemoryResultMessages.MEM_CHECKPOINT_FAILED,
          MemoryErrorCodes.MEM_CHECKPOINT_ERROR,
        );
  },
};

/**
 * mem_cleanup - Clean up stale memory data
 */
export const memCleanupTool: ToolDefinition = {
  name: 'mem_cleanup',
  description: 'Clean up stale memory data',
  inputSchema: memCleanupSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.dry_run) args.push(CliArgs.DRY_RUN);

    const result = await executeViaPack(CliCommands.MEM_CLEANUP, input, {
      ...buildExecutionOptions(options?.projectRoot, {
        command: CliCommands.MEM_CLEANUP,
        args,
        errorCode: MemoryErrorCodes.MEM_CLEANUP_ERROR,
      }),
    });

    return result.success
      ? success({
          message: resolveMessage(
            unwrapExecuteViaPackData(result.data),
            MemoryResultMessages.MEM_CLEANUP_PASSED,
          ),
        })
      : error(
          result.error?.message ?? MemoryResultMessages.MEM_CLEANUP_FAILED,
          MemoryErrorCodes.MEM_CLEANUP_ERROR,
        );
  },
};

/**
 * mem_context - Get context for current lane/WU
 */
export const memContextTool: ToolDefinition = {
  name: 'mem_context',
  description: 'Get memory context for a Work Unit, optionally filtered by lane',
  inputSchema: memContextSchema,

  async execute(input, options) {
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [CliArgs.WU, input.wu as string];
    if (input.lane) args.push(CliArgs.LANE, input.lane as string);

    const result = await executeViaPack(CliCommands.MEM_CONTEXT, input, {
      ...buildExecutionOptions(options?.projectRoot, {
        command: CliCommands.MEM_CONTEXT,
        args,
        errorCode: MemoryErrorCodes.MEM_CONTEXT_ERROR,
      }),
    });

    return result.success
      ? success(parseJsonPayload(unwrapExecuteViaPackData(result.data)))
      : error(
          result.error?.message ?? MemoryResultMessages.MEM_CONTEXT_FAILED,
          MemoryErrorCodes.MEM_CONTEXT_ERROR,
        );
  },
};

/**
 * mem_create - Create a memory node
 */
export const memCreateTool: ToolDefinition = {
  name: 'mem_create',
  description: 'Create a memory node (e.g., for bug discovery)',
  inputSchema: memCreateSchema,

  async execute(input, options) {
    if (!input.message) {
      return error(MemoryErrorMessages.MESSAGE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [input.message as string, CliArgs.WU, input.wu as string];
    if (input.type) args.push('--type', input.type as string);
    if (input.tags) args.push('--tags', (input.tags as string[]).join(','));

    const result = await executeViaPack(CliCommands.MEM_CREATE, input, {
      ...buildExecutionOptions(options?.projectRoot, {
        command: CliCommands.MEM_CREATE,
        args,
        errorCode: MemoryErrorCodes.MEM_CREATE_ERROR,
      }),
    });

    return result.success
      ? success({
          message: resolveMessage(
            unwrapExecuteViaPackData(result.data),
            MemoryResultMessages.MEM_CREATE_PASSED,
          ),
        })
      : error(
          result.error?.message ?? MemoryResultMessages.MEM_CREATE_FAILED,
          MemoryErrorCodes.MEM_CREATE_ERROR,
        );
  },
};

/**
 * mem_delete - Delete/archive a memory node
 */
export const memDeleteTool: ToolDefinition = {
  name: 'mem_delete',
  description: 'Delete or archive a memory node',
  inputSchema: memDeleteSchema,

  async execute(input, options) {
    if (!input.id) {
      return error(ErrorMessages.ID_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [CliArgs.ID, input.id as string];

    const result = await executeViaPack(CliCommands.MEM_DELETE, input, {
      ...buildExecutionOptions(options?.projectRoot, {
        command: CliCommands.MEM_DELETE,
        args,
        errorCode: MemoryErrorCodes.MEM_DELETE_ERROR,
      }),
    });

    return result.success
      ? success({
          message: resolveMessage(
            unwrapExecuteViaPackData(result.data),
            MemoryResultMessages.MEM_DELETE_PASSED,
          ),
        })
      : error(
          result.error?.message ?? MemoryResultMessages.MEM_DELETE_FAILED,
          MemoryErrorCodes.MEM_DELETE_ERROR,
        );
  },
};

/**
 * mem_export - Export memory as markdown
 */
export const memExportTool: ToolDefinition = {
  name: 'mem_export',
  description: 'Export memory for a Work Unit as markdown or JSON',
  inputSchema: memExportSchema,

  async execute(input, options) {
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [CliArgs.WU, input.wu as string];
    if (input.format) args.push(CliArgs.FORMAT, input.format as string);

    const result = await executeViaPack(CliCommands.MEM_EXPORT, input, {
      ...buildExecutionOptions(options?.projectRoot, {
        command: CliCommands.MEM_EXPORT,
        args,
        errorCode: MemoryErrorCodes.MEM_EXPORT_ERROR,
      }),
    });

    return result.success
      ? success({
          message: resolveMessage(
            unwrapExecuteViaPackData(result.data),
            MemoryResultMessages.MEM_EXPORT_PASSED,
          ),
        })
      : error(
          result.error?.message ?? MemoryResultMessages.MEM_EXPORT_FAILED,
          MemoryErrorCodes.MEM_EXPORT_ERROR,
        );
  },
};

/**
 * mem_inbox - Check coordination signals
 */
export const memInboxTool: ToolDefinition = {
  name: 'mem_inbox',
  description: 'Check coordination signals from other agents',
  inputSchema: memInboxSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.since) args.push(CliArgs.SINCE, input.since as string);
    if (input.wu) args.push(CliArgs.WU, input.wu as string);
    if (input.lane) args.push(CliArgs.LANE, input.lane as string);

    const result = await executeViaPack(CliCommands.MEM_INBOX, input, {
      ...buildExecutionOptions(options?.projectRoot, {
        command: CliCommands.MEM_INBOX,
        args,
        errorCode: MemoryErrorCodes.MEM_INBOX_ERROR,
      }),
    });

    return result.success
      ? success(parseJsonPayload(unwrapExecuteViaPackData(result.data)))
      : error(
          result.error?.message ?? MemoryResultMessages.MEM_INBOX_FAILED,
          MemoryErrorCodes.MEM_INBOX_ERROR,
        );
  },
};

/**
 * mem_signal - Broadcast coordination signal
 */
export const memSignalTool: ToolDefinition = {
  name: 'mem_signal',
  description: 'Broadcast a coordination signal to other agents',
  inputSchema: memSignalSchema,

  async execute(input, options) {
    if (!input.message) {
      return error(MemoryErrorMessages.MESSAGE_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [input.message as string, CliArgs.WU, input.wu as string];

    const result = await executeViaPack(CliCommands.MEM_SIGNAL, input, {
      ...buildExecutionOptions(options?.projectRoot, {
        command: CliCommands.MEM_SIGNAL,
        args,
        errorCode: MemoryErrorCodes.MEM_SIGNAL_ERROR,
      }),
    });

    return result.success
      ? success({
          message: resolveMessage(
            unwrapExecuteViaPackData(result.data),
            MemoryResultMessages.MEM_SIGNAL_PASSED,
          ),
        })
      : error(
          result.error?.message ?? MemoryResultMessages.MEM_SIGNAL_FAILED,
          MemoryErrorCodes.MEM_SIGNAL_ERROR,
        );
  },
};

/**
 * mem_summarize - Summarize memory context
 */
export const memSummarizeTool: ToolDefinition = {
  name: 'mem_summarize',
  description: 'Summarize memory context for a Work Unit',
  inputSchema: memSummarizeSchema,

  async execute(input, options) {
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [CliArgs.WU, input.wu as string];

    const result = await executeViaPack(CliCommands.MEM_SUMMARIZE, input, {
      ...buildExecutionOptions(options?.projectRoot, {
        command: CliCommands.MEM_SUMMARIZE,
        args,
        errorCode: MemoryErrorCodes.MEM_SUMMARIZE_ERROR,
      }),
    });

    return result.success
      ? success({
          message: resolveMessage(
            unwrapExecuteViaPackData(result.data),
            MemoryResultMessages.MEM_SUMMARIZE_PASSED,
          ),
        })
      : error(
          result.error?.message ?? MemoryResultMessages.MEM_SUMMARIZE_FAILED,
          MemoryErrorCodes.MEM_SUMMARIZE_ERROR,
        );
  },
};

/**
 * mem_triage - Triage discovered bugs
 */
export const memTriageTool: ToolDefinition = {
  name: 'mem_triage',
  description: 'Triage discovered bugs for a Work Unit, optionally promoting to WU',
  inputSchema: memTriageSchema,

  async execute(input, options) {
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [CliArgs.WU, input.wu as string];
    if (input.promote) args.push('--promote', input.promote as string);
    if (input.lane) args.push(CliArgs.LANE, input.lane as string);

    const result = await executeViaPack(CliCommands.MEM_TRIAGE, input, {
      ...buildExecutionOptions(options?.projectRoot, {
        command: CliCommands.MEM_TRIAGE,
        args,
        errorCode: MemoryErrorCodes.MEM_TRIAGE_ERROR,
      }),
    });

    return result.success
      ? success(parseJsonPayload(unwrapExecuteViaPackData(result.data)))
      : error(
          result.error?.message ?? MemoryResultMessages.MEM_TRIAGE_FAILED,
          MemoryErrorCodes.MEM_TRIAGE_ERROR,
        );
  },
};

/**
 * mem_recover - Generate post-compaction recovery context for a Work Unit
 */
export const memRecoverTool: ToolDefinition = {
  name: 'mem_recover',
  description: 'Generate recovery context after compaction for a Work Unit',
  inputSchema: memRecoverSchema,

  async execute(input, options) {
    if (!input.wu) {
      return error(MemoryErrorMessages.WU_REQUIRED, ErrorCodes.MISSING_PARAMETER);
    }

    const args = [CliArgs.WU, input.wu as string];
    if (input.max_size !== undefined) args.push('--max-size', String(input.max_size));
    if (input.format) args.push(CliArgs.FORMAT, input.format as string);
    if (input.quiet) args.push(CliArgs.QUIET);
    if (input.base_dir) args.push(CliArgs.BASE_DIR, input.base_dir as string);

    const result = await executeViaPack(CliCommands.MEM_RECOVER, input, {
      ...buildExecutionOptions(options?.projectRoot, {
        command: CliCommands.MEM_RECOVER,
        args,
        errorCode: MemoryErrorCodes.MEM_RECOVER_ERROR,
      }),
    });

    if (!result.success) {
      return error(
        result.error?.message ?? MemoryResultMessages.MEM_RECOVER_FAILED,
        MemoryErrorCodes.MEM_RECOVER_ERROR,
      );
    }

    const unwrapped = unwrapExecuteViaPackData(result.data);
    if (input.format === 'json') {
      return success(parseJsonPayload(unwrapped));
    }

    return success({
      message: resolveMessage(unwrapped, MemoryResultMessages.MEM_RECOVER_PASSED),
    });
  },
};

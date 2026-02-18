/**
 * @file memory-tools.ts
 * @description Memory tool implementations
 *
 * WU-1642: Extracted from tools.ts during domain decomposition.
 * WU-1424: Memory tools
 * WU-1456: Memory commands use shared schemas where available
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
  runCliCommand,
  type CliRunnerOptions,
} from '../tools-shared.js';
import { CliCommands } from '../mcp-constants.js';

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

// mem:recover public parity schema (not yet modeled in @lumenflow/core memory schemas)
const memRecoverSchema = z.object({
  wu: z.string().optional(),
  max_size: z.number().optional(),
  format: z.enum(['json', 'human']).optional(),
  quiet: z.boolean().optional(),
  base_dir: z.string().optional(),
});

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

    const args = ['--wu', input.wu as string];

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.MEM_INIT, args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Memory initialized' });
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:init failed',
        MemoryErrorCodes.MEM_INIT_ERROR,
      );
    }
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

    const args = ['--wu', input.wu as string];
    if (input.lane) args.push(CliArgs.LANE, input.lane as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.MEM_START, args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Session started' });
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:start failed',
        MemoryErrorCodes.MEM_START_ERROR,
      );
    }
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

    const args = ['--wu', input.wu as string];

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.MEM_READY, args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:ready failed',
        MemoryErrorCodes.MEM_READY_ERROR,
      );
    }
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

    const args = ['--wu', input.wu as string];
    if (input.message) args.push('--message', input.message as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.MEM_CHECKPOINT, args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Checkpoint saved' });
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:checkpoint failed',
        MemoryErrorCodes.MEM_CHECKPOINT_ERROR,
      );
    }
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

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.MEM_CLEANUP, args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Cleanup completed' });
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:cleanup failed',
        MemoryErrorCodes.MEM_CLEANUP_ERROR,
      );
    }
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

    const args = ['--wu', input.wu as string];
    if (input.lane) args.push(CliArgs.LANE, input.lane as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.MEM_CONTEXT, args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:context failed',
        MemoryErrorCodes.MEM_CONTEXT_ERROR,
      );
    }
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

    const args = [input.message as string, '--wu', input.wu as string];
    if (input.type) args.push('--type', input.type as string);
    if (input.tags) args.push('--tags', (input.tags as string[]).join(','));

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.MEM_CREATE, args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Memory node created' });
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:create failed',
        MemoryErrorCodes.MEM_CREATE_ERROR,
      );
    }
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

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.MEM_DELETE, args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Memory node deleted' });
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:delete failed',
        MemoryErrorCodes.MEM_DELETE_ERROR,
      );
    }
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

    const args = ['--wu', input.wu as string];
    if (input.format) args.push(CliArgs.FORMAT, input.format as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.MEM_EXPORT, args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout });
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:export failed',
        MemoryErrorCodes.MEM_EXPORT_ERROR,
      );
    }
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

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.MEM_INBOX, args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:inbox failed',
        MemoryErrorCodes.MEM_INBOX_ERROR,
      );
    }
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

    const args = [input.message as string, '--wu', input.wu as string];

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.MEM_SIGNAL, args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout || 'Signal broadcast' });
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:signal failed',
        MemoryErrorCodes.MEM_SIGNAL_ERROR,
      );
    }
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

    const args = ['--wu', input.wu as string];

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.MEM_SUMMARIZE, args, cliOptions);

    if (result.success) {
      return success({ message: result.stdout });
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:summarize failed',
        MemoryErrorCodes.MEM_SUMMARIZE_ERROR,
      );
    }
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

    const args = ['--wu', input.wu as string];
    if (input.promote) args.push('--promote', input.promote as string);
    if (input.lane) args.push(CliArgs.LANE, input.lane as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.MEM_TRIAGE, args, cliOptions);

    if (result.success) {
      try {
        const data = JSON.parse(result.stdout);
        return success(data);
      } catch {
        return success({ message: result.stdout });
      }
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:triage failed',
        MemoryErrorCodes.MEM_TRIAGE_ERROR,
      );
    }
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

    const args = ['--wu', input.wu as string];
    if (input.max_size !== undefined) args.push('--max-size', String(input.max_size));
    if (input.format) args.push(CliArgs.FORMAT, input.format as string);
    if (input.quiet) args.push(CliArgs.QUIET);
    if (input.base_dir) args.push(CliArgs.BASE_DIR, input.base_dir as string);

    const cliOptions: CliRunnerOptions = { projectRoot: options?.projectRoot };
    const result = await runCliCommand(CliCommands.MEM_RECOVER, args, cliOptions);

    if (result.success) {
      if (input.format === 'json') {
        try {
          const data = JSON.parse(result.stdout);
          return success(data);
        } catch {
          return success({ message: result.stdout || 'Recovery context generated' });
        }
      }
      return success({ message: result.stdout || 'Recovery context generated' });
    } else {
      return error(
        result.stderr || result.error?.message || 'mem:recover failed',
        MemoryErrorCodes.MEM_RECOVER_ERROR,
      );
    }
  },
};

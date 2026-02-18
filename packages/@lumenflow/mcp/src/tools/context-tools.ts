/**
 * @file context-tools.ts
 * @description Context/read operations via @lumenflow/core
 *
 * WU-1642: Extracted from tools.ts during domain decomposition.
 * WU-1803: Migrated from runCliCommand/direct core calls to executeViaPack (runtime pack execution)
 */

import { z } from 'zod';
import { wuStatusEnum } from '@lumenflow/core';
import { type ToolDefinition, ErrorCodes, executeViaPack } from '../tools-shared.js';

/**
 * context_get - Get current WU context (location, git state, WU state)
 */
export const contextGetTool: ToolDefinition = {
  name: 'context_get',
  description: 'Get current LumenFlow context including location, git state, and active WU',
  inputSchema: z.object({}).optional(),

  async execute(input, options) {
    const result = await executeViaPack('context:get', input ?? {}, {
      projectRoot: options?.projectRoot,
      fallback: {
        command: 'context:get',
        args: [],
        errorCode: ErrorCodes.CONTEXT_ERROR,
      },
    });

    return result;
  },
};

/**
 * wu_list - List all WUs with optional status filter
 *
 * WU-1431: Uses shared wuStatusEnum for status filter
 * WU-1803: Migrated from runCliCommand('wu:validate') to executeViaPack('wu:list')
 */
export const wuListTool: ToolDefinition = {
  name: 'wu_list',
  description: 'List all Work Units (WUs) with optional status filter',
  inputSchema: z.object({
    status: wuStatusEnum.optional(),
    lane: z.string().optional(),
  }),

  async execute(input, options) {
    const result = await executeViaPack('wu:list', input, {
      projectRoot: options?.projectRoot,
      fallback: {
        command: 'wu:validate',
        args: ['--all', '--json'],
        errorCode: ErrorCodes.WU_LIST_ERROR,
      },
    });

    return result;
  },
};

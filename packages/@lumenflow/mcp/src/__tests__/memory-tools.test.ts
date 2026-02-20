// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file memory-tools.test.ts
 * @description Tests for Memory MCP tool implementations
 *
 * WU-1811: migrate memory tools from runCliCommand to executeViaPack runtime path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  memInitTool,
  memStartTool,
  memReadyTool,
  memCheckpointTool,
  memCleanupTool,
  memContextTool,
  memCreateTool,
  memDeleteTool,
  memExportTool,
  memInboxTool,
  memSignalTool,
  memSummarizeTool,
  memTriageTool,
  memRecoverTool,
} from '../tools.js';
import * as cliRunner from '../cli-runner.js';
import * as toolsShared from '../tools-shared.js';

vi.mock('../cli-runner.js', () => ({
  runCliCommand: vi.fn(),
}));

vi.mock('../tools-shared.js', async () => {
  const actual = await vi.importActual<typeof import('../tools-shared.js')>('../tools-shared.js');
  return {
    ...actual,
    executeViaPack: vi.fn(actual.executeViaPack),
  };
});

const TEST_WU_ID = 'WU-1424';
const TEST_LANE = 'Framework: CLI';
const TEST_PROMOTE_LANE = 'Framework: Core';
const TEST_MESSAGE = 'AC1 complete: tests passing';
const TEST_DISCOVERY_MESSAGE = 'Bug: Parser issue';
const TEST_BASE_DIR = '/tmp/project';

function runtimeSuccess(data: unknown) {
  return {
    success: true,
    data: {
      success: true,
      data,
    },
  };
}

describe('Memory MCP tools (WU-1811)', () => {
  const mockRunCliCommand = vi.mocked(cliRunner.runCliCommand);
  const mockExecuteViaPack = vi.mocked(toolsShared.executeViaPack);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('routing', () => {
    const cases = [
      {
        toolName: 'mem_init',
        command: 'mem:init',
        tool: memInitTool,
        input: { wu: TEST_WU_ID },
        expectedArgs: ['--wu', TEST_WU_ID],
      },
      {
        toolName: 'mem_start',
        command: 'mem:start',
        tool: memStartTool,
        input: { wu: TEST_WU_ID, lane: TEST_LANE },
        expectedArgs: ['--wu', TEST_WU_ID, '--lane', TEST_LANE],
      },
      {
        toolName: 'mem_ready',
        command: 'mem:ready',
        tool: memReadyTool,
        input: { wu: TEST_WU_ID },
        expectedArgs: ['--wu', TEST_WU_ID],
      },
      {
        toolName: 'mem_checkpoint',
        command: 'mem:checkpoint',
        tool: memCheckpointTool,
        input: { wu: TEST_WU_ID, message: 'Before risky operation' },
        expectedArgs: ['--wu', TEST_WU_ID, '--message', 'Before risky operation'],
      },
      {
        toolName: 'mem_cleanup',
        command: 'mem:cleanup',
        tool: memCleanupTool,
        input: { dry_run: true },
        expectedArgs: ['--dry-run'],
      },
      {
        toolName: 'mem_context',
        command: 'mem:context',
        tool: memContextTool,
        input: { wu: TEST_WU_ID, lane: TEST_LANE },
        expectedArgs: ['--wu', TEST_WU_ID, '--lane', TEST_LANE],
      },
      {
        toolName: 'mem_create',
        command: 'mem:create',
        tool: memCreateTool,
        input: {
          message: TEST_DISCOVERY_MESSAGE,
          wu: TEST_WU_ID,
          type: 'discovery',
          tags: ['bug', 'parser'],
        },
        expectedArgs: [
          TEST_DISCOVERY_MESSAGE,
          '--wu',
          TEST_WU_ID,
          '--type',
          'discovery',
          '--tags',
          'bug,parser',
        ],
      },
      {
        toolName: 'mem_delete',
        command: 'mem:delete',
        tool: memDeleteTool,
        input: { id: 'node-123' },
        expectedArgs: ['--id', 'node-123'],
      },
      {
        toolName: 'mem_export',
        command: 'mem:export',
        tool: memExportTool,
        input: { wu: TEST_WU_ID, format: 'json' },
        expectedArgs: ['--wu', TEST_WU_ID, '--format', 'json'],
      },
      {
        toolName: 'mem_inbox',
        command: 'mem:inbox',
        tool: memInboxTool,
        input: { since: '30m', wu: TEST_WU_ID, lane: TEST_LANE },
        expectedArgs: ['--since', '30m', '--wu', TEST_WU_ID, '--lane', TEST_LANE],
      },
      {
        toolName: 'mem_signal',
        command: 'mem:signal',
        tool: memSignalTool,
        input: { message: TEST_MESSAGE, wu: TEST_WU_ID },
        expectedArgs: [TEST_MESSAGE, '--wu', TEST_WU_ID],
      },
      {
        toolName: 'mem_summarize',
        command: 'mem:summarize',
        tool: memSummarizeTool,
        input: { wu: TEST_WU_ID },
        expectedArgs: ['--wu', TEST_WU_ID],
      },
      {
        toolName: 'mem_triage',
        command: 'mem:triage',
        tool: memTriageTool,
        input: { wu: TEST_WU_ID, promote: 'node-123', lane: TEST_PROMOTE_LANE },
        expectedArgs: ['--wu', TEST_WU_ID, '--promote', 'node-123', '--lane', TEST_PROMOTE_LANE],
      },
      {
        toolName: 'mem_recover',
        command: 'mem:recover',
        tool: memRecoverTool,
        input: {
          wu: TEST_WU_ID,
          max_size: 512,
          format: 'json',
          quiet: true,
          base_dir: TEST_BASE_DIR,
        },
        expectedArgs: [
          '--wu',
          TEST_WU_ID,
          '--max-size',
          '512',
          '--format',
          'json',
          '--quiet',
          '--base-dir',
          TEST_BASE_DIR,
        ],
      },
    ] as const;

    it.each(cases)(
      '$toolName routes via executeViaPack and never calls runCliCommand',
      async (c) => {
        mockExecuteViaPack.mockResolvedValue(runtimeSuccess({ message: `${c.toolName}-ok` }));

        const result = await c.tool.execute(c.input);

        expect(result.success).toBe(true);
        expect(mockExecuteViaPack).toHaveBeenCalledWith(
          c.command,
          c.input,
          expect.objectContaining({
            fallback: expect.objectContaining({
              command: c.command,
            }),
          }),
        );

        const fallbackArgs = (mockExecuteViaPack.mock.calls.at(-1)?.[2]?.fallback?.args ?? []) as
          | string[]
          | undefined;
        expect(fallbackArgs ?? []).toEqual(expect.arrayContaining(c.expectedArgs));
        expect(mockRunCliCommand).not.toHaveBeenCalled();
      },
    );
  });

  describe('validation', () => {
    const requiredWuCases = [
      { tool: memInitTool, label: 'mem_init' },
      { tool: memStartTool, label: 'mem_start' },
      { tool: memReadyTool, label: 'mem_ready' },
      { tool: memCheckpointTool, label: 'mem_checkpoint' },
      { tool: memContextTool, label: 'mem_context' },
      { tool: memExportTool, label: 'mem_export' },
      { tool: memSummarizeTool, label: 'mem_summarize' },
      { tool: memTriageTool, label: 'mem_triage' },
      { tool: memRecoverTool, label: 'mem_recover' },
    ] as const;

    it.each(requiredWuCases)('$label requires wu', async ({ tool }) => {
      const result = await tool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('wu');
      expect(mockExecuteViaPack).not.toHaveBeenCalled();
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('mem_create requires message', async () => {
      const result = await memCreateTool.execute({ wu: TEST_WU_ID });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('message');
      expect(mockExecuteViaPack).not.toHaveBeenCalled();
    });

    it('mem_create requires wu', async () => {
      const result = await memCreateTool.execute({ message: TEST_DISCOVERY_MESSAGE });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('wu');
      expect(mockExecuteViaPack).not.toHaveBeenCalled();
    });

    it('mem_signal requires message', async () => {
      const result = await memSignalTool.execute({ wu: TEST_WU_ID });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('message');
      expect(mockExecuteViaPack).not.toHaveBeenCalled();
    });

    it('mem_signal requires wu', async () => {
      const result = await memSignalTool.execute({ message: TEST_MESSAGE });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('wu');
      expect(mockExecuteViaPack).not.toHaveBeenCalled();
    });

    it('mem_delete requires id', async () => {
      const result = await memDeleteTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
      expect(mockExecuteViaPack).not.toHaveBeenCalled();
    });
  });

  describe('runtime payload handling', () => {
    it('mem_ready parses JSON payload from runtime output', async () => {
      mockExecuteViaPack.mockResolvedValue(
        runtimeSuccess({ message: JSON.stringify({ pending: 3, nodes: ['n-1'] }) }),
      );

      const result = await memReadyTool.execute({ wu: TEST_WU_ID });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ pending: 3, nodes: ['n-1'] });
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('mem_context parses JSON payload from runtime output', async () => {
      mockExecuteViaPack.mockResolvedValue(
        runtimeSuccess({ message: JSON.stringify({ wu: TEST_WU_ID, lane: TEST_LANE }) }),
      );

      const result = await memContextTool.execute({ wu: TEST_WU_ID, lane: TEST_LANE });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ wu: TEST_WU_ID, lane: TEST_LANE });
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('mem_triage parses JSON payload from runtime output', async () => {
      mockExecuteViaPack.mockResolvedValue(
        runtimeSuccess({ message: JSON.stringify({ discoveries: [{ id: 'node-1' }] }) }),
      );

      const result = await memTriageTool.execute({ wu: TEST_WU_ID });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ discoveries: [{ id: 'node-1' }] });
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('mem_recover parses JSON payload in json mode', async () => {
      mockExecuteViaPack.mockResolvedValue(
        runtimeSuccess({ message: JSON.stringify({ wuId: TEST_WU_ID, size: 512 }) }),
      );

      const result = await memRecoverTool.execute({ wu: TEST_WU_ID, format: 'json' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ wuId: TEST_WU_ID, size: 512 });
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });
  });
});

/**
 * @file tools.test.ts
 * @description Tests for MCP tool implementations
 *
 * WU-1412: MCP tools available: context_get, wu_list, wu_status, wu_create, wu_claim, wu_done, gates_run
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  contextGetTool,
  registeredTools,
  taskBlockTool,
  taskClaimTool,
  taskCompleteTool,
  taskCreateTool,
  taskInspectTool,
  taskToolExecuteTool,
  taskUnblockTool,
  wuListTool,
  wuStatusTool,
  wuCreateTool,
  wuClaimTool,
  wuDoneTool,
  gatesRunTool,
} from '../tools.js';
import {
  RuntimeTaskToolDescriptions,
  RuntimeTaskToolNames,
} from '../tools/runtime-task-constants.js';
import * as cliRunner from '../cli-runner.js';
import * as core from '@lumenflow/core';

// Mock cli-runner for write operations
vi.mock('../cli-runner.js', () => ({
  runCliCommand: vi.fn(),
}));

// Mock @lumenflow/core for read operations
vi.mock('@lumenflow/core', async () => {
  const actual = await vi.importActual('@lumenflow/core');
  return {
    ...actual,
    computeWuContext: vi.fn(),
    parseAllWUYamls: vi.fn(),
    parseWUYaml: vi.fn(),
    generateBacklogMarkdown: vi.fn(),
  };
});

describe('MCP tools', () => {
  const mockRunCliCommand = vi.mocked(cliRunner.runCliCommand);
  const mockComputeWuContext = vi.mocked(core.computeWuContext);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('context_get', () => {
    it('should return current WU context via core', async () => {
      const mockContext = {
        location: { type: 'worktree', cwd: '/path/to/worktree' },
        git: { branch: 'lane/framework-cli/wu-1412', isDirty: false },
        wu: { id: 'WU-1412', status: 'in_progress' },
      };
      mockComputeWuContext.mockResolvedValue(
        mockContext as unknown as Awaited<ReturnType<typeof core.computeWuContext>>,
      );

      const result = await contextGetTool.execute({});

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject(mockContext);
      expect(mockComputeWuContext).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockComputeWuContext.mockRejectedValue(new Error('Git not found'));

      const result = await contextGetTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Git not found');
    });
  });

  describe('wu_list', () => {
    it('should list WUs via CLI shell-out', async () => {
      const mockWus = [
        { id: 'WU-1412', title: 'MCP server', status: 'in_progress' },
        { id: 'WU-1413', title: 'MCP init', status: 'ready' },
      ];
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: JSON.stringify(mockWus),
        stderr: '',
        exitCode: 0,
      });

      const result = await wuListTool.execute({});

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockWus);
    });

    it('should filter by status when provided', async () => {
      const mockWus = [
        { id: 'WU-1412', title: 'MCP server', status: 'in_progress' },
        { id: 'WU-1413', title: 'MCP init', status: 'ready' },
      ];
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: JSON.stringify(mockWus),
        stderr: '',
        exitCode: 0,
      });

      const result = await wuListTool.execute({ status: 'in_progress' });

      expect(result.success).toBe(true);
      // Should filter to only in_progress
      expect((result.data as Array<{ status: string }>).length).toBe(1);
    });
  });

  describe('wu_status', () => {
    it('should return WU status via CLI shell-out', async () => {
      const mockWu = {
        id: 'WU-1412',
        title: 'MCP server',
        status: 'in_progress',
        lane: 'Framework: CLI',
      };
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: JSON.stringify(mockWu),
        stderr: '',
        exitCode: 0,
      });

      const result = await wuStatusTool.execute({ id: 'WU-1412' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ id: 'WU-1412' });
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:status',
        expect.arrayContaining(['--id', 'WU-1412', '--json']),
        expect.any(Object),
      );
    });

    it('should require id parameter', async () => {
      const result = await wuStatusTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });
  });

  describe('wu_create', () => {
    it('should create WU via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Created WU-1414',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuCreateTool.execute({
        lane: 'Framework: CLI',
        title: 'New feature',
        description: 'Context: ... Problem: ... Solution: ...',
        acceptance: ['Criterion 1'],
        code_paths: ['packages/@lumenflow/mcp/**'],
        exposure: 'backend-only',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:create',
        expect.arrayContaining(['--lane', 'Framework: CLI']),
        expect.any(Object),
      );
    });

    it('should require lane parameter', async () => {
      const result = await wuCreateTool.execute({
        title: 'Missing lane',
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('lane');
    });
  });

  describe('wu_claim', () => {
    it('should claim WU via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Worktree created',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuClaimTool.execute({ id: 'WU-1412', lane: 'Framework: CLI' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:claim',
        expect.arrayContaining(['--id', 'WU-1412']),
        expect.any(Object),
      );
    });

    it('should require id and lane parameters', async () => {
      const result = await wuClaimTool.execute({ id: 'WU-1412' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('lane');
    });
  });

  describe('runtime tracer-bullet registry wiring', () => {
    it(`should export ${RuntimeTaskToolNames.TASK_CLAIM} runtime tool definition`, () => {
      expect(taskClaimTool.name).toBe(RuntimeTaskToolNames.TASK_CLAIM);
      expect(taskClaimTool.description).toBe(RuntimeTaskToolDescriptions.TASK_CLAIM);
    });

    it(`should export ${RuntimeTaskToolNames.TASK_CREATE} runtime tool definition`, () => {
      expect(taskCreateTool.name).toBe(RuntimeTaskToolNames.TASK_CREATE);
      expect(taskCreateTool.description).toBe(RuntimeTaskToolDescriptions.TASK_CREATE);
    });

    it(`should export ${RuntimeTaskToolNames.TASK_COMPLETE} runtime tool definition`, () => {
      expect(taskCompleteTool.name).toBe(RuntimeTaskToolNames.TASK_COMPLETE);
      expect(taskCompleteTool.description).toBe(RuntimeTaskToolDescriptions.TASK_COMPLETE);
    });

    it(`should export ${RuntimeTaskToolNames.TASK_BLOCK} runtime tool definition`, () => {
      expect(taskBlockTool.name).toBe(RuntimeTaskToolNames.TASK_BLOCK);
      expect(taskBlockTool.description).toBe(RuntimeTaskToolDescriptions.TASK_BLOCK);
    });

    it(`should export ${RuntimeTaskToolNames.TASK_UNBLOCK} runtime tool definition`, () => {
      expect(taskUnblockTool.name).toBe(RuntimeTaskToolNames.TASK_UNBLOCK);
      expect(taskUnblockTool.description).toBe(RuntimeTaskToolDescriptions.TASK_UNBLOCK);
    });

    it(`should export ${RuntimeTaskToolNames.TASK_INSPECT} runtime tool definition`, () => {
      expect(taskInspectTool.name).toBe(RuntimeTaskToolNames.TASK_INSPECT);
      expect(taskInspectTool.description).toBe(RuntimeTaskToolDescriptions.TASK_INSPECT);
    });

    it(`should export ${RuntimeTaskToolNames.TOOL_EXECUTE} runtime tool definition`, () => {
      expect(taskToolExecuteTool.name).toBe(RuntimeTaskToolNames.TOOL_EXECUTE);
      expect(taskToolExecuteTool.description).toBe(RuntimeTaskToolDescriptions.TOOL_EXECUTE);
    });

    it(`should include ${RuntimeTaskToolNames.TASK_CLAIM} in the production MCP registry aggregate`, () => {
      expect(registeredTools.some((tool) => tool.name === RuntimeTaskToolNames.TASK_CLAIM)).toBe(
        true,
      );
    });

    it(`should include ${RuntimeTaskToolNames.TASK_CREATE} in the production MCP registry aggregate`, () => {
      expect(registeredTools.some((tool) => tool.name === RuntimeTaskToolNames.TASK_CREATE)).toBe(
        true,
      );
    });

    it(`should include ${RuntimeTaskToolNames.TASK_COMPLETE} in the production MCP registry aggregate`, () => {
      expect(registeredTools.some((tool) => tool.name === RuntimeTaskToolNames.TASK_COMPLETE)).toBe(
        true,
      );
    });

    it(`should include ${RuntimeTaskToolNames.TASK_BLOCK} in the production MCP registry aggregate`, () => {
      expect(registeredTools.some((tool) => tool.name === RuntimeTaskToolNames.TASK_BLOCK)).toBe(
        true,
      );
    });

    it(`should include ${RuntimeTaskToolNames.TASK_UNBLOCK} in the production MCP registry aggregate`, () => {
      expect(registeredTools.some((tool) => tool.name === RuntimeTaskToolNames.TASK_UNBLOCK)).toBe(
        true,
      );
    });

    it(`should include ${RuntimeTaskToolNames.TASK_INSPECT} in the production MCP registry aggregate`, () => {
      expect(registeredTools.some((tool) => tool.name === RuntimeTaskToolNames.TASK_INSPECT)).toBe(
        true,
      );
    });

    it(`should include ${RuntimeTaskToolNames.TOOL_EXECUTE} in the production MCP registry aggregate`, () => {
      expect(registeredTools.some((tool) => tool.name === RuntimeTaskToolNames.TOOL_EXECUTE)).toBe(
        true,
      );
    });
  });

  describe('wu_done', () => {
    it('should complete WU via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'WU completed',
        stderr: '',
        exitCode: 0,
      });

      const result = await wuDoneTool.execute({ id: 'WU-1412' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'wu:done',
        expect.arrayContaining(['--id', 'WU-1412']),
        expect.any(Object),
      );
    });

    it('should fail fast if not on main checkout', async () => {
      const mockContext = {
        location: { type: 'worktree', cwd: '/path/to/worktree' },
        git: { branch: 'lane/framework-cli/wu-1412' },
      };
      mockComputeWuContext.mockResolvedValue(
        mockContext as unknown as Awaited<ReturnType<typeof core.computeWuContext>>,
      );

      const result = await wuDoneTool.execute({ id: 'WU-1412' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('main checkout');
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should require id parameter', async () => {
      const result = await wuDoneTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });
  });

  describe('gates_run', () => {
    it('should run gates via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'All gates passed',
        stderr: '',
        exitCode: 0,
      });

      const result = await gatesRunTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'gates',
        expect.any(Array),
        expect.any(Object),
      );
    });

    it('should support --docs-only flag', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Docs gates passed',
        stderr: '',
        exitCode: 0,
      });

      const result = await gatesRunTool.execute({ docs_only: true });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'gates',
        expect.arrayContaining(['--docs-only']),
        expect.any(Object),
      );
    });

    it('should report gate failures', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'lint failed',
        exitCode: 1,
      });

      const result = await gatesRunTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('lint failed');
    });
  });
});

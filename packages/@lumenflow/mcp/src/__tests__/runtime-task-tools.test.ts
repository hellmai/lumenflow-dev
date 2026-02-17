import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as cliRunner from '../cli-runner.js';
import {
  resetRuntimeTaskToolCache,
  taskClaimTool,
  taskCreateTool,
} from '../tools/runtime-task-tools.js';
import * as kernel from '@lumenflow/kernel';
import { ErrorCodes } from '../tools-shared.js';
import { RuntimeTaskToolNames } from '../tools/runtime-task-constants.js';

vi.mock('@lumenflow/kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lumenflow/kernel')>();
  return {
    ...actual,
    initializeKernelRuntime: vi.fn(),
  };
});

vi.mock('../cli-runner.js', () => ({
  runCliCommand: vi.fn(),
}));

describe('runtime task MCP tools', () => {
  const mockInitializeKernelRuntime = vi.mocked(kernel.initializeKernelRuntime);
  const mockRunCliCommand = vi.mocked(cliRunner.runCliCommand);
  const sampleTaskSpec = {
    id: 'WU-1785',
    workspace_id: 'workspace-default',
    lane_id: 'framework-core-lifecycle',
    domain: 'software-delivery',
    title: 'Create runtime task',
    description: 'Route task:create through runtime',
    acceptance: ['Task created through runtime path'],
    declared_scopes: [],
    risk: 'medium',
    type: 'feature',
    priority: 'P2',
    created: '2026-02-17',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetRuntimeTaskToolCache();
  });

  it(`routes ${RuntimeTaskToolNames.TASK_CLAIM} through KernelRuntime without CLI shell-out`, async () => {
    const claimResult = {
      task_id: 'WU-1771',
      run: {
        run_id: 'run-WU-1771-1',
        task_id: 'WU-1771',
        status: 'executing',
      },
    };
    const claimTask = vi.fn().mockResolvedValue(claimResult);
    mockInitializeKernelRuntime.mockResolvedValue({ claimTask } as unknown as Awaited<
      ReturnType<typeof kernel.initializeKernelRuntime>
    >);

    const result = await taskClaimTool.execute(
      {
        task_id: 'WU-1771',
        by: 'tom@hellm.ai',
        session_id: 'session-1771',
      },
      { projectRoot: '/tmp/lumenflow-mcp-runtime' },
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual(claimResult);
    expect(mockInitializeKernelRuntime).toHaveBeenCalledWith({
      workspaceRoot: path.resolve('/tmp/lumenflow-mcp-runtime'),
    });
    expect(claimTask).toHaveBeenCalledWith({
      task_id: 'WU-1771',
      by: 'tom@hellm.ai',
      session_id: 'session-1771',
    });
    expect(mockRunCliCommand).not.toHaveBeenCalled();
  });

  it('validates input before runtime initialization', async () => {
    const result = await taskClaimTool.execute(
      {
        by: 'tom@hellm.ai',
        session_id: 'session-1771',
      },
      { projectRoot: '/tmp/lumenflow-mcp-runtime' },
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.TASK_CLAIM_ERROR);
    expect(mockInitializeKernelRuntime).not.toHaveBeenCalled();
  });

  it('returns error when KernelRuntime initialization fails', async () => {
    mockInitializeKernelRuntime.mockRejectedValue(new Error('runtime init failed'));

    const result = await taskClaimTool.execute(
      {
        task_id: 'WU-1771',
        by: 'tom@hellm.ai',
        session_id: 'session-1771',
      },
      { projectRoot: '/tmp/lumenflow-mcp-runtime' },
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.TASK_CLAIM_ERROR);
    expect(result.error?.message).toContain('runtime init failed');
    expect(mockRunCliCommand).not.toHaveBeenCalled();
  });

  it(`reuses initialized runtime for repeated ${RuntimeTaskToolNames.TASK_CLAIM} calls in the same workspace`, async () => {
    const claimTask = vi.fn().mockResolvedValue({
      task_id: 'WU-1771',
    });
    mockInitializeKernelRuntime.mockResolvedValue({ claimTask } as unknown as Awaited<
      ReturnType<typeof kernel.initializeKernelRuntime>
    >);

    await taskClaimTool.execute(
      {
        task_id: 'WU-1771',
        by: 'tom@hellm.ai',
        session_id: 'session-1771-a',
      },
      { projectRoot: '/tmp/lumenflow-mcp-runtime' },
    );
    await taskClaimTool.execute(
      {
        task_id: 'WU-1771',
        by: 'tom@hellm.ai',
        session_id: 'session-1771-b',
      },
      { projectRoot: '/tmp/lumenflow-mcp-runtime' },
    );

    expect(mockInitializeKernelRuntime).toHaveBeenCalledTimes(1);
    expect(claimTask).toHaveBeenCalledTimes(2);
  });

  it(`routes ${RuntimeTaskToolNames.TASK_CREATE} through KernelRuntime without CLI shell-out`, async () => {
    const createResult = {
      task: sampleTaskSpec,
      task_spec_path: '/tmp/lumenflow-mcp-runtime/.lumenflow/kernel/tasks/WU-1785.yaml',
      event: {
        schema_version: 1,
        kind: 'task_created',
        task_id: 'WU-1785',
        timestamp: '2026-02-17T00:00:00.000Z',
        spec_hash: 'a'.repeat(64),
      },
    };
    const createTask = vi.fn().mockResolvedValue(createResult);
    mockInitializeKernelRuntime.mockResolvedValue({ createTask } as unknown as Awaited<
      ReturnType<typeof kernel.initializeKernelRuntime>
    >);

    const result = await taskCreateTool.execute(sampleTaskSpec, {
      projectRoot: '/tmp/lumenflow-mcp-runtime',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual(createResult);
    expect(mockInitializeKernelRuntime).toHaveBeenCalledWith({
      workspaceRoot: path.resolve('/tmp/lumenflow-mcp-runtime'),
    });
    expect(createTask).toHaveBeenCalledWith(sampleTaskSpec);
    expect(mockRunCliCommand).not.toHaveBeenCalled();
  });

  it(`validates ${RuntimeTaskToolNames.TASK_CREATE} input before runtime initialization`, async () => {
    const result = await taskCreateTool.execute(
      {
        id: 'WU-1785',
      },
      { projectRoot: '/tmp/lumenflow-mcp-runtime' },
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.TASK_CREATE_ERROR);
    expect(mockInitializeKernelRuntime).not.toHaveBeenCalled();
  });

  it(`returns error when ${RuntimeTaskToolNames.TASK_CREATE} fails`, async () => {
    const createTask = vi.fn().mockRejectedValue(new Error('task creation failed'));
    mockInitializeKernelRuntime.mockResolvedValue({ createTask } as unknown as Awaited<
      ReturnType<typeof kernel.initializeKernelRuntime>
    >);

    const result = await taskCreateTool.execute(sampleTaskSpec, {
      projectRoot: '/tmp/lumenflow-mcp-runtime',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.TASK_CREATE_ERROR);
    expect(result.error?.message).toContain('task creation failed');
    expect(mockRunCliCommand).not.toHaveBeenCalled();
  });
});

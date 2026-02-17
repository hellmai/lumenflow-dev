import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as kernel from '@lumenflow/kernel';
import { getPublicManifest } from '../public-manifest.js';
import {
  parseTaskClaimDomainData,
  parseTaskBlockReason,
  parseTaskCompleteEvidenceRefs,
  parseTaskCreateSpec,
  runTaskBlock,
  runTaskClaim,
  runTaskComplete,
  runTaskCreate,
  runTaskInspect,
  runTaskUnblock,
} from '../task-claim.js';

vi.mock('@lumenflow/kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lumenflow/kernel')>();
  return {
    ...actual,
    initializeKernelRuntime: vi.fn(),
  };
});

const TASK_CLAIM_COMMAND_NAME = 'task:claim';
const TASK_CLAIM_BIN_NAME = 'task-claim';
const TASK_CLAIM_BIN_PATH = './dist/task-claim.js';

describe('task-claim command', () => {
  const mockInitializeKernelRuntime = vi.mocked(kernel.initializeKernelRuntime);
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
  });

  it('routes task claims through KernelRuntime.claimTask', async () => {
    const claimResult = {
      task_id: 'WU-1772',
      run: {
        run_id: 'run-WU-1772-1',
        task_id: 'WU-1772',
        status: 'executing',
        started_at: '2026-02-17T00:00:00.000Z',
        by: 'tom@hellm.ai',
        session_id: 'session-1772',
      },
      events: [
        {
          kind: 'task_claimed',
          task_id: 'WU-1772',
          run_id: 'run-WU-1772-1',
          timestamp: '2026-02-17T00:00:00.000Z',
          by: 'tom@hellm.ai',
          session_id: 'session-1772',
          domain_data: {},
        },
        {
          kind: 'run_started',
          task_id: 'WU-1772',
          run_id: 'run-WU-1772-1',
          timestamp: '2026-02-17T00:00:00.000Z',
          by: 'tom@hellm.ai',
          session_id: 'session-1772',
        },
      ],
      policy: {
        allowed: true,
        decisions: [],
      },
    };

    const claimTask = vi.fn().mockResolvedValue(claimResult);
    mockInitializeKernelRuntime.mockResolvedValue({ claimTask } as Awaited<
      ReturnType<typeof kernel.initializeKernelRuntime>
    >);

    const result = await runTaskClaim({
      input: {
        task_id: 'WU-1772',
        by: 'tom@hellm.ai',
        session_id: 'session-1772',
      },
      workspaceRoot: '/tmp/lumenflow-task-claim',
      json: true,
    });

    expect(mockInitializeKernelRuntime).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/lumenflow-task-claim',
    });
    expect(claimTask).toHaveBeenCalledWith({
      task_id: 'WU-1772',
      by: 'tom@hellm.ai',
      session_id: 'session-1772',
    });
    expect(result).toEqual(claimResult);
  });

  it('routes task creation through KernelRuntime.createTask', async () => {
    const createResult = {
      task: sampleTaskSpec,
      task_spec_path: '/tmp/lumenflow-task-claim/.lumenflow/kernel/tasks/WU-1785.yaml',
      event: {
        schema_version: 1,
        kind: 'task_created',
        task_id: 'WU-1785',
        timestamp: '2026-02-17T00:00:00.000Z',
        spec_hash: 'a'.repeat(64),
      },
    };

    const createTask = vi.fn().mockResolvedValue(createResult);
    mockInitializeKernelRuntime.mockResolvedValue({ createTask } as Awaited<
      ReturnType<typeof kernel.initializeKernelRuntime>
    >);

    const result = await runTaskCreate({
      input: sampleTaskSpec,
      workspaceRoot: '/tmp/lumenflow-task-claim',
      json: true,
    });

    expect(mockInitializeKernelRuntime).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/lumenflow-task-claim',
    });
    expect(createTask).toHaveBeenCalledWith(sampleTaskSpec);
    expect(result).toEqual(createResult);
  });

  it('routes task completion through KernelRuntime.completeTask', async () => {
    const completeResult = {
      task_id: 'WU-1785',
      run_id: 'run-WU-1785-1',
      events: [
        {
          schema_version: 1,
          kind: 'run_succeeded',
          task_id: 'WU-1785',
          run_id: 'run-WU-1785-1',
          timestamp: '2026-02-17T00:00:00.000Z',
          evidence_refs: ['receipt-1'],
        },
        {
          schema_version: 1,
          kind: 'task_completed',
          task_id: 'WU-1785',
          timestamp: '2026-02-17T00:00:00.000Z',
          evidence_refs: ['receipt-1'],
        },
      ],
      policy: {
        decision: 'allow',
        decisions: [],
      },
    };

    const completeTask = vi.fn().mockResolvedValue(completeResult);
    mockInitializeKernelRuntime.mockResolvedValue({ completeTask } as Awaited<
      ReturnType<typeof kernel.initializeKernelRuntime>
    >);

    const result = await runTaskComplete({
      input: {
        task_id: 'WU-1785',
        run_id: 'run-WU-1785-1',
        evidence_refs: ['receipt-1'],
      },
      workspaceRoot: '/tmp/lumenflow-task-claim',
      json: true,
    });

    expect(mockInitializeKernelRuntime).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/lumenflow-task-claim',
    });
    expect(completeTask).toHaveBeenCalledWith({
      task_id: 'WU-1785',
      run_id: 'run-WU-1785-1',
      evidence_refs: ['receipt-1'],
    });
    expect(result).toEqual(completeResult);
  });

  it('routes task block through KernelRuntime.blockTask', async () => {
    const blockResult = {
      task_id: 'WU-1787',
      event: {
        schema_version: 1,
        kind: 'task_blocked',
        task_id: 'WU-1787',
        timestamp: '2026-02-17T00:00:00.000Z',
        reason: 'waiting on dependency',
      },
    };

    const blockTask = vi.fn().mockResolvedValue(blockResult);
    mockInitializeKernelRuntime.mockResolvedValue({ blockTask } as Awaited<
      ReturnType<typeof kernel.initializeKernelRuntime>
    >);

    const result = await runTaskBlock({
      input: {
        task_id: 'WU-1787',
        reason: 'waiting on dependency',
      },
      workspaceRoot: '/tmp/lumenflow-task-claim',
      json: true,
    });

    expect(mockInitializeKernelRuntime).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/lumenflow-task-claim',
    });
    expect(blockTask).toHaveBeenCalledWith({
      task_id: 'WU-1787',
      reason: 'waiting on dependency',
    });
    expect(result).toEqual(blockResult);
  });

  it('routes task unblock through KernelRuntime.unblockTask', async () => {
    const unblockResult = {
      task_id: 'WU-1787',
      event: {
        schema_version: 1,
        kind: 'task_unblocked',
        task_id: 'WU-1787',
        timestamp: '2026-02-17T00:00:00.000Z',
      },
    };

    const unblockTask = vi.fn().mockResolvedValue(unblockResult);
    mockInitializeKernelRuntime.mockResolvedValue({ unblockTask } as Awaited<
      ReturnType<typeof kernel.initializeKernelRuntime>
    >);

    const result = await runTaskUnblock({
      input: {
        task_id: 'WU-1787',
      },
      workspaceRoot: '/tmp/lumenflow-task-claim',
      json: true,
    });

    expect(mockInitializeKernelRuntime).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/lumenflow-task-claim',
    });
    expect(unblockTask).toHaveBeenCalledWith({
      task_id: 'WU-1787',
    });
    expect(result).toEqual(unblockResult);
  });

  it('routes task inspect through KernelRuntime.inspectTask', async () => {
    const inspectResult = {
      task_id: 'WU-1788',
      task: sampleTaskSpec,
      state: {
        task_id: 'WU-1788',
        status: 'active',
        run_count: 1,
      },
      run_history: [],
      receipts: [],
      policy_decisions: [],
      events: [],
    };

    const inspectTask = vi.fn().mockResolvedValue(inspectResult);
    mockInitializeKernelRuntime.mockResolvedValue({ inspectTask } as Awaited<
      ReturnType<typeof kernel.initializeKernelRuntime>
    >);

    const result = await runTaskInspect({
      taskId: 'WU-1788',
      workspaceRoot: '/tmp/lumenflow-task-claim',
      json: true,
    });

    expect(mockInitializeKernelRuntime).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/lumenflow-task-claim',
    });
    expect(inspectTask).toHaveBeenCalledWith('WU-1788');
    expect(result).toEqual(inspectResult);
  });

  it('parses valid domain data JSON objects', () => {
    expect(parseTaskClaimDomainData('{"owner":"hellmai"}')).toEqual({ owner: 'hellmai' });
  });

  it('returns undefined when domain data is omitted', () => {
    expect(parseTaskClaimDomainData()).toBeUndefined();
  });

  it('parses valid task spec JSON payloads', () => {
    expect(parseTaskCreateSpec(JSON.stringify(sampleTaskSpec))).toEqual(sampleTaskSpec);
  });

  it('throws for invalid task spec payloads', () => {
    expect(() => parseTaskCreateSpec('{"id":"WU-1785"}')).toThrow();
  });

  it('parses valid evidence refs payloads', () => {
    expect(parseTaskCompleteEvidenceRefs('["receipt-1","receipt-2"]')).toEqual([
      'receipt-1',
      'receipt-2',
    ]);
  });

  it('parses valid task block reasons', () => {
    expect(parseTaskBlockReason('waiting on dependency')).toBe('waiting on dependency');
  });

  it('returns undefined when evidence refs are omitted', () => {
    expect(parseTaskCompleteEvidenceRefs()).toBeUndefined();
  });

  it('throws for invalid evidence refs payloads', () => {
    expect(() => parseTaskCompleteEvidenceRefs('{"receipt":"receipt-1"}')).toThrow();
  });

  it('throws for invalid task block reason values', () => {
    expect(() => parseTaskBlockReason('')).toThrow();
  });

  it('throws for non-object domain data JSON', () => {
    expect(() => parseTaskClaimDomainData('[]')).toThrow();
  });
});

describe('task-claim registration wiring', () => {
  it('registers task:claim in the public manifest', () => {
    const manifest = getPublicManifest();
    const taskClaimEntry = manifest.find((entry) => entry.name === TASK_CLAIM_COMMAND_NAME);

    expect(taskClaimEntry).toBeDefined();
    expect(taskClaimEntry?.binName).toBe(TASK_CLAIM_BIN_NAME);
    expect(taskClaimEntry?.binPath).toBe(TASK_CLAIM_BIN_PATH);
  });

  it('registers task-claim binary in package.json', () => {
    const packageJsonPath = resolve(import.meta.dirname, '../../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, { encoding: 'utf8' })) as {
      bin?: Record<string, string>;
    };

    expect(packageJson.bin?.[TASK_CLAIM_BIN_NAME]).toBe(TASK_CLAIM_BIN_PATH);
  });
});

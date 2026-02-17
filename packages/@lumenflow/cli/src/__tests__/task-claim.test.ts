import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as kernel from '@lumenflow/kernel';
import { getPublicManifest } from '../public-manifest.js';
import { parseTaskClaimDomainData, runTaskClaim } from '../task-claim.js';

vi.mock('@lumenflow/kernel', () => ({
  initializeKernelRuntime: vi.fn(),
}));

const TASK_CLAIM_COMMAND_NAME = 'task:claim';
const TASK_CLAIM_BIN_NAME = 'task-claim';
const TASK_CLAIM_BIN_PATH = './dist/task-claim.js';

describe('task-claim command', () => {
  const mockInitializeKernelRuntime = vi.mocked(kernel.initializeKernelRuntime);

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

  it('parses valid domain data JSON objects', () => {
    expect(parseTaskClaimDomainData('{"owner":"hellmai"}')).toEqual({ owner: 'hellmai' });
  });

  it('returns undefined when domain data is omitted', () => {
    expect(parseTaskClaimDomainData()).toBeUndefined();
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

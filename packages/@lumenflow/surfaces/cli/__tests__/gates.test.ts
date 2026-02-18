// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import type { KernelRuntime } from '@lumenflow/kernel';
import { createGateCommands, createOrchestrationCommands } from '../gates.js';

describe('surfaces/cli gates + orchestration commands', () => {
  it('runs gate policies through runtime policy engine', async () => {
    const evaluate = vi.fn(async () => ({
      decision: 'allow' as const,
      decisions: [
        {
          policy_id: 'software-delivery.gate.format',
          decision: 'allow' as const,
          reason: 'format gate passed',
        },
      ],
      warnings: [],
    }));

    const runtime = {
      getPolicyEngine: () => ({ evaluate }),
      getToolHost: vi.fn(),
      createTask: vi.fn(),
      claimTask: vi.fn(),
      completeTask: vi.fn(),
      inspectTask: vi.fn(),
      executeTool: vi.fn(),
    } as unknown as KernelRuntime;

    const commands = createGateCommands(runtime);
    const result = await commands['gates:run']({
      task_id: 'WU-1737-gates',
      run_id: 'run-1737-gates',
      lane_id: 'framework-cli-orchestration',
      pack_id: 'software-delivery',
    });

    expect(evaluate).toHaveBeenCalledWith({
      trigger: 'on_completion',
      task_id: 'WU-1737-gates',
      run_id: 'run-1737-gates',
      lane_id: 'framework-cli-orchestration',
      pack_id: 'software-delivery',
    });
    expect(result.decision).toBe('allow');
    expect(result.decisions[0]?.policy_id).toBe('software-delivery.gate.format');
  });

  it('routes orchestration monitor/init-status through runtime.inspectTask', async () => {
    const inspectTask = vi.fn(async () => ({
      task_id: 'WU-1737-orchestration',
      task: {
        id: 'WU-1737-orchestration',
        workspace_id: 'workspace',
        lane_id: 'lane',
        domain: 'software-delivery',
        title: 'WU-1737',
        description: 'orchestration test',
        acceptance: ['ok'],
        declared_scopes: [],
        risk: 'low' as const,
        type: 'feature',
        priority: 'P1' as const,
        created: '2026-02-16',
      },
      state: {
        task_id: 'WU-1737-orchestration',
        status: 'active' as const,
        run_count: 1,
      },
      run_history: [],
      receipts: [],
      policy_decisions: [],
      events: [],
    }));

    const runtime = {
      inspectTask,
      getPolicyEngine: vi.fn(),
      getToolHost: vi.fn(),
      createTask: vi.fn(),
      claimTask: vi.fn(),
      completeTask: vi.fn(),
      executeTool: vi.fn(),
    } as unknown as KernelRuntime;

    const commands = createOrchestrationCommands(runtime);
    await commands['orchestration:init-status']('WU-1737-orchestration');
    await commands['orchestration:monitor']('WU-1737-orchestration');

    expect(inspectTask).toHaveBeenCalledTimes(2);
    expect(inspectTask).toHaveBeenNthCalledWith(1, 'WU-1737-orchestration');
    expect(inspectTask).toHaveBeenNthCalledWith(2, 'WU-1737-orchestration');
  });
});

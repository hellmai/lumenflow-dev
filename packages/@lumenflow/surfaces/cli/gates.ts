// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import {
  POLICY_TRIGGERS,
  type KernelRuntime,
  type PolicyEvaluationResult,
  type TaskInspection,
} from '@lumenflow/kernel';

export interface GateRunInput {
  task_id: string;
  run_id: string;
  lane_id?: string;
  pack_id?: string;
}

export interface GateCommands {
  'gates:run': (input: GateRunInput) => Promise<PolicyEvaluationResult>;
}

export interface OrchestrationCommands {
  'orchestration:init-status': (taskId: string) => Promise<TaskInspection>;
  'orchestration:monitor': (taskId: string) => Promise<TaskInspection>;
}

export function createGateCommands(runtime: KernelRuntime): GateCommands {
  return {
    'gates:run': async (input) => {
      return runtime.getPolicyEngine().evaluate({
        trigger: POLICY_TRIGGERS.ON_COMPLETION,
        task_id: input.task_id,
        run_id: input.run_id,
        lane_id: input.lane_id,
        pack_id: input.pack_id,
      });
    },
  };
}

export function createOrchestrationCommands(runtime: KernelRuntime): OrchestrationCommands {
  return {
    'orchestration:init-status': async (taskId) => runtime.inspectTask(taskId),
    'orchestration:monitor': async (taskId) => runtime.inspectTask(taskId),
  };
}

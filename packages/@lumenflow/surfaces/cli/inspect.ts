// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { readFile } from 'node:fs/promises';
import type {
  KernelRuntime,
  TaskInspection,
  TaskInspection as KernelTaskInspection,
  ToolOutput,
} from '@lumenflow/kernel';

export interface InspectView extends KernelTaskInspection {
  evidence: string[];
}

export interface InspectCommands {
  'task:inspect': (taskId: string) => Promise<InspectView>;
}

export interface ReplayRunInput {
  task_id: string;
  run_id: string;
  session_id: string;
}

export interface ReplayOutput {
  receipt_id: string;
  tool_name: string;
  output: ToolOutput;
}

export interface ReplayRunResult {
  task_id: string;
  run_id: string;
  replay_run_id: string;
  outputs: ReplayOutput[];
}

export interface ReplayCommands {
  'task:replay': (input: ReplayRunInput) => Promise<ReplayRunResult>;
}

function collectEvidence(inspection: TaskInspection): string[] {
  const evidence = new Set<string>();

  for (const event of inspection.events) {
    if (!('evidence_refs' in event)) {
      continue;
    }
    const refs = event.evidence_refs;
    if (!Array.isArray(refs)) {
      continue;
    }
    for (const ref of refs) {
      evidence.add(ref);
    }
  }

  for (const receipt of inspection.receipts) {
    if (receipt.kind === 'tool_call_started') {
      evidence.add(receipt.input_ref);
      continue;
    }
    if (receipt.output_ref) {
      evidence.add(receipt.output_ref);
    }
  }

  return [...evidence];
}

export function createInspectCommands(runtime: KernelRuntime): InspectCommands {
  return {
    'task:inspect': async (taskId) => {
      const inspection = await runtime.inspectTask(taskId);
      return {
        ...inspection,
        evidence: collectEvidence(inspection),
      };
    },
  };
}

async function loadReplayInput(inputRef: string): Promise<unknown> {
  const payload = await readFile(inputRef, 'utf8');
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return payload;
  }
}

export function createReplayCommands(runtime: KernelRuntime): ReplayCommands {
  return {
    'task:replay': async (input) => {
      const inspection = await runtime.inspectTask(input.task_id);
      const replayRunId = `${input.run_id}:replay`;
      const replayOutputs: ReplayOutput[] = [];

      const startedReceipts = inspection.receipts.filter((receipt) => {
        return receipt.kind === 'tool_call_started' && receipt.run_id === input.run_id;
      });

      for (const receipt of startedReceipts) {
        const replayInput = await loadReplayInput(receipt.input_ref);
        const output = await runtime.executeTool(receipt.tool_name, replayInput, {
          run_id: replayRunId,
          task_id: input.task_id,
          session_id: input.session_id,
          allowed_scopes: receipt.scope_enforced,
          metadata: {
            workspace_allowed_scopes: receipt.scope_enforced,
            lane_allowed_scopes: receipt.scope_enforced,
            task_declared_scopes: receipt.scope_enforced,
            workspace_config_hash: receipt.workspace_config_hash,
            runtime_version: receipt.runtime_version,
            pack_id: receipt.pack_id,
            pack_version: receipt.pack_version,
            pack_integrity: receipt.pack_integrity,
          },
        });

        replayOutputs.push({
          receipt_id: receipt.receipt_id,
          tool_name: receipt.tool_name,
          output,
        });
      }

      return {
        task_id: input.task_id,
        run_id: input.run_id,
        replay_run_id: replayRunId,
        outputs: replayOutputs,
      };
    },
  };
}

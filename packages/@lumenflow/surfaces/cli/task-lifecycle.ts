// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import {
  initializeKernelRuntime,
  type ClaimTaskInput,
  type ClaimTaskResult,
  type CompleteTaskInput,
  type CompleteTaskResult,
  type CreateTaskResult,
  type InitializeKernelRuntimeOptions,
  type KernelRuntime,
  type TaskSpec,
  type TaskInspection,
} from '@lumenflow/kernel';

export interface TaskLifecycleCommands {
  'task:create': (taskSpec: TaskSpec) => Promise<CreateTaskResult>;
  'task:claim': (input: ClaimTaskInput) => Promise<ClaimTaskResult>;
  'task:status': (taskId: string) => Promise<TaskInspection>;
  'task:complete': (input: CompleteTaskInput) => Promise<CompleteTaskResult>;
}

export interface InitializedTaskLifecycleCommands {
  runtime: KernelRuntime;
  commands: TaskLifecycleCommands;
}

export function createTaskLifecycleCommands(runtime: KernelRuntime): TaskLifecycleCommands {
  return {
    'task:create': async (taskSpec) => runtime.createTask(taskSpec),
    'task:claim': async (input) => runtime.claimTask(input),
    'task:status': async (taskId) => runtime.inspectTask(taskId),
    'task:complete': async (input) => runtime.completeTask(input),
  };
}

export async function initializeTaskLifecycleCommands(
  options: InitializeKernelRuntimeOptions,
): Promise<InitializedTaskLifecycleCommands> {
  const runtime = await initializeKernelRuntime(options);
  return {
    runtime,
    commands: createTaskLifecycleCommands(runtime),
  };
}

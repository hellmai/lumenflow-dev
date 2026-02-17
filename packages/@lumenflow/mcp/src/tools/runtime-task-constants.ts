export const RuntimeTaskToolNames = {
  TASK_CLAIM: 'task_claim',
  TASK_CREATE: 'task_create',
  TASK_COMPLETE: 'task_complete',
  TASK_BLOCK: 'task_block',
  TASK_UNBLOCK: 'task_unblock',
  TASK_INSPECT: 'task_inspect',
  TOOL_EXECUTE: 'tool_execute',
} as const;

export const RuntimeTaskToolDescriptions = {
  TASK_CLAIM: 'Claim a task directly through KernelRuntime (no CLI shell-out).',
  TASK_CREATE: 'Create a task directly through KernelRuntime (no CLI shell-out).',
  TASK_COMPLETE: 'Complete a task directly through KernelRuntime (no CLI shell-out).',
  TASK_BLOCK: 'Block a task directly through KernelRuntime (no CLI shell-out).',
  TASK_UNBLOCK: 'Unblock a task directly through KernelRuntime (no CLI shell-out).',
  TASK_INSPECT: 'Inspect a task directly through KernelRuntime (no CLI shell-out).',
  TOOL_EXECUTE: 'Execute a tool directly through KernelRuntime (no CLI shell-out).',
} as const;

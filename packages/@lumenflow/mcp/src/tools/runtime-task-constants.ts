export const RuntimeTaskToolNames = {
  TASK_CLAIM: 'task_claim',
  TASK_CREATE: 'task_create',
  TASK_COMPLETE: 'task_complete',
} as const;

export const RuntimeTaskToolDescriptions = {
  TASK_CLAIM: 'Claim a task directly through KernelRuntime (no CLI shell-out).',
  TASK_CREATE: 'Create a task directly through KernelRuntime (no CLI shell-out).',
  TASK_COMPLETE: 'Complete a task directly through KernelRuntime (no CLI shell-out).',
} as const;

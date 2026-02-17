export const KERNEL_EVENT_KINDS = {
  TASK_CREATED: 'task_created',
  TASK_CLAIMED: 'task_claimed',
  TASK_BLOCKED: 'task_blocked',
  TASK_UNBLOCKED: 'task_unblocked',
  TASK_WAITING: 'task_waiting',
  TASK_RESUMED: 'task_resumed',
  TASK_COMPLETED: 'task_completed',
  TASK_RELEASED: 'task_released',
  TASK_DELEGATED: 'task_delegated',
  RUN_STARTED: 'run_started',
  RUN_PAUSED: 'run_paused',
  RUN_FAILED: 'run_failed',
  RUN_SUCCEEDED: 'run_succeeded',
  WORKSPACE_UPDATED: 'workspace_updated',
  WORKSPACE_WARNING: 'workspace_warning',
  SPEC_TAMPERED: 'spec_tampered',
  CHECKPOINT: 'checkpoint',
} as const;

export type KernelEventKind = (typeof KERNEL_EVENT_KINDS)[keyof typeof KERNEL_EVENT_KINDS];

export const TASK_EVENT_KINDS = [
  KERNEL_EVENT_KINDS.TASK_CREATED,
  KERNEL_EVENT_KINDS.TASK_CLAIMED,
  KERNEL_EVENT_KINDS.TASK_BLOCKED,
  KERNEL_EVENT_KINDS.TASK_UNBLOCKED,
  KERNEL_EVENT_KINDS.TASK_WAITING,
  KERNEL_EVENT_KINDS.TASK_RESUMED,
  KERNEL_EVENT_KINDS.TASK_COMPLETED,
  KERNEL_EVENT_KINDS.TASK_RELEASED,
  KERNEL_EVENT_KINDS.TASK_DELEGATED,
] as const;

export type TaskEventKind = (typeof TASK_EVENT_KINDS)[number];

export const RUN_LIFECYCLE_EVENT_KINDS = [
  KERNEL_EVENT_KINDS.RUN_STARTED,
  KERNEL_EVENT_KINDS.RUN_PAUSED,
  KERNEL_EVENT_KINDS.RUN_FAILED,
  KERNEL_EVENT_KINDS.RUN_SUCCEEDED,
] as const;

export type RunLifecycleEventKind = (typeof RUN_LIFECYCLE_EVENT_KINDS)[number];

const TASK_EVENT_KIND_SET = new Set<string>(TASK_EVENT_KINDS);
const RUN_LIFECYCLE_EVENT_KIND_SET = new Set<string>(RUN_LIFECYCLE_EVENT_KINDS);

export function isTaskEventKind(kind: string): kind is TaskEventKind {
  return TASK_EVENT_KIND_SET.has(kind);
}

export function isRunLifecycleEventKind(kind: string): kind is RunLifecycleEventKind {
  return RUN_LIFECYCLE_EVENT_KIND_SET.has(kind);
}

export const TOOL_TRACE_KINDS = {
  TOOL_CALL_STARTED: 'tool_call_started',
  TOOL_CALL_FINISHED: 'tool_call_finished',
} as const;

export type ToolTraceKind = (typeof TOOL_TRACE_KINDS)[keyof typeof TOOL_TRACE_KINDS];

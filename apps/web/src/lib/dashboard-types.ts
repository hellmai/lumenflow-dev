/**
 * Shared types for the live task dashboard.
 *
 * These types mirror the kernel event shapes but are decoupled from the
 * server-side kernel module so they can be used in client components.
 */

/** Canonical task lifecycle states from the kernel state machine. */
export const TASK_STATES = {
  READY: 'ready',
  ACTIVE: 'active',
  BLOCKED: 'blocked',
  WAITING: 'waiting',
  DONE: 'done',
} as const;

export type TaskStatus = (typeof TASK_STATES)[keyof typeof TASK_STATES];

/** All possible task states as an ordered array for visualization. */
export const TASK_STATE_ORDER: readonly TaskStatus[] = [
  TASK_STATES.READY,
  TASK_STATES.ACTIVE,
  TASK_STATES.BLOCKED,
  TASK_STATES.WAITING,
  TASK_STATES.DONE,
];

/** SSE connection states. */
export const SSE_CONNECTION_STATES = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
} as const;

export type SseConnectionState = (typeof SSE_CONNECTION_STATES)[keyof typeof SSE_CONNECTION_STATES];

/** A parsed SSE event from the /api/events/:taskId stream. */
export interface DashboardEvent {
  readonly id: string;
  readonly kind: string;
  readonly timestamp: string;
  readonly taskId: string;
  readonly data: Record<string, unknown>;
}

export const POLICY_DECISIONS = {
  ALLOW: 'allow',
  DENY: 'deny',
  APPROVAL_REQUIRED: 'approval_required',
} as const;

export type PolicyDecisionType = (typeof POLICY_DECISIONS)[keyof typeof POLICY_DECISIONS];

/** Policy decision as rendered in tool receipts. */
export interface PolicyDecisionView {
  readonly policyId: string;
  readonly decision: PolicyDecisionType;
  readonly reason?: string;
}

/** Scope entry for tool execution receipts. */
export interface ScopeView {
  readonly type: string;
  readonly pattern?: string;
  readonly access?: string;
  readonly posture?: string;
}

/** A tool execution receipt pair (started + finished). */
export interface ToolReceiptView {
  readonly receiptId: string;
  readonly toolName: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
  readonly result?: 'success' | 'failure' | 'denied' | 'crashed';
  readonly scopeRequested: readonly ScopeView[];
  readonly scopeAllowed: readonly ScopeView[];
  readonly policyDecisions: readonly PolicyDecisionView[];
}

export const APPROVAL_STATUSES = {
  PENDING: 'pending',
  APPROVED: 'approved',
  DENIED: 'denied',
} as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[keyof typeof APPROVAL_STATUSES];

export interface ApprovalRequestView {
  readonly receiptId: string;
  readonly toolName: string;
  readonly policyId: string;
  readonly reason?: string;
  readonly scopeRequested: readonly ScopeView[];
  readonly scopeAllowed: readonly ScopeView[];
  readonly status: ApprovalStatus;
  readonly decidedAt?: string;
}

/** An evidence chain link referencing a receipt or event. */
export interface EvidenceLink {
  readonly id: string;
  readonly type: 'receipt' | 'event';
  readonly label: string;
  readonly timestamp: string;
  readonly ref?: string;
}

/** Top-level dashboard state. */
export interface DashboardState {
  readonly taskId: string;
  readonly connectionState: SseConnectionState;
  readonly currentStatus: TaskStatus;
  readonly events: readonly DashboardEvent[];
  readonly toolReceipts: readonly ToolReceiptView[];
  readonly approvalRequests: readonly ApprovalRequestView[];
  readonly evidenceLinks: readonly EvidenceLink[];
}

export const INITIAL_DASHBOARD_STATE: Omit<DashboardState, 'taskId'> = {
  connectionState: SSE_CONNECTION_STATES.CONNECTING,
  currentStatus: TASK_STATES.READY,
  events: [],
  toolReceipts: [],
  approvalRequests: [],
  evidenceLinks: [],
};

// --- Policy Decision Overlay Types (WU-1834) ---

/** Status of an action diff entry: whether it was denied, allowed, or narrowed. */
export type ActionDiffStatus = 'denied' | 'allowed' | 'narrowed';

/** A single entry in the action diff showing attempted vs permitted values. */
export interface ActionDiffEntry {
  readonly field: string;
  readonly attempted: string;
  readonly permitted: string | null;
  readonly status: ActionDiffStatus;
}

/** Three-column scope intersection: what was requested, allowed, and enforced. */
export interface ScopeIntersectionView {
  readonly requested: readonly ScopeView[];
  readonly allowed: readonly ScopeView[];
  readonly enforced: readonly ScopeView[];
}

/** Complete denial view for the policy decision overlay. */
export interface PolicyDenialView {
  readonly receiptId: string;
  readonly toolName: string;
  readonly policyId: string;
  readonly reason: string;
  readonly timestamp: string;
  readonly scopeIntersection: ScopeIntersectionView;
  readonly actionDiff: readonly ActionDiffEntry[];
}

/** Map from kernel event kind to task state for state-machine transitions. */
export const EVENT_KIND_TO_STATE = new Map<string, TaskStatus>([
  ['task_created', TASK_STATES.READY],
  ['task_claimed', TASK_STATES.ACTIVE],
  ['task_blocked', TASK_STATES.BLOCKED],
  ['task_unblocked', TASK_STATES.ACTIVE],
  ['task_waiting', TASK_STATES.WAITING],
  ['task_resumed', TASK_STATES.ACTIVE],
  ['task_completed', TASK_STATES.DONE],
  ['task_released', TASK_STATES.READY],
]);

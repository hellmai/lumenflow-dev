/**
 * Orchestration Domain Schemas
 *
 * Zod schemas for runtime validation of orchestration domain types.
 * Single source of truth - types are inferred from these schemas.
 *
 * @module orchestration.schemas
 * @see {@link ./orchestration.types.mjs} - Types inferred from these schemas
 * @see {@link ./orchestration.constants.mjs} - Constants used in validation
 */

import { z } from 'zod';
import {
  LANES,
  AGENT_NAMES,
  SEVERITY_LEVELS,
  AGENT_RESULT_STATUSES,
  TIMELINE_EVENT_TYPES,
  EVENT_SEVERITY_LEVELS,
  USER_CHOICE_OPTIONS,
  DOD_TOTAL,
} from './orchestration.constants.js';

/**
 * Schema for the longest running WU information.
 */
const LongestRunningSchema = z.object({
  wuId: z.string().min(1),
  lane: z.enum(LANES),
  durationMs: z.number().nonnegative(),
});

/**
 * Schema for pending mandatory agent information.
 */
const PendingMandatorySchema = z.object({
  wuId: z.string().min(1),
  agent: z.enum(AGENT_NAMES),
});

/**
 * Schema for active agent session (WU-1438).
 */
const ActiveSessionSchema = z.object({
  sessionId: z.string().uuid(),
  wuId: z.string().min(1),
  started: z.string().datetime(),
  contextTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  incidentsLogged: z.number().int().nonnegative(),
});

/**
 * Schema for worktree with uncommitted changes (WU-1748).
 * Used for cross-agent visibility of abandoned WU work.
 */
const WorktreeWithUncommittedChangesSchema = z.object({
  /** WU ID extracted from worktree branch name */
  wuId: z.string().min(1),
  /** Worktree directory path */
  worktreePath: z.string().min(1),
  /** Number of uncommitted files */
  uncommittedFileCount: z.number().int().nonnegative(),
  /** Last git activity timestamp (ISO 8601) */
  lastActivityTimestamp: z.string(),
});

/**
 * Schema for global orchestration status.
 * Shows high-level dashboard metrics at a glance.
 */
export const GlobalStatusSchema = z.object({
  /** Number of WUs currently in progress */
  activeWUs: z.number().int().nonnegative(),
  /** Number of WUs completed in the last 24 hours */
  completed24h: z.number().int().nonnegative(),
  /** Number of currently blocked WUs */
  blocked: z.number().int().nonnegative(),
  /** Number of WUs with failing gates */
  gatesFailing: z.number().int().nonnegative(),
  /** Information about the longest running WU, or null if none active */
  longestRunning: LongestRunningSchema.nullable(),
  /** List of WUs with pending mandatory agents */
  pendingMandatory: z.array(PendingMandatorySchema),
  /** Current active agent session, or null if none (WU-1438) */
  activeSession: ActiveSessionSchema.nullable(),
  /** Worktrees with uncommitted changes for cross-agent visibility (WU-1748) */
  worktreesWithUncommittedChanges: z.array(WorktreeWithUncommittedChangesSchema),
});

/**
 * Schema for last run information within agent metrics.
 */
const LastRunSchema = z.object({
  wuId: z.string().min(1),
  timestamp: z.string().datetime(),
  result: z.enum(['pass', 'fail']),
});

/**
 * Schema for per-agent metrics.
 * Tracks invocation counts, pass rates, and timing.
 */
export const AgentMetricSchema = z.object({
  /** Total number of times this agent has been invoked */
  invoked: z.number().int().nonnegative(),
  /** Pass rate as percentage (0-100) */
  passRate: z.number().min(0).max(100),
  /** Average duration in milliseconds */
  avgDurationMs: z.number().nonnegative(),
  /** Information about the most recent run, or null if never run */
  lastRun: LastRunSchema.nullable(),
});

/**
 * Schema for WU progress tracking.
 * Shows DoD progress and agent status per WU.
 */
export const WUProgressSchema = z.object({
  /** Work Unit ID (e.g., "WU-1234") */
  wuId: z.string().min(1),
  /** Lane the WU is assigned to */
  lane: z.enum(LANES),
  /** Human-readable title of the WU */
  title: z.string().min(1),
  /** Current DoD checkpoint progress (0 to DOD_TOTAL) */
  dodProgress: z.number().int().min(0).max(DOD_TOTAL),
  /** Total DoD checkpoints (always DOD_TOTAL) */
  dodTotal: z.literal(DOD_TOTAL),
  /** Status of each agent that has been or should be run */
  agents: z.record(z.string(), z.enum(AGENT_RESULT_STATUSES)),
  /** Tufte-style headline sentence describing current state */
  headline: z.string(),
});

/**
 * Schema for timeline events.
 * Records orchestration history for dashboard display.
 */
export const TimelineEventSchema = z.object({
  /** ISO 8601 timestamp of the event */
  timestamp: z.string().datetime(),
  /** Type of orchestration event */
  event: z.enum(TIMELINE_EVENT_TYPES),
  /** Associated Work Unit ID */
  wuId: z.string().min(1),
  /** Human-readable event description */
  detail: z.string(),
  /** Visual severity for display */
  severity: z.enum(EVENT_SEVERITY_LEVELS),
});

/**
 * Schema for dashboard alerts.
 * Highlights items requiring attention.
 */
export const AlertSchema = z.object({
  /** Alert severity level */
  severity: z.enum(SEVERITY_LEVELS),
  /** Human-readable alert message */
  message: z.string().min(1),
  /** Associated Work Unit ID */
  wuId: z.string().min(1),
  /** Suggested action or command */
  action: z.string().min(1),
});

/**
 * Schema for orchestration suggestions.
 * Recommendations for next actions.
 */
export const SuggestionSchema = z.object({
  /** Unique suggestion identifier */
  id: z.string().min(1),
  /** Suggestion priority level */
  priority: z.enum(SEVERITY_LEVELS),
  /** Short action description */
  action: z.string().min(1),
  /** Reason for the suggestion */
  reason: z.string().min(1),
  /** CLI command to execute the suggestion */
  command: z.string().min(1),
});

/**
 * Schema for execution plan steps.
 */
const ExecutionStepSchema = z.object({
  /** Execution order (1-based) */
  order: z.number().int().positive(),
  /** Agent to run (if applicable) */
  agent: z.string().optional(),
  /** Action to perform (if not an agent) */
  action: z.string().optional(),
  /** Step execution status */
  status: z.enum(AGENT_RESULT_STATUSES),
});

/**
 * Schema for execution plans.
 * Proposed sequence of orchestration actions.
 */
export const ExecutionPlanSchema = z.object({
  /** Work Unit ID this plan is for */
  wuId: z.string().min(1),
  /** Ordered list of steps to execute */
  steps: z.array(ExecutionStepSchema),
  /** Estimated token cost for the full plan */
  estimatedTokens: z.number().int().nonnegative(),
});

/**
 * Schema for user choices on execution plans.
 */
export const UserChoiceSchema = z.object({
  /** User's choice */
  choice: z.enum(USER_CHOICE_OPTIONS),
  /** Modifications if choice is 'edit' */
  modifications: z.array(z.string()).optional(),
});

/**
 * Schema for complete dashboard data.
 * Aggregates all data needed for dashboard rendering.
 */
export const DashboardDataSchema = z.object({
  /** Global status metrics */
  globalStatus: GlobalStatusSchema,
  /** Per-agent metrics keyed by agent name */
  agentMetrics: z.record(z.string(), AgentMetricSchema),
  /** Progress for all active WUs */
  wuProgress: z.array(WUProgressSchema),
  /** Recent timeline events */
  timeline: z.array(TimelineEventSchema),
  /** Current alerts */
  alerts: z.array(AlertSchema),
});

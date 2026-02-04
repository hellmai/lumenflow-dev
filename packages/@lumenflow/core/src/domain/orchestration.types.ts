/**
 * Orchestration Domain Types
 *
 * TypeScript types inferred from Zod schemas.
 * Single source of truth - schemas validate at runtime, types at compile time.
 *
 * @module orchestration.types
 * @see {@link ./orchestration.schemas.ts} - Schemas these types are inferred from
 * @see {@link ./orchestration.constants.ts} - Constants and derived types
 */

import type { z } from 'zod';
import type {
  GlobalStatusSchema,
  AgentMetricSchema,
  WUProgressSchema,
  TimelineEventSchema,
  AlertSchema,
  SuggestionSchema,
  ExecutionPlanSchema,
  UserChoiceSchema,
  DashboardDataSchema,
} from './orchestration.schemas.js';

// Re-export constant-derived types for convenience
export type {
  Lane,
  AgentName,
  SeverityLevel,
  AgentResultStatus,
  TimelineEventType,
  EventSeverityLevel,
  UserChoiceOption,
  MandatoryAgentName,
} from './orchestration.constants.js';

// Re-export const values as well
export {
  LANES,
  AGENT_NAMES,
  SEVERITY_LEVELS,
  AGENT_RESULT_STATUSES,
  TIMELINE_EVENT_TYPES,
  EVENT_SEVERITY_LEVELS,
  USER_CHOICE_OPTIONS,
  MANDATORY_AGENT_NAMES,
} from './orchestration.constants.js';

/**
 * Global orchestration status.
 * Shows high-level dashboard metrics at a glance.
 *
 * @example
 * const status: GlobalStatus = {
 *   activeWUs: 2,
 *   completed24h: 5,
 *   blocked: 1,
 *   gatesFailing: 0,
 *   longestRunning: { wuId: 'WU-1234', lane: 'Intelligence', durationMs: 2700000 },
 *   pendingMandatory: [{ wuId: 'WU-1235', agent: 'security-auditor' }],
 * };
 */
export type GlobalStatus = z.infer<typeof GlobalStatusSchema>;

/**
 * Per-agent metrics for dashboard display.
 * Tracks invocation counts, pass rates, and timing.
 *
 * @example
 * const metric: AgentMetric = {
 *   invoked: 3,
 *   passRate: 100,
 *   avgDurationMs: 120000,
 *   lastRun: { wuId: 'WU-1234', timestamp: '2025-01-15T10:00:00Z', result: 'pass' },
 * };
 */
export type AgentMetric = z.infer<typeof AgentMetricSchema>;

/**
 * Work Unit progress for dashboard display.
 * Shows DoD progress and agent status per WU.
 *
 * @example
 * const progress: WUProgress = {
 *   wuId: 'WU-1234',
 *   lane: 'Intelligence',
 *   title: 'LLM Classification Feature',
 *   dodProgress: 8,
 *   dodTotal: 11,
 *   agents: { 'llm-reviewer': 'pass', 'code-reviewer': 'pending' },
 *   headline: 'Blocked on code-reviewer - awaiting approval',
 * };
 */
export type WUProgress = z.infer<typeof WUProgressSchema>;

/**
 * Timeline event for orchestration history.
 * Records key events for dashboard display.
 *
 * @example
 * const event: TimelineEvent = {
 *   timestamp: '2025-01-15T09:00:00Z',
 *   event: 'claim',
 *   wuId: 'WU-1234',
 *   detail: 'Claimed for Intelligence lane',
 *   severity: 'info',
 * };
 */
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

/**
 * Dashboard alert for items requiring attention.
 *
 * @example
 * const alert: Alert = {
 *   severity: 'high',
 *   message: 'Mandatory agent not yet invoked',
 *   wuId: 'WU-1235',
 *   action: 'Run security-auditor before wu:done',
 * };
 */
export type Alert = z.infer<typeof AlertSchema>;

/**
 * Orchestration suggestion for next actions.
 *
 * @example
 * const suggestion: Suggestion = {
 *   id: 'sug-001',
 *   priority: 'high',
 *   action: 'Run security-auditor',
 *   reason: 'WU touches auth paths',
 *   command: 'pnpm orchestrate:run security-auditor',
 * };
 */
export type Suggestion = z.infer<typeof SuggestionSchema>;

/**
 * Execution plan for proposed orchestration actions.
 *
 * @example
 * const plan: ExecutionPlan = {
 *   wuId: 'WU-1234',
 *   steps: [
 *     { order: 1, agent: 'llm-reviewer', status: 'pending' },
 *     { order: 2, action: 'gates', status: 'pending' },
 *   ],
 *   estimatedTokens: 5000,
 * };
 */
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

/**
 * User choice on execution plan confirmation.
 *
 * @example
 * const choice: UserChoice = { choice: 'approve' };
 * const editChoice: UserChoice = { choice: 'edit', modifications: ['Skip step 2'] };
 */
export type UserChoice = z.infer<typeof UserChoiceSchema>;

/**
 * Complete dashboard data aggregating all metrics.
 * This is the main data structure passed to renderers.
 *
 * @example
 * const data: DashboardData = {
 *   globalStatus: { ... },
 *   agentMetrics: { 'security-auditor': { ... } },
 *   wuProgress: [{ ... }],
 *   timeline: [{ ... }],
 *   alerts: [{ ... }],
 * };
 */
export type DashboardData = z.infer<typeof DashboardDataSchema>;

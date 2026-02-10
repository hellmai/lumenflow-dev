/**
 * Orchestration Domain Constants
 *
 * Centralised constants for the agent orchestration dashboard.
 * Avoids magic numbers and hardcoded strings throughout the orchestration layer.
 *
 * @module orchestration.constants
 * @see {@link ../ports/dashboard-renderer.port.ts} - Uses these constants
 * @see {@link ../ports/metrics-collector.port.ts} - Uses these constants
 */

import { DIRECTORIES, LUMENFLOW_PATHS } from '../wu-constants.js';

/**
 * Total number of Definition of Done checkpoints.
 * Used by dashboard to show DoD progress (X/11).
 */
export const DOD_TOTAL = 11;

/**
 * Valid lane names in the LumenFlow system.
 * Used for type-safe lane validation.
 *
 * Note: This should match the lanes defined in .lumenflow.config.yaml.
 * These are LumenFlow framework lanes, not application-specific lanes.
 */
export const LANES = [
  'Framework: Core',
  'Framework: CLI',
  'Framework: Memory',
  'Framework: Agent',
  'Framework: Metrics',
  'Framework: Initiatives',
  'Framework: Shims',
  'Operations: Infrastructure',
  'Operations: CI/CD',
  'Content: Documentation',
] as const;

/** Type for valid lane names */
export type Lane = (typeof LANES)[number];

/**
 * Known agent names in the orchestration system.
 * Includes both mandatory (Tier 1) and suggested (Tier 2) agents.
 *
 * Note: These are LumenFlow framework agents defined in .claude/agents/.
 * Application-specific agents should be configured separately.
 */
export const AGENT_NAMES = [
  'general-purpose',
  'lumenflow-pm',
  'test-engineer',
  'code-reviewer',
  'bug-triage',
  'lumenflow-enforcer',
  'lumenflow-doc-sync',
] as const;

/** Type for agent names */
export type AgentName = (typeof AGENT_NAMES)[number];

/**
 * Alert severity levels for dashboard display.
 * HIGH = action required immediately
 * MEDIUM = action suggested
 * LOW = informational
 */
export const SEVERITY_LEVELS = ['high', 'medium', 'low'] as const;

/** Type for severity levels */
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

/**
 * Default timeline window for dashboard display (hours).
 */
export const TIMELINE_WINDOW_HOURS = 24;

/**
 * Maximum alerts to display in dashboard.
 */
export const MAX_ALERTS_DISPLAY = 10;

/**
 * Agent result statuses for WU progress tracking.
 */
export const AGENT_RESULT_STATUSES = ['pending', 'pass', 'fail', 'skipped'] as const;

/** Type for agent result statuses */
export type AgentResultStatus = (typeof AGENT_RESULT_STATUSES)[number];

/**
 * Timeline event types for orchestration history.
 */
export const TIMELINE_EVENT_TYPES = ['claim', 'done', 'block', 'agent', 'gates'] as const;

/** Type for timeline event types */
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

/**
 * Event severity levels for timeline display.
 */
export const EVENT_SEVERITY_LEVELS = ['info', 'warning', 'error'] as const;

/** Type for event severity levels */
export type EventSeverityLevel = (typeof EVENT_SEVERITY_LEVELS)[number];

/**
 * User choice options for execution plan confirmation.
 */
export const USER_CHOICE_OPTIONS = ['approve', 'reject', 'edit'] as const;

/** Type for user choice options */
export type UserChoiceOption = (typeof USER_CHOICE_OPTIONS)[number];

/**
 * Mandatory agent names (subset of AGENT_NAMES)
 *
 * Note: For LumenFlow framework development, mandatory agents are not currently
 * enforced since this is a workflow framework, not an application with PII/auth concerns.
 * Projects using LumenFlow can define their own mandatory agents in their config.
 *
 * The test-engineer and code-reviewer agents are suggested but not mandatory.
 */
export const MANDATORY_AGENT_NAMES = [] as const;

/** Type for mandatory agent names */
export type MandatoryAgentName = (typeof MANDATORY_AGENT_NAMES)[number];

/**
 * Mandatory agent triggers - glob patterns that indicate when agents must be invoked.
 * Uses minimatch patterns (NOT regex) for file path matching.
 *
 * Note: For LumenFlow framework development, this is empty since we don't have
 * application-specific concerns like PII, auth, or RLS. Projects using LumenFlow
 * should configure their own triggers based on their domain requirements.
 *
 * Example application-specific triggers (configure in your project):
 * - security-auditor: supabase/migrations/**, auth/**, rls/**
 * - llm-reviewer: prompts/**, llm/**
 *
 * Usage:
 * ```typescript
 * import { minimatch } from 'minimatch';
 * const triggers = MANDATORY_TRIGGERS['my-agent'];
 * const shouldTrigger = triggers?.some(pattern => minimatch(filePath, pattern));
 * ```
 */
export const MANDATORY_TRIGGERS: Record<string, readonly string[]> = {
  // No mandatory triggers for LumenFlow framework development.
  // Projects should configure their own triggers based on their domain.
};

/**
 * File system paths for metrics collection.
 * Used by FileSystemMetricsCollector to avoid hardcoded strings.
 */
export const FILESYSTEM_PATHS = {
  WU_DIR: DIRECTORIES.WU_DIR,
  STATUS_FILE: DIRECTORIES.STATUS_PATH,
  BACKLOG_FILE: DIRECTORIES.BACKLOG_PATH,
  TELEMETRY_DIR: LUMENFLOW_PATHS.TELEMETRY,
  STAMPS_DIR: LUMENFLOW_PATHS.STAMPS_DIR,
  SESSION_FILE: LUMENFLOW_PATHS.SESSION_CURRENT,
};

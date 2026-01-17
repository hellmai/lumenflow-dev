/**
 * Orchestration Domain Constants
 *
 * Centralised constants for the agent orchestration dashboard.
 * Avoids magic numbers and hardcoded strings throughout the orchestration layer.
 *
 * @module orchestration.constants
 * @see {@link ../ports/dashboard-renderer.port.mjs} - Uses these constants
 * @see {@link ../ports/metrics-collector.port.mjs} - Uses these constants
 */

/**
 * Total number of Definition of Done checkpoints.
 * Used by dashboard to show DoD progress (X/11).
 */
export const DOD_TOTAL = 11;

/**
 * Valid lane names in the LumenFlow system.
 * Used for type-safe lane validation.
 */
export const LANES = [
  'Intelligence',
  'Experience',
  'Core Systems',
  'Operations',
  'Discovery',
] as const;

/** Type for valid lane names */
export type Lane = (typeof LANES)[number];

/**
 * Known agent names in the orchestration system.
 * Includes both mandatory (Tier 1) and suggested (Tier 2) agents.
 */
export const AGENT_NAMES = [
  'security-auditor',
  'beacon-guardian',
  'test-engineer',
  'code-reviewer',
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
 */
export const MANDATORY_AGENT_NAMES = ['security-auditor', 'beacon-guardian'] as const;

/** Type for mandatory agent names */
export type MandatoryAgentName = (typeof MANDATORY_AGENT_NAMES)[number];

/**
 * Mandatory agent triggers - glob patterns that indicate when agents must be invoked.
 * Uses minimatch patterns (NOT regex) for file path matching.
 *
 * @example
 * // Check if a path triggers security-auditor:
 * import { minimatch } from 'minimatch';
 * const triggers = MANDATORY_TRIGGERS['security-auditor'];
 * const shouldTrigger = triggers.some(pattern => minimatch(filePath, pattern));
 */
export const MANDATORY_TRIGGERS: Record<MandatoryAgentName, readonly string[]> = {
  'security-auditor': ['supabase/migrations/**', '**/auth/**', '**/rls/**', '**/permissions/**'],
  'beacon-guardian': ['**/prompts/**', '**/classification/**', '**/detector/**', '**/llm/**'],
};

/**
 * File system paths for metrics collection.
 * Used by FileSystemMetricsCollector to avoid hardcoded strings.
 */
export const FILESYSTEM_PATHS = {
  WU_DIR: 'docs/04-operations/tasks/wu',
  STATUS_FILE: 'docs/04-operations/tasks/status.md',
  BACKLOG_FILE: 'docs/04-operations/tasks/backlog.md',
  TELEMETRY_DIR: '.beacon/telemetry',
  STAMPS_DIR: '.beacon/stamps',
  SESSION_FILE: '.beacon/sessions/current.json',
};

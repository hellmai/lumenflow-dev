// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * State Doctor Core (WU-1209, WU-1420)
 *
 * Integrity checker for LumenFlow state that detects:
 * - Orphaned WUs (done status but no stamp)
 * - Dangling signals (reference non-existent WUs)
 * - Broken memory relationships (events for missing WU specs)
 * - Status mismatches between WU YAML and state store (WU-1420)
 *
 * Inspired by Beads bd doctor command.
 *
 * Design principles:
 * - Non-destructive by default (read-only diagnosis)
 * - --fix flag for safe auto-repair of resolvable issues
 * - Dependency injection for testability
 * - Human-readable output with actionable suggestions
 *
 * @see {@link packages/@lumenflow/cli/src/state-doctor.ts} - CLI wrapper
 * @see {@link packages/@lumenflow/core/src/__tests__/state-doctor-core.test.ts} - Tests
 */

import { WU_STATUS } from './wu-constants.js';

/**
 * Issue type constants
 */
export const ISSUE_TYPES = {
  /** WU has done status but no stamp file */
  ORPHANED_WU: 'orphaned_wu',
  /** Signal references a WU that doesn't exist */
  DANGLING_SIGNAL: 'dangling_signal',
  /** Event references a WU that doesn't exist */
  BROKEN_EVENT: 'broken_event',
  /** WU YAML status differs from state store derived status (WU-1420) */
  STATUS_MISMATCH: 'status_mismatch',
} as const;

/**
 * Issue severity levels
 */
export const ISSUE_SEVERITY = {
  /** Critical issues that may cause data loss */
  ERROR: 'error',
  /** Issues that should be fixed but aren't blocking */
  WARNING: 'warning',
  /** Informational findings */
  INFO: 'info',
} as const;

/**
 * Statuses representable by wu-events transitions.
 *
 * WU YAML supports additional metadata statuses (e.g. superseded) that do not
 * have event transitions in the state store. Those statuses are intentionally
 * excluded from mismatch comparisons to avoid false positives.
 */
const EVENT_REPRESENTABLE_STATUSES = new Set<string>([
  WU_STATUS.READY,
  WU_STATUS.IN_PROGRESS,
  WU_STATUS.BLOCKED,
  WU_STATUS.DONE,
]);

const STATUS_MISMATCH_SUGGESTION = {
  AUTO_FIX: 'Emit corrective event using: pnpm state:doctor --fix',
  MANUAL_FIX:
    'Manual reconciliation required: state transition is not representable via corrective events',
} as const;

/**
 * Issue type (union)
 */
export type IssueType = (typeof ISSUE_TYPES)[keyof typeof ISSUE_TYPES];

/**
 * Issue severity (union)
 */
export type IssueSeverity = (typeof ISSUE_SEVERITY)[keyof typeof ISSUE_SEVERITY];

/**
 * Mock WU YAML content
 */
export interface MockWU {
  id: string;
  status: string;
  lane?: string;
  title?: string;
}

/**
 * Mock signal content
 */
export interface MockSignal {
  id: string;
  wuId?: string;
  timestamp?: string;
  message?: string;
}

/**
 * Mock event content
 */
export interface MockEvent {
  wuId: string;
  type: string;
  timestamp?: string;
  lane?: string;
  title?: string;
  reason?: string;
}

/**
 * Event to emit for fixing status mismatches (WU-1420)
 */
export interface EmitEventPayload {
  wuId: string;
  type: 'release' | 'complete';
  reason?: string;
  timestamp?: string;
}

/**
 * Status mismatch details for fixing (WU-1420)
 */
export interface StatusMismatchDetails {
  yamlStatus: string;
  derivedStatus: string;
}

/**
 * Dependencies for state doctor (injectable for testing)
 */
export interface StateDoctorDeps {
  /** List all WU YAML files */
  listWUs: () => Promise<MockWU[]>;
  /** List all stamp file IDs */
  listStamps: () => Promise<string[]>;
  /** List all signals */
  listSignals: () => Promise<MockSignal[]>;
  /** List all events */
  listEvents: () => Promise<MockEvent[]>;
  /** Remove a signal by ID (for --fix) */
  removeSignal?: (id: string) => Promise<void>;
  /** Remove events for a WU (for --fix) */
  removeEvent?: (wuId: string) => Promise<void>;
  /** Create a stamp for a WU (for --fix) */
  createStamp?: (wuId: string, title: string) => Promise<void>;
  /** Emit an event to fix status mismatch (WU-1420) */
  emitEvent?: (event: EmitEventPayload) => Promise<void>;
}

/**
 * A detected issue in the state
 */
export interface DiagnosisIssue {
  /** Type of issue */
  type: IssueType;
  /** Severity level */
  severity: IssueSeverity;
  /** WU ID involved (if applicable) */
  wuId?: string;
  /** Signal ID involved (if applicable) */
  signalId?: string;
  /** Human-readable description */
  description: string;
  /** Suggested fix */
  suggestion: string;
  /** Whether this issue can be auto-fixed */
  canAutoFix: boolean;
  /** Status mismatch details for fixing (WU-1420) */
  statusMismatch?: StatusMismatchDetails;
}

/**
 * A fix error that occurred during auto-repair
 */
export interface FixError {
  /** Type of issue that failed to fix */
  type: IssueType;
  /** WU ID involved (if applicable) */
  wuId?: string;
  /** Signal ID involved (if applicable) */
  signalId?: string;
  /** Error message */
  error: string;
}

/**
 * Summary statistics
 */
export interface DiagnosisSummary {
  /** Number of orphaned WUs */
  orphanedWUs: number;
  /** Number of dangling signals */
  danglingSignals: number;
  /** Number of broken events */
  brokenEvents: number;
  /** Number of status mismatches (WU-1420) */
  statusMismatches: number;
  /** Total number of issues */
  totalIssues: number;
}

/**
 * Options for diagnosis
 */
export interface DiagnosisOptions {
  /** Whether to attempt auto-fixes */
  fix?: boolean;
  /** Dry-run mode (report what would be fixed) */
  dryRun?: boolean;
}

/**
 * Result of state diagnosis
 */
export interface StateDiagnosis {
  /** Whether the state is healthy */
  healthy: boolean;
  /** List of detected issues */
  issues: DiagnosisIssue[];
  /** Summary statistics */
  summary: DiagnosisSummary;
  /** Issues that were fixed */
  fixed: DiagnosisIssue[];
  /** Errors that occurred during fixing */
  fixErrors: FixError[];
  /** Whether this was a dry-run */
  dryRun?: boolean;
  /** Issues that would be fixed (in dry-run mode) */
  wouldFix?: DiagnosisIssue[];
}

/**
 * Derive WU status from events (WU-1420)
 *
 * Replays events to determine the current derived status:
 * - claim/create -> in_progress
 * - release -> ready
 * - complete -> done
 * - block -> blocked
 * - unblock -> in_progress
 *
 * @param events - All events for this WU
 * @returns Derived status or undefined if no events
 */
function deriveStatusFromEvents(events: MockEvent[]): string | undefined {
  if (events.length === 0) {
    return undefined;
  }

  let status: string | undefined = undefined;

  for (const event of events) {
    switch (event.type) {
      case 'claim':
      case 'create':
        status = WU_STATUS.IN_PROGRESS;
        break;
      case 'release':
        status = WU_STATUS.READY;
        break;
      case 'complete':
        status = WU_STATUS.DONE;
        break;
      case 'block':
        status = WU_STATUS.BLOCKED;
        break;
      case 'unblock':
        status = WU_STATUS.IN_PROGRESS;
        break;
      // checkpoint doesn't change status
    }
  }

  return status;
}

/**
 * Detect status mismatches between WU YAML and state store (WU-1420)
 *
 * Compares the status field in WU YAML against the derived status from events.
 * Only reports issues for WUs that have events in the state store.
 */
function detectStatusMismatches(wus: MockWU[], events: MockEvent[]): DiagnosisIssue[] {
  const issues: DiagnosisIssue[] = [];

  // Group events by WU ID
  const eventsByWu = new Map<string, MockEvent[]>();
  for (const event of events) {
    const existing = eventsByWu.get(event.wuId) || [];
    existing.push(event);
    eventsByWu.set(event.wuId, existing);
  }

  for (const wu of wus) {
    if (!EVENT_REPRESENTABLE_STATUSES.has(wu.status)) {
      // YAML-only lifecycle states (e.g. superseded) are not representable in
      // wu-events; skip mismatch detection to avoid false positives.
      continue;
    }

    const wuEvents = eventsByWu.get(wu.id);
    if (!wuEvents || wuEvents.length === 0) {
      // No events for this WU - nothing to compare
      continue;
    }

    const derivedStatus = deriveStatusFromEvents(wuEvents);
    if (derivedStatus && derivedStatus !== wu.status) {
      const eventType = getCorrectiveEventType(wu.status, derivedStatus);
      issues.push({
        type: ISSUE_TYPES.STATUS_MISMATCH,
        severity: ISSUE_SEVERITY.WARNING,
        wuId: wu.id,
        description: `WU ${wu.id} YAML status is '${wu.status}' but state store says '${derivedStatus}'`,
        suggestion: eventType
          ? STATUS_MISMATCH_SUGGESTION.AUTO_FIX
          : STATUS_MISMATCH_SUGGESTION.MANUAL_FIX,
        canAutoFix: eventType !== null,
        statusMismatch: {
          yamlStatus: wu.status,
          derivedStatus,
        },
      });
    }
  }

  return issues;
}

/**
 * Detect orphaned WUs (done status but no stamp)
 */
function detectOrphanedWUs(wus: MockWU[], stamps: Set<string>): DiagnosisIssue[] {
  const issues: DiagnosisIssue[] = [];

  for (const wu of wus) {
    if (wu.status === WU_STATUS.DONE && !stamps.has(wu.id)) {
      issues.push({
        type: ISSUE_TYPES.ORPHANED_WU,
        severity: ISSUE_SEVERITY.WARNING,
        wuId: wu.id,
        description: `WU ${wu.id} has status '${WU_STATUS.DONE}' but no stamp file exists`,
        suggestion: `Create stamp file for ${wu.id} using: pnpm state:doctor --fix`,
        canAutoFix: true,
      });
    }
  }

  return issues;
}

/**
 * Detect dangling signals (reference non-existent WUs)
 */
function detectDanglingSignals(signals: MockSignal[], wuIds: Set<string>): DiagnosisIssue[] {
  const issues: DiagnosisIssue[] = [];

  for (const signal of signals) {
    // Skip signals without WU references
    if (!signal.wuId) {
      continue;
    }

    if (!wuIds.has(signal.wuId)) {
      issues.push({
        type: ISSUE_TYPES.DANGLING_SIGNAL,
        severity: ISSUE_SEVERITY.WARNING,
        wuId: signal.wuId,
        signalId: signal.id,
        description: `Signal ${signal.id} references non-existent WU ${signal.wuId}`,
        suggestion: `Remove dangling signal using: pnpm state:doctor --fix`,
        canAutoFix: true,
      });
    }
  }

  return issues;
}

/**
 * Detect broken events (reference non-existent WUs)
 */
function detectBrokenEvents(events: MockEvent[], wuIds: Set<string>): DiagnosisIssue[] {
  const issues: DiagnosisIssue[] = [];
  const seenWuIds = new Set<string>();

  for (const event of events) {
    // Only report once per WU
    if (seenWuIds.has(event.wuId)) {
      continue;
    }

    if (!wuIds.has(event.wuId)) {
      seenWuIds.add(event.wuId);
      issues.push({
        type: ISSUE_TYPES.BROKEN_EVENT,
        severity: ISSUE_SEVERITY.WARNING,
        wuId: event.wuId,
        description: `Events exist for non-existent WU ${event.wuId}`,
        suggestion: `Archive or remove events for missing WU using: pnpm state:doctor --fix`,
        canAutoFix: true,
      });
    }
  }

  return issues;
}

/**
 * Detect orphan backlog references (WU-2229)
 *
 * Finds WU IDs referenced in backlog.md that have no corresponding YAML file.
 * This catches stale entries left behind by wu:delete or manual edits.
 */
function detectOrphanBacklogRefs(backlogRefs: string[], wuIds: Set<string>): DiagnosisIssue[] {
  const issues: DiagnosisIssue[] = [];

  for (const refId of backlogRefs) {
    if (!wuIds.has(refId)) {
      issues.push({
        type: ISSUE_TYPES.ORPHAN_BACKLOG_REF,
        severity: ISSUE_SEVERITY.WARNING,
        wuId: refId,
        description: `${refId} referenced in backlog.md but no ${refId}.yaml exists`,
        suggestion: `Regenerate backlog.md from state store, or remove the stale entry manually`,
        canAutoFix: false,
      });
    }
  }

  return issues;
}

/**
 * Calculate summary statistics from issues
 */
function calculateSummary(issues: DiagnosisIssue[]): DiagnosisSummary {
  let orphanedWUs = 0;
  let danglingSignals = 0;
  let brokenEvents = 0;
  let statusMismatches = 0;
  let orphanBacklogRefs = 0;

  for (const issue of issues) {
    switch (issue.type) {
      case ISSUE_TYPES.ORPHANED_WU:
        orphanedWUs++;
        break;
      case ISSUE_TYPES.DANGLING_SIGNAL:
        danglingSignals++;
        break;
      case ISSUE_TYPES.BROKEN_EVENT:
        brokenEvents++;
        break;
      case ISSUE_TYPES.STATUS_MISMATCH:
        statusMismatches++;
        break;
      case ISSUE_TYPES.ORPHAN_BACKLOG_REF:
        orphanBacklogRefs++;
        break;
    }
  }

  return {
    orphanedWUs,
    danglingSignals,
    brokenEvents,
    statusMismatches,
    orphanBacklogRefs,
    totalIssues: issues.length,
  };
}

/**
 * Determine the corrective event type for a status mismatch (WU-1420)
 *
 * When YAML says X but state says Y, emit event to transition state to X:
 * - YAML=ready, state=in_progress -> emit release
 * - YAML=done, state=in_progress -> emit complete
 * - YAML=in_progress, state=ready -> cannot fix (would need claim with lane/title)
 * - YAML=in_progress, state=done -> cannot fix (cannot un-complete)
 */
function getCorrectiveEventType(
  yamlStatus: string,
  derivedStatus: string,
): 'release' | 'complete' | null {
  // Transition from in_progress to ready: emit release
  if (yamlStatus === WU_STATUS.READY && derivedStatus === WU_STATUS.IN_PROGRESS) {
    return 'release';
  }

  // Transition from in_progress to done: emit complete
  if (yamlStatus === WU_STATUS.DONE && derivedStatus === WU_STATUS.IN_PROGRESS) {
    return 'complete';
  }

  // Other transitions are not auto-fixable by emitting events
  // - ready -> in_progress would need claim (requires lane/title context)
  // - done -> in_progress would need to revert complete (not supported)
  return null;
}

/**
 * Attempt to fix an issue
 */
async function fixIssue(
  issue: DiagnosisIssue,
  deps: StateDoctorDeps,
  wus: MockWU[],
): Promise<{ fixed: boolean; error?: string }> {
  try {
    switch (issue.type) {
      case ISSUE_TYPES.DANGLING_SIGNAL:
        if (deps.removeSignal && issue.signalId) {
          await deps.removeSignal(issue.signalId);
          return { fixed: true };
        }
        return { fixed: false, error: 'No removeSignal function provided' };

      case ISSUE_TYPES.BROKEN_EVENT:
        if (deps.removeEvent && issue.wuId) {
          await deps.removeEvent(issue.wuId);
          return { fixed: true };
        }
        return { fixed: false, error: 'No removeEvent function provided' };

      case ISSUE_TYPES.ORPHANED_WU:
        if (deps.createStamp && issue.wuId) {
          const wu = wus.find((w) => w.id === issue.wuId);
          await deps.createStamp(issue.wuId, wu?.title || `WU ${issue.wuId}`);
          return { fixed: true };
        }
        return { fixed: false, error: 'No createStamp function provided' };

      case ISSUE_TYPES.STATUS_MISMATCH: {
        if (!deps.emitEvent) {
          return { fixed: false, error: 'No emitEvent function provided' };
        }
        if (!issue.wuId || !issue.statusMismatch) {
          return { fixed: false, error: 'Missing WU ID or status mismatch details' };
        }

        const { yamlStatus, derivedStatus } = issue.statusMismatch;
        const eventType = getCorrectiveEventType(yamlStatus, derivedStatus);

        if (!eventType) {
          return {
            fixed: false,
            error: `Cannot auto-fix: transition from '${derivedStatus}' to '${yamlStatus}' requires manual intervention`,
          };
        }

        await deps.emitEvent({
          wuId: issue.wuId,
          type: eventType,
          reason: `state:doctor --fix: reconciling state store with YAML status '${yamlStatus}'`,
          timestamp: new Date().toISOString(),
        });
        return { fixed: true };
      }

      default:
        return { fixed: false, error: `Unknown issue type: ${issue.type}` };
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { fixed: false, error };
  }
}

/**
 * Diagnose state integrity issues.
 *
 * Detects:
 * - Orphaned WUs (done status but no stamp)
 * - Dangling signals (reference non-existent WUs)
 * - Broken events (events for missing WU specs)
 *
 * @param baseDir - Project base directory
 * @param deps - Dependency functions for reading/writing state
 * @param options - Diagnosis options
 * @returns Diagnosis result with issues and optional fixes
 *
 * @example
 * // Diagnose without fixing
 * const result = await diagnoseState(baseDir, deps);
 *
 * @example
 * // Diagnose and fix
 * const result = await diagnoseState(baseDir, deps, { fix: true });
 *
 * @example
 * // Dry-run (report what would be fixed)
 * const result = await diagnoseState(baseDir, deps, { fix: true, dryRun: true });
 */
/**
 * Apply fixes to auto-fixable issues
 */
async function applyFixes(
  issues: DiagnosisIssue[],
  deps: StateDoctorDeps,
  wus: MockWU[],
  result: StateDiagnosis,
): Promise<void> {
  const fixableIssues = issues.filter((i) => i.canAutoFix);

  for (const issue of fixableIssues) {
    const fixResult = await fixIssue(issue, deps, wus);

    if (fixResult.fixed) {
      result.fixed.push(issue);
    } else if (fixResult.error) {
      result.fixErrors.push({
        type: issue.type,
        wuId: issue.wuId,
        signalId: issue.signalId,
        error: fixResult.error,
      });
    }
  }
}

export async function diagnoseState(
  _baseDir: string,
  deps: StateDoctorDeps,
  options: DiagnosisOptions = {},
): Promise<StateDiagnosis> {
  const { fix = false, dryRun = false } = options;

  // Gather state data
  const [wus, stamps, signals, events] = await Promise.all([
    deps.listWUs(),
    deps.listStamps(),
    deps.listSignals(),
    deps.listEvents(),
  ]);

  // Build lookup sets
  const wuIds = new Set(wus.map((wu) => wu.id));
  const stampIds = new Set(stamps);

  // Detect issues
  const orphanedWUissues = detectOrphanedWUs(wus, stampIds);
  const danglingSignalIssues = detectDanglingSignals(signals, wuIds);
  const brokenEventIssues = detectBrokenEvents(events, wuIds);
  const statusMismatchIssues = detectStatusMismatches(wus, events);

  // WU-2229: Detect orphan backlog references (optional — backward compatible)
  const backlogRefs = deps.listBacklogRefs ? await deps.listBacklogRefs() : [];
  const orphanBacklogRefIssues =
    backlogRefs.length > 0 ? detectOrphanBacklogRefs(backlogRefs, wuIds) : [];

  const issues = [
    ...orphanedWUissues,
    ...danglingSignalIssues,
    ...brokenEventIssues,
    ...statusMismatchIssues,
    ...orphanBacklogRefIssues,
  ];
  const summary = calculateSummary(issues);

  // Initialize result
  const result: StateDiagnosis = {
    healthy: issues.length === 0,
    issues,
    summary,
    fixed: [],
    fixErrors: [],
  };

  // Handle fixing
  if (fix && dryRun) {
    result.dryRun = true;
    result.wouldFix = issues.filter((i) => i.canAutoFix);
  } else if (fix) {
    await applyFixes(issues, deps, wus, result);
  }

  return result;
}

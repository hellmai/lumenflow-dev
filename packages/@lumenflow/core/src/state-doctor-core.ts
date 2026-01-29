/**
 * State Doctor Core (WU-1209)
 *
 * Integrity checker for LumenFlow state that detects:
 * - Orphaned WUs (done status but no stamp)
 * - Dangling signals (reference non-existent WUs)
 * - Broken memory relationships (events for missing WU specs)
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
 * Detect orphaned WUs (done status but no stamp)
 */
function detectOrphanedWUs(wus: MockWU[], stamps: Set<string>): DiagnosisIssue[] {
  const issues: DiagnosisIssue[] = [];

  for (const wu of wus) {
    if (wu.status === 'done' && !stamps.has(wu.id)) {
      issues.push({
        type: ISSUE_TYPES.ORPHANED_WU,
        severity: ISSUE_SEVERITY.WARNING,
        wuId: wu.id,
        description: `WU ${wu.id} has status 'done' but no stamp file exists`,
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
 * Calculate summary statistics from issues
 */
function calculateSummary(issues: DiagnosisIssue[]): DiagnosisSummary {
  let orphanedWUs = 0;
  let danglingSignals = 0;
  let brokenEvents = 0;

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
    }
  }

  return {
    orphanedWUs,
    danglingSignals,
    brokenEvents,
    totalIssues: issues.length,
  };
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

  const issues = [...orphanedWUissues, ...danglingSignalIssues, ...brokenEventIssues];
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

/**
 * State Cleanup Core (WU-1208)
 *
 * Unified orchestration of all state cleanup operations:
 * - Signal cleanup (TTL-based, from @lumenflow/memory)
 * - Memory cleanup (lifecycle-based, from @lumenflow/memory)
 * - Event archival (age-based, from @lumenflow/core)
 *
 * Cleanup order: signals -> memory -> events (dependency order)
 *
 * Design principles:
 * - Non-fatal errors: failures in one cleanup type don't block others
 * - Consistent summary: aggregated counts for all cleanup types
 * - Configurable: supports --dry-run and type-specific flags
 *
 * @see {@link packages/@lumenflow/cli/src/state-cleanup.ts} - CLI wrapper
 * @see {@link packages/@lumenflow/core/src/__tests__/state-cleanup-core.test.ts} - Tests
 */

/**
 * Cleanup types supported by state:cleanup
 */
export type CleanupType = 'signals' | 'memory' | 'events';

/**
 * Signal cleanup result (from @lumenflow/memory/signal-cleanup-core)
 */
export interface SignalCleanupResult {
  success: boolean;
  removedIds: string[];
  retainedIds: string[];
  bytesFreed: number;
  compactionRatio: number;
  dryRun?: boolean;
  breakdown: {
    ttlExpired: number;
    unreadTtlExpired: number;
    countLimitExceeded: number;
    activeWuProtected: number;
  };
}

/**
 * Memory cleanup result (from @lumenflow/memory/mem-cleanup-core)
 */
export interface MemoryCleanupResult {
  success: boolean;
  removedIds: string[];
  retainedIds: string[];
  bytesFreed: number;
  compactionRatio: number;
  dryRun?: boolean;
  breakdown: {
    ephemeral: number;
    session: number;
    wu: number;
    sensitive: number;
    ttlExpired: number;
    activeSessionProtected: number;
  };
}

/**
 * Event archival result (from @lumenflow/core/wu-events-cleanup)
 */
export interface EventArchivalResult {
  success: boolean;
  archivedWuIds: string[];
  retainedWuIds: string[];
  archivedEventCount: number;
  retainedEventCount: number;
  bytesArchived: number;
  dryRun?: boolean;
  breakdown: {
    archivedOlderThanThreshold: number;
    retainedActiveWu: number;
    retainedWithinThreshold: number;
  };
}

/**
 * Signal cleanup function type
 */
export type CleanupSignalsFn = (
  baseDir: string,
  options: { dryRun?: boolean },
) => Promise<SignalCleanupResult>;

/**
 * Memory cleanup function type
 */
export type CleanupMemoryFn = (
  baseDir: string,
  options: { dryRun?: boolean },
) => Promise<MemoryCleanupResult>;

/**
 * Event archival function type
 */
export type ArchiveEventsFn = (
  baseDir: string,
  options: { dryRun?: boolean },
) => Promise<EventArchivalResult>;

/**
 * Error that occurred during a specific cleanup type
 */
export interface CleanupError {
  type: CleanupType;
  message: string;
  error?: Error;
}

/**
 * Summary of signal cleanup
 */
export interface SignalCleanupSummary {
  removedCount: number;
  retainedCount: number;
  bytesFreed: number;
  breakdown: SignalCleanupResult['breakdown'];
}

/**
 * Summary of memory cleanup
 */
export interface MemoryCleanupSummary {
  removedCount: number;
  retainedCount: number;
  bytesFreed: number;
  breakdown: MemoryCleanupResult['breakdown'];
}

/**
 * Summary of event archival
 */
export interface EventArchivalSummary {
  archivedWuCount: number;
  retainedWuCount: number;
  archivedEventCount: number;
  retainedEventCount: number;
  bytesArchived: number;
  breakdown: EventArchivalResult['breakdown'];
}

/**
 * Overall summary of state cleanup
 */
export interface StateCleanupSummary {
  totalBytesFreed: number;
  typesExecuted: CleanupType[];
  typesSkipped: CleanupType[];
}

/**
 * Options for unified state cleanup
 */
export interface StateCleanupOptions {
  /** If true, preview without modifications */
  dryRun?: boolean;
  /** Only execute signal cleanup */
  signalsOnly?: boolean;
  /** Only execute memory cleanup */
  memoryOnly?: boolean;
  /** Only execute event archival */
  eventsOnly?: boolean;
  /** Signal cleanup function (injectable for testing) */
  cleanupSignals?: CleanupSignalsFn;
  /** Memory cleanup function (injectable for testing) */
  cleanupMemory?: CleanupMemoryFn;
  /** Event archival function (injectable for testing) */
  archiveEvents?: ArchiveEventsFn;
}

/**
 * Result of unified state cleanup
 */
export interface StateCleanupResult {
  /** Whether all executed cleanups succeeded */
  success: boolean;
  /** True if in dry-run mode */
  dryRun?: boolean;
  /** Signal cleanup summary (undefined if skipped) */
  signals?: SignalCleanupSummary;
  /** Memory cleanup summary (undefined if skipped) */
  memory?: MemoryCleanupSummary;
  /** Event archival summary (undefined if skipped) */
  events?: EventArchivalSummary;
  /** Errors from failed cleanups (non-fatal) */
  errors: CleanupError[];
  /** Aggregated summary */
  summary: StateCleanupSummary;
}

/**
 * All cleanup types in dependency order
 */
const ALL_CLEANUP_TYPES: CleanupType[] = ['signals', 'memory', 'events'];

/**
 * Determine which cleanup types to execute based on options
 *
 * @param options - State cleanup options
 * @returns Array of cleanup types to execute
 */
function getTypesToExecute(options: StateCleanupOptions): CleanupType[] {
  if (options.signalsOnly) {
    return ['signals'];
  }
  if (options.memoryOnly) {
    return ['memory'];
  }
  if (options.eventsOnly) {
    return ['events'];
  }
  return ALL_CLEANUP_TYPES;
}

/**
 * Execute signal cleanup and capture results or errors
 *
 * @param baseDir - Project base directory
 * @param options - Cleanup options
 * @returns Signal cleanup summary or undefined on error
 */
async function executeSignalCleanup(
  baseDir: string,
  options: StateCleanupOptions,
): Promise<{ summary?: SignalCleanupSummary; error?: CleanupError }> {
  if (!options.cleanupSignals) {
    return { error: { type: 'signals', message: 'No cleanupSignals function provided' } };
  }

  try {
    const result = await options.cleanupSignals(baseDir, { dryRun: options.dryRun });
    return {
      summary: {
        removedCount: result.removedIds.length,
        retainedCount: result.retainedIds.length,
        bytesFreed: result.bytesFreed,
        breakdown: result.breakdown,
      },
    };
  } catch (err) {
    const error = err as Error;
    return {
      error: {
        type: 'signals',
        message: error.message,
        error,
      },
    };
  }
}

/**
 * Execute memory cleanup and capture results or errors
 *
 * @param baseDir - Project base directory
 * @param options - Cleanup options
 * @returns Memory cleanup summary or undefined on error
 */
async function executeMemoryCleanup(
  baseDir: string,
  options: StateCleanupOptions,
): Promise<{ summary?: MemoryCleanupSummary; error?: CleanupError }> {
  if (!options.cleanupMemory) {
    return { error: { type: 'memory', message: 'No cleanupMemory function provided' } };
  }

  try {
    const result = await options.cleanupMemory(baseDir, { dryRun: options.dryRun });
    return {
      summary: {
        removedCount: result.removedIds.length,
        retainedCount: result.retainedIds.length,
        bytesFreed: result.bytesFreed,
        breakdown: result.breakdown,
      },
    };
  } catch (err) {
    const error = err as Error;
    return {
      error: {
        type: 'memory',
        message: error.message,
        error,
      },
    };
  }
}

/**
 * Execute event archival and capture results or errors
 *
 * @param baseDir - Project base directory
 * @param options - Cleanup options
 * @returns Event archival summary or undefined on error
 */
async function executeEventArchival(
  baseDir: string,
  options: StateCleanupOptions,
): Promise<{ summary?: EventArchivalSummary; error?: CleanupError }> {
  if (!options.archiveEvents) {
    return { error: { type: 'events', message: 'No archiveEvents function provided' } };
  }

  try {
    const result = await options.archiveEvents(baseDir, { dryRun: options.dryRun });
    return {
      summary: {
        archivedWuCount: result.archivedWuIds.length,
        retainedWuCount: result.retainedWuIds.length,
        archivedEventCount: result.archivedEventCount,
        retainedEventCount: result.retainedEventCount,
        bytesArchived: result.bytesArchived,
        breakdown: result.breakdown,
      },
    };
  } catch (err) {
    const error = err as Error;
    return {
      error: {
        type: 'events',
        message: error.message,
        error,
      },
    };
  }
}

/**
 * Calculate total bytes freed from all cleanup summaries
 *
 * @param signals - Signal cleanup summary
 * @param memory - Memory cleanup summary
 * @param events - Event archival summary
 * @returns Total bytes freed
 */
function calculateTotalBytesFreed(
  signals?: SignalCleanupSummary,
  memory?: MemoryCleanupSummary,
  events?: EventArchivalSummary,
): number {
  let total = 0;
  if (signals) {
    total += signals.bytesFreed;
  }
  if (memory) {
    total += memory.bytesFreed;
  }
  if (events) {
    total += events.bytesArchived;
  }
  return total;
}

/**
 * Orchestrate all state cleanup operations in dependency order.
 *
 * Executes cleanups in order: signals -> memory -> events
 *
 * Non-fatal: failures in one cleanup type don't block others.
 * All errors are collected and reported in the result.
 *
 * @param baseDir - Project base directory
 * @param options - State cleanup options
 * @returns Unified cleanup result with summaries and errors
 *
 * @example
 * // Full cleanup with dry-run
 * const result = await cleanupState(baseDir, { dryRun: true });
 *
 * @example
 * // Signals only
 * const result = await cleanupState(baseDir, { signalsOnly: true });
 *
 * @example
 * // With injected cleanup functions (for testing or custom implementations)
 * const result = await cleanupState(baseDir, {
 *   cleanupSignals: myCustomSignalCleanup,
 *   cleanupMemory: myCustomMemoryCleanup,
 *   archiveEvents: myCustomEventArchival,
 * });
 */
export async function cleanupState(
  baseDir: string,
  options: StateCleanupOptions = {},
): Promise<StateCleanupResult> {
  const typesToExecute = getTypesToExecute(options);
  const typesSkipped = ALL_CLEANUP_TYPES.filter((t) => !typesToExecute.includes(t));

  const errors: CleanupError[] = [];
  let signalsSummary: SignalCleanupSummary | undefined;
  let memorySummary: MemoryCleanupSummary | undefined;
  let eventsSummary: EventArchivalSummary | undefined;

  // Execute cleanups in dependency order: signals -> memory -> events
  if (typesToExecute.includes('signals')) {
    const result = await executeSignalCleanup(baseDir, options);
    if (result.error) {
      errors.push(result.error);
    } else {
      signalsSummary = result.summary;
    }
  }

  if (typesToExecute.includes('memory')) {
    const result = await executeMemoryCleanup(baseDir, options);
    if (result.error) {
      errors.push(result.error);
    } else {
      memorySummary = result.summary;
    }
  }

  if (typesToExecute.includes('events')) {
    const result = await executeEventArchival(baseDir, options);
    if (result.error) {
      errors.push(result.error);
    } else {
      eventsSummary = result.summary;
    }
  }

  const totalBytesFreed = calculateTotalBytesFreed(signalsSummary, memorySummary, eventsSummary);

  return {
    success: errors.length === 0,
    dryRun: options.dryRun,
    signals: signalsSummary,
    memory: memorySummary,
    events: eventsSummary,
    errors,
    summary: {
      totalBytesFreed,
      typesExecuted: typesToExecute,
      typesSkipped,
    },
  };
}

/**
 * Patrol Loop Module (WU-1242)
 *
 * Continuous patrol loop for monitoring spawn health.
 * The 'Witness patrol' pattern - keeps the spawn fleet healthy by
 * checking status at configurable intervals with exponential backoff
 * on repeated failures.
 *
 * Features:
 * - Configurable patrol interval (default 5min)
 * - Exponential backoff on failures (max 1hr)
 * - Graceful shutdown support
 * - Cycle callbacks for status reporting
 * - Error handling with continuation
 *
 * @see {@link packages/@lumenflow/cli/src/orchestrate-monitor.ts} - CLI integration
 * @see {@link packages/@lumenflow/core/src/__tests__/patrol-loop.test.ts} - Tests
 */

/**
 * Default patrol interval (5 minutes in milliseconds)
 */
export const DEFAULT_PATROL_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Maximum backoff interval (1 hour in milliseconds)
 */
export const MAX_BACKOFF_MS = 60 * 60 * 1000;

/**
 * Result of a patrol check
 */
export interface PatrolCheckResult {
  /** Whether the spawn fleet is healthy (no stuck spawns or zombies) */
  healthy: boolean;
  /** Number of stuck spawns detected */
  stuckCount: number;
  /** Number of zombie locks detected */
  zombieCount: number;
  /** Optional suggestions for recovery */
  suggestions?: string[];
}

/**
 * Metadata passed to cycle callbacks
 */
export interface CycleMetadata {
  /** The cycle number (1-indexed) */
  cycleNumber: number;
  /** Current interval in milliseconds */
  intervalMs: number;
  /** Number of consecutive failures */
  consecutiveFailures: number;
  /** Timestamp of the cycle */
  timestamp: Date;
}

/**
 * Callback invoked on each patrol cycle
 */
export type OnCycleCallback = (result: PatrolCheckResult, meta: CycleMetadata) => void;

/**
 * Callback invoked when an error occurs
 */
export type OnErrorCallback = (error: Error, cycleNumber: number) => void;

/**
 * Options for creating a PatrolLoop
 */
export interface PatrolLoopOptions {
  /**
   * Function to check spawn health
   */
  checkFn: () => Promise<PatrolCheckResult>;

  /**
   * Patrol interval in milliseconds (default: 5 minutes)
   */
  intervalMs?: number;

  /**
   * Callback invoked after each patrol cycle
   */
  onCycle?: OnCycleCallback;

  /**
   * Callback invoked when checkFn throws an error
   */
  onError?: OnErrorCallback;
}

/**
 * Calculates the backoff interval based on consecutive failures.
 * Uses exponential backoff with a maximum of 1 hour.
 *
 * Backoff formula: baseInterval * 2^(failures-1), capped at MAX_BACKOFF_MS
 *
 * @param consecutiveFailures - Number of consecutive failures (1-indexed)
 * @param baseIntervalMs - Base interval in milliseconds
 * @returns Backoff interval in milliseconds
 *
 * @example
 * calculateBackoff(1, 5*60*1000) // 5 minutes (no backoff yet)
 * calculateBackoff(2, 5*60*1000) // 10 minutes (2x)
 * calculateBackoff(3, 5*60*1000) // 20 minutes (4x)
 */
export function calculateBackoff(consecutiveFailures: number, baseIntervalMs: number): number {
  if (consecutiveFailures <= 1) {
    return baseIntervalMs;
  }

  // Exponential backoff: baseInterval * 2^(failures-1)
  const multiplier = Math.pow(2, consecutiveFailures - 1);
  const backoffMs = baseIntervalMs * multiplier;

  // Cap at maximum backoff
  return Math.min(backoffMs, MAX_BACKOFF_MS);
}

/**
 * Patrol loop for continuous spawn monitoring.
 *
 * @example
 * const patrol = new PatrolLoop({
 *   checkFn: async () => {
 *     const result = await runMonitor();
 *     return {
 *       healthy: result.stuckSpawns.length === 0,
 *       stuckCount: result.stuckSpawns.length,
 *       zombieCount: result.zombieLocks.length,
 *     };
 *   },
 *   intervalMs: 5 * 60 * 1000, // 5 minutes
 *   onCycle: (result, meta) => {
 *     console.log(`Cycle ${meta.cycleNumber}: ${result.healthy ? 'healthy' : 'issues detected'}`);
 *   },
 * });
 *
 * patrol.start();
 * // Later...
 * patrol.stop();
 */
export class PatrolLoop {
  private readonly checkFn: () => Promise<PatrolCheckResult>;
  private readonly baseIntervalMs: number;
  private readonly onCycle?: OnCycleCallback;
  private readonly onError?: OnErrorCallback;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private failures = 0;
  private cycles = 0;

  /**
   * Creates a new PatrolLoop instance.
   *
   * @param options - Patrol loop configuration
   */
  constructor(options: PatrolLoopOptions) {
    this.checkFn = options.checkFn;
    this.baseIntervalMs = options.intervalMs ?? DEFAULT_PATROL_INTERVAL_MS;
    this.onCycle = options.onCycle;
    this.onError = options.onError;
  }

  /**
   * The configured base interval in milliseconds.
   */
  get intervalMs(): number {
    return this.baseIntervalMs;
  }

  /**
   * Whether the patrol loop is currently running.
   */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Number of consecutive failures (resets on success).
   */
  get consecutiveFailures(): number {
    return this.failures;
  }

  /**
   * Total number of completed patrol cycles.
   */
  get totalCycles(): number {
    return this.cycles;
  }

  /**
   * Starts the patrol loop.
   * Does nothing if already running.
   */
  start(): void {
    if (this.running) {
      return; // Already running, don't create duplicate timers
    }

    this.running = true;
    this.scheduleNextCycle();
  }

  /**
   * Stops the patrol loop.
   * Safe to call even if not running.
   */
  stop(): void {
    this.running = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Schedules the next patrol cycle.
   */
  private scheduleNextCycle(): void {
    if (!this.running) {
      return;
    }

    const intervalMs = calculateBackoff(this.failures, this.baseIntervalMs);

    this.timer = setTimeout(() => {
      void this.runCycle().then(() => this.scheduleNextCycle());
    }, intervalMs);
  }

  /**
   * Runs a single patrol cycle.
   */
  private async runCycle(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.cycles++;
    const cycleNumber = this.cycles;

    try {
      const result = await this.checkFn();

      // Success - reset failure count
      this.failures = 0;

      // Call cycle callback
      if (this.onCycle) {
        const meta: CycleMetadata = {
          cycleNumber,
          intervalMs: this.baseIntervalMs,
          consecutiveFailures: this.failures,
          timestamp: new Date(),
        };
        this.onCycle(result, meta);
      }
    } catch (error) {
      // Failure - increment failure count
      this.failures++;

      // Call error callback
      if (this.onError) {
        this.onError(error instanceof Error ? error : new Error(String(error)), cycleNumber);
      }
    }
  }
}

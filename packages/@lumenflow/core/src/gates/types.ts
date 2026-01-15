/**
 * Types for the gates runner.
 * @module @lumenflow/core/gates
 */

/** Gate names that can be run */
export type GateName = 'format' | 'lint' | 'typecheck' | 'test';

/** Result of running a single gate */
export interface GateResult {
  /** Name of the gate */
  gate: GateName;
  /** Whether the gate passed (exit code 0) */
  passed: boolean;
  /** Exit code from the process */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/** Result of running all gates */
export interface GatesResult {
  /** Whether all gates passed */
  passed: boolean;
  /** Number of gates that passed */
  passedCount: number;
  /** Number of gates that failed */
  failedCount: number;
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Results for each gate */
  results: GateResult[];
}

/** Options for running gates */
export interface RunGatesOptions {
  /** Working directory (required) */
  cwd: string;
  /** Stop on first failure (default: true) */
  failFast?: boolean;
  /** Specific gates to run (default: all) */
  gates?: GateName[];
  /** Custom commands for gates */
  commands?: Partial<Record<GateName, string>>;
}

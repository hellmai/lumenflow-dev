import path from 'node:path';
import { existsSync, unlinkSync, symlinkSync } from 'node:fs';

/**
 * Options for agent mode detection
 */
interface GatesAgentModeOptions {
  /** Command line arguments */
  argv?: string[];
  /** Environment variables */
  env?: Record<string, string | undefined>;
  /** stdout stream */
  stdout?: { isTTY?: boolean };
}

/**
 * Options for log path functions
 */
interface GatesLogOptions {
  /** Working directory */
  cwd: string;
  /** Environment variables */
  env?: Record<string, string | undefined>;
}

/**
 * Options for building gate log path
 */
interface BuildGatesLogPathOptions extends GatesLogOptions {
  /** WU ID */
  wuId?: string;
  /** Lane name */
  lane?: string;
  /** Current timestamp */
  now?: Date;
}

/**
 * Options for updating symlink
 */
interface UpdateGatesLatestSymlinkOptions extends GatesLogOptions {
  /** Path to the actual gate log file */
  logPath: string;
}

/**
 * Determine whether gates should run in low-noise "agent mode".
 *
 * Agent mode is intended for Claude Code sessions, where tool output is injected into the
 * conversation context and can trigger "prompt too long".
 *
 * Detection strategy (WU-1827):
 * 1. --verbose flag always forces full output (returns false)
 * 2. CLAUDE_PROJECT_DIR env var is a strong hint (returns true if set)
 * 3. TTY check: non-TTY + non-CI = likely agent mode (returns true)
 * 4. Interactive TTY = human user (returns false)
 *
 * @param {GatesAgentModeOptions} options
 * @returns {boolean} True if gates should run in agent mode
 */
export function shouldUseGatesAgentMode({ argv, env, stdout }: GatesAgentModeOptions = {}) {
  // --verbose flag always forces full output
  const isVerbose = Array.isArray(argv) && argv.includes('--verbose');
  if (isVerbose) {
    return false;
  }

  // CLAUDE_PROJECT_DIR is a strong hint that we're in Claude Code
  const hasClaudeProjectDir = Boolean(env?.CLAUDE_PROJECT_DIR);
  if (hasClaudeProjectDir) {
    return true;
  }

  // CI environments should get full output for debugging
  const isCI = Boolean(env?.CI);
  if (isCI) {
    return false;
  }

  // Use provided stdout or fall back to process.stdout
  const stdoutStream = stdout ?? process.stdout;

  // TTY check: non-TTY = likely agent mode (Claude Code Bash tool doesn't have TTY)
  // If stdout is undefined or isTTY is falsy, assume agent mode (safer default)
  const isTTY = stdoutStream?.isTTY ?? false;

  // Non-TTY + non-CI = likely agent mode
  return !isTTY;
}

export function getGatesLogDir({ cwd, env }: GatesLogOptions) {
  const configured = env?.LUMENFLOW_LOG_DIR;
  return path.resolve(cwd, configured || '.logs');
}

export function buildGatesLogPath({
  cwd,
  env,
  wuId,
  lane,
  now = new Date(),
}: BuildGatesLogPathOptions) {
  const logDir = getGatesLogDir({ cwd, env });
  const safeLane = (lane || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const safeWu = (wuId || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(logDir, `gates-${safeLane}-${safeWu}-${stamp}.log`);
}

/**
 * Get the path to the gates-latest.log symlink (WU-2064)
 *
 * @param {Object} options
 * @param {string} options.cwd - Working directory
 * @param {Object} [options.env] - Environment variables
 * @returns {string} Path to the symlink
 */
export function getGatesLatestSymlinkPath({ cwd, env }: GatesLogOptions) {
  const logDir = getGatesLogDir({ cwd, env });
  return path.join(logDir, 'gates-latest.log');
}

/**
 * Create or update the gates-latest.log symlink to point to the most recent gate run (WU-2064)
 *
 * This provides a stable path for agents to access the most recent gate log
 * without needing to know the timestamp-based filename.
 *
 * @param {Object} options
 * @param {string} options.logPath - Path to the actual gate log file
 * @param {string} options.cwd - Working directory
 * @param {Object} [options.env] - Environment variables
 * @returns {boolean} True if symlink was created/updated successfully
 */
export function updateGatesLatestSymlink({ logPath, cwd, env }: UpdateGatesLatestSymlinkOptions) {
  const symlinkPath = getGatesLatestSymlinkPath({ cwd, env });

  try {
    // Remove existing symlink if present
    if (existsSync(symlinkPath)) {
      unlinkSync(symlinkPath);
    }

    // Create relative symlink (so it works regardless of absolute path)
    const logDir = path.dirname(symlinkPath);
    const relativePath = path.relative(logDir, logPath);
    symlinkSync(relativePath, symlinkPath);

    return true;
  } catch {
    // Symlink creation is best-effort, don't fail gates
    return false;
  }
}

export const WU_DONE_PRE_COMMIT_GATE_DECISION_REASONS = {
  SKIP_GATES_FLAG: 'skip-gates-flag',
  REUSE_STEP_ZERO: 'reuse-step-zero',
  REUSE_CHECKPOINT: 'reuse-checkpoint',
  RUN_REQUIRED: 'run-required',
} as const;

export type WuDonePreCommitGateDecisionReason =
  (typeof WU_DONE_PRE_COMMIT_GATE_DECISION_REASONS)[keyof typeof WU_DONE_PRE_COMMIT_GATE_DECISION_REASONS];

export interface WuDonePreCommitGateDecisionInput {
  skipGates: boolean;
  fullGatesRanInCurrentRun: boolean;
  skippedByCheckpoint: boolean;
  checkpointId?: string | null;
}

export interface WuDonePreCommitGateDecision {
  runPreCommitFullSuite: boolean;
  reason: WuDonePreCommitGateDecisionReason;
  message: string;
}

/**
 * Decide whether wu:done pre-flight hook validation should rerun full gates.
 *
 * WU-1659: Avoid duplicate full-suite execution when Step 0 already ran gates
 * (or reused a valid checkpoint), while keeping operator-visible reasoning.
 */
export function resolveWuDonePreCommitGateDecision(
  input: WuDonePreCommitGateDecisionInput,
): WuDonePreCommitGateDecision {
  if (input.skipGates) {
    return {
      runPreCommitFullSuite: false,
      reason: WU_DONE_PRE_COMMIT_GATE_DECISION_REASONS.SKIP_GATES_FLAG,
      message: 'Pre-flight hook validation skipped because --skip-gates is active.',
    };
  }

  if (input.fullGatesRanInCurrentRun) {
    return {
      runPreCommitFullSuite: false,
      reason: WU_DONE_PRE_COMMIT_GATE_DECISION_REASONS.REUSE_STEP_ZERO,
      message:
        'Pre-flight hook validation reuses Step 0 gate results; duplicate full-suite run skipped.',
    };
  }

  if (input.skippedByCheckpoint) {
    const checkpointSuffix = input.checkpointId ? ` (${input.checkpointId})` : '';
    return {
      runPreCommitFullSuite: false,
      reason: WU_DONE_PRE_COMMIT_GATE_DECISION_REASONS.REUSE_CHECKPOINT,
      message: `Pre-flight hook validation reuses checkpoint gate attestation${checkpointSuffix}; duplicate full-suite run skipped.`,
    };
  }

  return {
    runPreCommitFullSuite: true,
    reason: WU_DONE_PRE_COMMIT_GATE_DECISION_REASONS.RUN_REQUIRED,
    message:
      'No gate attestation found for this wu:done run; executing pre-flight hook gate suite.',
  };
}

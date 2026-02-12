/**
 * @file cloud-detect.ts
 * @description Cloud mode activation and branch-aware guard logic
 *
 * WU-1495: Config-driven cloud detection foundation.
 * WU-1610: Cloud activation is explicit-only.
 *
 * Detection precedence (highest to lowest):
 * 1. --cloud CLI flag (explicit activation)
 * 2. LUMENFLOW_CLOUD=1 environment variable (explicit activation)
 *
 * Design decisions:
 * - Pure function with no I/O (env is injected, not read from process.env)
 * - LUMENFLOW_CLOUD only accepts '1' as truthy (not 'true', 'yes', etc.)
 * - Runtime identity signals are intentionally not used for cloud activation
 *
 * @module cloud-detect
 */

/**
 * Environment signal configuration from .lumenflow.config.yaml
 *
 * Defines an environment variable match rule.
 *
 * Note: These signals are runtime identity/context hints and are not used
 * for cloud execution-path activation (WU-1610).
 * When `equals` is omitted, presence of the variable (non-empty) is sufficient.
 * When `equals` is provided, the value must match exactly.
 */
export interface CloudEnvSignalConfig {
  /** Environment variable name to check */
  readonly name: string;
  /** Optional exact value match constraint */
  readonly equals?: string;
}

/**
 * Cloud detection configuration from .lumenflow.config.yaml
 */
export interface CloudDetectConfig {
  /** Deprecated activation toggle for env signals (ignored by detection logic) */
  readonly auto_detect: boolean;
  /** Runtime identity signals from config (not used for activation) */
  readonly env_signals: readonly CloudEnvSignalConfig[];
}

/**
 * Input for cloud detection (pure function, no I/O)
 */
export interface CloudDetectInput {
  /** Whether --cloud CLI flag was set */
  readonly cloudFlag: boolean;
  /** Environment variables (Record<string, string | undefined>) */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Cloud detection config from .lumenflow.config.yaml */
  readonly config: CloudDetectConfig;
}

/**
 * Activation source enum-like constants for cloud detection results.
 * Using const object + type pattern for type safety without runtime overhead.
 */
export const CLOUD_ACTIVATION_SOURCE = {
  /** Activated via --cloud CLI flag */
  FLAG: 'flag',
  /** Activated via LUMENFLOW_CLOUD=1 environment variable */
  ENV_VAR: 'env_var',
  /** Reserved legacy value (no longer emitted by detectCloudMode) */
  ENV_SIGNAL: 'env_signal',
} as const;

/** Type for activation source values */
export type CloudActivationSource =
  (typeof CLOUD_ACTIVATION_SOURCE)[keyof typeof CLOUD_ACTIVATION_SOURCE];

/**
 * Result of cloud detection
 */
export interface CloudDetectResult {
  /** Whether cloud mode should be activated */
  readonly isCloud: boolean;
  /** Source of activation (undefined when isCloud=false) */
  readonly source?: CloudActivationSource;
  /** Name of the matched env signal (only when source='env_signal') */
  readonly matchedSignal?: string;
}

/**
 * Effective cloud activation decision reason on a specific branch.
 */
export const CLOUD_EFFECTIVE_REASON = {
  /** env-signal auto-detection was suppressed on a protected branch */
  SUPPRESSED_ENV_SIGNAL_ON_PROTECTED: 'suppressed_env_signal_on_protected',
  /** explicit cloud activation was blocked on a protected branch */
  BLOCKED_EXPLICIT_ON_PROTECTED: 'blocked_explicit_on_protected',
} as const;

/** Type for effective decision reason values */
export type CloudEffectiveReason =
  (typeof CLOUD_EFFECTIVE_REASON)[keyof typeof CLOUD_EFFECTIVE_REASON];

/**
 * Input for branch-aware effective cloud activation.
 */
export interface EffectiveCloudActivationInput {
  /** Raw cloud detection output */
  readonly detection: CloudDetectResult;
  /** Current git branch */
  readonly currentBranch: string;
  /** Protected branches where cloud activation is restricted (default: main/master) */
  readonly protectedBranches?: readonly string[];
}

/**
 * Branch-aware effective cloud activation decision.
 */
export interface EffectiveCloudActivationResult {
  /** Whether cloud mode should be used after branch guard */
  readonly isCloud: boolean;
  /** Original activation source (if any) */
  readonly source?: CloudActivationSource;
  /** Matched env signal name (when source is env_signal) */
  readonly matchedSignal?: string;
  /** Whether activation came from explicit source (--cloud or LUMENFLOW_CLOUD=1) */
  readonly explicit: boolean;
  /** Whether cloud mode was suppressed (env-signal on protected branch) */
  readonly suppressed: boolean;
  /** Whether cloud mode was blocked (explicit activation on protected branch) */
  readonly blocked: boolean;
  /** Decision reason when suppressed/blocked */
  readonly reason?: CloudEffectiveReason;
}

/** Environment variable name for explicit cloud activation */
const LUMENFLOW_CLOUD_ENV = 'LUMENFLOW_CLOUD';

/** Value that activates cloud mode via LUMENFLOW_CLOUD env var */
const LUMENFLOW_CLOUD_ACTIVE_VALUE = '1';

/** Default protected branches where cloud activation is constrained */
const DEFAULT_PROTECTED_BRANCHES = ['main', 'master'] as const;

/**
 * Detect whether cloud mode should be activated.
 *
 * Implements explicit-only activation:
 * 1. --cloud flag (explicit, always wins)
 * 2. LUMENFLOW_CLOUD=1 (explicit env var, always wins)
 *
 * This function is pure: it takes all inputs explicitly and performs no I/O.
 * Runtime identity signals are intentionally ignored for activation.
 *
 * @param input - Detection inputs (flag, env, config)
 * @returns Detection result with source attribution
 */
export function detectCloudMode(input: CloudDetectInput): CloudDetectResult {
  const { cloudFlag, env } = input;

  // Precedence 1: --cloud CLI flag (highest priority)
  if (cloudFlag) {
    return {
      isCloud: true,
      source: CLOUD_ACTIVATION_SOURCE.FLAG,
    };
  }

  // Precedence 2: LUMENFLOW_CLOUD=1 environment variable
  if (env[LUMENFLOW_CLOUD_ENV] === LUMENFLOW_CLOUD_ACTIVE_VALUE) {
    return {
      isCloud: true,
      source: CLOUD_ACTIVATION_SOURCE.ENV_VAR,
    };
  }

  // No activation source matched
  return { isCloud: false };
}

/**
 * Resolve effective cloud activation with branch-aware protection.
 *
 * Rules:
 * - On protected branches (main/master by default):
 *   - env-signal auto-detection is suppressed (falls back to non-cloud mode)
 *   - explicit activation (--cloud or LUMENFLOW_CLOUD=1) is blocked
 * - On non-protected branches, detection result is preserved
 */
export function resolveEffectiveCloudActivation(
  input: EffectiveCloudActivationInput,
): EffectiveCloudActivationResult {
  const { detection, currentBranch } = input;
  const protectedBranches = input.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES;

  if (!detection.isCloud) {
    return {
      isCloud: false,
      explicit: false,
      suppressed: false,
      blocked: false,
    };
  }

  const explicit =
    detection.source === CLOUD_ACTIVATION_SOURCE.FLAG ||
    detection.source === CLOUD_ACTIVATION_SOURCE.ENV_VAR;
  const isProtectedBranch = protectedBranches.includes(currentBranch);

  if (!isProtectedBranch) {
    return {
      isCloud: true,
      source: detection.source,
      matchedSignal: detection.matchedSignal,
      explicit,
      suppressed: false,
      blocked: false,
    };
  }

  if (explicit) {
    return {
      isCloud: false,
      source: detection.source,
      matchedSignal: detection.matchedSignal,
      explicit: true,
      suppressed: false,
      blocked: true,
      reason: CLOUD_EFFECTIVE_REASON.BLOCKED_EXPLICIT_ON_PROTECTED,
    };
  }

  return {
    isCloud: false,
    source: detection.source,
    matchedSignal: detection.matchedSignal,
    explicit: false,
    suppressed: true,
    blocked: false,
    reason: CLOUD_EFFECTIVE_REASON.SUPPRESSED_ENV_SIGNAL_ON_PROTECTED,
  };
}

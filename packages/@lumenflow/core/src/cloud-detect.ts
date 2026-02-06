/**
 * @file cloud-detect.ts
 * @description Cloud mode auto-detection core logic
 *
 * WU-1495: Config-driven cloud auto-detection with precedence rules.
 *
 * Detection precedence (highest to lowest):
 * 1. --cloud CLI flag (explicit activation)
 * 2. LUMENFLOW_CLOUD=1 environment variable (explicit activation)
 * 3. env_signals from config (opt-in auto-detection, only when auto_detect=true)
 *
 * Design decisions:
 * - Pure function with no I/O (env is injected, not read from process.env)
 * - No hardcoded vendor-specific signals (all signals come from config)
 * - LUMENFLOW_CLOUD only accepts '1' as truthy (not 'true', 'yes', etc.)
 *
 * @module cloud-detect
 */

/**
 * Environment signal configuration from .lumenflow.config.yaml
 *
 * Defines an environment variable to check for cloud detection.
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
  /** Whether to enable env-signal auto-detection (default: false) */
  readonly auto_detect: boolean;
  /** Environment signals to check when auto_detect is true */
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
  /** Activated via env_signals auto-detection */
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

/** Environment variable name for explicit cloud activation */
const LUMENFLOW_CLOUD_ENV = 'LUMENFLOW_CLOUD';

/** Value that activates cloud mode via LUMENFLOW_CLOUD env var */
const LUMENFLOW_CLOUD_ACTIVE_VALUE = '1';

/**
 * Detect whether cloud mode should be activated.
 *
 * Implements a strict precedence chain:
 * 1. --cloud flag (explicit, always wins)
 * 2. LUMENFLOW_CLOUD=1 (explicit env var, always wins)
 * 3. env_signals auto-detection (opt-in, only when config.auto_detect=true)
 *
 * This function is pure: it takes all inputs explicitly and performs no I/O.
 * No vendor-specific signals are hardcoded; all signals come from config.
 *
 * @param input - Detection inputs (flag, env, config)
 * @returns Detection result with source attribution
 */
export function detectCloudMode(input: CloudDetectInput): CloudDetectResult {
  const { cloudFlag, env, config } = input;

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

  // Precedence 3: env_signals auto-detection (only when auto_detect=true)
  if (config.auto_detect) {
    for (const signal of config.env_signals) {
      const envValue = env[signal.name];

      // Skip if env var is not set or is empty
      if (envValue === undefined || envValue === '') {
        continue;
      }

      // If equals constraint is provided, check exact match
      if (signal.equals !== undefined) {
        if (envValue === signal.equals) {
          return {
            isCloud: true,
            source: CLOUD_ACTIVATION_SOURCE.ENV_SIGNAL,
            matchedSignal: signal.name,
          };
        }
        // Value doesn't match equals constraint, skip this signal
        continue;
      }

      // No equals constraint - presence of non-empty value is sufficient
      return {
        isCloud: true,
        source: CLOUD_ACTIVATION_SOURCE.ENV_SIGNAL,
        matchedSignal: signal.name,
      };
    }
  }

  // No activation source matched
  return { isCloud: false };
}

/**
 * @file cloud-detect.test.ts
 * @description Tests for cloud auto-detection core logic
 *
 * WU-1495: Config-driven cloud auto-detection core
 *
 * Acceptance Criteria:
 * AC1: Config schema includes cloud.auto_detect (default false) and cloud.env_signals ({name, equals?}[]).
 * AC2: Detection precedence enforces explicit activation first: --cloud/LUMENFLOW_CLOUD=1 always wins.
 * AC3: Env-signal auto-detection runs only when cloud.auto_detect is true.
 * AC4: Core detection logic has no hardcoded vendor-specific environment signals.
 * AC5: wu:claim --cloud with LUMENFLOW_CLOUD=1 already set does not conflict or double-apply.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  detectCloudMode,
  type CloudDetectInput,
  type CloudDetectResult,
  CLOUD_ACTIVATION_SOURCE,
} from '../cloud-detect.js';

// Test constants to avoid magic strings (sonarjs/no-duplicate-string)
const ENV_LUMENFLOW_CLOUD = 'LUMENFLOW_CLOUD';
const ENV_CI = 'CI';
const ENV_GITHUB_ACTIONS = 'GITHUB_ACTIONS';
const ENV_CODEX = 'CODEX';
const CLOUD_VALUE_TRUE = '1';
const CLOUD_VALUE_FALSE = '0';

describe('WU-1495: Cloud auto-detection core', () => {
  describe('AC2: Detection precedence - explicit activation always wins', () => {
    it('should detect cloud mode when --cloud flag is set', () => {
      const input: CloudDetectInput = {
        cloudFlag: true,
        env: {},
        config: { auto_detect: false, env_signals: [] },
      };

      const result = detectCloudMode(input);

      expect(result.isCloud).toBe(true);
      expect(result.source).toBe(CLOUD_ACTIVATION_SOURCE.FLAG);
    });

    it('should detect cloud mode when LUMENFLOW_CLOUD=1 is set', () => {
      const input: CloudDetectInput = {
        cloudFlag: false,
        env: { [ENV_LUMENFLOW_CLOUD]: CLOUD_VALUE_TRUE },
        config: { auto_detect: false, env_signals: [] },
      };

      const result = detectCloudMode(input);

      expect(result.isCloud).toBe(true);
      expect(result.source).toBe(CLOUD_ACTIVATION_SOURCE.ENV_VAR);
    });

    it('should not detect cloud when LUMENFLOW_CLOUD=0', () => {
      const input: CloudDetectInput = {
        cloudFlag: false,
        env: { [ENV_LUMENFLOW_CLOUD]: CLOUD_VALUE_FALSE },
        config: { auto_detect: false, env_signals: [] },
      };

      const result = detectCloudMode(input);

      expect(result.isCloud).toBe(false);
    });

    it('should let --cloud flag take precedence over auto_detect=false', () => {
      const input: CloudDetectInput = {
        cloudFlag: true,
        env: {},
        config: { auto_detect: false, env_signals: [] },
      };

      const result = detectCloudMode(input);

      expect(result.isCloud).toBe(true);
      expect(result.source).toBe(CLOUD_ACTIVATION_SOURCE.FLAG);
    });

    it('should let LUMENFLOW_CLOUD=1 take precedence over auto_detect=false', () => {
      const input: CloudDetectInput = {
        cloudFlag: false,
        env: { [ENV_LUMENFLOW_CLOUD]: CLOUD_VALUE_TRUE },
        config: { auto_detect: false, env_signals: [] },
      };

      const result = detectCloudMode(input);

      expect(result.isCloud).toBe(true);
      expect(result.source).toBe(CLOUD_ACTIVATION_SOURCE.ENV_VAR);
    });

    it('should let --cloud flag take precedence over env signals', () => {
      const input: CloudDetectInput = {
        cloudFlag: true,
        env: { [ENV_CI]: CLOUD_VALUE_TRUE },
        config: {
          auto_detect: true,
          env_signals: [{ name: ENV_CI }],
        },
      };

      const result = detectCloudMode(input);

      expect(result.isCloud).toBe(true);
      expect(result.source).toBe(CLOUD_ACTIVATION_SOURCE.FLAG);
    });

    it('should let LUMENFLOW_CLOUD=1 take precedence over env signals', () => {
      const input: CloudDetectInput = {
        cloudFlag: false,
        env: {
          [ENV_LUMENFLOW_CLOUD]: CLOUD_VALUE_TRUE,
          [ENV_CI]: CLOUD_VALUE_TRUE,
        },
        config: {
          auto_detect: true,
          env_signals: [{ name: ENV_CI }],
        },
      };

      const result = detectCloudMode(input);

      expect(result.isCloud).toBe(true);
      expect(result.source).toBe(CLOUD_ACTIVATION_SOURCE.ENV_VAR);
    });
  });

  describe('AC3: Env-signal auto-detection runs only when auto_detect is true', () => {
    it('should not run env-signal detection when auto_detect is false', () => {
      const input: CloudDetectInput = {
        cloudFlag: false,
        env: { [ENV_CI]: CLOUD_VALUE_TRUE },
        config: {
          auto_detect: false,
          env_signals: [{ name: ENV_CI }],
        },
      };

      const result = detectCloudMode(input);

      expect(result.isCloud).toBe(false);
      expect(result.source).toBeUndefined();
    });

    it('should detect cloud via env signal when auto_detect is true and signal matches', () => {
      const input: CloudDetectInput = {
        cloudFlag: false,
        env: { [ENV_CI]: CLOUD_VALUE_TRUE },
        config: {
          auto_detect: true,
          env_signals: [{ name: ENV_CI }],
        },
      };

      const result = detectCloudMode(input);

      expect(result.isCloud).toBe(true);
      expect(result.source).toBe(CLOUD_ACTIVATION_SOURCE.ENV_SIGNAL);
      expect(result.matchedSignal).toBe(ENV_CI);
    });

    it('should not detect cloud when auto_detect is true but no signals match', () => {
      const input: CloudDetectInput = {
        cloudFlag: false,
        env: {},
        config: {
          auto_detect: true,
          env_signals: [{ name: ENV_CI }],
        },
      };

      const result = detectCloudMode(input);

      expect(result.isCloud).toBe(false);
    });

    it('should match env signal by name only (presence check)', () => {
      const input: CloudDetectInput = {
        cloudFlag: false,
        env: { [ENV_GITHUB_ACTIONS]: 'true' },
        config: {
          auto_detect: true,
          env_signals: [{ name: ENV_GITHUB_ACTIONS }],
        },
      };

      const result = detectCloudMode(input);

      expect(result.isCloud).toBe(true);
      expect(result.matchedSignal).toBe(ENV_GITHUB_ACTIONS);
    });

    it('should match env signal with equals constraint', () => {
      const input: CloudDetectInput = {
        cloudFlag: false,
        env: { [ENV_CI]: 'true' },
        config: {
          auto_detect: true,
          env_signals: [{ name: ENV_CI, equals: 'true' }],
        },
      };

      const result = detectCloudMode(input);

      expect(result.isCloud).toBe(true);
      expect(result.matchedSignal).toBe(ENV_CI);
    });

    it('should not match env signal when equals constraint does not match', () => {
      const input: CloudDetectInput = {
        cloudFlag: false,
        env: { [ENV_CI]: 'false' },
        config: {
          auto_detect: true,
          env_signals: [{ name: ENV_CI, equals: 'true' }],
        },
      };

      const result = detectCloudMode(input);

      expect(result.isCloud).toBe(false);
    });

    it('should match first matching signal from multiple configured signals', () => {
      const input: CloudDetectInput = {
        cloudFlag: false,
        env: { [ENV_CODEX]: CLOUD_VALUE_TRUE },
        config: {
          auto_detect: true,
          env_signals: [{ name: ENV_CI }, { name: ENV_CODEX }, { name: ENV_GITHUB_ACTIONS }],
        },
      };

      const result = detectCloudMode(input);

      expect(result.isCloud).toBe(true);
      expect(result.matchedSignal).toBe(ENV_CODEX);
    });

    it('should return false when auto_detect is true but env_signals is empty', () => {
      const input: CloudDetectInput = {
        cloudFlag: false,
        env: { [ENV_CI]: CLOUD_VALUE_TRUE },
        config: {
          auto_detect: true,
          env_signals: [],
        },
      };

      const result = detectCloudMode(input);

      expect(result.isCloud).toBe(false);
    });
  });

  describe('AC4: No hardcoded vendor-specific environment signals', () => {
    it('should not detect cloud mode with no config and no flags', () => {
      const input: CloudDetectInput = {
        cloudFlag: false,
        env: {
          [ENV_CI]: CLOUD_VALUE_TRUE,
          [ENV_GITHUB_ACTIONS]: 'true',
          [ENV_CODEX]: CLOUD_VALUE_TRUE,
        },
        config: { auto_detect: false, env_signals: [] },
      };

      const result = detectCloudMode(input);

      // Even with CI-like env vars present, detection should NOT trigger
      // because no explicit activation or env_signals configuration exists
      expect(result.isCloud).toBe(false);
    });

    it('should only match user-configured env signals, not built-in ones', () => {
      const customSignal = 'MY_CUSTOM_CLOUD_SIGNAL';
      const input: CloudDetectInput = {
        cloudFlag: false,
        env: {
          [ENV_CI]: CLOUD_VALUE_TRUE,
          [customSignal]: 'yes',
        },
        config: {
          auto_detect: true,
          env_signals: [{ name: customSignal, equals: 'yes' }],
        },
      };

      const result = detectCloudMode(input);

      expect(result.isCloud).toBe(true);
      expect(result.matchedSignal).toBe(customSignal);
    });
  });

  describe('AC5: --cloud with LUMENFLOW_CLOUD=1 does not conflict or double-apply', () => {
    it('should not conflict when both --cloud flag and LUMENFLOW_CLOUD=1 are set', () => {
      const input: CloudDetectInput = {
        cloudFlag: true,
        env: { [ENV_LUMENFLOW_CLOUD]: CLOUD_VALUE_TRUE },
        config: { auto_detect: false, env_signals: [] },
      };

      const result = detectCloudMode(input);

      expect(result.isCloud).toBe(true);
      // Flag takes precedence (checked first)
      expect(result.source).toBe(CLOUD_ACTIVATION_SOURCE.FLAG);
    });

    it('should not conflict when all three sources agree (flag + env var + signal)', () => {
      const input: CloudDetectInput = {
        cloudFlag: true,
        env: {
          [ENV_LUMENFLOW_CLOUD]: CLOUD_VALUE_TRUE,
          [ENV_CI]: CLOUD_VALUE_TRUE,
        },
        config: {
          auto_detect: true,
          env_signals: [{ name: ENV_CI }],
        },
      };

      const result = detectCloudMode(input);

      expect(result.isCloud).toBe(true);
      // Flag takes highest precedence
      expect(result.source).toBe(CLOUD_ACTIVATION_SOURCE.FLAG);
    });
  });

  describe('WU-1592: CLAUDECODE signal support', () => {
    it('detects cloud when CLAUDECODE=1 and signal requires exact match', () => {
      const input: CloudDetectInput = {
        cloudFlag: false,
        env: { CLAUDECODE: '1' },
        config: {
          auto_detect: true,
          env_signals: [{ name: 'CLAUDECODE', equals: '1' }],
        },
      };

      const result = detectCloudMode(input);

      expect(result.isCloud).toBe(true);
      expect(result.source).toBe(CLOUD_ACTIVATION_SOURCE.ENV_SIGNAL);
      expect(result.matchedSignal).toBe('CLAUDECODE');
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined env gracefully', () => {
      const input: CloudDetectInput = {
        cloudFlag: false,
        env: {},
        config: { auto_detect: false, env_signals: [] },
      };

      const result = detectCloudMode(input);

      expect(result.isCloud).toBe(false);
    });

    it('should handle LUMENFLOW_CLOUD with non-1 truthy value', () => {
      const input: CloudDetectInput = {
        cloudFlag: false,
        env: { [ENV_LUMENFLOW_CLOUD]: 'true' },
        config: { auto_detect: false, env_signals: [] },
      };

      const result = detectCloudMode(input);

      // Only '1' is treated as explicit activation
      expect(result.isCloud).toBe(false);
    });

    it('should handle empty string env value as not present for signal matching', () => {
      const input: CloudDetectInput = {
        cloudFlag: false,
        env: { [ENV_CI]: '' },
        config: {
          auto_detect: true,
          env_signals: [{ name: ENV_CI }],
        },
      };

      const result = detectCloudMode(input);

      // Empty string is not considered "present"
      expect(result.isCloud).toBe(false);
    });
  });
});

/**
 * LumenFlow Config Schema Tests
 *
 * WU-1203: Add configurable progress signals to memory config
 *
 * Acceptance Criteria:
 * 1. ProgressSignalsConfigSchema added to lumenflow-config-schema.ts with enabled, frequency,
 *    on_milestone, on_tests_pass, before_gates, on_blocked, auto_checkpoint fields
 * 2. MemoryConfigSchema extended with optional progress_signals field
 */

import { describe, it, expect } from 'vitest';

import {
  ProgressSignalsConfigSchema,
  MemoryConfigSchema,
  LumenFlowConfigSchema,
  parseConfig,
  getDefaultConfig,
  type ProgressSignalsConfig,
  type MemoryConfig,
} from '../lumenflow-config-schema.js';

// Test constants for progress signals
const PROGRESS_SIGNALS_DEFAULTS = {
  enabled: false,
  frequency: 0,
  on_milestone: true,
  on_tests_pass: true,
  before_gates: true,
  on_blocked: true,
  auto_checkpoint: false,
} as const;

describe('WU-1203: Progress Signals Config Schema', () => {
  describe('AC1: ProgressSignalsConfigSchema', () => {
    it('should have enabled field defaulting to false', () => {
      const result = ProgressSignalsConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enabled).toBe(PROGRESS_SIGNALS_DEFAULTS.enabled);
      }
    });

    it('should have frequency field defaulting to 0 (disabled)', () => {
      const result = ProgressSignalsConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.frequency).toBe(PROGRESS_SIGNALS_DEFAULTS.frequency);
      }
    });

    it('should have on_milestone field defaulting to true', () => {
      const result = ProgressSignalsConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.on_milestone).toBe(PROGRESS_SIGNALS_DEFAULTS.on_milestone);
      }
    });

    it('should have on_tests_pass field defaulting to true', () => {
      const result = ProgressSignalsConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.on_tests_pass).toBe(PROGRESS_SIGNALS_DEFAULTS.on_tests_pass);
      }
    });

    it('should have before_gates field defaulting to true', () => {
      const result = ProgressSignalsConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.before_gates).toBe(PROGRESS_SIGNALS_DEFAULTS.before_gates);
      }
    });

    it('should have on_blocked field defaulting to true', () => {
      const result = ProgressSignalsConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.on_blocked).toBe(PROGRESS_SIGNALS_DEFAULTS.on_blocked);
      }
    });

    it('should have auto_checkpoint field defaulting to false', () => {
      const result = ProgressSignalsConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.auto_checkpoint).toBe(PROGRESS_SIGNALS_DEFAULTS.auto_checkpoint);
      }
    });

    it('should accept complete custom configuration', () => {
      const customConfig = {
        enabled: true,
        frequency: 10,
        on_milestone: false,
        on_tests_pass: false,
        before_gates: false,
        on_blocked: false,
        auto_checkpoint: true,
      };

      const result = ProgressSignalsConfigSchema.safeParse(customConfig);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(customConfig);
      }
    });

    it('should reject non-negative integer for frequency', () => {
      const result = ProgressSignalsConfigSchema.safeParse({ frequency: -1 });
      expect(result.success).toBe(false);
    });

    it('should reject non-boolean for enabled', () => {
      const result = ProgressSignalsConfigSchema.safeParse({ enabled: 'true' });
      expect(result.success).toBe(false);
    });
  });

  describe('AC2: MemoryConfigSchema with progress_signals', () => {
    it('should accept memory config without progress_signals (optional)', () => {
      const result = MemoryConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        // progress_signals should be undefined when not provided
        expect(result.data.progress_signals).toBeUndefined();
      }
    });

    it('should accept memory config with progress_signals', () => {
      const result = MemoryConfigSchema.safeParse({
        progress_signals: {
          enabled: true,
          frequency: 5,
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.progress_signals).toBeDefined();
        expect(result.data.progress_signals?.enabled).toBe(true);
        expect(result.data.progress_signals?.frequency).toBe(5);
        // Defaults should be applied
        expect(result.data.progress_signals?.on_milestone).toBe(true);
      }
    });

    it('should preserve existing memory config fields with progress_signals', () => {
      const result = MemoryConfigSchema.safeParse({
        directory: 'custom-memory/',
        sessionTtl: 1000,
        progress_signals: {
          enabled: true,
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.directory).toBe('custom-memory/');
        expect(result.data.sessionTtl).toBe(1000);
        expect(result.data.progress_signals?.enabled).toBe(true);
      }
    });
  });

  describe('LumenFlowConfigSchema integration', () => {
    it('should include progress_signals in full config parsing', () => {
      const config = {
        memory: {
          progress_signals: {
            enabled: true,
            frequency: 20,
            auto_checkpoint: true,
          },
        },
      };

      const result = LumenFlowConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.memory.progress_signals).toBeDefined();
        expect(result.data.memory.progress_signals?.enabled).toBe(true);
        expect(result.data.memory.progress_signals?.frequency).toBe(20);
        expect(result.data.memory.progress_signals?.auto_checkpoint).toBe(true);
      }
    });

    it('should work with parseConfig helper', () => {
      const config = parseConfig({
        memory: {
          progress_signals: {
            enabled: true,
          },
        },
      });

      expect(config.memory.progress_signals).toBeDefined();
      expect(config.memory.progress_signals?.enabled).toBe(true);
    });

    it('should work with getDefaultConfig', () => {
      const config = getDefaultConfig();

      // progress_signals should be optional and undefined by default
      expect(config.memory).toBeDefined();
      // Not including progress_signals in defaults keeps backwards compatibility
    });
  });

  describe('Type safety', () => {
    it('should infer correct ProgressSignalsConfig type', () => {
      // This is a compile-time check - if types are wrong, this won't compile
      const _config: ProgressSignalsConfig = {
        enabled: true,
        frequency: 10,
        on_milestone: true,
        on_tests_pass: true,
        before_gates: true,
        on_blocked: true,
        auto_checkpoint: false,
      };

      expect(_config.enabled).toBe(true);
    });

    it('should allow optional progress_signals on MemoryConfig type', () => {
      // Compile-time check for optional field
      const _memoryWithSignals: MemoryConfig = {
        directory: 'test/',
        sessionTtl: 1000,
        checkpointTtl: 2000,
        enableAutoCleanup: true,
        progress_signals: {
          enabled: true,
          frequency: 0,
          on_milestone: true,
          on_tests_pass: true,
          before_gates: true,
          on_blocked: true,
          auto_checkpoint: false,
        },
      };

      const _memoryWithoutSignals: MemoryConfig = {
        directory: 'test/',
        sessionTtl: 1000,
        checkpointTtl: 2000,
        enableAutoCleanup: true,
      };

      expect(_memoryWithSignals.progress_signals).toBeDefined();
      expect(_memoryWithoutSignals.progress_signals).toBeUndefined();
    });
  });
});

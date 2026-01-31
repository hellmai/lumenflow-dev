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
  EventArchivalConfigSchema,
  MemoryConfigSchema,
  BeaconPathsSchema,
  LumenFlowConfigSchema,
  parseConfig,
  getDefaultConfig,
  type ProgressSignalsConfig,
  type EventArchivalConfig,
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

// Common test constants to avoid duplicate string literals (sonarjs/no-duplicate-string)
const TEST_CUSTOM_MEMORY_DIR = 'custom-memory/';
const TEST_MEMORY_DIR = 'test/';
const DESCRIBE_TYPE_SAFETY = 'Type safety';

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
        directory: TEST_CUSTOM_MEMORY_DIR,
        sessionTtl: 1000,
        progress_signals: {
          enabled: true,
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.directory).toBe(TEST_CUSTOM_MEMORY_DIR);
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

  describe('WU-1207: Event Archival Config Schema', () => {
    // 90 days in milliseconds
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

    describe('EventArchivalConfigSchema defaults', () => {
      it('should have archiveAfter defaulting to 90 days', () => {
        const result = EventArchivalConfigSchema.safeParse({});

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.archiveAfter).toBe(NINETY_DAYS_MS);
        }
      });

      it('should have keepArchives defaulting to true', () => {
        const result = EventArchivalConfigSchema.safeParse({});

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.keepArchives).toBe(true);
        }
      });

      it('should accept custom archiveAfter value', () => {
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;
        const result = EventArchivalConfigSchema.safeParse({
          archiveAfter: thirtyDays,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.archiveAfter).toBe(thirtyDays);
        }
      });

      it('should reject non-positive archiveAfter', () => {
        const result = EventArchivalConfigSchema.safeParse({
          archiveAfter: 0,
        });
        expect(result.success).toBe(false);
      });

      it('should reject non-boolean keepArchives', () => {
        const result = EventArchivalConfigSchema.safeParse({
          keepArchives: 'true',
        });
        expect(result.success).toBe(false);
      });
    });

    describe('BeaconPathsSchema with eventArchival', () => {
      it('should include eventArchival in beacon paths', () => {
        const result = BeaconPathsSchema.safeParse({});

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.eventArchival).toBeDefined();
          expect(result.data.eventArchival.archiveAfter).toBe(NINETY_DAYS_MS);
          expect(result.data.eventArchival.keepArchives).toBe(true);
        }
      });

      it('should accept custom eventArchival configuration', () => {
        const result = BeaconPathsSchema.safeParse({
          eventArchival: {
            archiveAfter: 60 * 24 * 60 * 60 * 1000, // 60 days
            keepArchives: false,
          },
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.eventArchival.archiveAfter).toBe(60 * 24 * 60 * 60 * 1000);
          expect(result.data.eventArchival.keepArchives).toBe(false);
        }
      });
    });

    describe(DESCRIBE_TYPE_SAFETY, () => {
      it('should infer correct EventArchivalConfig type', () => {
        const _config: EventArchivalConfig = {
          archiveAfter: NINETY_DAYS_MS,
          keepArchives: true,
        };

        expect(_config.archiveAfter).toBe(NINETY_DAYS_MS);
      });
    });
  });

  describe(DESCRIBE_TYPE_SAFETY, () => {
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
        directory: TEST_MEMORY_DIR,
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
        directory: TEST_MEMORY_DIR,
        sessionTtl: 1000,
        checkpointTtl: 2000,
        enableAutoCleanup: true,
      };

      expect(_memoryWithSignals.progress_signals).toBeDefined();
      expect(_memoryWithoutSignals.progress_signals).toBeUndefined();
    });
  });
});

/**
 * WU-1289: Tests for spawn_context_max_size configuration
 *
 * Acceptance Criteria:
 * 1. Config schema supports memory.spawn_context_max_size with default
 * 2. Schema tests cover parsing and defaults
 */
describe('WU-1289: spawn_context_max_size Config Schema', () => {
  // Default value: 4KB (4096 bytes)
  const DEFAULT_SPAWN_CONTEXT_MAX_SIZE = 4096;

  describe('AC1: MemoryConfigSchema with spawn_context_max_size', () => {
    it('should have spawn_context_max_size defaulting to 4096 bytes', () => {
      const result = MemoryConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.spawn_context_max_size).toBe(DEFAULT_SPAWN_CONTEXT_MAX_SIZE);
      }
    });

    it('should accept custom spawn_context_max_size value', () => {
      const customSize = 8192; // 8KB
      const result = MemoryConfigSchema.safeParse({
        spawn_context_max_size: customSize,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.spawn_context_max_size).toBe(customSize);
      }
    });

    it('should accept large spawn_context_max_size values (up to 64KB)', () => {
      const largeSize = 65536; // 64KB
      const result = MemoryConfigSchema.safeParse({
        spawn_context_max_size: largeSize,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.spawn_context_max_size).toBe(largeSize);
      }
    });

    it('should reject non-positive spawn_context_max_size', () => {
      const result = MemoryConfigSchema.safeParse({
        spawn_context_max_size: 0,
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative spawn_context_max_size', () => {
      const result = MemoryConfigSchema.safeParse({
        spawn_context_max_size: -1,
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-integer spawn_context_max_size', () => {
      const result = MemoryConfigSchema.safeParse({
        spawn_context_max_size: 4096.5,
      });
      expect(result.success).toBe(false);
    });

    it('should preserve spawn_context_max_size alongside other memory config fields', () => {
      const result = MemoryConfigSchema.safeParse({
        directory: TEST_CUSTOM_MEMORY_DIR,
        sessionTtl: 1000,
        spawn_context_max_size: 16384,
        progress_signals: {
          enabled: true,
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.directory).toBe(TEST_CUSTOM_MEMORY_DIR);
        expect(result.data.sessionTtl).toBe(1000);
        expect(result.data.spawn_context_max_size).toBe(16384);
        expect(result.data.progress_signals?.enabled).toBe(true);
      }
    });
  });

  describe('AC4: LumenFlowConfigSchema integration', () => {
    it('should include spawn_context_max_size in full config parsing with default', () => {
      const result = LumenFlowConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.memory.spawn_context_max_size).toBe(DEFAULT_SPAWN_CONTEXT_MAX_SIZE);
      }
    });

    it('should accept custom spawn_context_max_size in full config', () => {
      const config = {
        memory: {
          spawn_context_max_size: 8192,
        },
      };

      const result = LumenFlowConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.memory.spawn_context_max_size).toBe(8192);
      }
    });

    it('should work with parseConfig helper', () => {
      const config = parseConfig({
        memory: {
          spawn_context_max_size: 16384,
        },
      });

      expect(config.memory.spawn_context_max_size).toBe(16384);
    });

    it('should include default spawn_context_max_size in getDefaultConfig', () => {
      const config = getDefaultConfig();

      expect(config.memory.spawn_context_max_size).toBe(DEFAULT_SPAWN_CONTEXT_MAX_SIZE);
    });
  });

  describe(DESCRIBE_TYPE_SAFETY, () => {
    it('should include spawn_context_max_size in MemoryConfig type', () => {
      // Compile-time check - if type is wrong, this won't compile
      const _memoryConfig: MemoryConfig = {
        directory: TEST_MEMORY_DIR,
        sessionTtl: 1000,
        checkpointTtl: 2000,
        enableAutoCleanup: true,
        spawn_context_max_size: 4096,
      };

      expect(_memoryConfig.spawn_context_max_size).toBe(4096);
    });
  });
});

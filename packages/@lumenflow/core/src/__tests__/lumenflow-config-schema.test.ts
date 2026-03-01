// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

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
  StatePathsSchema,
  LumenFlowConfigSchema,
  DirectoriesSchema,
  parseConfig,
  getDefaultConfig,
  LockPolicySchema,
  LaneDefinitionSchema,
  AutoCheckpointConfigSchema,
  MemoryEnforcementConfigSchema,
  CloudEnvSignalSchema,
  CloudConfigSchema,
  WuConfigSchema,
  type ProgressSignalsConfig,
  type EventArchivalConfig,
  type MemoryConfig,
  type WuBriefPolicyMode,
  type LockPolicy,
  type LaneDefinition,
  type AutoCheckpointConfig,
  type MemoryEnforcementConfig,
  type CloudEnvSignal,
  type CloudConfig,
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

// Shared lane test constants (used by WU-1322, WU-1345)
const TEST_LANE_FRAMEWORK_CORE = 'Framework: Core';
const TEST_LANE_CONTENT_DOCS = 'Content: Documentation';
const TEST_CODE_PATH_CORE = 'packages/@lumenflow/core/**';
const TEST_CODE_PATH_DOCS = 'docs/**';
const TEST_WIP_JUSTIFICATION = 'Docs WUs are low-conflict parallel work';
const LOCK_POLICY_ALL = 'all';
const LOCK_POLICY_ACTIVE = 'active';
const LOCK_POLICY_NONE = 'none';

describe('WU-2287: wu:brief policy config schema', () => {
  it('defaults wu.brief.policyMode to auto', () => {
    const result = WuConfigSchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.brief.policyMode).toBe('auto');
    }
  });

  it('accepts custom policy modes', () => {
    const result = WuConfigSchema.safeParse({
      brief: {
        policyMode: 'manual',
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.brief.policyMode).toBe('manual');
    }
  });

  it('rejects unknown policy modes', () => {
    const result = WuConfigSchema.safeParse({
      brief: {
        policyMode: 'sometimes',
      },
    });

    expect(result.success).toBe(false);
  });

  it('propagates wu.brief.policyMode through full config parsing', () => {
    const result = LumenFlowConfigSchema.safeParse({
      wu: {
        brief: {
          policyMode: 'off',
        },
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.wu.brief.policyMode).toBe('off');
    }
  });

  it('exports WuBriefPolicyMode type', () => {
    const _policyMode: WuBriefPolicyMode = 'required';

    expect(_policyMode).toBe('required');
  });
});

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

    describe('StatePathsSchema with eventArchival', () => {
      it('should include eventArchival in state paths', () => {
        const result = StatePathsSchema.safeParse({});

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.eventArchival).toBeDefined();
          expect(result.data.eventArchival.archiveAfter).toBe(NINETY_DAYS_MS);
          expect(result.data.eventArchival.keepArchives).toBe(true);
        }
      });

      it('should accept custom eventArchival configuration', () => {
        const result = StatePathsSchema.safeParse({
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
 * WU-1322: Tests for lock_policy field in lane configuration
 *
 * Acceptance Criteria:
 * 1. LaneConfigSchema includes lock_policy field with enum validation
 * 2. Default value is 'all' for backward compatibility
 * 3. TypeScript types exported: LockPolicy type
 * 4. Example added to workspace.yaml software_delivery (commented)
 * 5. All existing tests pass (no breaking changes)
 */
describe('WU-1322: LockPolicy Config Schema', () => {
  describe('AC1: LockPolicySchema enum validation', () => {
    it('should accept "all" as valid lock_policy', () => {
      const result = LockPolicySchema.safeParse(LOCK_POLICY_ALL);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(LOCK_POLICY_ALL);
      }
    });

    it('should accept "active" as valid lock_policy', () => {
      const result = LockPolicySchema.safeParse(LOCK_POLICY_ACTIVE);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(LOCK_POLICY_ACTIVE);
      }
    });

    it('should accept "none" as valid lock_policy', () => {
      const result = LockPolicySchema.safeParse(LOCK_POLICY_NONE);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(LOCK_POLICY_NONE);
      }
    });

    it('should reject invalid lock_policy values', () => {
      const result = LockPolicySchema.safeParse('invalid');
      expect(result.success).toBe(false);
    });

    it('should reject non-string lock_policy values', () => {
      const result = LockPolicySchema.safeParse(123);
      expect(result.success).toBe(false);
    });
  });

  describe('AC2: Default value is "all" for backward compatibility', () => {
    it('should default to "all" when lock_policy is not provided in lane definition', () => {
      const result = LaneDefinitionSchema.safeParse({
        name: TEST_LANE_FRAMEWORK_CORE,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.lock_policy).toBe(LOCK_POLICY_ALL);
      }
    });

    it('should preserve explicit lock_policy when provided', () => {
      const result = LaneDefinitionSchema.safeParse({
        name: TEST_LANE_CONTENT_DOCS,
        lock_policy: LOCK_POLICY_NONE,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.lock_policy).toBe(LOCK_POLICY_NONE);
      }
    });

    it('should preserve existing lane config fields alongside lock_policy', () => {
      const result = LaneDefinitionSchema.safeParse({
        name: TEST_LANE_FRAMEWORK_CORE,
        wip_limit: 2,
        wip_justification: 'Test justification',
        lock_policy: LOCK_POLICY_ACTIVE,
        code_paths: [TEST_CODE_PATH_CORE],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe(TEST_LANE_FRAMEWORK_CORE);
        expect(result.data.wip_limit).toBe(2);
        expect(result.data.wip_justification).toBe('Test justification');
        expect(result.data.lock_policy).toBe(LOCK_POLICY_ACTIVE);
        expect(result.data.code_paths).toEqual([TEST_CODE_PATH_CORE]);
      }
    });
  });

  describe('AC3: TypeScript types exported', () => {
    it('should export LockPolicy type (compile-time check)', () => {
      // This is a compile-time check - if types are wrong, this won't compile
      // Type inference test - should compile without errors
      const _policy: LockPolicy = 'all';
      expect(_policy).toBe('all');
    });

    it('should export LaneDefinition type (compile-time check)', () => {
      // Compile-time check for LaneDefinition type
      const _lane: LaneDefinition = {
        name: TEST_LANE_FRAMEWORK_CORE,
        lock_policy: LOCK_POLICY_ALL,
      };
      expect(_lane.name).toBe(TEST_LANE_FRAMEWORK_CORE);
      expect(_lane.lock_policy).toBe(LOCK_POLICY_ALL);
    });
  });

  describe('AC5: No breaking changes to existing lane config', () => {
    it('should parse existing lane config without lock_policy', () => {
      // Simulates existing workspace.yaml software_delivery lanes without lock_policy
      const existingLaneConfig = {
        name: TEST_LANE_FRAMEWORK_CORE,
        wip_limit: 1,
        code_paths: [TEST_CODE_PATH_CORE],
      };

      const result = LaneDefinitionSchema.safeParse(existingLaneConfig);

      expect(result.success).toBe(true);
      if (result.success) {
        // Should have default lock_policy
        expect(result.data.lock_policy).toBe(LOCK_POLICY_ALL);
        // Should preserve all other fields
        expect(result.data.name).toBe(TEST_LANE_FRAMEWORK_CORE);
        expect(result.data.wip_limit).toBe(1);
      }
    });

    it('should parse lane with wip_justification (WU-1187 compatibility)', () => {
      const laneWithJustification = {
        name: TEST_LANE_CONTENT_DOCS,
        wip_limit: 4,
        wip_justification: TEST_WIP_JUSTIFICATION,
      };

      const result = LaneDefinitionSchema.safeParse(laneWithJustification);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.wip_limit).toBe(4);
        expect(result.data.wip_justification).toBe(TEST_WIP_JUSTIFICATION);
        expect(result.data.lock_policy).toBe(LOCK_POLICY_ALL);
      }
    });
  });
});

/**
 * WU-1289: Tests for delegation_context_max_size configuration
 *
 * Acceptance Criteria:
 * 1. Config schema supports memory.delegation_context_max_size with default
 * 2. Schema tests cover parsing and defaults
 */
describe('WU-1674: delegation_context_max_size Config Schema', () => {
  // Default value: 4KB (4096 bytes)
  const DEFAULT_DELEGATION_CONTEXT_MAX_SIZE = 4096;

  describe('AC1: MemoryConfigSchema with delegation_context_max_size', () => {
    it('should have delegation_context_max_size defaulting to 4096 bytes', () => {
      const result = MemoryConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delegation_context_max_size).toBe(DEFAULT_DELEGATION_CONTEXT_MAX_SIZE);
      }
    });

    it('should accept custom delegation_context_max_size value', () => {
      const customSize = 8192; // 8KB
      const result = MemoryConfigSchema.safeParse({
        delegation_context_max_size: customSize,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delegation_context_max_size).toBe(customSize);
      }
    });

    it('should accept large delegation_context_max_size values (up to 64KB)', () => {
      const largeSize = 65536; // 64KB
      const result = MemoryConfigSchema.safeParse({
        delegation_context_max_size: largeSize,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delegation_context_max_size).toBe(largeSize);
      }
    });

    it('should reject non-positive delegation_context_max_size', () => {
      const result = MemoryConfigSchema.safeParse({
        delegation_context_max_size: 0,
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative delegation_context_max_size', () => {
      const result = MemoryConfigSchema.safeParse({
        delegation_context_max_size: -1,
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-integer delegation_context_max_size', () => {
      const result = MemoryConfigSchema.safeParse({
        delegation_context_max_size: 4096.5,
      });
      expect(result.success).toBe(false);
    });

    it('should reject deprecated spawn_context_max_size with explicit guidance', () => {
      const result = MemoryConfigSchema.safeParse({
        spawn_context_max_size: 4096,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((issue) => issue.message).join(' ');
        expect(messages).toMatch(/delegation_context_max_size/i);
      }
    });

    it('should preserve delegation_context_max_size alongside other memory config fields', () => {
      const result = MemoryConfigSchema.safeParse({
        directory: TEST_CUSTOM_MEMORY_DIR,
        sessionTtl: 1000,
        delegation_context_max_size: 16384,
        progress_signals: {
          enabled: true,
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.directory).toBe(TEST_CUSTOM_MEMORY_DIR);
        expect(result.data.sessionTtl).toBe(1000);
        expect(result.data.delegation_context_max_size).toBe(16384);
        expect(result.data.progress_signals?.enabled).toBe(true);
      }
    });
  });

  describe('AC4: LumenFlowConfigSchema integration', () => {
    it('should include delegation_context_max_size in full config parsing with default', () => {
      const result = LumenFlowConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.memory.delegation_context_max_size).toBe(
          DEFAULT_DELEGATION_CONTEXT_MAX_SIZE,
        );
      }
    });

    it('should accept custom delegation_context_max_size in full config', () => {
      const config = {
        memory: {
          delegation_context_max_size: 8192,
        },
      };

      const result = LumenFlowConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.memory.delegation_context_max_size).toBe(8192);
      }
    });

    it('should work with parseConfig helper', () => {
      const config = parseConfig({
        memory: {
          delegation_context_max_size: 16384,
        },
      });

      expect(config.memory.delegation_context_max_size).toBe(16384);
    });

    it('should include default delegation_context_max_size in getDefaultConfig', () => {
      const config = getDefaultConfig();

      expect(config.memory.delegation_context_max_size).toBe(DEFAULT_DELEGATION_CONTEXT_MAX_SIZE);
    });
  });

  describe(DESCRIBE_TYPE_SAFETY, () => {
    it('should include delegation_context_max_size in MemoryConfig type', () => {
      // Compile-time check - if type is wrong, this won't compile
      const _memoryConfig: MemoryConfig = {
        directory: TEST_MEMORY_DIR,
        sessionTtl: 1000,
        checkpointTtl: 2000,
        enableAutoCleanup: true,
        delegation_context_max_size: 4096,
      };

      expect(_memoryConfig.delegation_context_max_size).toBe(4096);
    });
  });
});

/**
 * WU-1345: Tests for lanes field in LumenFlowConfigSchema
 *
 * Bug fix: resolveLaneConfigsFromConfig(getConfig()) receives undefined lanes
 * because Zod strips unknown keys and lanes is not in the schema.
 *
 * Acceptance Criteria:
 * 1. LumenFlowConfigSchema includes lanes field with proper typing
 * 2. resolveLaneConfigsFromConfig receives typed lanes from getConfig()
 * 3. Existing lane config from workspace.yaml software_delivery is correctly parsed
 * 4. Unit tests verify lanes are preserved through Zod parsing
 */
describe('WU-1345: Lanes field in LumenFlowConfigSchema', () => {
  describe('AC1: LumenFlowConfigSchema includes lanes field with proper typing', () => {
    it('should accept lanes config with definitions array', () => {
      const config = {
        lanes: {
          definitions: [
            {
              name: TEST_LANE_FRAMEWORK_CORE,
              wip_limit: 1,
              code_paths: [TEST_CODE_PATH_CORE],
            },
          ],
        },
      };

      const result = LumenFlowConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.lanes).toBeDefined();
        expect(result.data.lanes?.definitions).toHaveLength(1);
        expect(result.data.lanes?.definitions?.[0]?.name).toBe(TEST_LANE_FRAMEWORK_CORE);
      }
    });

    it('should accept lanes config with enforcement section', () => {
      const config = {
        lanes: {
          enforcement: {
            require_parent: true,
            allow_custom: false,
          },
          definitions: [
            {
              name: TEST_LANE_FRAMEWORK_CORE,
              wip_limit: 1,
            },
          ],
        },
      };

      const result = LumenFlowConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.lanes?.enforcement?.require_parent).toBe(true);
        expect(result.data.lanes?.enforcement?.allow_custom).toBe(false);
      }
    });

    it('should preserve lock_policy in lane definitions', () => {
      const config = {
        lanes: {
          definitions: [
            {
              name: TEST_LANE_CONTENT_DOCS,
              wip_limit: 4,
              wip_justification: TEST_WIP_JUSTIFICATION,
              lock_policy: LOCK_POLICY_NONE,
              code_paths: [TEST_CODE_PATH_DOCS],
            },
          ],
        },
      };

      const result = LumenFlowConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        const lane = result.data.lanes?.definitions?.[0];
        expect(lane?.lock_policy).toBe(LOCK_POLICY_NONE);
        expect(lane?.wip_justification).toBe(TEST_WIP_JUSTIFICATION);
      }
    });

    it('should accept engineering and business sections (alternate format)', () => {
      const config = {
        lanes: {
          engineering: [
            {
              name: TEST_LANE_FRAMEWORK_CORE,
              wip_limit: 1,
            },
          ],
          business: [
            {
              name: TEST_LANE_CONTENT_DOCS,
              wip_limit: 2,
            },
          ],
        },
      };

      const result = LumenFlowConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.lanes?.engineering).toHaveLength(1);
        expect(result.data.lanes?.business).toHaveLength(1);
      }
    });
  });

  describe('AC3: Existing lane config from workspace.yaml software_delivery is correctly parsed', () => {
    it('should parse real-world lanes config structure', () => {
      // Mirrors the actual workspace.yaml software_delivery lane structure
      const realWorldConfig = {
        lanes: {
          enforcement: {
            require_parent: true,
            allow_custom: false,
          },
          definitions: [
            {
              name: TEST_LANE_FRAMEWORK_CORE,
              wip_limit: 1,
              code_paths: [TEST_CODE_PATH_CORE],
            },
            {
              name: 'Framework: CLI',
              wip_limit: 1,
              code_paths: ['packages/@lumenflow/cli/**'],
            },
            {
              name: TEST_LANE_CONTENT_DOCS,
              wip_limit: 4,
              wip_justification:
                'Docs WUs are low-conflict parallel work targeting different pages',
              code_paths: ['docs/**', 'apps/docs/**'],
            },
          ],
        },
      };

      const result = LumenFlowConfigSchema.safeParse(realWorldConfig);

      expect(result.success).toBe(true);
      if (result.success) {
        const lanes = result.data.lanes;
        expect(lanes).toBeDefined();
        expect(lanes?.definitions).toHaveLength(3);

        // Check Framework: Core
        const coreLane = lanes?.definitions?.find((l) => l.name === TEST_LANE_FRAMEWORK_CORE);
        expect(coreLane?.wip_limit).toBe(1);

        // Check Content: Documentation
        const docsLane = lanes?.definitions?.find((l) => l.name === TEST_LANE_CONTENT_DOCS);
        expect(docsLane?.wip_limit).toBe(4);
        expect(docsLane?.wip_justification).toContain('low-conflict');
      }
    });
  });

  describe('AC4: parseConfig helper preserves lanes', () => {
    it('should preserve lanes through parseConfig helper', () => {
      const config = parseConfig({
        lanes: {
          definitions: [
            {
              name: TEST_LANE_FRAMEWORK_CORE,
              wip_limit: 1,
            },
          ],
        },
      });

      expect(config.lanes).toBeDefined();
      expect(config.lanes?.definitions?.[0]?.name).toBe(TEST_LANE_FRAMEWORK_CORE);
    });

    it('should have undefined lanes in getDefaultConfig (not required)', () => {
      const config = getDefaultConfig();
      // lanes is optional, should be undefined by default
      expect(config.lanes).toBeUndefined();
    });
  });

  describe('Backwards compatibility', () => {
    it('should parse config without lanes field (optional)', () => {
      const config = {
        version: '1.0.0',
      };

      const result = LumenFlowConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.lanes).toBeUndefined();
      }
    });

    it('should preserve all other config fields alongside lanes', () => {
      const config = {
        version: '2.0',
        lanes: {
          definitions: [{ name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 1 }],
        },
        memory: {
          directory: TEST_CUSTOM_MEMORY_DIR,
        },
      };

      const result = LumenFlowConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe('2.0');
        expect(result.data.lanes?.definitions).toHaveLength(1);
        expect(result.data.memory.directory).toBe(TEST_CUSTOM_MEMORY_DIR);
      }
    });
  });
});

/**
 * WU-1471: Auto-checkpoint enforcement + wu:done checkpoint gate
 *
 * Acceptance Criteria:
 * AC1: Integrate generates PostToolUse and async SubagentStop hooks when
 *       memory.enforcement.auto_checkpoint.enabled=true and hooks=true.
 * AC3: wu:done supports memory.enforcement.require_checkpoint_for_done
 *       (warn by default, block when enabled).
 * AC5: When auto-checkpoint policy is enabled but hooks master switch is
 *       disabled, tooling emits a warning and remains advisory-only.
 */
describe('WU-1471: Auto-checkpoint enforcement config schema', () => {
  describe('AC1: AutoCheckpointConfigSchema', () => {
    it('should default enabled to false', () => {
      const result = AutoCheckpointConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enabled).toBe(false);
      }
    });

    it('should default interval_tool_calls to 30', () => {
      const result = AutoCheckpointConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.interval_tool_calls).toBe(30);
      }
    });

    it('should accept custom configuration', () => {
      const customConfig = {
        enabled: true,
        interval_tool_calls: 50,
      };

      const result = AutoCheckpointConfigSchema.safeParse(customConfig);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enabled).toBe(true);
        expect(result.data.interval_tool_calls).toBe(50);
      }
    });

    it('should reject non-positive interval_tool_calls', () => {
      const result = AutoCheckpointConfigSchema.safeParse({ interval_tool_calls: 0 });
      expect(result.success).toBe(false);
    });

    it('should reject non-integer interval_tool_calls', () => {
      const result = AutoCheckpointConfigSchema.safeParse({ interval_tool_calls: 10.5 });
      expect(result.success).toBe(false);
    });
  });

  describe('AC3: MemoryEnforcementConfigSchema with require_checkpoint_for_done', () => {
    it('should default require_checkpoint_for_done to warn', () => {
      const result = MemoryEnforcementConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.require_checkpoint_for_done).toBe('warn');
      }
    });

    it('should accept block mode', () => {
      const result = MemoryEnforcementConfigSchema.safeParse({
        require_checkpoint_for_done: 'block',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.require_checkpoint_for_done).toBe('block');
      }
    });

    it('should accept off mode', () => {
      const result = MemoryEnforcementConfigSchema.safeParse({
        require_checkpoint_for_done: 'off',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.require_checkpoint_for_done).toBe('off');
      }
    });

    it('should reject invalid mode', () => {
      const result = MemoryEnforcementConfigSchema.safeParse({
        require_checkpoint_for_done: 'error',
      });
      expect(result.success).toBe(false);
    });

    it('should include auto_checkpoint sub-schema', () => {
      const result = MemoryEnforcementConfigSchema.safeParse({
        auto_checkpoint: {
          enabled: true,
          interval_tool_calls: 25,
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.auto_checkpoint.enabled).toBe(true);
        expect(result.data.auto_checkpoint.interval_tool_calls).toBe(25);
      }
    });
  });

  describe('MemoryConfigSchema with enforcement', () => {
    it('should accept memory config without enforcement (optional)', () => {
      const result = MemoryConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enforcement).toBeUndefined();
      }
    });

    it('should accept memory config with enforcement', () => {
      const result = MemoryConfigSchema.safeParse({
        enforcement: {
          auto_checkpoint: { enabled: true },
          require_checkpoint_for_done: 'block',
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enforcement).toBeDefined();
        expect(result.data.enforcement?.auto_checkpoint.enabled).toBe(true);
        expect(result.data.enforcement?.require_checkpoint_for_done).toBe('block');
      }
    });

    it('should preserve existing memory fields alongside enforcement', () => {
      const result = MemoryConfigSchema.safeParse({
        directory: TEST_CUSTOM_MEMORY_DIR,
        enforcement: {
          require_checkpoint_for_done: 'warn',
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.directory).toBe(TEST_CUSTOM_MEMORY_DIR);
        expect(result.data.enforcement?.require_checkpoint_for_done).toBe('warn');
      }
    });
  });

  describe('LumenFlowConfigSchema integration', () => {
    it('should include enforcement in full config parsing', () => {
      const config = {
        memory: {
          enforcement: {
            auto_checkpoint: { enabled: true, interval_tool_calls: 20 },
            require_checkpoint_for_done: 'block',
          },
        },
      };

      const result = LumenFlowConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.memory.enforcement).toBeDefined();
        expect(result.data.memory.enforcement?.auto_checkpoint.enabled).toBe(true);
        expect(result.data.memory.enforcement?.auto_checkpoint.interval_tool_calls).toBe(20);
        expect(result.data.memory.enforcement?.require_checkpoint_for_done).toBe('block');
      }
    });

    it('should work with parseConfig helper', () => {
      const config = parseConfig({
        memory: {
          enforcement: {
            auto_checkpoint: { enabled: true },
          },
        },
      });

      expect(config.memory.enforcement).toBeDefined();
      expect(config.memory.enforcement?.auto_checkpoint.enabled).toBe(true);
    });

    it('should have undefined enforcement in getDefaultConfig', () => {
      const config = getDefaultConfig();
      expect(config.memory.enforcement).toBeUndefined();
    });
  });

  describe(DESCRIBE_TYPE_SAFETY, () => {
    it('should infer correct AutoCheckpointConfig type', () => {
      const _config: AutoCheckpointConfig = {
        enabled: true,
        interval_tool_calls: 30,
      };
      expect(_config.enabled).toBe(true);
    });

    it('should infer correct MemoryEnforcementConfig type', () => {
      const _config: MemoryEnforcementConfig = {
        auto_checkpoint: { enabled: false, interval_tool_calls: 30 },
        require_checkpoint_for_done: 'warn',
      };
      expect(_config.require_checkpoint_for_done).toBe('warn');
    });
  });
});

/**
 * WU-1495: Cloud auto-detection config schema
 *
 * Acceptance Criteria:
 * AC1: Config schema includes cloud.auto_detect (default false) and cloud.env_signals ({name, equals?}[]).
 */
describe('WU-1495: Cloud Config Schema', () => {
  describe('AC1: CloudEnvSignalSchema', () => {
    it('should accept signal with name only (presence check)', () => {
      const result = CloudEnvSignalSchema.safeParse({ name: 'CI' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('CI');
        expect(result.data.equals).toBeUndefined();
      }
    });

    it('should accept signal with name and equals constraint', () => {
      const result = CloudEnvSignalSchema.safeParse({ name: 'CI', equals: 'true' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('CI');
        expect(result.data.equals).toBe('true');
      }
    });

    it('should reject signal without name', () => {
      const result = CloudEnvSignalSchema.safeParse({ equals: 'true' });
      expect(result.success).toBe(false);
    });

    it('should reject non-string name', () => {
      const result = CloudEnvSignalSchema.safeParse({ name: 123 });
      expect(result.success).toBe(false);
    });

    it('should reject empty name', () => {
      const result = CloudEnvSignalSchema.safeParse({ name: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('AC1: CloudConfigSchema defaults', () => {
    it('should default auto_detect to false', () => {
      const result = CloudConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.auto_detect).toBe(false);
      }
    });

    it('should default env_signals to empty array', () => {
      const result = CloudConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.env_signals).toEqual([]);
      }
    });

    it('should accept custom auto_detect value', () => {
      const result = CloudConfigSchema.safeParse({ auto_detect: true });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.auto_detect).toBe(true);
      }
    });

    it('should accept custom env_signals array', () => {
      const signals = [{ name: 'CI' }, { name: 'GITHUB_ACTIONS', equals: 'true' }];
      const result = CloudConfigSchema.safeParse({
        auto_detect: true,
        env_signals: signals,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.env_signals).toHaveLength(2);
        expect(result.data.env_signals[0].name).toBe('CI');
        expect(result.data.env_signals[1].equals).toBe('true');
      }
    });

    it('should reject non-boolean auto_detect', () => {
      const result = CloudConfigSchema.safeParse({ auto_detect: 'true' });
      expect(result.success).toBe(false);
    });

    it('should reject invalid env_signals entries', () => {
      const result = CloudConfigSchema.safeParse({
        env_signals: [{ invalid: 'entry' }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('LumenFlowConfigSchema integration', () => {
    it('should accept config with cloud section', () => {
      const config = {
        cloud: {
          auto_detect: true,
          env_signals: [{ name: 'CI' }],
        },
      };

      const result = LumenFlowConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cloud).toBeDefined();
        expect(result.data.cloud.auto_detect).toBe(true);
        expect(result.data.cloud.env_signals).toHaveLength(1);
      }
    });

    it('should provide defaults when cloud section is omitted', () => {
      const result = LumenFlowConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cloud).toBeDefined();
        expect(result.data.cloud.auto_detect).toBe(false);
        expect(result.data.cloud.env_signals).toEqual([]);
      }
    });

    it('should work with parseConfig helper', () => {
      const config = parseConfig({
        cloud: {
          auto_detect: true,
          env_signals: [{ name: 'CODEX', equals: '1' }],
        },
      });

      expect(config.cloud.auto_detect).toBe(true);
      expect(config.cloud.env_signals[0].name).toBe('CODEX');
    });

    it('should include cloud defaults in getDefaultConfig', () => {
      const config = getDefaultConfig();

      expect(config.cloud).toBeDefined();
      expect(config.cloud.auto_detect).toBe(false);
      expect(config.cloud.env_signals).toEqual([]);
    });
  });

  describe(DESCRIBE_TYPE_SAFETY, () => {
    it('should infer correct CloudEnvSignal type', () => {
      const _signal: CloudEnvSignal = {
        name: 'CI',
        equals: 'true',
      };
      expect(_signal.name).toBe('CI');
    });

    it('should allow optional equals on CloudEnvSignal type', () => {
      const _signal: CloudEnvSignal = {
        name: 'CI',
      };
      expect(_signal.equals).toBeUndefined();
    });

    it('should infer correct CloudConfig type', () => {
      const _config: CloudConfig = {
        auto_detect: true,
        env_signals: [{ name: 'CI' }],
      };
      expect(_config.auto_detect).toBe(true);
    });
  });
});

/**
 * WU-1654: DirectoriesSchema safeGitPath field
 * Verifies configurable safe-git path with correct default.
 */
describe('WU-1654: DirectoriesSchema safeGitPath', () => {
  it('should have safeGitPath field defaulting to scripts/safe-git', () => {
    const result = DirectoriesSchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.safeGitPath).toBe('scripts/safe-git');
    }
  });

  it('should accept custom safeGitPath value', () => {
    const result = DirectoriesSchema.safeParse({ safeGitPath: 'tools/shims/git' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.safeGitPath).toBe('tools/shims/git');
    }
  });

  it('should include safeGitPath in full config defaults', () => {
    const config = getDefaultConfig();
    expect(config.directories.safeGitPath).toBe('scripts/safe-git');
  });

  it('WU-1755: build_command default should be generic pnpm build (F10)', () => {
    const config = getDefaultConfig();
    // Should NOT reference @lumenflow/cli (that's source-repo-specific)
    expect(config.build_command).toBe('pnpm build');
    expect(config.build_command).not.toContain('@lumenflow/cli');
  });
});

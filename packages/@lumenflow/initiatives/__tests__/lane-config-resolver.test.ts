/**
 * WU-1345: Lane Config Resolver Tests
 *
 * Tests for resolveLaneConfigsFromConfig to verify that lane config
 * is correctly extracted from Zod-parsed LumenFlow config.
 *
 * Bug fix context: WU-1340 wired resolveLaneConfigsFromConfig(getConfig())
 * but getConfig() returns Zod-parsed config which stripped lanes because
 * it wasn't in the schema. This file tests the fix.
 */

import { describe, it, expect } from 'vitest';

import { resolveLaneConfigsFromConfig } from '../src/lane-config-resolver.js';

// Import the schema to verify integration
import { LumenFlowConfigSchema } from '@lumenflow/core';

// Test constants for lane names (sonarjs/no-duplicate-string)
const TEST_LANE_FRAMEWORK_CORE = 'Framework: Core';
const TEST_LANE_CONTENT_DOCS = 'Content: Documentation';
const TEST_CODE_PATH_CORE = 'packages/@lumenflow/core/**';
const TEST_CODE_PATH_DOCS = 'docs/**';
const TEST_WIP_JUSTIFICATION = 'Docs WUs are low-conflict parallel work';
const LOCK_POLICY_ALL = 'all';
const LOCK_POLICY_NONE = 'none';

describe('WU-1345: Lane Config Resolver with Zod-parsed Config', () => {
  describe('resolveLaneConfigsFromConfig with parsed config', () => {
    it('should extract lane configs from Zod-parsed config with definitions', () => {
      // Simulate the flow: YAML -> Zod parse -> resolveLaneConfigsFromConfig
      const rawConfig = {
        lanes: {
          definitions: [
            {
              name: TEST_LANE_FRAMEWORK_CORE,
              wip_limit: 1,
              lock_policy: 'all',
              code_paths: [TEST_CODE_PATH_CORE],
            },
            {
              name: TEST_LANE_CONTENT_DOCS,
              wip_limit: 4,
              lock_policy: 'none',
            },
          ],
        },
      };

      // Parse through Zod (simulates getConfig())
      const parsed = LumenFlowConfigSchema.parse(rawConfig);

      // This was the bug: lanes was undefined after parsing
      expect(parsed.lanes).toBeDefined();

      // Now test resolveLaneConfigsFromConfig
      const laneConfigs = resolveLaneConfigsFromConfig(parsed);

      expect(laneConfigs[TEST_LANE_FRAMEWORK_CORE]).toBeDefined();
      expect(laneConfigs[TEST_LANE_FRAMEWORK_CORE].wip_limit).toBe(1);
      expect(laneConfigs[TEST_LANE_FRAMEWORK_CORE].lock_policy).toBe(LOCK_POLICY_ALL);

      expect(laneConfigs[TEST_LANE_CONTENT_DOCS]).toBeDefined();
      expect(laneConfigs[TEST_LANE_CONTENT_DOCS].wip_limit).toBe(4);
      expect(laneConfigs[TEST_LANE_CONTENT_DOCS].lock_policy).toBe(LOCK_POLICY_NONE);
    });

    it('should extract lanes from engineering/business sections', () => {
      const rawConfig = {
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

      const parsed = LumenFlowConfigSchema.parse(rawConfig);
      const laneConfigs = resolveLaneConfigsFromConfig(parsed);

      expect(Object.keys(laneConfigs)).toHaveLength(2);
      expect(laneConfigs[TEST_LANE_FRAMEWORK_CORE].wip_limit).toBe(1);
      expect(laneConfigs[TEST_LANE_CONTENT_DOCS].wip_limit).toBe(2);
    });

    it('should return empty object when lanes not in config', () => {
      const rawConfig = {
        version: '1.0.0',
      };

      const parsed = LumenFlowConfigSchema.parse(rawConfig);
      const laneConfigs = resolveLaneConfigsFromConfig(parsed);

      expect(Object.keys(laneConfigs)).toHaveLength(0);
    });

    it('should preserve lock_policy through full parsing flow', () => {
      // This test verifies the complete flow that was broken before WU-1345
      const configLikeRealWorld = {
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
              name: TEST_LANE_CONTENT_DOCS,
              wip_limit: 4,
              wip_justification: TEST_WIP_JUSTIFICATION,
              lock_policy: LOCK_POLICY_NONE,
              code_paths: [TEST_CODE_PATH_DOCS],
            },
          ],
        },
      };

      const parsed = LumenFlowConfigSchema.parse(configLikeRealWorld);
      const laneConfigs = resolveLaneConfigsFromConfig(parsed);

      // Framework: Core should have default lock_policy 'all'
      expect(laneConfigs[TEST_LANE_FRAMEWORK_CORE]).toBeDefined();
      expect(laneConfigs[TEST_LANE_FRAMEWORK_CORE].wip_limit).toBe(1);
      expect(laneConfigs[TEST_LANE_FRAMEWORK_CORE].lock_policy).toBe(LOCK_POLICY_ALL);

      // Content: Documentation should have explicit lock_policy 'none'
      expect(laneConfigs[TEST_LANE_CONTENT_DOCS]).toBeDefined();
      expect(laneConfigs[TEST_LANE_CONTENT_DOCS].wip_limit).toBe(4);
      expect(laneConfigs[TEST_LANE_CONTENT_DOCS].lock_policy).toBe(LOCK_POLICY_NONE);
    });
  });

  describe('backwards compatibility', () => {
    it('should work with config that has no lanes field', () => {
      const parsed = LumenFlowConfigSchema.parse({});
      const laneConfigs = resolveLaneConfigsFromConfig(parsed);

      expect(laneConfigs).toEqual({});
    });

    it('should work with direct (non-Zod-parsed) config', () => {
      // The resolver should also work with raw config objects
      const rawConfig = {
        lanes: {
          definitions: [
            {
              name: TEST_LANE_FRAMEWORK_CORE,
              wip_limit: 1,
            },
          ],
        },
      };

      const laneConfigs = resolveLaneConfigsFromConfig(rawConfig);

      expect(laneConfigs[TEST_LANE_FRAMEWORK_CORE]).toBeDefined();
      expect(laneConfigs[TEST_LANE_FRAMEWORK_CORE].wip_limit).toBe(1);
    });
  });
});

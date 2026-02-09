/**
 * @file cleanup-trigger-config.test.ts
 * Test suite for cleanup.trigger config option (WU-1366)
 *
 * WU-1366: Add cleanup.trigger config option (on_done | on_init | manual)
 *          with on_done as default.
 *
 * Tests:
 * - Schema validates cleanup.trigger enum values
 * - Default value is 'on_done'
 * - Invalid values are rejected
 * - Config is correctly parsed from YAML
 */

import { describe, it, expect } from 'vitest';
import {
  LumenFlowConfigSchema,
  parseConfig,
  getDefaultConfig,
  CleanupConfigSchema,
} from '../lumenflow-config-schema.js';

describe('cleanup.trigger config (WU-1366)', () => {
  describe('CleanupConfigSchema', () => {
    it('should accept "on_done" as a valid trigger value', () => {
      const result = CleanupConfigSchema.safeParse({ trigger: 'on_done' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.trigger).toBe('on_done');
      }
    });

    it('should accept "on_init" as a valid trigger value', () => {
      const result = CleanupConfigSchema.safeParse({ trigger: 'on_init' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.trigger).toBe('on_init');
      }
    });

    it('should accept "manual" as a valid trigger value', () => {
      const result = CleanupConfigSchema.safeParse({ trigger: 'manual' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.trigger).toBe('manual');
      }
    });

    it('should reject invalid trigger values', () => {
      const result = CleanupConfigSchema.safeParse({ trigger: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('should default trigger to "on_done"', () => {
      const result = CleanupConfigSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.trigger).toBe('on_done');
      }
    });
  });

  // WU-1542: Configurable commit message
  describe('cleanup.commit_message (WU-1542)', () => {
    it('should accept a custom commit_message', () => {
      const result = CleanupConfigSchema.safeParse({
        commit_message: 'chore(repair): auto state cleanup [skip ci]',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.commit_message).toBe('chore(repair): auto state cleanup [skip ci]');
      }
    });

    it('should default commit_message to universal format without scope', () => {
      const result = CleanupConfigSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        // Must NOT use chore(lumenflow): - that breaks consumer main-branch guards
        expect(result.data.commit_message).toBe('chore: lumenflow state cleanup [skip ci]');
        expect(result.data.commit_message).not.toContain('chore(lumenflow)');
      }
    });

    it('should include commit_message in full config schema', () => {
      const config = parseConfig({
        cleanup: {
          commit_message: 'fix: state cleanup',
        },
      });
      expect(config.cleanup.commit_message).toBe('fix: state cleanup');
    });

    it('should default commit_message in full config', () => {
      const config = getDefaultConfig();
      expect(config.cleanup.commit_message).toBe('chore: lumenflow state cleanup [skip ci]');
    });
  });

  describe('LumenFlowConfigSchema cleanup integration', () => {
    it('should include cleanup config in full config schema', () => {
      const config = parseConfig({
        cleanup: {
          trigger: 'manual',
        },
      });

      expect(config.cleanup).toBeDefined();
      expect(config.cleanup.trigger).toBe('manual');
    });

    it('should default cleanup.trigger to "on_done" in full config', () => {
      const config = getDefaultConfig();
      expect(config.cleanup).toBeDefined();
      expect(config.cleanup.trigger).toBe('on_done');
    });

    it('should validate cleanup config in full config schema', () => {
      const result = LumenFlowConfigSchema.safeParse({
        cleanup: {
          trigger: 'on_init',
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cleanup.trigger).toBe('on_init');
      }
    });
  });
});

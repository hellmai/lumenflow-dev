/**
 * Tests for git.requireRemote configuration
 *
 * WU-1302: Verify that git.requireRemote=false allows wu:create to work
 * without a remote repository configured.
 */

import { describe, it, expect } from 'vitest';
import { GitConfigSchema, LumenFlowConfigSchema, parseConfig } from '../lumenflow-config-schema.js';

describe('git.requireRemote config (WU-1302)', () => {
  describe('schema validation', () => {
    it('accepts git.requireRemote=false in config', () => {
      const config = {
        git: {
          requireRemote: false,
        },
      };

      const result = LumenFlowConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.git.requireRemote).toBe(false);
      }
    });

    it('accepts git.requireRemote=true in config', () => {
      const config = {
        git: {
          requireRemote: true,
        },
      };

      const result = LumenFlowConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.git.requireRemote).toBe(true);
      }
    });

    it('defaults git.requireRemote to true when not specified', () => {
      const config = {};

      const result = parseConfig(config);
      expect(result.git.requireRemote).toBe(true);
    });

    it('GitConfigSchema includes requireRemote field', () => {
      const gitConfig = {
        requireRemote: false,
        mainBranch: 'main',
      };

      const result = GitConfigSchema.safeParse(gitConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.requireRemote).toBe(false);
      }
    });
  });

  describe('config semantics', () => {
    it('requireRemote=true means remote is required (default, online mode)', () => {
      const config = parseConfig({ git: { requireRemote: true } });

      // When true, operations should fail if no remote exists
      expect(config.git.requireRemote).toBe(true);
    });

    it('requireRemote=false means remote is optional (offline/local mode)', () => {
      const config = parseConfig({ git: { requireRemote: false } });

      // When false, operations can proceed without a remote
      expect(config.git.requireRemote).toBe(false);
    });

    it('config can be loaded with other git settings unchanged', () => {
      const config = parseConfig({
        git: {
          requireRemote: false,
          mainBranch: 'develop', // Custom main branch
          laneBranchPrefix: 'feature/', // Custom prefix
        },
      });

      expect(config.git.requireRemote).toBe(false);
      expect(config.git.mainBranch).toBe('develop');
      expect(config.git.laneBranchPrefix).toBe('feature/');
    });
  });
});

// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Config Key Normalization Tests (WU-1765)
 *
 * Verifies that snake_case YAML keys (e.g., agent_branch_patterns)
 * are correctly normalized to camelCase before Zod parsing.
 *
 * Root cause: workspace.yaml software_delivery commonly uses snake_case keys, but the Zod
 * schema expects camelCase. yaml.parse() returns keys as-is, and Zod
 * silently drops unrecognized keys, causing config values to be lost.
 */

import { describe, it, expect } from 'vitest';
import { normalizeConfigKeys } from '../normalize-config-keys.js';
import { parseConfig } from '../lumenflow-config-schema.js';

describe('normalizeConfigKeys (WU-1765)', () => {
  describe('git section snake_case to camelCase', () => {
    it('should normalize agent_branch_patterns to agentBranchPatterns', () => {
      const raw = {
        git: {
          agent_branch_patterns: ['claude/*', 'codex/*'],
        },
      };

      const normalized = normalizeConfigKeys(raw);
      expect(normalized.git.agentBranchPatterns).toEqual(['claude/*', 'codex/*']);
    });

    it('should normalize main_branch to mainBranch', () => {
      const raw = {
        git: {
          main_branch: 'develop',
        },
      };

      const normalized = normalizeConfigKeys(raw);
      expect(normalized.git.mainBranch).toBe('develop');
    });

    it('should normalize disable_agent_pattern_registry to disableAgentPatternRegistry', () => {
      const raw = {
        git: {
          disable_agent_pattern_registry: true,
        },
      };

      const normalized = normalizeConfigKeys(raw);
      expect(normalized.git.disableAgentPatternRegistry).toBe(true);
    });

    it('should normalize agent_branch_patterns_override to agentBranchPatternsOverride', () => {
      const raw = {
        git: {
          agent_branch_patterns_override: ['only-this/*'],
        },
      };

      const normalized = normalizeConfigKeys(raw);
      expect(normalized.git.agentBranchPatternsOverride).toEqual(['only-this/*']);
    });

    it('should preserve already-camelCase keys', () => {
      const raw = {
        git: {
          agentBranchPatterns: ['claude/*'],
          mainBranch: 'main',
        },
      };

      const normalized = normalizeConfigKeys(raw);
      expect(normalized.git.agentBranchPatterns).toEqual(['claude/*']);
      expect(normalized.git.mainBranch).toBe('main');
    });

    it('should prefer camelCase over snake_case when both exist', () => {
      const raw = {
        git: {
          agent_branch_patterns: ['snake/*'],
          agentBranchPatterns: ['camel/*'],
        },
      };

      const normalized = normalizeConfigKeys(raw);
      // camelCase takes precedence (explicit schema form wins)
      expect(normalized.git.agentBranchPatterns).toEqual(['camel/*']);
    });

    it('should normalize default_remote to defaultRemote', () => {
      const raw = {
        git: {
          default_remote: 'upstream',
        },
      };

      const normalized = normalizeConfigKeys(raw);
      expect(normalized.git.defaultRemote).toBe('upstream');
    });

    it('should normalize require_remote to requireRemote', () => {
      const raw = {
        git: {
          require_remote: false,
        },
      };

      const normalized = normalizeConfigKeys(raw);
      expect(normalized.git.requireRemote).toBe(false);
    });

    it('should normalize lane_branch_prefix to laneBranchPrefix', () => {
      const raw = {
        git: {
          lane_branch_prefix: 'feature/',
        },
      };

      const normalized = normalizeConfigKeys(raw);
      expect(normalized.git.laneBranchPrefix).toBe('feature/');
    });

    it('should normalize max_branch_drift to maxBranchDrift', () => {
      const raw = {
        git: {
          max_branch_drift: 10,
        },
      };

      const normalized = normalizeConfigKeys(raw);
      expect(normalized.git.maxBranchDrift).toBe(10);
    });
  });

  describe('passthrough for non-git sections', () => {
    it('should pass through sections without git key unchanged', () => {
      const raw = {
        version: '1.0.0',
        directories: {
          wuDir: 'tasks/wu',
        },
      };

      const normalized = normalizeConfigKeys(raw);
      expect(normalized.version).toBe('1.0.0');
      expect(normalized.directories.wuDir).toBe('tasks/wu');
    });

    it('should handle empty input', () => {
      const normalized = normalizeConfigKeys({});
      expect(normalized).toEqual({});
    });

    it('should handle missing git section', () => {
      const raw = { version: '1.0.0' };
      const normalized = normalizeConfigKeys(raw);
      expect(normalized.git).toBeUndefined();
    });
  });

  describe('integration with parseConfig', () => {
    it('should produce valid config when snake_case YAML is normalized before parsing', () => {
      const rawYaml = {
        git: {
          agent_branch_patterns: ['claude/*', 'codex/*'],
          main_branch: 'main',
        },
      };

      const normalized = normalizeConfigKeys(rawYaml);
      const config = parseConfig(normalized);

      expect(config.git.agentBranchPatterns).toEqual(['claude/*', 'codex/*']);
      expect(config.git.mainBranch).toBe('main');
    });

    it('should make agent_branch_patterns available after full config loading', () => {
      const rawYaml = {
        git: {
          agent_branch_patterns: ['claude/*', 'codex/*', 'agent/*'],
        },
      };

      const normalized = normalizeConfigKeys(rawYaml);
      const config = parseConfig(normalized);

      // This is the critical assertion: claude/* should be in the patterns
      expect(config.git.agentBranchPatterns).toContain('claude/*');
      expect(config.git.agentBranchPatterns).toContain('codex/*');
    });
  });
});

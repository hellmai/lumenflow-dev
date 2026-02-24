// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file git-status-parser.test.ts
 * Tests for the git-status-parser sub-module (WU-2127)
 */

import { describe, it, expect } from 'vitest';
import {
  parseDirtyPathsFromStatus,
  getNonAllowlistedDirtyPaths,
  formatBlockedPaths,
  formatMainDirtyMutationGuardMessage,
} from '../../hooks/git-status-parser.js';

describe('WU-2127: git-status-parser sub-module', () => {
  describe('parseDirtyPathsFromStatus', () => {
    it('should parse modified file paths', () => {
      const status = ' M packages/cli/src/file.ts\n M packages/core/src/index.ts\n';
      const paths = parseDirtyPathsFromStatus(status);
      expect(paths).toContain('packages/cli/src/file.ts');
      expect(paths).toContain('packages/core/src/index.ts');
    });

    it('should handle rename entries (destination path)', () => {
      const status = 'R  old/path.ts -> new/path.ts\n';
      const paths = parseDirtyPathsFromStatus(status);
      expect(paths).toContain('new/path.ts');
    });

    it('should handle quoted paths', () => {
      const status = ' M "packages/cli/src/file.ts"\n';
      const paths = parseDirtyPathsFromStatus(status);
      expect(paths).toContain('packages/cli/src/file.ts');
    });

    it('should handle ./ prefixed paths', () => {
      const status = ' M ./src/file.ts\n';
      const paths = parseDirtyPathsFromStatus(status);
      expect(paths).toContain('src/file.ts');
    });

    it('should return empty array for empty status', () => {
      expect(parseDirtyPathsFromStatus('')).toEqual([]);
    });

    it('should return empty array for blank lines only', () => {
      expect(parseDirtyPathsFromStatus('\n\n\n')).toEqual([]);
    });

    it('should deduplicate identical paths', () => {
      const status = ' M packages/cli/src/file.ts\n M packages/cli/src/file.ts\n';
      const paths = parseDirtyPathsFromStatus(status);
      expect(paths).toHaveLength(1);
    });

    it('should skip lines shorter than prefix length', () => {
      const status = 'AB\n M valid/path.ts\n';
      const paths = parseDirtyPathsFromStatus(status);
      expect(paths).toEqual(['valid/path.ts']);
    });
  });

  describe('getNonAllowlistedDirtyPaths', () => {
    const ALLOWLIST = ['.lumenflow/', '.claude/', 'docs/04-operations/tasks/wu/'] as const;

    it('should filter out allowlisted paths', () => {
      const status = ' M .lumenflow/state/events.jsonl\n M packages/cli/src/file.ts\n';
      const blocked = getNonAllowlistedDirtyPaths(status, ALLOWLIST);
      expect(blocked).toEqual(['packages/cli/src/file.ts']);
    });

    it('should return empty when all paths are allowlisted', () => {
      const status = ' M .lumenflow/state/events.jsonl\n M .claude/settings.json\n';
      const blocked = getNonAllowlistedDirtyPaths(status, ALLOWLIST);
      expect(blocked).toEqual([]);
    });

    it('should return all paths when none are allowlisted', () => {
      const status = ' M src/a.ts\n M src/b.ts\n';
      const blocked = getNonAllowlistedDirtyPaths(status, ALLOWLIST);
      expect(blocked).toHaveLength(2);
    });
  });

  describe('formatBlockedPaths', () => {
    it('should format paths as bullet list', () => {
      const result = formatBlockedPaths(['a.ts', 'b.ts']);
      expect(result).toBe('  - a.ts\n  - b.ts');
    });

    it('should truncate beyond 10 paths', () => {
      const paths = Array.from({ length: 12 }, (_, i) => `file-${i}.ts`);
      const result = formatBlockedPaths(paths);
      expect(result).toContain('... and 2 more');
    });

    it('should handle empty array', () => {
      expect(formatBlockedPaths([])).toBe('');
    });
  });

  describe('formatMainDirtyMutationGuardMessage', () => {
    it('should include command name, paths, and resolution steps', () => {
      const message = formatMainDirtyMutationGuardMessage({
        commandName: 'wu:prep',
        mainCheckout: '/test/project',
        blockedPaths: ['src/file.ts'],
        allowlistPrefixes: ['.lumenflow/'],
      });
      expect(message).toContain('wu:prep blocked');
      expect(message).toContain('src/file.ts');
      expect(message).toContain('.lumenflow/');
      expect(message).toContain('How to resolve');
      expect(message).toContain('Main checkout: /test/project');
    });
  });
});

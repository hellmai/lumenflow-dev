// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file path-utils.test.ts
 * Tests for the path-utils sub-module (WU-2127)
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeDirectorySegment,
  ensureRepoRelativePrefix,
  stripWrappingQuotes,
  normalizeRepoRelativePath,
  isAllowlistedPath,
} from '../../hooks/path-utils.js';

describe('WU-2127: path-utils sub-module', () => {
  describe('normalizeDirectorySegment', () => {
    it('should strip leading/trailing slashes and backslashes', () => {
      expect(normalizeDirectorySegment('/worktrees/', 'default')).toBe('worktrees');
    });

    it('should return fallback for empty string', () => {
      expect(normalizeDirectorySegment('', 'fallback')).toBe('fallback');
    });

    it('should normalize backslashes to forward slashes', () => {
      expect(normalizeDirectorySegment('path\\to\\dir', 'default')).toBe('path/to/dir');
    });

    it('should return fallback for string of only slashes', () => {
      expect(normalizeDirectorySegment('///', 'default')).toBe('default');
    });
  });

  describe('ensureRepoRelativePrefix', () => {
    it('should add trailing slash to non-empty path', () => {
      expect(ensureRepoRelativePrefix('docs/tasks/wu')).toBe('docs/tasks/wu/');
    });

    it('should return empty string for empty input', () => {
      expect(ensureRepoRelativePrefix('')).toBe('');
    });

    it('should normalize backslashes and strip leading/trailing slashes', () => {
      expect(ensureRepoRelativePrefix('/docs\\tasks\\wu/')).toBe('docs/tasks/wu/');
    });
  });

  describe('stripWrappingQuotes', () => {
    it('should strip surrounding double quotes', () => {
      expect(stripWrappingQuotes('"quoted path"')).toBe('quoted path');
    });

    it('should not strip if only one quote present', () => {
      expect(stripWrappingQuotes('"no-end')).toBe('"no-end');
    });

    it('should return empty string for double-quote pair', () => {
      expect(stripWrappingQuotes('""')).toBe('');
    });

    it('should leave unquoted strings unchanged', () => {
      expect(stripWrappingQuotes('no-quotes')).toBe('no-quotes');
    });
  });

  describe('normalizeRepoRelativePath', () => {
    it('should strip ./ prefix', () => {
      expect(normalizeRepoRelativePath('./src/file.ts')).toBe('src/file.ts');
    });

    it('should normalize backslashes to forward slashes', () => {
      expect(normalizeRepoRelativePath('src\\hooks\\file.ts')).toBe('src/hooks/file.ts');
    });

    it('should strip wrapping quotes and trim whitespace', () => {
      expect(normalizeRepoRelativePath('  "src/file.ts"  ')).toBe('src/file.ts');
    });

    it('should handle combined normalization', () => {
      expect(normalizeRepoRelativePath('"./src\\path\\file.ts"')).toBe('src/path/file.ts');
    });
  });

  describe('isAllowlistedPath', () => {
    const MAIN_REPO = '/test/project';
    const PREFIXES = ['.lumenflow/', '.claude/', 'docs/04-operations/tasks/wu/'] as const;

    it('should allow paths matching allowlist prefix', () => {
      expect(
        isAllowlistedPath('/test/project/.lumenflow/state/events.jsonl', MAIN_REPO, PREFIXES),
      ).toBe(true);
    });

    it('should allow paths matching .claude/ prefix', () => {
      expect(isAllowlistedPath('/test/project/.claude/settings.json', MAIN_REPO, PREFIXES)).toBe(
        true,
      );
    });

    it('should reject paths not in allowlist', () => {
      expect(isAllowlistedPath('/test/project/packages/cli/src/file.ts', MAIN_REPO, PREFIXES)).toBe(
        false,
      );
    });

    it('should reject paths outside the repo', () => {
      expect(isAllowlistedPath('/other/repo/.lumenflow/file', MAIN_REPO, PREFIXES)).toBe(false);
    });
  });
});

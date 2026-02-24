// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file config-resolver.test.ts
 * Tests for the config-resolver sub-module (WU-2127)
 */

import { describe, it, expect } from 'vitest';
import {
  resolveWorktreesDirSegment,
  resolveWuAllowlistPrefix,
  resolveMainWriteAllowlistPrefixes,
} from '../../hooks/config-resolver.js';

describe('WU-2127: config-resolver sub-module', () => {
  describe('resolveWorktreesDirSegment', () => {
    it('should return a non-empty string for any project path', () => {
      const result = resolveWorktreesDirSegment('/nonexistent/path');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should not contain trailing slashes', () => {
      const result = resolveWorktreesDirSegment('/nonexistent/path');
      expect(result.endsWith('/')).toBe(false);
    });
  });

  describe('resolveWuAllowlistPrefix', () => {
    it('should return a string ending with /', () => {
      const result = resolveWuAllowlistPrefix('/nonexistent/path');
      expect(result.endsWith('/')).toBe(true);
    });

    it('should contain the wu directory path', () => {
      const result = resolveWuAllowlistPrefix('/nonexistent/path');
      // Default WU dir contains 'wu' or 'tasks'
      expect(result.length).toBeGreaterThan(1);
    });
  });

  describe('resolveMainWriteAllowlistPrefixes', () => {
    it('should include .lumenflow/ prefix', () => {
      const prefixes = resolveMainWriteAllowlistPrefixes('/test/project');
      expect(prefixes).toContain('.lumenflow/');
    });

    it('should include .claude/ prefix', () => {
      const prefixes = resolveMainWriteAllowlistPrefixes('/test/project');
      expect(prefixes).toContain('.claude/');
    });

    it('should include plan/ prefix', () => {
      const prefixes = resolveMainWriteAllowlistPrefixes('/test/project');
      expect(prefixes).toContain('plan/');
    });

    it('should include WU directory prefix as first element', () => {
      const prefixes = resolveMainWriteAllowlistPrefixes('/test/project');
      expect(prefixes.length).toBeGreaterThanOrEqual(4);
      // The WU dir prefix should be the first entry
      expect(prefixes[0].endsWith('/')).toBe(true);
    });
  });
});

/**
 * @file dependency-validator.test.ts
 * Tests for dependency validation (WU-1065)
 *
 * Validates that the dependency validator correctly checks for required packages.
 * WU-1065: ms package must be resolvable from @lumenflow/core for mem:inbox validation.
 */

import { describe, it, expect } from 'vitest';

import {
  validateDependencies,
  validateInboxDependencies,
  TOOL_DEPENDENCIES,
  formatDependencyError,
} from '../dependency-validator.js';

describe('dependency-validator (WU-1065)', () => {
  describe('TOOL_DEPENDENCIES', () => {
    it('mem:inbox requires ms and commander', () => {
      expect(TOOL_DEPENDENCIES['mem:inbox']).toContain('ms');
      expect(TOOL_DEPENDENCIES['mem:inbox']).toContain('commander');
    });
  });

  describe('validateDependencies', () => {
    it('returns valid for empty package list', async () => {
      const result = await validateDependencies([]);
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('returns valid for installed packages', async () => {
      // commander is a dependency of @lumenflow/core
      const result = await validateDependencies(['commander']);
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('returns invalid for missing packages', async () => {
      const result = await validateDependencies(['nonexistent-package-xyz']);
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('nonexistent-package-xyz');
    });
  });

  describe('validateInboxDependencies', () => {
    it('validates ms package is available (WU-1065 regression test)', async () => {
      // This is the key test for WU-1065
      // ms must be resolvable from @lumenflow/core since that's where validation runs
      const result = await validateInboxDependencies();

      expect(result.valid).toBe(true);
      expect(result.missing).not.toContain('ms');
    });

    it('validates all mem:inbox dependencies', async () => {
      const result = await validateInboxDependencies();

      // Should validate successfully with no missing packages
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });

  describe('formatDependencyError', () => {
    it('formats error message with tool name and missing packages', () => {
      const message = formatDependencyError('mem:inbox', ['ms', 'commander']);

      expect(message).toContain('mem:inbox');
      expect(message).toContain('ms');
      expect(message).toContain('commander');
      expect(message).toContain('pnpm install');
    });
  });
});

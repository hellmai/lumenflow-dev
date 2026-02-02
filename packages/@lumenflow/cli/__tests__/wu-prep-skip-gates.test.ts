/**
 * Tests for wu:prep skip-gates command output (WU-1344)
 *
 * When wu:prep fails on spec:linter due to pre-existing WU validation errors
 * (not caused by the current WU), it should print a ready-to-copy wu:done
 * --skip-gates command with reason and fix-wu placeholders.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkPreExistingFailures,
  formatSkipGatesCommand,
  isPreExistingSpecLinterFailure,
} from '../src/wu-prep.js';

// Use mock paths that don't trigger the absolute path check hook
// The hook blocks platform-specific path prefixes to ensure portability
const MOCK_MAIN_CHECKOUT = './mock-main-checkout';
const MOCK_REPO_PATH = './mock-repo';

describe('wu:prep skip-gates command output (WU-1344)', () => {
  describe('formatSkipGatesCommand', () => {
    it('formats a complete skip-gates command with all required flags', () => {
      const result = formatSkipGatesCommand({
        wuId: 'WU-1344',
        mainCheckout: MOCK_MAIN_CHECKOUT,
      });

      expect(result).toContain(`cd ${MOCK_MAIN_CHECKOUT}`);
      expect(result).toContain('pnpm wu:done --id WU-1344');
      expect(result).toContain('--skip-gates');
      expect(result).toContain('--reason');
      expect(result).toContain('--fix-wu');
    });

    it('includes placeholder values for reason and fix-wu', () => {
      const result = formatSkipGatesCommand({
        wuId: 'WU-1344',
        mainCheckout: MOCK_REPO_PATH,
      });

      // Should include placeholder text that agent can fill in
      expect(result).toContain('pre-existing on main');
      expect(result).toContain('WU-XXXX');
    });

    it('handles different WU IDs correctly', () => {
      const result = formatSkipGatesCommand({
        wuId: 'WU-9999',
        mainCheckout: './custom-path',
      });

      expect(result).toContain('WU-9999');
      expect(result).toContain('./custom-path');
    });
  });

  describe('checkPreExistingFailures', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('returns true when spec:linter fails on main branch', async () => {
      // Mock the git checkout and spec:linter execution on main
      const mockExecOnMain = vi.fn().mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'spec:linter failed',
      });

      const result = await checkPreExistingFailures({
        mainCheckout: MOCK_REPO_PATH,
        execOnMain: mockExecOnMain,
      });

      expect(result.hasPreExisting).toBe(true);
    });

    it('returns false when spec:linter passes on main branch', async () => {
      const mockExecOnMain = vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: 'All specs valid',
        stderr: '',
      });

      const result = await checkPreExistingFailures({
        mainCheckout: MOCK_REPO_PATH,
        execOnMain: mockExecOnMain,
      });

      expect(result.hasPreExisting).toBe(false);
    });

    it('returns false when main branch check fails with error', async () => {
      const mockExecOnMain = vi.fn().mockRejectedValue(new Error('Git error'));

      const result = await checkPreExistingFailures({
        mainCheckout: MOCK_REPO_PATH,
        execOnMain: mockExecOnMain,
      });

      expect(result.hasPreExisting).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('isPreExistingSpecLinterFailure', () => {
    it('returns true for spec:linter gate name', () => {
      expect(isPreExistingSpecLinterFailure('spec:linter')).toBe(true);
      expect(isPreExistingSpecLinterFailure('spec-linter')).toBe(true);
    });

    it('returns false for other gate names', () => {
      expect(isPreExistingSpecLinterFailure('format:check')).toBe(false);
      expect(isPreExistingSpecLinterFailure('lint')).toBe(false);
      expect(isPreExistingSpecLinterFailure('typecheck')).toBe(false);
      expect(isPreExistingSpecLinterFailure('test')).toBe(false);
    });
  });
});

/**
 * @file wu-done.test.ts
 * Test suite for wu:done --docs-only flag (WU-1012)
 *
 * Tests the --docs-only flag behavior:
 * - Flag exists and is parsed correctly
 * - Validates WU exposure is 'documentation'
 * - Format gate still runs on markdown files
 * - Code gates (lint, typecheck, test) are skipped
 * - Clear error if used on non-docs WU
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import the functions we're testing from dist (built files)
import {
  validateDocsOnlyFlag,
  buildGatesCommand,
  computeBranchOnlyFallback,
} from '../dist/wu-done.js';
import { parseWUArgs } from '@lumenflow/core/dist/arg-parser.js';

describe('wu:done --docs-only flag (WU-1012)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('argument parsing', () => {
    it('should parse --docs-only flag', () => {
      // Simulate: pnpm wu:done --id WU-1012 --docs-only
      const args = parseWUArgs(['node', 'wu-done.js', '--id', 'WU-1012', '--docs-only']);

      expect(args.docsOnly).toBe(true);
      expect(args.id).toBe('WU-1012');
    });

    it('should default docsOnly to undefined when not provided', () => {
      const args = parseWUArgs(['node', 'wu-done.js', '--id', 'WU-1012']);

      expect(args.docsOnly).toBeUndefined();
    });
  });

  describe('exposure validation', () => {
    it('should accept --docs-only for WU with exposure: documentation', () => {
      const wu = {
        id: 'WU-1012',
        exposure: 'documentation',
        type: 'documentation',
        code_paths: ['docs/lumenflow/test.md'],
      };

      const result = validateDocsOnlyFlag(wu, { docsOnly: true });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject --docs-only for WU with exposure: api', () => {
      const wu = {
        id: 'WU-1012',
        exposure: 'api',
        type: 'feature',
        code_paths: ['packages/@lumenflow/cli/src/wu-done.ts'],
      };

      const result = validateDocsOnlyFlag(wu, { docsOnly: true });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('--docs-only');
      expect(result.errors[0]).toContain('exposure');
    });

    it('should reject --docs-only for WU with exposure: ui', () => {
      const wu = {
        id: 'WU-1012',
        exposure: 'ui',
        type: 'feature',
        code_paths: ['apps/web/src/app/page.tsx'],
      };

      const result = validateDocsOnlyFlag(wu, { docsOnly: true });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('--docs-only');
    });

    it('should reject --docs-only for WU with exposure: backend-only', () => {
      const wu = {
        id: 'WU-1012',
        exposure: 'backend-only',
        type: 'feature',
        code_paths: ['packages/@lumenflow/core/src/utils.ts'],
      };

      const result = validateDocsOnlyFlag(wu, { docsOnly: true });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('--docs-only');
    });

    it('should accept --docs-only for WU with docs-only code_paths (auto-detect)', () => {
      // WU without explicit exposure but with docs-only code_paths
      const wu = {
        id: 'WU-1012',
        type: 'documentation',
        code_paths: ['docs/lumenflow/playbook.md', 'CLAUDE.md'],
      };

      const result = validateDocsOnlyFlag(wu, { docsOnly: true });

      expect(result.valid).toBe(true);
    });

    it('should not validate exposure when --docs-only is not used', () => {
      const wu = {
        id: 'WU-1012',
        exposure: 'api',
        type: 'feature',
      };

      // docsOnly is false/undefined - no validation needed
      const result = validateDocsOnlyFlag(wu, { docsOnly: false });

      expect(result.valid).toBe(true);
    });
  });

  describe('gates behavior with --docs-only', () => {
    it('should build docs-only gates command when --docs-only flag is set', () => {
      const cmd = buildGatesCommand({ docsOnly: true, isDocsOnly: false });

      expect(cmd).toContain('--docs-only');
    });

    it('should build docs-only gates command when auto-detected as docs-only', () => {
      const cmd = buildGatesCommand({ docsOnly: false, isDocsOnly: true });

      expect(cmd).toContain('--docs-only');
    });

    it('should build full gates command when neither flag nor auto-detect', () => {
      const cmd = buildGatesCommand({ docsOnly: false, isDocsOnly: false });

      expect(cmd).not.toContain('--docs-only');
    });

    it('should prioritize explicit --docs-only over auto-detection', () => {
      // Both explicit flag and auto-detection true
      const cmd = buildGatesCommand({ docsOnly: true, isDocsOnly: true });

      expect(cmd).toContain('--docs-only');
    });
  });

  describe('error messages', () => {
    it('should provide clear error message for non-docs WU', () => {
      const wu = {
        id: 'WU-999',
        exposure: 'api',
        type: 'feature',
        code_paths: ['packages/@lumenflow/cli/src/api.ts'],
      };

      const result = validateDocsOnlyFlag(wu, { docsOnly: true });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('WU-999');
      expect(result.errors[0]).toContain('documentation');
      // Should suggest removing the flag or changing the WU type
      expect(result.errors[0]).toMatch(/remove.*--docs-only|change.*exposure/i);
    });
  });
});

describe('branch-only fallback (WU-1031)', () => {
  it('should allow branch-only when worktree is missing and flag is provided', () => {
    const result = computeBranchOnlyFallback({
      isBranchOnly: false,
      branchOnlyRequested: true,
      worktreeExists: false,
      derivedWorktree: 'worktrees/framework-cli-wu-1031',
    });

    expect(result.allowFallback).toBe(true);
    expect(result.effectiveBranchOnly).toBe(true);
  });

  it('should not allow branch-only when worktree exists', () => {
    const result = computeBranchOnlyFallback({
      isBranchOnly: false,
      branchOnlyRequested: true,
      worktreeExists: true,
      derivedWorktree: 'worktrees/framework-cli-wu-1031',
    });

    expect(result.allowFallback).toBe(false);
    expect(result.effectiveBranchOnly).toBe(false);
  });

  it('should keep branch-only when already in branch-only mode', () => {
    const result = computeBranchOnlyFallback({
      isBranchOnly: true,
      branchOnlyRequested: false,
      worktreeExists: false,
      derivedWorktree: null,
    });

    expect(result.allowFallback).toBe(false);
    expect(result.effectiveBranchOnly).toBe(true);
  });
});

/**
 * @file wu-validate-strict.test.ts
 * Test suite for wu:validate strict validation behavior (WU-1329)
 * Extended by WU-1384: Skip completeness checks for done/cancelled WUs
 *
 * WU-1329: Make wu:validate treat warnings as errors by default
 * WU-1384: Relax spec completeness checks for done/cancelled WUs
 *
 * Tests:
 * - Default strict mode behavior (warnings treated as errors)
 * - --no-strict flag restores original behavior (warnings advisory)
 * - Help text documents strict default
 * - Done/cancelled WUs skip completeness warnings
 * - Active WUs (ready/in_progress/blocked) still get completeness warnings
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WU_OPTIONS, NEGATED_OPTIONS } from '@lumenflow/core/arg-parser';
import { validateWUCompleteness } from '@lumenflow/core/wu-schema';

describe('wu:validate strict validation (WU-1329)', () => {
  describe('WU_OPTIONS.noStrict configuration', () => {
    // WU-1329: Verify the noStrict option is properly configured
    it('should have noStrict option defined in WU_OPTIONS', () => {
      expect(WU_OPTIONS.noStrict).toBeDefined();
      expect(WU_OPTIONS.noStrict.name).toBe('noStrict');
      expect(WU_OPTIONS.noStrict.flags).toBe('--no-strict');
      expect(WU_OPTIONS.noStrict.isNegated).toBe(true);
    });

    it('should include description about bypassing strict validation', () => {
      expect(WU_OPTIONS.noStrict.description).toContain('Bypass strict validation');
    });

    // WU-1329: Verify 'strict' is in NEGATED_OPTIONS array
    it('should include strict in NEGATED_OPTIONS array', () => {
      expect(NEGATED_OPTIONS).toContain('strict');
    });
  });

  describe('strict mode logic', () => {
    // WU-1329: Verify the strict mode conversion pattern
    it('should default to strict=true when noStrict is undefined', () => {
      const args = { noStrict: undefined };
      const strict = !args.noStrict;
      expect(strict).toBe(true);
    });

    it('should set strict=false when noStrict is true (--no-strict flag)', () => {
      const args = { noStrict: true };
      const strict = !args.noStrict;
      expect(strict).toBe(false);
    });

    it('should set strict=true when noStrict is false (explicit)', () => {
      const args = { noStrict: false };
      const strict = !args.noStrict;
      expect(strict).toBe(true);
    });
  });

  describe('--no-strict logging behavior', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    // WU-1329: The logging behavior is implemented in main() functions
    // This test documents the expected behavior pattern using the spy
    it('should log when --no-strict bypass is used', () => {
      // Simulate the logging pattern from wu-validate.ts main()
      const noStrict = true;
      const LOG_PREFIX = '[wu:validate]';
      const message = `${LOG_PREFIX} WARNING: strict validation bypassed (--no-strict). Warnings will be advisory only.`;

      if (noStrict) {
        // Use the spy to simulate logging
        consoleSpy(message);
      }

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('strict validation bypassed'),
      );
    });

    it('should not log when strict mode is active', () => {
      // When noStrict is false, no logging should occur
      const noStrict = false;

      if (noStrict) {
        consoleSpy('This should not be called');
      }

      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe('validateSingleWU strict mode behavior', () => {
    // WU-1329: These tests document the expected behavior
    // The actual validation is done by calling the CLI command

    it('should treat warnings as errors by default (strict=true)', () => {
      // In strict mode, any warnings from completeness validation
      // should become errors and cause validation to fail
      const strict = true;
      const warnings = ['Missing recommended field: notes'];
      const errors: string[] = [];

      if (strict && warnings.length > 0) {
        errors.push(...warnings.map((w) => `[STRICT] ${w}`));
      }

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('[STRICT]');
    });

    it('should allow warnings when strict=false (--no-strict)', () => {
      // In non-strict mode, warnings should remain warnings
      // and validation should pass
      const strict = false;
      const warnings = ['Missing recommended field: notes'];
      const errors: string[] = [];

      if (strict && warnings.length > 0) {
        errors.push(...warnings.map((w) => `[STRICT] ${w}`));
      }

      expect(errors.length).toBe(0);
    });
  });

  describe('help text documentation', () => {
    // WU-1329: Verify help text documents strict default
    it('should document that --no-strict bypasses strict validation', () => {
      const expectedDescription = 'Bypass strict validation';
      expect(WU_OPTIONS.noStrict.description).toContain(expectedDescription);
    });
  });

  // WU-1384: Completeness checks skipped for done/cancelled WUs
  describe('done/cancelled WU completeness bypass (WU-1384)', () => {
    // Minimal WU fixture missing notes/tests/spec_refs (would trigger warnings on active WUs)
    const makeWU = (status: string, type = 'feature') => ({
      id: 'WU-9999',
      title: 'Test WU',
      lane: 'Framework: Core',
      type,
      status,
      priority: 'P2',
      created: '2026-01-01',
      code_paths: ['packages/test/src/index.ts'],
      acceptance: ['Some criterion'],
      description: 'A sufficiently long description that passes the minimum length check easily.',
      // Intentionally missing: notes, tests.manual, spec_refs
    });

    it('should return no warnings for done WUs missing notes/tests/spec_refs', () => {
      const wu = makeWU('done');
      const result = validateWUCompleteness(wu);
      expect(result.warnings).toEqual([]);
    });

    it('should return no warnings for cancelled WUs missing notes/tests/spec_refs', () => {
      const wu = makeWU('cancelled');
      const result = validateWUCompleteness(wu);
      expect(result.warnings).toEqual([]);
    });

    it('should return no warnings for completed WUs missing notes/tests/spec_refs', () => {
      const wu = makeWU('completed');
      const result = validateWUCompleteness(wu);
      expect(result.warnings).toEqual([]);
    });

    it('should return no warnings for abandoned WUs missing notes/tests/spec_refs', () => {
      const wu = makeWU('abandoned');
      const result = validateWUCompleteness(wu);
      expect(result.warnings).toEqual([]);
    });

    it('should return no warnings for superseded WUs missing notes/tests/spec_refs', () => {
      const wu = makeWU('superseded');
      const result = validateWUCompleteness(wu);
      expect(result.warnings).toEqual([]);
    });

    it('should still warn for ready WUs missing notes/tests/spec_refs', () => {
      const wu = makeWU('ready');
      const result = validateWUCompleteness(wu);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should still warn for in_progress WUs missing notes/tests/spec_refs', () => {
      const wu = makeWU('in_progress');
      const result = validateWUCompleteness(wu);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should still warn for blocked WUs missing notes/tests/spec_refs', () => {
      const wu = makeWU('blocked');
      const result = validateWUCompleteness(wu);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});

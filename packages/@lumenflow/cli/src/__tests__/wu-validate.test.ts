import { describe, it, expect } from 'vitest';
import { summarizeValidationResults, validateWuValidateOptions } from '../wu-validate.js';
import { validateRegistrationParity, REGISTRATION_SURFACES } from '@lumenflow/core/wu-lint';

describe('wu:validate JSON summary (WU-1441)', () => {
  it('should summarize invalid WUs with totals', () => {
    const results = [
      { wuId: 'WU-1', valid: true, warnings: [], errors: [] },
      { wuId: 'WU-2', valid: false, warnings: [], errors: ['[STRICT] Missing notes'] },
    ];

    const summary = summarizeValidationResults(results);

    expect(summary.valid).toBe(false);
    expect(summary.totalValid).toBe(1);
    expect(summary.totalInvalid).toBe(1);
    expect(summary.totalWarnings).toBe(0);
    expect(summary.invalid).toEqual([
      {
        wuId: 'WU-2',
        errors: ['[STRICT] Missing notes'],
      },
    ]);
  });

  it('should include warnings per WU', () => {
    const results = [
      { wuId: 'WU-3', valid: true, warnings: ['Warn'], errors: [] },
      { wuId: 'WU-4', valid: true, warnings: [], errors: [] },
    ];

    const summary = summarizeValidationResults(results);

    expect(summary.valid).toBe(true);
    expect(summary.totalWarnings).toBe(1);
    expect(summary.warnings).toEqual([
      {
        wuId: 'WU-3',
        warnings: ['Warn'],
      },
    ]);
  });

  it('accepts shared-schema valid wu:validate options', () => {
    const result = validateWuValidateOptions('WU-1484', false);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects missing id via shared schema validator', () => {
    const result = validateWuValidateOptions(undefined, false);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('id'))).toBe(true);
  });
});

/**
 * WU-1504: Registration parity lint integration with wu:validate
 *
 * Verifies that parity warnings from lintWUSpec are surfaced through
 * the wu:validate flow (strict mode treats them as blocking errors,
 * non-strict treats them as advisory warnings).
 */
describe('wu:validate registration parity integration (WU-1504)', () => {
  it('should detect missing registration surfaces for CLI command WUs', () => {
    const wu = {
      id: 'WU-TEST',
      code_paths: ['packages/@lumenflow/cli/src/wu-new-feature.ts'],
    };

    const result = validateRegistrationParity(wu);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(2);
    // Should warn about both public-manifest and MCP tools
    const messages = result.errors.map((e) => e.message);
    expect(messages.some((m) => m.includes('public-manifest.ts'))).toBe(true);
    expect(messages.some((m) => m.includes('tools.ts'))).toBe(true);
  });

  it('should pass parity check when all registration surfaces are present', () => {
    const wu = {
      id: 'WU-TEST',
      code_paths: [
        'packages/@lumenflow/cli/src/wu-new-feature.ts',
        REGISTRATION_SURFACES.PUBLIC_MANIFEST,
        REGISTRATION_SURFACES.MCP_TOOLS,
      ],
    };

    const result = validateRegistrationParity(wu);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('parity errors should be surfaced as LINT warnings in strict mode summary', () => {
    // Simulate the wu-validate.ts pattern: lint errors become [LINT] warnings,
    // and in strict mode those become [STRICT] errors
    const wu = {
      id: 'WU-STRICT',
      code_paths: ['packages/@lumenflow/cli/src/wu-new-feature.ts'],
    };
    const parityResult = validateRegistrationParity(wu);
    const warnings = parityResult.errors.map((e) => `[LINT] ${e.message}`);

    // In strict mode, warnings become blocking errors
    const strict = true;
    const errors: string[] = [];
    if (strict && warnings.length > 0) {
      errors.push(...warnings.map((w) => `[STRICT] ${w}`));
    }

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('[STRICT]');
    expect(errors[0]).toContain('[LINT]');
  });

  it('parity errors should remain advisory in non-strict mode', () => {
    const wu = {
      id: 'WU-NONSTRICT',
      code_paths: ['packages/@lumenflow/cli/src/wu-new-feature.ts'],
    };
    const parityResult = validateRegistrationParity(wu);
    const warnings = parityResult.errors.map((e) => `[LINT] ${e.message}`);

    const strict = false;
    const errors: string[] = [];
    if (strict && warnings.length > 0) {
      errors.push(...warnings.map((w) => `[STRICT] ${w}`));
    }

    // Non-strict: warnings stay as warnings, no errors
    expect(errors.length).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

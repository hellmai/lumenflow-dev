import { describe, it, expect } from 'vitest';
import { summarizeValidationResults, validateWuValidateOptions } from '../wu-validate.js';

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

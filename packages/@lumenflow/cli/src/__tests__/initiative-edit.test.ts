import { describe, expect, it } from 'vitest';

import {
  applyArrayEdits,
  buildNoEditsMessage,
  hasAnyEdits,
  validateEditArgs,
} from '../initiative-edit.js';

const METRIC_ONE = 'Metric one';
const METRIC_TWO = 'Metric two';
const NEW_METRIC = 'New metric';

describe('initiative:edit success metric editing', () => {
  it('removes exact success metric matches', () => {
    const updated = {
      success_metrics: [METRIC_ONE, METRIC_TWO],
    };

    applyArrayEdits(updated, {
      removeSuccessMetric: [METRIC_ONE],
    });

    expect(updated.success_metrics).toEqual([METRIC_TWO]);
  });

  it('is idempotent when removing absent metric', () => {
    const updated = {
      success_metrics: [METRIC_ONE],
    };

    applyArrayEdits(updated, {
      removeSuccessMetric: [METRIC_TWO],
    });

    expect(updated.success_metrics).toEqual([METRIC_ONE]);
  });

  it('applies remove after add in same invocation', () => {
    const updated = {
      success_metrics: [METRIC_ONE],
    };

    applyArrayEdits(updated, {
      addSuccessMetric: [NEW_METRIC],
      removeSuccessMetric: [NEW_METRIC],
    });

    expect(updated.success_metrics).toEqual([METRIC_ONE]);
  });

  it('treats remove-success-metric as an edit for validation', () => {
    expect(hasAnyEdits({ removeSuccessMetric: [METRIC_ONE] })).toBe(true);
  });

  it('documents remove-success-metric in no-edits help output', () => {
    expect(buildNoEditsMessage()).toContain('--remove-success-metric <text>');
  });

  it('accepts schema-valid initiative:edit options', () => {
    const result = validateEditArgs({
      id: 'INIT-015',
      status: 'in_progress',
      addLane: ['Framework: CLI'],
      removeSuccessMetric: [METRIC_ONE],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects invalid status via shared schema validator', () => {
    const result = validateEditArgs({
      id: 'INIT-015',
      status: 'not-a-real-status',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('status'))).toBe(true);
  });
});

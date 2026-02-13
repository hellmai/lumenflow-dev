import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';

import {
  applyArrayEdits,
  buildNoEditsMessage,
  formatRetryExhaustionError,
  hasAnyEdits,
  INITIATIVE_EDIT_PUSH_RETRY_OVERRIDE,
  isRetryExhaustionError,
  validateEditArgs,
} from '../initiative-edit.js';

const METRIC_ONE = 'Metric one';
const METRIC_TWO = 'Metric two';
const NEW_METRIC = 'New metric';

describe('initiative:edit requireRemote:false support (WU-1497)', () => {
  it('should not call ensureMainUpToDate directly (micro-worktree handles origin sync)', () => {
    // Read the source file to verify it does not call ensureMainUpToDate
    // This is a structural test: initiative-edit must not perform its own origin fetch
    // because withMicroWorktree already handles requireRemote-aware origin sync
    const sourceFile = fs.readFileSync(new URL('../initiative-edit.ts', import.meta.url), 'utf-8');

    // The source should NOT contain a function call to ensureMainUpToDate
    // (comments mentioning it are fine; only actual await/call invocations are the bug)
    const mainFunctionMatch = sourceFile.match(/async function main\(\)[\s\S]*?^}/m);
    expect(mainFunctionMatch).not.toBeNull();
    const mainBody = mainFunctionMatch![0];

    // Match actual function calls: await ensureMainUpToDate( or ensureMainUpToDate(
    expect(mainBody).not.toMatch(/(?:await\s+)?ensureMainUpToDate\s*\(/);
  });

  it('should not import ensureMainUpToDate from wu-helpers', () => {
    const sourceFile = fs.readFileSync(new URL('../initiative-edit.ts', import.meta.url), 'utf-8');

    // Should not import ensureMainUpToDate at all (clean imports)
    expect(sourceFile).not.toMatch(/import.*ensureMainUpToDate.*from/);
  });
});

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

describe('initiative:edit retry handling (WU-1621)', () => {
  it('exports operation-level push retry override', () => {
    expect(INITIATIVE_EDIT_PUSH_RETRY_OVERRIDE).toEqual({
      retries: 8,
      min_delay_ms: 300,
      max_delay_ms: 4000,
    });
  });

  it('detects retry exhaustion errors', () => {
    expect(
      isRetryExhaustionError(new Error('Push failed after 3 attempts. Origin main is busy.')),
    ).toBe(true);
    expect(isRetryExhaustionError(new Error('Network timeout'))).toBe(false);
  });

  it('formats actionable retry exhaustion guidance', () => {
    const formatted = formatRetryExhaustionError(
      new Error('Push failed after 3 attempts. Origin main may have significant traffic.'),
      'INIT-015',
    );

    expect(formatted).toContain('Next steps:');
    expect(formatted).toContain('initiative:edit');
    expect(formatted).toContain('--id INIT-015');
  });
});

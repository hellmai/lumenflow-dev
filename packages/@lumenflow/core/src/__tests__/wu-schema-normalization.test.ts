/**
 * @fileoverview Tests for WU schema normalization
 *
 * WU-1063: Ensure normalizeWUSchema preserves spec_refs
 *
 * @module __tests__/wu-schema-normalization.test
 */

import { describe, it, expect } from 'vitest';
import { normalizeWUSchema } from '../wu-schema-normalization.js';

describe('normalizeWUSchema', () => {
  it('preserves spec_refs during normalization', () => {
    const input = {
      id: 'WU-1063',
      title: 'Test',
      spec_refs: ['lumenflow://plans/WU-1063-plan.md'],
      summary: 'Legacy summary',
      context: 'Legacy context',
      created: '2026-01-22T12:34:56.789Z',
    };

    const result = normalizeWUSchema(input);

    expect(result.spec_refs).toEqual(['lumenflow://plans/WU-1063-plan.md']);
    expect(result.summary).toBeUndefined();
    expect(result.context).toBeUndefined();
    expect(result.description).toContain('Legacy summary');
    expect(result.description).toContain('Legacy context');
    expect(result.created).toBe('2026-01-22');
  });
});

import { describe, it, expect } from 'vitest';
import { buildWUContent } from '../src/wu-create-content.js';
import { WU_CREATE_DEFAULTS } from '@lumenflow/core/wu-create-defaults';

describe('wu:create notes field (WU-2245)', () => {
  const baseArgs = {
    id: 'WU-9999',
    lane: 'Framework: CLI',
    title: 'Test WU',
    priority: 'P2',
    type: 'feature',
    created: '2026-02-27',
  };

  const baseOpts = {
    description: 'Context: test.\nProblem: test.\nSolution: test.',
    acceptance: ['Acceptance criterion'],
    codePaths: ['packages/@lumenflow/cli/src/wu-create.ts'],
    testPathsManual: ['Manual test: verify output'],
    testPathsUnit: ['packages/@lumenflow/cli/__tests__/wu-create.test.ts'],
    exposure: 'backend-only' as const,
    specRefs: ['docs/04-operations/plans/WU-9999-plan.md'],
    strict: false,
  };

  it('leaves notes empty/null when --notes is not provided', () => {
    const result = buildWUContent({
      ...baseArgs,
      opts: { ...baseOpts, notes: undefined },
    });

    // Notes should be null, undefined, or empty string -- NOT the placeholder
    expect(result.notes).not.toBe(WU_CREATE_DEFAULTS.AUTO_NOTES_PLACEHOLDER);
    // Should be falsy (null, undefined, or empty string)
    expect(result.notes || null).toBeNull();
  });

  it('leaves notes empty/null when --notes is empty string', () => {
    const result = buildWUContent({
      ...baseArgs,
      opts: { ...baseOpts, notes: '' },
    });

    expect(result.notes).not.toBe(WU_CREATE_DEFAULTS.AUTO_NOTES_PLACEHOLDER);
    expect(result.notes || null).toBeNull();
  });

  it('leaves notes empty/null when --notes is whitespace-only', () => {
    const result = buildWUContent({
      ...baseArgs,
      opts: { ...baseOpts, notes: '   ' },
    });

    expect(result.notes).not.toBe(WU_CREATE_DEFAULTS.AUTO_NOTES_PLACEHOLDER);
    expect(result.notes || null).toBeNull();
  });

  it('sets notes to provided text when --notes is given', () => {
    const customNotes = 'This WU fixes a placeholder bug in wu:create';
    const result = buildWUContent({
      ...baseArgs,
      opts: { ...baseOpts, notes: customNotes },
    });

    expect(result.notes).toBe(customNotes);
  });

  it('preserves multiline notes text', () => {
    const multilineNotes = 'Line one.\nLine two.\nLine three.';
    const result = buildWUContent({
      ...baseArgs,
      opts: { ...baseOpts, notes: multilineNotes },
    });

    expect(result.notes).toBe(multilineNotes);
  });
});

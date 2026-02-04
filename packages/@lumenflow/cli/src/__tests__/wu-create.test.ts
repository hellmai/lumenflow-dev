/**
 * @file wu-create.test.ts
 * Tests for wu:create helpers and warnings (WU-1429)
 */

import { describe, it, expect } from 'vitest';
import { buildWUContent, collectInitiativeWarnings } from '../wu-create.js';

const BASE_WU = {
  id: 'WU-1429',
  lane: 'Framework: CLI',
  title: 'Test WU',
  priority: 'P2',
  type: 'feature',
  created: '2026-02-04',
  opts: {
    description:
      'Context: test context.\nProblem: test problem.\nSolution: test solution that exceeds minimum.',
    acceptance: ['Acceptance criterion'],
    exposure: 'backend-only',
    codePaths: ['packages/@lumenflow/cli/src/wu-create.ts'],
    testPathsUnit: ['packages/@lumenflow/cli/src/__tests__/wu-create.test.ts'],
    specRefs: ['lumenflow://plans/WU-1429-plan.md'],
  },
};

describe('wu:create helpers (WU-1429)', () => {
  it('should persist notes when provided', () => {
    const wu = buildWUContent({
      ...BASE_WU,
      opts: {
        ...BASE_WU.opts,
        notes: 'Implementation notes for test',
      },
    });

    expect(wu.notes).toBe('Implementation notes for test');
  });

  it('should warn when initiative has phases but no --phase is provided', () => {
    const warnings = collectInitiativeWarnings({
      initiativeId: 'INIT-TEST',
      initiativeDoc: {
        phases: [{ id: 1, title: 'Phase 1' }],
      },
      phase: undefined,
      specRefs: ['lumenflow://plans/WU-1429-plan.md'],
    });

    expect(warnings).toEqual(
      expect.arrayContaining([
        'Initiative INIT-TEST has phases defined. Consider adding --phase to link this WU to a phase.',
      ]),
    );
  });

  it('should warn when initiative has related_plan but no spec_refs', () => {
    const warnings = collectInitiativeWarnings({
      initiativeId: 'INIT-TEST',
      initiativeDoc: {
        related_plan: 'lumenflow://plans/INIT-TEST-plan.md',
      },
      phase: '1',
      specRefs: [],
    });

    expect(warnings).toEqual(
      expect.arrayContaining([
        'Initiative INIT-TEST has related_plan (lumenflow://plans/INIT-TEST-plan.md). Consider adding --spec-refs to link this WU to the plan.',
      ]),
    );
  });

  it('should not warn when phase and spec_refs are provided', () => {
    const warnings = collectInitiativeWarnings({
      initiativeId: 'INIT-TEST',
      initiativeDoc: {
        phases: [{ id: 1, title: 'Phase 1' }],
        related_plan: 'lumenflow://plans/INIT-TEST-plan.md',
      },
      phase: '1',
      specRefs: ['lumenflow://plans/WU-1429-plan.md'],
    });

    expect(warnings).toEqual([]);
  });
});

/**
 * @file wu-create.test.ts
 * Tests for wu:create helpers and warnings (WU-1429)
 */

import { describe, it, expect } from 'vitest';
import { buildWUContent, collectInitiativeWarnings, validateCreateSpec } from '../wu-create.js';

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
  it('should default notes to non-empty placeholder when not provided', () => {
    const wu = buildWUContent({
      ...BASE_WU,
      opts: {
        ...BASE_WU.opts,
        // Intentionally omit notes
        notes: undefined,
      },
    });

    expect(typeof wu.notes).toBe('string');
    expect(wu.notes.trim().length).toBeGreaterThan(0);
    expect(wu.notes).toContain('(auto)');
  });

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

  it('should allow creating a plan-first WU without explicit test flags when code_paths are non-code', () => {
    const validation = validateCreateSpec({
      id: 'WU-2000',
      lane: 'Framework: CLI',
      title: 'Plan-only spec creation',
      priority: 'P2',
      type: 'feature',
      opts: {
        description:
          'Context: test context.\nProblem: test problem.\nSolution: test solution that exceeds minimum.',
        acceptance: ['Acceptance criterion'],
        exposure: 'backend-only',
        // Non-code file path: manual-only tests are acceptable.
        codePaths: ['docs/README.md'],
        // No testPathsManual/unit/e2e provided - should auto-default manual stub.
        specRefs: ['lumenflow://plans/WU-2000-plan.md'],
        strict: false,
      },
    });

    expect(validation.valid).toBe(true);

    const wu = buildWUContent({
      id: 'WU-2000',
      lane: 'Framework: CLI',
      title: 'Plan-only spec creation',
      priority: 'P2',
      type: 'feature',
      created: '2026-02-05',
      opts: {
        description:
          'Context: test context.\nProblem: test problem.\nSolution: test solution that exceeds minimum.',
        acceptance: ['Acceptance criterion'],
        exposure: 'backend-only',
        codePaths: ['docs/README.md'],
        specRefs: ['lumenflow://plans/WU-2000-plan.md'],
      },
    });

    expect(wu.tests?.manual?.length).toBeGreaterThan(0);
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

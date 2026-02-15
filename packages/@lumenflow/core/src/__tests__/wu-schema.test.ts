/**
 * @file wu-schema.test.ts
 * Test suite for WU schema plan field support (WU-1683)
 *
 * Tests:
 * - AC1: WU schema supports optional 'plan' field
 * - AC4: Spec completeness validator checks plan file exists when field is set
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateWU, validateReadyWU, validateWUCompleteness } from '../wu-schema.js';

/**
 * Helper to create a minimal valid WU object for testing.
 * Provides all required fields so tests can focus on the field under test.
 */
function makeValidWU(overrides: Record<string, unknown> = {}) {
  return {
    id: 'WU-1683',
    title: 'Add plan field to WU schema',
    lane: 'Framework: CLI WU Commands',
    type: 'feature',
    status: 'ready',
    priority: 'P2',
    created: '2026-02-15',
    description:
      'Add a first-class plan field to the WU schema that links to the plan file, similar to how initiatives have plan files. This enables plan-to-WU linking.',
    acceptance: ['WU schema supports an optional plan field'],
    code_paths: ['packages/@lumenflow/core/src/wu-schema.ts'],
    tests: {
      manual: ['Verify plan field is populated in YAML'],
      unit: ['packages/@lumenflow/core/src/__tests__/wu-schema.test.ts'],
    },
    artifacts: ['.lumenflow/stamps/WU-1683.done'],
    dependencies: [],
    risks: [],
    notes: 'Implementation notes for the plan field feature.',
    requires_review: false,
    ...overrides,
  };
}

describe('WU Schema: plan field (WU-1683)', () => {
  describe('AC1: Optional plan field in schema', () => {
    it('should accept a WU without plan field (backward compatible)', () => {
      const wu = makeValidWU();
      // No plan field at all
      const result = validateWU(wu);
      expect(result.success).toBe(true);
    });

    it('should accept a WU with plan field set to a string path', () => {
      const wu = makeValidWU({
        plan: 'docs/04-operations/plans/WU-1683-plan.md',
      });
      const result = validateWU(wu);
      expect(result.success).toBe(true);
      expect(result.data?.plan).toBe('docs/04-operations/plans/WU-1683-plan.md');
    });

    it('should accept a WU with plan field using lumenflow:// protocol', () => {
      const wu = makeValidWU({
        plan: 'lumenflow://plans/WU-1683-plan.md',
      });
      const result = validateWU(wu);
      expect(result.success).toBe(true);
      expect(result.data?.plan).toBe('lumenflow://plans/WU-1683-plan.md');
    });

    it('should accept a WU with plan field set to undefined', () => {
      const wu = makeValidWU({ plan: undefined });
      const result = validateWU(wu);
      expect(result.success).toBe(true);
    });

    it('should preserve plan field through BaseWUSchema (ReadyWU) validation', () => {
      const wu = makeValidWU({
        plan: 'docs/04-operations/plans/WU-1683-plan.md',
      });
      const result = validateReadyWU(wu);
      expect(result.success).toBe(true);
      expect(result.data?.plan).toBe('docs/04-operations/plans/WU-1683-plan.md');
    });

    it('should reject non-string plan values', () => {
      const wu = makeValidWU({ plan: 123 });
      const result = validateWU(wu);
      expect(result.success).toBe(false);
    });

    it('should reject array plan values', () => {
      const wu = makeValidWU({ plan: ['plan1.md', 'plan2.md'] });
      const result = validateWU(wu);
      expect(result.success).toBe(false);
    });
  });

  describe('AC4: Spec completeness validates plan file exists', () => {
    it('should not warn when plan field is not set', () => {
      const wu = makeValidWU();
      const { warnings } = validateWUCompleteness(wu);
      // No plan-file-specific warnings (spec_refs warnings may mention "plan" generically)
      const planFieldWarnings = warnings.filter((w) => w.includes("'plan' field"));
      expect(planFieldWarnings).toHaveLength(0);
    });

    it('should warn when plan field is set but file does not exist', () => {
      const wu = makeValidWU({
        plan: 'docs/04-operations/plans/WU-1683-plan.md',
      });
      const { warnings } = validateWUCompleteness(wu);
      const planFieldWarnings = warnings.filter((w) => w.includes("'plan' field"));
      expect(planFieldWarnings.length).toBeGreaterThan(0);
    });

    it('should not warn about plan for terminal WUs (done/cancelled)', () => {
      const wu = makeValidWU({
        status: 'done',
        plan: 'nonexistent-plan.md',
      });
      const { warnings } = validateWUCompleteness(wu);
      // Terminal WUs skip completeness checks entirely
      const planFieldWarnings = warnings.filter((w) => w.includes("'plan' field"));
      expect(planFieldWarnings).toHaveLength(0);
    });

    it('should not warn about plan for documentation WUs', () => {
      const wu = makeValidWU({
        type: 'documentation',
        plan: 'nonexistent-plan.md',
        code_paths: [],
      });
      const { warnings } = validateWUCompleteness(wu);
      const planFieldWarnings = warnings.filter((w) => w.includes("'plan' field"));
      expect(planFieldWarnings).toHaveLength(0);
    });
  });
});

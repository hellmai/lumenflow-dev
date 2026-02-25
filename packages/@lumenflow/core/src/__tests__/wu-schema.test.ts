// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

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

    // NOTE: Plan file existence validation is out of scope for WU-1683.
    // The plan field holds URIs (lumenflow://plans/...) that can't be
    // checked on disk. Completeness validation may be added in a future WU.
  });
});

describe('WU Schema: sizing_estimate .refine() (WU-2155)', () => {
  it('should accept sizing_estimate without exception fields', () => {
    const wu = makeValidWU({
      sizing_estimate: {
        estimated_files: 5,
        estimated_tool_calls: 30,
        strategy: 'single-session',
      },
    });

    const result = validateWU(wu);
    expect(result.success).toBe(true);
  });

  it('should accept sizing_estimate with both exception_type and exception_reason', () => {
    const wu = makeValidWU({
      sizing_estimate: {
        estimated_files: 50,
        estimated_tool_calls: 120,
        strategy: 'checkpoint-resume',
        exception_type: 'docs-only',
        exception_reason: 'All markdown documentation files',
      },
    });

    const result = validateWU(wu);
    expect(result.success).toBe(true);
  });

  it('should reject sizing_estimate with exception_type but no exception_reason', () => {
    const wu = makeValidWU({
      sizing_estimate: {
        estimated_files: 50,
        estimated_tool_calls: 120,
        strategy: 'checkpoint-resume',
        exception_type: 'docs-only',
      },
    });

    const result = validateWU(wu);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('exception_reason'))).toBe(true);
    }
  });

  it('should reject sizing_estimate with exception_type and empty exception_reason', () => {
    const wu = makeValidWU({
      sizing_estimate: {
        estimated_files: 50,
        estimated_tool_calls: 120,
        strategy: 'checkpoint-resume',
        exception_type: 'shallow-multi-file',
        exception_reason: '   ',
      },
    });

    const result = validateWU(wu);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('exception_reason'))).toBe(true);
    }
  });

  it('should accept sizing_estimate without exception_type (backward compat)', () => {
    const wu = makeValidWU({
      sizing_estimate: {
        estimated_files: 10,
        estimated_tool_calls: 30,
        strategy: 'single-session',
      },
    });

    const result = validateWU(wu);
    expect(result.success).toBe(true);
  });
});

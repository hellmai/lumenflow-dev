/**
 * Tests for formatting.ts — false-complete bug (WU-1906).
 *
 * When plan.waves is empty, the formatters must distinguish between:
 * (a) all WUs done → "All WUs are complete"
 * (b) WUs still pending but none unblocked → "N WU(s) pending but none unblocked"
 */
import { describe, it, expect } from 'vitest';
import { formatExecutionPlan, formatExecutionPlanWithEmbeddedSpawns } from '../formatting.js';
import type { ExecutionPlan } from '../types.js';
import type { InitiativeDoc } from '../../initiative-yaml.js';

const INIT_DOC: InitiativeDoc = {
  id: 'INIT-TEST',
  slug: 'test-initiative',
  status: 'in_progress',
  title: 'Test Initiative',
};

function makePlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    waves: [],
    skipped: [],
    skippedWithReasons: [],
    deferred: [],
    ...overrides,
  };
}

describe('formatExecutionPlan — zero-waves disambiguation (WU-1906)', () => {
  it('reports "complete" when all WUs are skipped (done) and nothing deferred', () => {
    const plan = makePlan({
      skipped: ['WU-100', 'WU-101', 'WU-102'],
    });

    const output = formatExecutionPlan(INIT_DOC, plan);
    expect(output).toContain('complete');
    expect(output).not.toMatch(/pending|unblocked|blocked/i);
  });

  it('reports pending/blocked when deferred WUs exist', () => {
    const plan = makePlan({
      skipped: ['WU-100'],
      deferred: [
        { id: 'WU-101', blockedBy: ['WU-100'], reason: 'dependency not met' },
        { id: 'WU-102', blockedBy: ['WU-101'], reason: 'dependency not met' },
      ],
    });

    const output = formatExecutionPlan(INIT_DOC, plan);
    // Must NOT say "complete" — WUs are still pending
    expect(output).not.toMatch(/all.*complete/i);
    // Must indicate that WUs are pending but blocked
    expect(output).toMatch(/pending|unblocked|blocked/i);
  });

  it('reports pending/blocked when skippedWithReasons (non-ready) WUs exist', () => {
    const plan = makePlan({
      skippedWithReasons: [
        { id: 'WU-200', reason: 'status: in_progress' },
        { id: 'WU-201', reason: 'status: blocked' },
      ],
    });

    const output = formatExecutionPlan(INIT_DOC, plan);
    expect(output).not.toMatch(/all.*complete/i);
  });

  it('reports pending when both deferred and skippedWithReasons are present', () => {
    const plan = makePlan({
      skipped: ['WU-300'],
      skippedWithReasons: [{ id: 'WU-301', reason: 'status: blocked' }],
      deferred: [{ id: 'WU-302', blockedBy: ['WU-301'], reason: 'dependency not met' }],
    });

    const output = formatExecutionPlan(INIT_DOC, plan);
    expect(output).not.toMatch(/all.*complete/i);
    expect(output).toMatch(/pending|unblocked|blocked/i);
  });
});

describe('formatExecutionPlanWithEmbeddedSpawns — zero-waves disambiguation (WU-1906)', () => {
  it('reports "complete" when all WUs are done (empty deferred/skippedWithReasons)', () => {
    const plan = makePlan({
      skipped: ['WU-400', 'WU-401'],
    });

    const output = formatExecutionPlanWithEmbeddedSpawns(plan);
    expect(output).toContain('complete');
    expect(output).not.toMatch(/pending|unblocked|blocked/i);
  });

  it('does NOT report "complete" when deferred WUs exist', () => {
    const plan = makePlan({
      deferred: [{ id: 'WU-500', blockedBy: ['WU-499'], reason: 'dependency not met' }],
    });

    const output = formatExecutionPlanWithEmbeddedSpawns(plan);
    expect(output).not.toMatch(/complete/i);
    expect(output).toMatch(/pending|unblocked|blocked/i);
  });

  it('does NOT report "complete" when skippedWithReasons exist', () => {
    const plan = makePlan({
      skippedWithReasons: [{ id: 'WU-600', reason: 'status: in_progress' }],
    });

    const output = formatExecutionPlanWithEmbeddedSpawns(plan);
    expect(output).not.toMatch(/complete/i);
  });
});

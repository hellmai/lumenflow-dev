/**
 * Tests for flow state calculation
 */
import { describe, it, expect } from 'vitest';
import { calculateFlowState } from '../../src/flow/calculate-flow-state.js';
import type { WUMetrics } from '../../src/types.js';

describe('calculateFlowState', () => {
  it('counts WUs by status correctly', () => {
    const wuMetrics: WUMetrics[] = [
      { id: 'WU-1', title: 'a', lane: 'Ops', status: 'ready' },
      { id: 'WU-2', title: 'b', lane: 'Ops', status: 'ready' },
      { id: 'WU-3', title: 'c', lane: 'Ops', status: 'in_progress' },
      { id: 'WU-4', title: 'd', lane: 'Ops', status: 'blocked' },
      { id: 'WU-5', title: 'e', lane: 'Ops', status: 'waiting' },
      { id: 'WU-6', title: 'f', lane: 'Ops', status: 'done' },
      { id: 'WU-7', title: 'g', lane: 'Ops', status: 'done' },
      { id: 'WU-8', title: 'h', lane: 'Ops', status: 'done' },
    ];

    const result = calculateFlowState(wuMetrics);

    expect(result.ready).toBe(2);
    expect(result.inProgress).toBe(1);
    expect(result.blocked).toBe(1);
    expect(result.waiting).toBe(1);
    expect(result.done).toBe(3);
    expect(result.totalActive).toBe(5);
  });

  it('returns zeros for empty array', () => {
    const result = calculateFlowState([]);

    expect(result.ready).toBe(0);
    expect(result.inProgress).toBe(0);
    expect(result.blocked).toBe(0);
    expect(result.waiting).toBe(0);
    expect(result.done).toBe(0);
    expect(result.totalActive).toBe(0);
  });

  it('calculates totalActive excluding done', () => {
    const wuMetrics: WUMetrics[] = [
      { id: 'WU-1', title: 'a', lane: 'Ops', status: 'ready' },
      { id: 'WU-2', title: 'b', lane: 'Ops', status: 'in_progress' },
      { id: 'WU-3', title: 'c', lane: 'Ops', status: 'done' },
    ];

    const result = calculateFlowState(wuMetrics);

    expect(result.totalActive).toBe(2);
    expect(result.done).toBe(1);
  });

  it('handles all same status', () => {
    const wuMetrics: WUMetrics[] = [
      { id: 'WU-1', title: 'a', lane: 'Ops', status: 'blocked' },
      { id: 'WU-2', title: 'b', lane: 'Ops', status: 'blocked' },
      { id: 'WU-3', title: 'c', lane: 'Ops', status: 'blocked' },
    ];

    const result = calculateFlowState(wuMetrics);

    expect(result.blocked).toBe(3);
    expect(result.totalActive).toBe(3);
    expect(result.ready).toBe(0);
  });
});

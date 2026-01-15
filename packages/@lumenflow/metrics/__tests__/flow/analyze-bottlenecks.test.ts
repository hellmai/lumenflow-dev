/**
 * Tests for bottleneck analysis
 */
import { describe, it, expect } from 'vitest';
import {
  topologicalSort,
  criticalPath,
  impactScore,
  analyzeBottlenecks,
  getBottleneckAnalysis,
  type DependencyGraph,
} from '../../src/flow/analyze-bottlenecks.js';
import type { DependencyGraphNode } from '../../src/types.js';

function createNode(
  id: string,
  blocks: string[] = [],
  blockedBy: string[] = [],
  status = 'ready'
): DependencyGraphNode {
  return { id, title: `Title for ${id}`, blocks, blockedBy, status };
}

describe('topologicalSort', () => {
  it('returns empty order for empty graph', () => {
    const graph: DependencyGraph = new Map();
    const result = topologicalSort(graph);
    expect(result.order).toEqual([]);
    expect(result.hasCycle).toBe(false);
  });

  it('returns correct order for linear chain', () => {
    const graph: DependencyGraph = new Map([
      ['WU-1', createNode('WU-1', ['WU-2'], [])],
      ['WU-2', createNode('WU-2', ['WU-3'], ['WU-1'])],
      ['WU-3', createNode('WU-3', [], ['WU-2'])],
    ]);

    const result = topologicalSort(graph);
    expect(result.hasCycle).toBe(false);
    expect(result.order.indexOf('WU-1')).toBeLessThan(result.order.indexOf('WU-2'));
    expect(result.order.indexOf('WU-2')).toBeLessThan(result.order.indexOf('WU-3'));
  });

  it('excludes done WUs', () => {
    const graph: DependencyGraph = new Map([
      ['WU-1', createNode('WU-1', ['WU-2'], [], 'done')],
      ['WU-2', createNode('WU-2', [], ['WU-1'], 'ready')],
    ]);

    const result = topologicalSort(graph);
    expect(result.hasCycle).toBe(false);
    expect(result.order).toContain('WU-2');
    expect(result.order).not.toContain('WU-1');
  });

  it('detects cycles and returns warning', () => {
    const graph: DependencyGraph = new Map([
      ['WU-1', createNode('WU-1', ['WU-2'], ['WU-2'])],
      ['WU-2', createNode('WU-2', ['WU-1'], ['WU-1'])],
    ]);

    const result = topologicalSort(graph);
    expect(result.hasCycle).toBe(true);
    expect(result.warning).toContain('Cycle detected');
    expect(result.cycleNodes).toBeDefined();
  });
});

describe('criticalPath', () => {
  it('returns empty path for empty graph', () => {
    const graph: DependencyGraph = new Map();
    const result = criticalPath(graph);
    expect(result.path).toEqual([]);
    expect(result.length).toBe(0);
  });

  it('finds longest path in linear chain', () => {
    const graph: DependencyGraph = new Map([
      ['WU-1', createNode('WU-1', ['WU-2'], [])],
      ['WU-2', createNode('WU-2', ['WU-3'], ['WU-1'])],
      ['WU-3', createNode('WU-3', [], ['WU-2'])],
    ]);

    const result = criticalPath(graph);
    expect(result.length).toBe(3);
    expect(result.path).toEqual(['WU-1', 'WU-2', 'WU-3']);
  });

  it('handles branching graph', () => {
    const graph: DependencyGraph = new Map([
      ['WU-1', createNode('WU-1', ['WU-2', 'WU-3'], [])],
      ['WU-2', createNode('WU-2', ['WU-4'], ['WU-1'])],
      ['WU-3', createNode('WU-3', [], ['WU-1'])],
      ['WU-4', createNode('WU-4', [], ['WU-2'])],
    ]);

    const result = criticalPath(graph);
    // Longest path is WU-1 -> WU-2 -> WU-4
    expect(result.length).toBe(3);
    expect(result.path[0]).toBe('WU-1');
    expect(result.path[result.length - 1]).toBe('WU-4');
  });

  it('returns warning for cyclic graph', () => {
    const graph: DependencyGraph = new Map([
      ['WU-1', createNode('WU-1', ['WU-2'], ['WU-2'])],
      ['WU-2', createNode('WU-2', ['WU-1'], ['WU-1'])],
    ]);

    const result = criticalPath(graph);
    expect(result.warning).toBeDefined();
  });
});

describe('impactScore', () => {
  it('returns 0 for WU not in graph', () => {
    const graph: DependencyGraph = new Map();
    expect(impactScore(graph, 'WU-999')).toBe(0);
  });

  it('returns 0 for WU with no dependents', () => {
    const graph: DependencyGraph = new Map([
      ['WU-1', createNode('WU-1', [], [])],
    ]);
    expect(impactScore(graph, 'WU-1')).toBe(0);
  });

  it('counts direct dependents', () => {
    const graph: DependencyGraph = new Map([
      ['WU-1', createNode('WU-1', ['WU-2', 'WU-3'], [])],
      ['WU-2', createNode('WU-2', [], ['WU-1'])],
      ['WU-3', createNode('WU-3', [], ['WU-1'])],
    ]);

    expect(impactScore(graph, 'WU-1')).toBe(2);
  });

  it('counts transitive dependents', () => {
    const graph: DependencyGraph = new Map([
      ['WU-1', createNode('WU-1', ['WU-2'], [])],
      ['WU-2', createNode('WU-2', ['WU-3'], ['WU-1'])],
      ['WU-3', createNode('WU-3', [], ['WU-2'])],
    ]);

    expect(impactScore(graph, 'WU-1')).toBe(2);
  });

  it('excludes done WUs', () => {
    const graph: DependencyGraph = new Map([
      ['WU-1', createNode('WU-1', ['WU-2'], [], 'ready')],
      ['WU-2', createNode('WU-2', [], ['WU-1'], 'done')],
    ]);

    expect(impactScore(graph, 'WU-1')).toBe(0);
  });
});

describe('analyzeBottlenecks', () => {
  it('returns empty array for empty graph', () => {
    const graph: DependencyGraph = new Map();
    const result = analyzeBottlenecks(graph, 10);
    expect(result).toEqual([]);
  });

  it('ranks by impact score descending', () => {
    const graph: DependencyGraph = new Map([
      ['WU-1', createNode('WU-1', ['WU-2', 'WU-3', 'WU-4'], [])],
      ['WU-2', createNode('WU-2', ['WU-4'], ['WU-1'])],
      ['WU-3', createNode('WU-3', [], ['WU-1'])],
      ['WU-4', createNode('WU-4', [], ['WU-1', 'WU-2'])],
    ]);

    const result = analyzeBottlenecks(graph, 10);
    expect(result[0]?.id).toBe('WU-1');
    expect(result[0]?.score).toBeGreaterThanOrEqual(result[1]?.score ?? 0);
  });

  it('respects limit', () => {
    const graph: DependencyGraph = new Map([
      ['WU-1', createNode('WU-1', [], [])],
      ['WU-2', createNode('WU-2', [], [])],
      ['WU-3', createNode('WU-3', [], [])],
    ]);

    const result = analyzeBottlenecks(graph, 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('includes title in results', () => {
    const graph: DependencyGraph = new Map([
      ['WU-1', createNode('WU-1', [], [])],
    ]);

    const result = analyzeBottlenecks(graph, 10);
    expect(result[0]?.title).toBeDefined();
  });
});

describe('getBottleneckAnalysis', () => {
  it('returns both bottlenecks and critical path', () => {
    const graph: DependencyGraph = new Map([
      ['WU-1', createNode('WU-1', ['WU-2'], [])],
      ['WU-2', createNode('WU-2', [], ['WU-1'])],
    ]);

    const result = getBottleneckAnalysis(graph);
    expect(result.bottlenecks).toBeDefined();
    expect(result.criticalPath).toBeDefined();
  });

  it('uses default limit of 10', () => {
    const graph: DependencyGraph = new Map();
    // Create 15 independent WUs
    for (let i = 0; i < 15; i++) {
      graph.set(`WU-${i}`, createNode(`WU-${i}`, [], []));
    }

    const result = getBottleneckAnalysis(graph);
    expect(result.bottlenecks.length).toBeLessThanOrEqual(10);
  });
});

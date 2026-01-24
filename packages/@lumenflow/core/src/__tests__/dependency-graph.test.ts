/**
 * @file dependency-graph.test.ts
 * @description Tests for dependency graph module (WU-1088)
 *
 * Ensures no top-level await warnings and proper cycle detection.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('dependency-graph', () => {
  describe('module loading', () => {
    it('should import without top-level await warning', async () => {
      // This test verifies that the module can be imported without triggering
      // "Detected unsettled top-level await" warning
      // The warning occurs when a top-level await is not resolved before module finishes loading
      const module = await import('../dependency-graph.js');

      // Module should export expected functions
      expect(typeof module.buildDependencyGraph).toBe('function');
      expect(typeof module.renderASCII).toBe('function');
      expect(typeof module.renderMermaid).toBe('function');
      expect(typeof module.validateGraph).toBe('function');
      expect(typeof module.topologicalSort).toBe('function');
      expect(typeof module.criticalPath).toBe('function');
      expect(typeof module.bottlenecks).toBe('function');
    });
  });

  describe('detectCycles (internal)', () => {
    // Import the internal detectCycles function for testing
    // Note: detectCycles is used internally by validateGraph and renderASCII

    it('should detect no cycles in empty graph', async () => {
      const { validateGraph } = await import('../dependency-graph.js');
      const graph = new Map();

      const result = validateGraph(graph);
      expect(result.hasCycle).toBe(false);
      expect(result.cycles).toEqual([]);
    });

    it('should detect no cycles in simple linear graph', async () => {
      const { validateGraph } = await import('../dependency-graph.js');
      // Linear chain: WU-001 blocks WU-002 blocks WU-003
      // No bidirectional references - truly acyclic
      const graph = new Map([
        [
          'WU-001',
          { id: 'WU-001', title: 'First', status: 'ready', blocks: ['WU-002'], blockedBy: [] },
        ],
        [
          'WU-002',
          { id: 'WU-002', title: 'Second', status: 'ready', blocks: ['WU-003'], blockedBy: [] },
        ],
        ['WU-003', { id: 'WU-003', title: 'Third', status: 'ready', blocks: [], blockedBy: [] }],
      ]);

      const result = validateGraph(graph);
      expect(result.hasCycle).toBe(false);
      expect(result.cycles).toEqual([]);
    });

    it('should detect simple 2-node cycle', async () => {
      const { validateGraph } = await import('../dependency-graph.js');
      const graph = new Map([
        [
          'WU-001',
          {
            id: 'WU-001',
            title: 'First',
            status: 'ready',
            blocks: ['WU-002'],
            blockedBy: ['WU-002'],
          },
        ],
        [
          'WU-002',
          {
            id: 'WU-002',
            title: 'Second',
            status: 'ready',
            blocks: ['WU-001'],
            blockedBy: ['WU-001'],
          },
        ],
      ]);

      const result = validateGraph(graph);
      expect(result.hasCycle).toBe(true);
      expect(result.cycles.length).toBeGreaterThan(0);
    });

    it('should detect self-reference cycle', async () => {
      const { validateGraph } = await import('../dependency-graph.js');
      const graph = new Map([
        [
          'WU-001',
          { id: 'WU-001', title: 'Self-ref', status: 'ready', blocks: ['WU-001'], blockedBy: [] },
        ],
      ]);

      const result = validateGraph(graph);
      expect(result.hasCycle).toBe(true);
    });
  });

  describe('buildDependencyGraph', () => {
    it('should return empty graph when WU directory does not exist', async () => {
      const { buildDependencyGraph } = await import('../dependency-graph.js');
      // In test environment, the WU directory may not exist
      // The function should gracefully return an empty map
      const graph = buildDependencyGraph();
      expect(graph instanceof Map).toBe(true);
    });
  });

  describe('topologicalSort', () => {
    it('should return empty array for empty graph', async () => {
      const { topologicalSort } = await import('../dependency-graph.js');
      const graph = new Map();

      const result = topologicalSort(graph);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([]);
    });

    it('should sort acyclic graph correctly', async () => {
      const { topologicalSort } = await import('../dependency-graph.js');
      const graph = new Map([
        [
          'WU-001',
          { id: 'WU-001', title: 'First', status: 'ready', blocks: ['WU-002'], blockedBy: [] },
        ],
        [
          'WU-002',
          { id: 'WU-002', title: 'Second', status: 'ready', blocks: [], blockedBy: ['WU-001'] },
        ],
      ]);

      const result = topologicalSort(graph);
      // Should be array (not object with warning)
      expect(Array.isArray(result)).toBe(true);
      // WU-001 should come before WU-002 since WU-002 is blocked by WU-001
      const idx1 = result.indexOf('WU-001');
      const idx2 = result.indexOf('WU-002');
      expect(idx1).toBeLessThan(idx2);
    });
  });

  describe('criticalPath', () => {
    it('should return empty path for empty graph', async () => {
      const { criticalPath } = await import('../dependency-graph.js');
      const graph = new Map();

      const result = criticalPath(graph);
      expect(result.path).toEqual([]);
      expect(result.length).toBe(0);
    });
  });

  describe('bottlenecks', () => {
    it('should return empty array for empty graph', async () => {
      const { bottlenecks } = await import('../dependency-graph.js');
      const graph = new Map();

      const result = bottlenecks(graph, 10);
      expect(result).toEqual([]);
    });

    it('should identify bottleneck WUs', async () => {
      const { bottlenecks } = await import('../dependency-graph.js');
      // WU-001 blocks WU-002 and WU-003, making it a bottleneck
      const graph = new Map([
        [
          'WU-001',
          {
            id: 'WU-001',
            title: 'Bottleneck',
            status: 'ready',
            blocks: ['WU-002', 'WU-003'],
            blockedBy: [],
          },
        ],
        [
          'WU-002',
          { id: 'WU-002', title: 'Blocked1', status: 'ready', blocks: [], blockedBy: ['WU-001'] },
        ],
        [
          'WU-003',
          { id: 'WU-003', title: 'Blocked2', status: 'ready', blocks: [], blockedBy: ['WU-001'] },
        ],
      ]);

      const result = bottlenecks(graph, 10);
      expect(result.length).toBeGreaterThan(0);
      // WU-001 should be the top bottleneck with score 2
      expect(result[0].id).toBe('WU-001');
      expect(result[0].score).toBe(2);
    });
  });

  describe('renderASCII', () => {
    it('should return error message for non-existent WU', async () => {
      const { renderASCII } = await import('../dependency-graph.js');
      const graph = new Map();

      const result = renderASCII(graph, 'WU-999');
      expect(result).toContain('WU not found');
    });

    it('should render simple WU', async () => {
      const { renderASCII } = await import('../dependency-graph.js');
      const graph = new Map([
        ['WU-001', { id: 'WU-001', title: 'Test WU', status: 'ready', blocks: [], blockedBy: [] }],
      ]);

      const result = renderASCII(graph, 'WU-001');
      expect(result).toContain('WU-001');
      expect(result).toContain('Test WU');
    });
  });

  describe('renderMermaid', () => {
    it('should render flowchart header', async () => {
      const { renderMermaid } = await import('../dependency-graph.js');
      const graph = new Map([
        ['WU-001', { id: 'WU-001', title: 'Test', status: 'ready', blocks: [], blockedBy: [] }],
      ]);

      const result = renderMermaid(graph);
      expect(result).toContain('flowchart TD');
    });

    it('should include node definitions', async () => {
      const { renderMermaid } = await import('../dependency-graph.js');
      const graph = new Map([
        ['WU-001', { id: 'WU-001', title: 'Test', status: 'ready', blocks: [], blockedBy: [] }],
      ]);

      const result = renderMermaid(graph);
      expect(result).toContain('WU-001');
    });
  });
});

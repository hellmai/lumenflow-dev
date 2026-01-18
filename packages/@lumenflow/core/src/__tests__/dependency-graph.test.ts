/**
 * Dependency Graph Tests (WU-1247, WU-1568)
 *
 * Tests for dependency graph building, visualization, and analysis.
 * Tests ASCII and Mermaid output formats.
 * Tests graph algorithms: topological sort, critical path, impact scoring.
 *
 * @see {@link tools/lib/dependency-graph.mjs} - Implementation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getUpstreamDependencies,
  getDownstreamDependents,
  renderASCII,
  renderMermaid,
  validateGraph,
  topologicalSort,
  criticalPath,
  impactScore,
  bottlenecks,
} from '../dependency-graph.js';

describe('dependency-graph', () => {
  describe('getUpstreamDependencies', () => {
    it('should return empty array for WU with no blocked_by', () => {
      const graph = new Map([['WU-001', { id: 'WU-001', blockedBy: [], blocks: [] }]]);

      const result = getUpstreamDependencies(graph, 'WU-001');
      expect(result).toEqual([]);
    });

    it('should return direct dependencies', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', blockedBy: ['WU-002'], blocks: [] }],
        ['WU-002', { id: 'WU-002', blockedBy: [], blocks: [] }],
      ]);

      const result = getUpstreamDependencies(graph, 'WU-001');
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('WU-002');
      expect(result[0].depth).toBe(1);
    });

    it('should traverse transitive dependencies', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', blockedBy: ['WU-002'], blocks: [] }],
        ['WU-002', { id: 'WU-002', blockedBy: ['WU-003'], blocks: [] }],
        ['WU-003', { id: 'WU-003', blockedBy: [], blocks: [] }],
      ]);

      const result = getUpstreamDependencies(graph, 'WU-001');
      expect(result.length).toBe(2);
      expect(result[0].id).toBe('WU-002');
      expect(result[0].depth).toBe(1);
      expect(result[1].id).toBe('WU-003');
      expect(result[1].depth).toBe(2);
    });

    it('should respect maxDepth parameter', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', blockedBy: ['WU-002'], blocks: [] }],
        ['WU-002', { id: 'WU-002', blockedBy: ['WU-003'], blocks: [] }],
        ['WU-003', { id: 'WU-003', blockedBy: ['WU-004'], blocks: [] }],
        ['WU-004', { id: 'WU-004', blockedBy: [], blocks: [] }],
      ]);

      const result = getUpstreamDependencies(graph, 'WU-001', 2);
      expect(result.length).toBe(2);
      // Should not include WU-004 (depth 3)
    });

    it('should handle missing WU gracefully', () => {
      const graph = new Map([['WU-001', { id: 'WU-001', blockedBy: ['WU-999'], blocks: [] }]]);

      const result = getUpstreamDependencies(graph, 'WU-001');
      // WU-999 not in graph, should return it but not traverse further
      expect(result.length >= 0).toBeTruthy();
    });

    it('should not visit same node twice (prevent infinite loops)', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', blockedBy: ['WU-002', 'WU-003'], blocks: [] }],
        ['WU-002', { id: 'WU-002', blockedBy: ['WU-004'], blocks: [] }],
        ['WU-003', { id: 'WU-003', blockedBy: ['WU-004'], blocks: [] }],
        ['WU-004', { id: 'WU-004', blockedBy: [], blocks: [] }],
      ]);

      const result = getUpstreamDependencies(graph, 'WU-001');
      // WU-004 should only appear once despite being reachable via two paths
      const wu004Count = result.filter((r) => r.id === 'WU-004').length;
      expect(wu004Count).toBe(1);
    });
  });

  describe('getDownstreamDependents', () => {
    it('should return empty array for WU with no blocks', () => {
      const graph = new Map([['WU-001', { id: 'WU-001', blockedBy: [], blocks: [] }]]);

      const result = getDownstreamDependents(graph, 'WU-001');
      expect(result).toEqual([]);
    });

    it('should return direct dependents', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', blockedBy: [], blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', blockedBy: [], blocks: [] }],
      ]);

      const result = getDownstreamDependents(graph, 'WU-001');
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('WU-002');
      expect(result[0].depth).toBe(1);
    });

    it('should traverse transitive dependents', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', blockedBy: [], blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', blockedBy: [], blocks: ['WU-003'] }],
        ['WU-003', { id: 'WU-003', blockedBy: [], blocks: [] }],
      ]);

      const result = getDownstreamDependents(graph, 'WU-001');
      expect(result.length).toBe(2);
      expect(result[0].id).toBe('WU-002');
      expect(result[1].id).toBe('WU-003');
    });

    it('should respect maxDepth parameter', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', blockedBy: [], blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', blockedBy: [], blocks: ['WU-003'] }],
        ['WU-003', { id: 'WU-003', blockedBy: [], blocks: ['WU-004'] }],
        ['WU-004', { id: 'WU-004', blockedBy: [], blocks: [] }],
      ]);

      const result = getDownstreamDependents(graph, 'WU-001', 2);
      expect(result.length).toBe(2);
      // Should not include WU-004 (depth 3)
    });
  });

  describe('renderASCII', () => {
    it('should return error message for missing WU', () => {
      const graph = new Map();
      const result = renderASCII(graph, 'WU-999');
      expect(result).toContain('WU not found');
      expect(result).toContain('WU-999');
    });

    it('should render WU header', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', title: 'Test WU', status: 'ready', blockedBy: [], blocks: [] }],
      ]);

      const result = renderASCII(graph, 'WU-001');
      expect(result).toContain('WU-001');
      expect(result).toContain('Test WU');
    });

    it('should render upstream dependencies', () => {
      const graph = new Map([
        [
          'WU-001',
          { id: 'WU-001', title: 'Child', status: 'ready', blockedBy: ['WU-002'], blocks: [] },
        ],
        ['WU-002', { id: 'WU-002', title: 'Parent', status: 'done', blockedBy: [], blocks: [] }],
      ]);

      const result = renderASCII(graph, 'WU-001');
      expect(result.includes('Dependencies (blocked by)')).toBeTruthy();
      expect(result).toContain('WU-002');
      expect(result).toContain('[done]');
    });

    it('should render downstream dependents', () => {
      const graph = new Map([
        [
          'WU-001',
          { id: 'WU-001', title: 'Parent', status: 'done', blockedBy: [], blocks: ['WU-002'] },
        ],
        ['WU-002', { id: 'WU-002', title: 'Child', status: 'ready', blockedBy: [], blocks: [] }],
      ]);

      const result = renderASCII(graph, 'WU-001');
      expect(result.includes('Dependents (blocks)')).toBeTruthy();
      expect(result).toContain('WU-002');
    });

    it('should support direction=up option', () => {
      const graph = new Map([
        [
          'WU-001',
          {
            id: 'WU-001',
            title: 'Test',
            status: 'ready',
            blockedBy: ['WU-002'],
            blocks: ['WU-003'],
          },
        ],
        ['WU-002', { id: 'WU-002', title: 'Upstream', status: 'done', blockedBy: [], blocks: [] }],
        [
          'WU-003',
          { id: 'WU-003', title: 'Downstream', status: 'ready', blockedBy: [], blocks: [] },
        ],
      ]);

      const result = renderASCII(graph, 'WU-001', { direction: 'up' });
      expect(result).toContain('WU-002');
      expect(!result.includes('Dependents (blocks)')).toBeTruthy();
    });

    it('should support direction=down option', () => {
      const graph = new Map([
        [
          'WU-001',
          {
            id: 'WU-001',
            title: 'Test',
            status: 'ready',
            blockedBy: ['WU-002'],
            blocks: ['WU-003'],
          },
        ],
        ['WU-002', { id: 'WU-002', title: 'Upstream', status: 'done', blockedBy: [], blocks: [] }],
        [
          'WU-003',
          { id: 'WU-003', title: 'Downstream', status: 'ready', blockedBy: [], blocks: [] },
        ],
      ]);

      const result = renderASCII(graph, 'WU-001', { direction: 'down' });
      expect(result).toContain('WU-003');
      expect(!result.includes('Dependencies (blocked by)')).toBeTruthy();
    });

    it('should truncate long titles', () => {
      const longTitle = 'A'.repeat(100);
      const graph = new Map([
        ['WU-001', { id: 'WU-001', title: longTitle, status: 'ready', blockedBy: [], blocks: [] }],
      ]);

      const result = renderASCII(graph, 'WU-001');
      expect(result).not.toContain(longTitle);
      expect(result).toContain('...');
    });
  });

  describe('renderMermaid', () => {
    it('should render flowchart header with direction', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', title: 'Test', status: 'ready', blockedBy: [], blocks: [] }],
      ]);

      const result = renderMermaid(graph);
      expect(result).toContain('flowchart TD');
    });

    it('should support custom direction', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', title: 'Test', status: 'ready', blockedBy: [], blocks: [] }],
      ]);

      const result = renderMermaid(graph, { direction: 'LR' });
      expect(result).toContain('flowchart LR');
    });

    it('should render node definitions with titles', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', title: 'Test WU', status: 'ready', blockedBy: [], blocks: [] }],
      ]);

      const result = renderMermaid(graph);
      expect(result).toContain('WU-001');
      expect(result).toContain('Test WU');
    });

    it('should render edges for blocked_by relationships', () => {
      const graph = new Map([
        [
          'WU-001',
          { id: 'WU-001', title: 'Child', status: 'ready', blockedBy: ['WU-002'], blocks: [] },
        ],
        ['WU-002', { id: 'WU-002', title: 'Parent', status: 'done', blockedBy: [], blocks: [] }],
      ]);

      const result = renderMermaid(graph);
      expect(result).toContain('WU-002 --> WU-001');
    });

    it('should render status styling classes', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', title: 'Test', status: 'done', blockedBy: [], blocks: [] }],
      ]);

      const result = renderMermaid(graph);
      expect(result).toContain('classDef done');
      expect(result).toContain('classDef in_progress');
      expect(result).toContain('classDef ready');
      expect(result).toContain('classDef blocked');
    });

    it('should apply class to nodes based on status', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', title: 'Test', status: 'done', blockedBy: [], blocks: [] }],
      ]);

      const result = renderMermaid(graph);
      expect(result).toContain('class WU-001 done');
    });

    it('should filter graph when rootId specified', () => {
      const graph = new Map([
        [
          'WU-001',
          { id: 'WU-001', title: 'Root', status: 'ready', blockedBy: ['WU-002'], blocks: [] },
        ],
        ['WU-002', { id: 'WU-002', title: 'Parent', status: 'done', blockedBy: [], blocks: [] }],
        [
          'WU-003',
          { id: 'WU-003', title: 'Unrelated', status: 'ready', blockedBy: [], blocks: [] },
        ],
      ]);

      const result = renderMermaid(graph, { rootId: 'WU-001' });
      expect(result).toContain('WU-001');
      expect(result).toContain('WU-002');
      // WU-003 is not connected to WU-001, should not appear
      expect(result).not.toContain('Unrelated');
    });
  });

  describe('validateGraph', () => {
    it('should return no errors for valid graph', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', blockedBy: ['WU-002'], blocks: [] }],
        ['WU-002', { id: 'WU-002', blockedBy: [], blocks: [] }],
      ]);

      const result = validateGraph(graph);
      expect(result.hasCycle).toBe(false);
      expect(result.orphans).toEqual([]);
    });

    it('should detect orphan references', () => {
      const graph = new Map([['WU-001', { id: 'WU-001', blockedBy: ['WU-999'], blocks: [] }]]);

      const result = validateGraph(graph);
      expect(result.orphans.length).toBe(1);
      expect(result.orphans[0].wuId).toBe('WU-001');
      expect(result.orphans[0].ref).toBe('WU-999');
    });

    it('should detect orphan in blocks field', () => {
      const graph = new Map([['WU-001', { id: 'WU-001', blockedBy: [], blocks: ['WU-999'] }]]);

      const result = validateGraph(graph);
      expect(result.orphans.length).toBe(1);
      expect(result.orphans[0].ref).toBe('WU-999');
    });

    it('should delegate cycle detection to initiative-validator', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', blockedBy: ['WU-002'], blocks: [] }],
        ['WU-002', { id: 'WU-002', blockedBy: ['WU-001'], blocks: [] }],
      ]);

      const result = validateGraph(graph);
      expect(result.hasCycle).toBe(true);
    });

    it('should report multiple orphans', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', blockedBy: ['WU-998'], blocks: ['WU-999'] }],
      ]);

      const result = validateGraph(graph);
      expect(result.orphans.length).toBe(2);
    });

    it('should handle empty graph', () => {
      const graph = new Map();

      const result = validateGraph(graph);
      expect(result.hasCycle).toBe(false);
      expect(result.orphans).toEqual([]);
      expect(result.cycles).toEqual([]);
    });
  });

  // WU-1568: Graph Analysis Tests
  describe('topologicalSort', () => {
    it('should return empty array for empty graph', () => {
      const graph = new Map();

      const result = topologicalSort(graph);
      expect(result).toEqual([]);
    });

    it('should return single node for single-node graph', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', status: 'ready', blockedBy: [], blocks: [] }],
      ]);

      const result = topologicalSort(graph);
      expect(result).toEqual(['WU-001']);
    });

    it('should return valid ordering for linear chain', () => {
      // WU-001 → WU-002 → WU-003 (WU-001 blocks WU-002 which blocks WU-003)
      const graph = new Map([
        ['WU-001', { id: 'WU-001', status: 'ready', blockedBy: [], blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', status: 'ready', blockedBy: ['WU-001'], blocks: ['WU-003'] }],
        ['WU-003', { id: 'WU-003', status: 'ready', blockedBy: ['WU-002'], blocks: [] }],
      ]);

      const result = topologicalSort(graph);
      // WU-001 must come before WU-002, WU-002 before WU-003
      const indexOf001 = result.indexOf('WU-001');
      const indexOf002 = result.indexOf('WU-002');
      const indexOf003 = result.indexOf('WU-003');
      expect(indexOf001 < indexOf002).toBe(true);
      expect(indexOf002 < indexOf003).toBe(true);
    });

    it('should return valid ordering for diamond pattern', () => {
      // Diamond: WU-001 → WU-002, WU-003 → WU-004
      //          WU-001 blocks both WU-002 and WU-003
      //          WU-002 and WU-003 both block WU-004
      const graph = new Map([
        ['WU-001', { id: 'WU-001', status: 'ready', blockedBy: [], blocks: ['WU-002', 'WU-003'] }],
        ['WU-002', { id: 'WU-002', status: 'ready', blockedBy: ['WU-001'], blocks: ['WU-004'] }],
        ['WU-003', { id: 'WU-003', status: 'ready', blockedBy: ['WU-001'], blocks: ['WU-004'] }],
        ['WU-004', { id: 'WU-004', status: 'ready', blockedBy: ['WU-002', 'WU-003'], blocks: [] }],
      ]);

      const result = topologicalSort(graph);
      // WU-001 must come first, WU-004 must come last
      expect(result.indexOf('WU-001')).toBe(0, 'WU-001 should be first');
      expect(result.indexOf('WU-004')).toBe(3, 'WU-004 should be last');
      // WU-002 and WU-003 can be in any order but must be between WU-001 and WU-004
      expect(result.indexOf('WU-002') > 0 && result.indexOf('WU-002') < 3).toBeTruthy();
      expect(result.indexOf('WU-003') > 0 && result.indexOf('WU-003') < 3).toBeTruthy();
    });

    it('should exclude done WUs from ordering', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', status: 'done', blockedBy: [], blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', status: 'ready', blockedBy: ['WU-001'], blocks: [] }],
      ]);

      const result = topologicalSort(graph);
      // Only WU-002 should be in result (WU-001 is done)
      expect(result).toEqual(['WU-002']);
    });

    it('should handle cycle gracefully and return partial ordering', () => {
      // Cycle: WU-001 → WU-002 → WU-001
      const graph = new Map([
        ['WU-001', { id: 'WU-001', status: 'ready', blockedBy: ['WU-002'], blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', status: 'ready', blockedBy: ['WU-001'], blocks: ['WU-001'] }],
      ]);

      const result = topologicalSort(graph);
      // Should not throw, returns object with warning
      expect(result.warning !== undefined || Array.isArray(result)).toBeTruthy();
    });
  });

  describe('criticalPath', () => {
    it('should return empty path for empty graph', () => {
      const graph = new Map();

      const result = criticalPath(graph);
      expect(result.path).toEqual([]);
      expect(result.length).toBe(0);
    });

    it('should return single node for single-node graph', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', status: 'ready', blockedBy: [], blocks: [] }],
      ]);

      const result = criticalPath(graph);
      expect(result.path).toEqual(['WU-001']);
      expect(result.length).toBe(1);
    });

    it('should return correct critical path for linear chain', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', status: 'ready', blockedBy: [], blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', status: 'ready', blockedBy: ['WU-001'], blocks: ['WU-003'] }],
        ['WU-003', { id: 'WU-003', status: 'ready', blockedBy: ['WU-002'], blocks: [] }],
      ]);

      const result = criticalPath(graph);
      expect(result.path).toEqual(['WU-001', 'WU-002', 'WU-003']);
      expect(result.length).toBe(3);
    });

    it('should return longest path for diamond pattern', () => {
      // All paths are length 3 in this diamond, so any path is valid
      const graph = new Map([
        ['WU-001', { id: 'WU-001', status: 'ready', blockedBy: [], blocks: ['WU-002', 'WU-003'] }],
        ['WU-002', { id: 'WU-002', status: 'ready', blockedBy: ['WU-001'], blocks: ['WU-004'] }],
        ['WU-003', { id: 'WU-003', status: 'ready', blockedBy: ['WU-001'], blocks: ['WU-004'] }],
        ['WU-004', { id: 'WU-004', status: 'ready', blockedBy: ['WU-002', 'WU-003'], blocks: [] }],
      ]);

      const result = criticalPath(graph);
      expect(result.length).toBe(3);
      expect(result.path[0]).toBe('WU-001');
      expect(result.path[2]).toBe('WU-004');
    });

    it('should exclude done WUs from critical path', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', status: 'done', blockedBy: [], blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', status: 'ready', blockedBy: ['WU-001'], blocks: ['WU-003'] }],
        ['WU-003', { id: 'WU-003', status: 'ready', blockedBy: ['WU-002'], blocks: [] }],
      ]);

      const result = criticalPath(graph);
      // WU-001 is done, so path starts from WU-002
      expect(result.path).toEqual(['WU-002', 'WU-003']);
      expect(result.length).toBe(2);
    });

    it('should handle cycle gracefully with warning', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', status: 'ready', blockedBy: ['WU-002'], blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', status: 'ready', blockedBy: ['WU-001'], blocks: ['WU-001'] }],
      ]);

      const result = criticalPath(graph);
      // Should return result with warning, not throw
      expect(result.warning !== undefined || result.path !== undefined).toBeTruthy();
    });
  });

  describe('impactScore', () => {
    it('should return 0 for node with no dependents', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', status: 'ready', blockedBy: [], blocks: [] }],
      ]);

      const result = impactScore(graph, 'WU-001');
      expect(result).toBe(0);
    });

    it('should return 1 for node with one direct dependent', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', status: 'ready', blockedBy: [], blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', status: 'ready', blockedBy: ['WU-001'], blocks: [] }],
      ]);

      const result = impactScore(graph, 'WU-001');
      expect(result).toBe(1);
    });

    it('should count all downstream dependents recursively', () => {
      // WU-001 → WU-002 → WU-003
      const graph = new Map([
        ['WU-001', { id: 'WU-001', status: 'ready', blockedBy: [], blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', status: 'ready', blockedBy: ['WU-001'], blocks: ['WU-003'] }],
        ['WU-003', { id: 'WU-003', status: 'ready', blockedBy: ['WU-002'], blocks: [] }],
      ]);

      const result = impactScore(graph, 'WU-001');
      expect(result).toBe(2); // WU-002 and WU-003
    });

    it('should count each dependent only once in diamond pattern', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', status: 'ready', blockedBy: [], blocks: ['WU-002', 'WU-003'] }],
        ['WU-002', { id: 'WU-002', status: 'ready', blockedBy: ['WU-001'], blocks: ['WU-004'] }],
        ['WU-003', { id: 'WU-003', status: 'ready', blockedBy: ['WU-001'], blocks: ['WU-004'] }],
        ['WU-004', { id: 'WU-004', status: 'ready', blockedBy: ['WU-002', 'WU-003'], blocks: [] }],
      ]);

      const result = impactScore(graph, 'WU-001');
      // WU-002, WU-003, WU-004 - each counted once
      expect(result).toBe(3);
    });

    it('should exclude done WUs from impact count', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', status: 'ready', blockedBy: [], blocks: ['WU-002', 'WU-003'] }],
        ['WU-002', { id: 'WU-002', status: 'done', blockedBy: ['WU-001'], blocks: [] }],
        ['WU-003', { id: 'WU-003', status: 'ready', blockedBy: ['WU-001'], blocks: [] }],
      ]);

      const result = impactScore(graph, 'WU-001');
      // Only WU-003 (WU-002 is done)
      expect(result).toBe(1);
    });

    it('should return 0 for non-existent node', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', status: 'ready', blockedBy: [], blocks: [] }],
      ]);

      const result = impactScore(graph, 'WU-999');
      expect(result).toBe(0);
    });
  });

  describe('bottlenecks', () => {
    it('should return empty array for empty graph', () => {
      const graph = new Map();

      const result = bottlenecks(graph, 5);
      expect(result).toEqual([]);
    });

    it('should return single node for single-node graph', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', status: 'ready', blockedBy: [], blocks: [] }],
      ]);

      const result = bottlenecks(graph, 5);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('WU-001');
      expect(result[0].score).toBe(0);
    });

    it('should rank nodes by impact score descending', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', status: 'ready', blockedBy: [], blocks: ['WU-002', 'WU-003'] }],
        ['WU-002', { id: 'WU-002', status: 'ready', blockedBy: ['WU-001'], blocks: ['WU-004'] }],
        ['WU-003', { id: 'WU-003', status: 'ready', blockedBy: ['WU-001'], blocks: [] }],
        ['WU-004', { id: 'WU-004', status: 'ready', blockedBy: ['WU-002'], blocks: [] }],
      ]);

      const result = bottlenecks(graph, 5);
      // WU-001 has highest impact (3), then WU-002 (1), then WU-003/WU-004 (0)
      expect(result[0].id).toBe('WU-001');
      expect(result[0].score).toBe(3);
      expect(result[1].id).toBe('WU-002');
      expect(result[1].score).toBe(1);
    });

    it('should respect limit parameter', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', status: 'ready', blockedBy: [], blocks: ['WU-002', 'WU-003'] }],
        ['WU-002', { id: 'WU-002', status: 'ready', blockedBy: ['WU-001'], blocks: ['WU-004'] }],
        ['WU-003', { id: 'WU-003', status: 'ready', blockedBy: ['WU-001'], blocks: [] }],
        ['WU-004', { id: 'WU-004', status: 'ready', blockedBy: ['WU-002'], blocks: [] }],
      ]);

      const result = bottlenecks(graph, 2);
      expect(result.length).toBe(2);
    });

    it('should exclude done WUs from results', () => {
      const graph = new Map([
        ['WU-001', { id: 'WU-001', status: 'done', blockedBy: [], blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', status: 'ready', blockedBy: ['WU-001'], blocks: [] }],
      ]);

      const result = bottlenecks(graph, 5);
      // Only WU-002 should be in results (WU-001 is done)
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('WU-002');
    });
  });
});

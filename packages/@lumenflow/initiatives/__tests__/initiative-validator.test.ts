/**
 * Initiative Validator Tests (WU-1246)
 *
 * TDD: Tests written first, implementation follows.
 * Tests DFS cycle detection, orphan reference detection, and initiative validation.
 *
 * @see {@link tools/lib/initiative-validator.mjs} - Implementation
 */

import { describe, it, expect } from 'vitest';
import {
  detectCycles,
  detectOrphanRefs,
  validateInitiativeRefs,
  validateDependencyGraph,
} from '../src/initiative-validator.js';

describe('initiative-validator', () => {
  describe('detectCycles', () => {
    it('should pass with no dependencies', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001' }],
        ['WU-002', { id: 'WU-002' }],
      ]);
      const result = detectCycles(wuMap);
      expect(result.hasCycle).toBe(false);
      expect(result.cycles).toEqual([]);
    });

    it('should pass with linear chain (A→B→C)', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001', blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', blocks: ['WU-003'] }],
        ['WU-003', { id: 'WU-003' }],
      ]);
      const result = detectCycles(wuMap);
      expect(result.hasCycle).toBe(false);
    });

    it('should detect self-reference (A→A)', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', blocks: ['WU-001'] }]]);
      const result = detectCycles(wuMap);
      expect(result.hasCycle).toBe(true);
      expect(result.cycles.length > 0).toBe(true);
    });

    it('should detect direct cycle (A→B→A)', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001', blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', blocks: ['WU-001'] }],
      ]);
      const result = detectCycles(wuMap);
      expect(result.hasCycle).toBe(true);
      expect(result.cycles.length > 0).toBe(true);
    });

    it('should detect indirect cycle (A→B→C→A)', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001', blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', blocks: ['WU-003'] }],
        ['WU-003', { id: 'WU-003', blocks: ['WU-001'] }],
      ]);
      const result = detectCycles(wuMap);
      expect(result.hasCycle).toBe(true);
      expect(result.cycles.length > 0).toBe(true);
    });

    it('should detect cycle via blocked_by', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001', blocked_by: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', blocked_by: ['WU-001'] }],
      ]);
      const result = detectCycles(wuMap);
      expect(result.hasCycle).toBe(true);
    });

    it('should detect cycle using mixed blocks/blocked_by', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001', blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', blocked_by: ['WU-003'] }],
        ['WU-003', { id: 'WU-003', blocks: ['WU-001'] }],
      ]);
      const result = detectCycles(wuMap);
      expect(result.hasCycle).toBe(true);
    });

    it('should handle empty wuMap', () => {
      const wuMap = new Map();
      const result = detectCycles(wuMap);
      expect(result.hasCycle).toBe(false);
      expect(result.cycles).toEqual([]);
    });

    it('should handle WU with undefined blocks/blocked_by', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001' }],
        ['WU-002', { id: 'WU-002', blocks: undefined }],
        ['WU-003', { id: 'WU-003', blocked_by: null }],
      ]);
      const result = detectCycles(wuMap);
      expect(result.hasCycle).toBe(false);
    });
  });

  describe('detectOrphanRefs', () => {
    it('should pass when all refs exist', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001', blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', blocked_by: ['WU-001'] }],
      ]);
      const allWuIds = new Set(['WU-001', 'WU-002']);
      const result = detectOrphanRefs(wuMap, allWuIds);
      expect(result.orphans).toEqual([]);
    });

    it('should detect orphan in blocks field', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', blocks: ['WU-999'] }]]);
      const allWuIds = new Set(['WU-001']);
      const result = detectOrphanRefs(wuMap, allWuIds);
      expect(result.orphans.length).toBe(1);
      expect(result.orphans[0].wuId).toBe('WU-001');
      expect(result.orphans[0].field).toBe('blocks');
      expect(result.orphans[0].ref).toBe('WU-999');
    });

    it('should detect orphan in blocked_by field', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', blocked_by: ['WU-888'] }]]);
      const allWuIds = new Set(['WU-001']);
      const result = detectOrphanRefs(wuMap, allWuIds);
      expect(result.orphans.length).toBe(1);
      expect(result.orphans[0].wuId).toBe('WU-001');
      expect(result.orphans[0].field).toBe('blocked_by');
      expect(result.orphans[0].ref).toBe('WU-888');
    });

    it('should detect multiple orphans', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001', blocks: ['WU-999'], blocked_by: ['WU-888'] }],
      ]);
      const allWuIds = new Set(['WU-001']);
      const result = detectOrphanRefs(wuMap, allWuIds);
      expect(result.orphans.length).toBe(2);
    });

    it('should handle empty arrays', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', blocks: [], blocked_by: [] }]]);
      const allWuIds = new Set(['WU-001']);
      const result = detectOrphanRefs(wuMap, allWuIds);
      expect(result.orphans).toEqual([]);
    });

    it('should handle undefined/null refs', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001', blocks: undefined }],
        ['WU-002', { id: 'WU-002', blocked_by: null }],
      ]);
      const allWuIds = new Set(['WU-001', 'WU-002']);
      const result = detectOrphanRefs(wuMap, allWuIds);
      expect(result.orphans).toEqual([]);
    });
  });

  describe('validateInitiativeRefs', () => {
    it('should pass when initiative reference exists', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', initiative: 'INIT-001' }]]);
      const initiatives = new Map([['INIT-001', { id: 'INIT-001', slug: 'test' }]]);
      const result = validateInitiativeRefs(wuMap, initiatives);
      expect(result.warnings).toEqual([]);
    });

    it('should warn when initiative reference missing', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', initiative: 'INIT-999' }]]);
      const initiatives = new Map([['INIT-001', { id: 'INIT-001', slug: 'test' }]]);
      const result = validateInitiativeRefs(wuMap, initiatives);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].includes('INIT-999')).toBe(true);
    });

    it('should pass when WU has no initiative field', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001' }]]);
      const initiatives = new Map();
      const result = validateInitiativeRefs(wuMap, initiatives);
      expect(result.warnings).toEqual([]);
    });

    it('should validate phase exists in initiative', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', initiative: 'INIT-001', phase: 2 }]]);
      const initiatives = new Map([
        [
          'INIT-001',
          {
            id: 'INIT-001',
            phases: [
              { id: 1, title: 'Phase 1', status: 'done' },
              { id: 2, title: 'Phase 2', status: 'in_progress' },
            ],
          },
        ],
      ]);
      const result = validateInitiativeRefs(wuMap, initiatives);
      expect(result.warnings).toEqual([]);
    });

    it('should warn when phase not in initiative', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', initiative: 'INIT-001', phase: 5 }]]);
      const initiatives = new Map([
        [
          'INIT-001',
          {
            id: 'INIT-001',
            phases: [{ id: 1, title: 'Phase 1', status: 'done' }],
          },
        ],
      ]);
      const result = validateInitiativeRefs(wuMap, initiatives);
      expect(result.warnings.length > 0).toBe(true);
      expect(result.warnings[0].includes('phase 5')).toBe(true);
    });

    it('should warn when phase specified but initiative has no phases', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', initiative: 'INIT-001', phase: 1 }]]);
      const initiatives = new Map([['INIT-001', { id: 'INIT-001' }]]);
      const result = validateInitiativeRefs(wuMap, initiatives);
      expect(result.warnings.length > 0).toBe(true);
    });

    it('should allow initiative reference by slug', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', initiative: 'shock-protocol' }]]);
      const initiatives = new Map([['INIT-001', { id: 'INIT-001', slug: 'shock-protocol' }]]);
      const result = validateInitiativeRefs(wuMap, initiatives);
      expect(result.warnings).toEqual([]);
    });
  });

  describe('validateDependencyGraph', () => {
    it('should return no errors for valid graph', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001', blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002' }],
      ]);
      const allWuIds = new Set(['WU-001', 'WU-002']);
      const initiatives = new Map();
      const result = validateDependencyGraph(wuMap, allWuIds, initiatives);
      expect(result.errors).toEqual([]);
    });

    it('should return error for cycle', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001', blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', blocks: ['WU-001'] }],
      ]);
      const allWuIds = new Set(['WU-001', 'WU-002']);
      const initiatives = new Map();
      const result = validateDependencyGraph(wuMap, allWuIds, initiatives);
      expect(result.errors.length > 0).toBe(true);
      expect(result.errors[0].includes('Circular')).toBe(true);
    });

    it('should return error for orphan refs', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', blocks: ['WU-999'] }]]);
      const allWuIds = new Set(['WU-001']);
      const initiatives = new Map();
      const result = validateDependencyGraph(wuMap, allWuIds, initiatives);
      expect(result.errors.length > 0).toBe(true);
      expect(result.errors[0].includes('WU-999')).toBe(true);
    });

    it('should return warnings for missing initiative refs', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', initiative: 'INIT-999' }]]);
      const allWuIds = new Set(['WU-001']);
      const initiatives = new Map();
      const result = validateDependencyGraph(wuMap, allWuIds, initiatives);
      expect(result.warnings.length > 0).toBe(true);
    });

    it('should aggregate multiple errors', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001', blocks: ['WU-001', 'WU-999'] }], // self-cycle + orphan
      ]);
      const allWuIds = new Set(['WU-001']);
      const initiatives = new Map();
      const result = validateDependencyGraph(wuMap, allWuIds, initiatives);
      expect(result.errors.length >= 2).toBe(true);
    });
  });
});

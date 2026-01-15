/**
 * Initiative Validator Tests (WU-1246)
 *
 * TDD: Tests written first, implementation follows.
 * Tests DFS cycle detection, orphan reference detection, and initiative validation.
 *
 * @see {@link tools/lib/initiative-validator.mjs} - Implementation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectCycles,
  detectOrphanRefs,
  validateInitiativeRefs,
  validateDependencyGraph,
} from '../initiative-validator.js';

describe('initiative-validator', () => {
  describe('detectCycles', () => {
    it('should pass with no dependencies', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001' }],
        ['WU-002', { id: 'WU-002' }],
      ]);
      const result = detectCycles(wuMap);
      assert.equal(result.hasCycle, false);
      assert.deepEqual(result.cycles, []);
    });

    it('should pass with linear chain (A→B→C)', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001', blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', blocks: ['WU-003'] }],
        ['WU-003', { id: 'WU-003' }],
      ]);
      const result = detectCycles(wuMap);
      assert.equal(result.hasCycle, false);
    });

    it('should detect self-reference (A→A)', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', blocks: ['WU-001'] }]]);
      const result = detectCycles(wuMap);
      assert.equal(result.hasCycle, true);
      assert.ok(result.cycles.length > 0, 'Should report cycle');
    });

    it('should detect direct cycle (A→B→A)', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001', blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', blocks: ['WU-001'] }],
      ]);
      const result = detectCycles(wuMap);
      assert.equal(result.hasCycle, true);
      assert.ok(result.cycles.length > 0, 'Should report cycle');
    });

    it('should detect indirect cycle (A→B→C→A)', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001', blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', blocks: ['WU-003'] }],
        ['WU-003', { id: 'WU-003', blocks: ['WU-001'] }],
      ]);
      const result = detectCycles(wuMap);
      assert.equal(result.hasCycle, true);
      assert.ok(result.cycles.length > 0, 'Should report cycle');
    });

    it('should detect cycle via blocked_by', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001', blocked_by: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', blocked_by: ['WU-001'] }],
      ]);
      const result = detectCycles(wuMap);
      assert.equal(result.hasCycle, true);
    });

    it('should detect cycle using mixed blocks/blocked_by', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001', blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', blocked_by: ['WU-003'] }],
        ['WU-003', { id: 'WU-003', blocks: ['WU-001'] }],
      ]);
      const result = detectCycles(wuMap);
      assert.equal(result.hasCycle, true);
    });

    it('should handle empty wuMap', () => {
      const wuMap = new Map();
      const result = detectCycles(wuMap);
      assert.equal(result.hasCycle, false);
      assert.deepEqual(result.cycles, []);
    });

    it('should handle WU with undefined blocks/blocked_by', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001' }],
        ['WU-002', { id: 'WU-002', blocks: undefined }],
        ['WU-003', { id: 'WU-003', blocked_by: null }],
      ]);
      const result = detectCycles(wuMap);
      assert.equal(result.hasCycle, false);
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
      assert.deepEqual(result.orphans, []);
    });

    it('should detect orphan in blocks field', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', blocks: ['WU-999'] }]]);
      const allWuIds = new Set(['WU-001']);
      const result = detectOrphanRefs(wuMap, allWuIds);
      assert.equal(result.orphans.length, 1);
      assert.equal(result.orphans[0].wuId, 'WU-001');
      assert.equal(result.orphans[0].field, 'blocks');
      assert.equal(result.orphans[0].ref, 'WU-999');
    });

    it('should detect orphan in blocked_by field', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', blocked_by: ['WU-888'] }]]);
      const allWuIds = new Set(['WU-001']);
      const result = detectOrphanRefs(wuMap, allWuIds);
      assert.equal(result.orphans.length, 1);
      assert.equal(result.orphans[0].wuId, 'WU-001');
      assert.equal(result.orphans[0].field, 'blocked_by');
      assert.equal(result.orphans[0].ref, 'WU-888');
    });

    it('should detect multiple orphans', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001', blocks: ['WU-999'], blocked_by: ['WU-888'] }],
      ]);
      const allWuIds = new Set(['WU-001']);
      const result = detectOrphanRefs(wuMap, allWuIds);
      assert.equal(result.orphans.length, 2);
    });

    it('should handle empty arrays', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', blocks: [], blocked_by: [] }]]);
      const allWuIds = new Set(['WU-001']);
      const result = detectOrphanRefs(wuMap, allWuIds);
      assert.deepEqual(result.orphans, []);
    });

    it('should handle undefined/null refs', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001', blocks: undefined }],
        ['WU-002', { id: 'WU-002', blocked_by: null }],
      ]);
      const allWuIds = new Set(['WU-001', 'WU-002']);
      const result = detectOrphanRefs(wuMap, allWuIds);
      assert.deepEqual(result.orphans, []);
    });
  });

  describe('validateInitiativeRefs', () => {
    it('should pass when initiative reference exists', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', initiative: 'INIT-001' }]]);
      const initiatives = new Map([['INIT-001', { id: 'INIT-001', slug: 'test' }]]);
      const result = validateInitiativeRefs(wuMap, initiatives);
      assert.deepEqual(result.warnings, []);
    });

    it('should warn when initiative reference missing', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', initiative: 'INIT-999' }]]);
      const initiatives = new Map([['INIT-001', { id: 'INIT-001', slug: 'test' }]]);
      const result = validateInitiativeRefs(wuMap, initiatives);
      assert.ok(result.warnings.length > 0, 'Should warn about missing initiative');
      assert.ok(
        result.warnings[0].includes('INIT-999'),
        'Warning should mention missing initiative'
      );
    });

    it('should pass when WU has no initiative field', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001' }]]);
      const initiatives = new Map();
      const result = validateInitiativeRefs(wuMap, initiatives);
      assert.deepEqual(result.warnings, []);
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
      assert.deepEqual(result.warnings, []);
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
      assert.ok(result.warnings.length > 0, 'Should warn about missing phase');
      assert.ok(result.warnings[0].includes('phase 5'), 'Warning should mention missing phase');
    });

    it('should warn when phase specified but initiative has no phases', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', initiative: 'INIT-001', phase: 1 }]]);
      const initiatives = new Map([['INIT-001', { id: 'INIT-001' }]]);
      const result = validateInitiativeRefs(wuMap, initiatives);
      assert.ok(result.warnings.length > 0, 'Should warn about phase with no phases defined');
    });

    it('should allow initiative reference by slug', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', initiative: 'shock-protocol' }]]);
      const initiatives = new Map([['INIT-001', { id: 'INIT-001', slug: 'shock-protocol' }]]);
      const result = validateInitiativeRefs(wuMap, initiatives);
      assert.deepEqual(result.warnings, []);
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
      assert.deepEqual(result.errors, []);
    });

    it('should return error for cycle', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001', blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', blocks: ['WU-001'] }],
      ]);
      const allWuIds = new Set(['WU-001', 'WU-002']);
      const initiatives = new Map();
      const result = validateDependencyGraph(wuMap, allWuIds, initiatives);
      assert.ok(result.errors.length > 0, 'Should report cycle as error');
      assert.ok(result.errors[0].includes('Circular'), 'Error should mention circular dependency');
    });

    it('should return error for orphan refs', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', blocks: ['WU-999'] }]]);
      const allWuIds = new Set(['WU-001']);
      const initiatives = new Map();
      const result = validateDependencyGraph(wuMap, allWuIds, initiatives);
      assert.ok(result.errors.length > 0, 'Should report orphan as error');
      assert.ok(result.errors[0].includes('WU-999'), 'Error should mention orphan ref');
    });

    it('should return warnings for missing initiative refs', () => {
      const wuMap = new Map([['WU-001', { id: 'WU-001', initiative: 'INIT-999' }]]);
      const allWuIds = new Set(['WU-001']);
      const initiatives = new Map();
      const result = validateDependencyGraph(wuMap, allWuIds, initiatives);
      assert.ok(result.warnings.length > 0, 'Should warn about missing initiative');
    });

    it('should aggregate multiple errors', () => {
      const wuMap = new Map([
        ['WU-001', { id: 'WU-001', blocks: ['WU-001', 'WU-999'] }], // self-cycle + orphan
      ]);
      const allWuIds = new Set(['WU-001']);
      const initiatives = new Map();
      const result = validateDependencyGraph(wuMap, allWuIds, initiatives);
      assert.ok(result.errors.length >= 2, 'Should report multiple errors');
    });
  });
});

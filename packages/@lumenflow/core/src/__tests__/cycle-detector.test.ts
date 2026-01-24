/**
 * @file cycle-detector.test.ts
 * @description Tests for cycle detection module (WU-1088)
 *
 * Extracted from @lumenflow/initiatives to break circular dependency.
 */
import { describe, it, expect } from 'vitest';
import { detectCycles, type WUObject, type CycleResult } from '../cycle-detector.js';

describe('cycle-detector', () => {
  describe('detectCycles', () => {
    it('should return no cycles for empty map', () => {
      const wuMap = new Map<string, WUObject>();
      const result = detectCycles(wuMap);

      expect(result.hasCycle).toBe(false);
      expect(result.cycles).toEqual([]);
    });

    it('should return no cycles for WUs without dependencies', () => {
      const wuMap = new Map<string, WUObject>([
        ['WU-001', { id: 'WU-001' }],
        ['WU-002', { id: 'WU-002' }],
      ]);
      const result = detectCycles(wuMap);

      expect(result.hasCycle).toBe(false);
      expect(result.cycles).toEqual([]);
    });

    it('should return no cycles for linear chain (A -> B -> C)', () => {
      const wuMap = new Map<string, WUObject>([
        ['WU-001', { id: 'WU-001', blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', blocks: ['WU-003'] }],
        ['WU-003', { id: 'WU-003' }],
      ]);
      const result = detectCycles(wuMap);

      expect(result.hasCycle).toBe(false);
    });

    it('should detect self-reference (A -> A)', () => {
      const wuMap = new Map<string, WUObject>([['WU-001', { id: 'WU-001', blocks: ['WU-001'] }]]);
      const result = detectCycles(wuMap);

      expect(result.hasCycle).toBe(true);
      expect(result.cycles.length).toBeGreaterThan(0);
    });

    it('should detect direct cycle (A -> B -> A)', () => {
      const wuMap = new Map<string, WUObject>([
        ['WU-001', { id: 'WU-001', blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', blocks: ['WU-001'] }],
      ]);
      const result = detectCycles(wuMap);

      expect(result.hasCycle).toBe(true);
      expect(result.cycles.length).toBeGreaterThan(0);
    });

    it('should detect indirect cycle (A -> B -> C -> A)', () => {
      const wuMap = new Map<string, WUObject>([
        ['WU-001', { id: 'WU-001', blocks: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', blocks: ['WU-003'] }],
        ['WU-003', { id: 'WU-003', blocks: ['WU-001'] }],
      ]);
      const result = detectCycles(wuMap);

      expect(result.hasCycle).toBe(true);
      expect(result.cycles.length).toBeGreaterThan(0);
    });

    it('should detect cycle via blocked_by', () => {
      const wuMap = new Map<string, WUObject>([
        ['WU-001', { id: 'WU-001', blocked_by: ['WU-002'] }],
        ['WU-002', { id: 'WU-002', blocked_by: ['WU-001'] }],
      ]);
      const result = detectCycles(wuMap);

      expect(result.hasCycle).toBe(true);
    });

    it('should handle undefined blocks/blocked_by', () => {
      const wuMap = new Map<string, WUObject>([
        ['WU-001', { id: 'WU-001' }],
        ['WU-002', { id: 'WU-002', blocks: undefined }],
        ['WU-003', { id: 'WU-003', blocked_by: undefined }],
      ]);
      const result = detectCycles(wuMap);

      expect(result.hasCycle).toBe(false);
    });

    it('should handle references to non-existent WUs', () => {
      const wuMap = new Map<string, WUObject>([['WU-001', { id: 'WU-001', blocks: ['WU-999'] }]]);
      // Should not throw, should not detect cycle
      const result = detectCycles(wuMap);

      expect(result.hasCycle).toBe(false);
    });

    it('should preserve additional WUObject properties', () => {
      const wuMap = new Map<string, WUObject>([
        ['WU-001', { id: 'WU-001', initiative: 'INIT-001', phase: 1 }],
      ]);
      const result = detectCycles(wuMap);

      expect(result.hasCycle).toBe(false);
      // WUObject interface should allow initiative and phase properties
      const wu = wuMap.get('WU-001');
      expect(wu?.initiative).toBe('INIT-001');
      expect(wu?.phase).toBe(1);
    });
  });

  describe('CycleResult type', () => {
    it('should have correct shape', () => {
      const result: CycleResult = {
        hasCycle: false,
        cycles: [],
      };

      expect(result).toHaveProperty('hasCycle');
      expect(result).toHaveProperty('cycles');
      expect(Array.isArray(result.cycles)).toBe(true);
    });
  });
});

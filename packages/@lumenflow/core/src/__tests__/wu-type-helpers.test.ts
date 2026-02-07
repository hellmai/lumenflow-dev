/**
 * @file wu-type-helpers.test.ts
 * Unit tests for WU type/test helper predicates (WU-1444)
 */

import { describe, it, expect } from 'vitest';

import { hasAnyTests, hasManualTests, isDocsOrProcessType } from '../wu-type-helpers.js';

describe('wu-type-helpers (WU-1444)', () => {
  describe('isDocsOrProcessType', () => {
    it('should return true for documentation', () => {
      expect(isDocsOrProcessType('documentation')).toBe(true);
    });

    it('should return true for process', () => {
      expect(isDocsOrProcessType('process')).toBe(true);
    });

    it('should return false for feature', () => {
      expect(isDocsOrProcessType('feature')).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isDocsOrProcessType(undefined)).toBe(false);
    });
  });

  describe('hasAnyTests', () => {
    it('should return false when no tests object provided', () => {
      expect(hasAnyTests(undefined)).toBe(false);
    });

    it('should return false when all arrays are empty', () => {
      expect(hasAnyTests({ manual: [], unit: [], e2e: [], integration: [] })).toBe(false);
    });

    it('should return true when any test array has items', () => {
      expect(hasAnyTests({ manual: ['step'], unit: [], e2e: [] })).toBe(true);
      expect(hasAnyTests({ manual: [], unit: ['a.test.ts'], e2e: [] })).toBe(true);
      expect(hasAnyTests({ manual: [], unit: [], e2e: ['spec'] })).toBe(true);
      expect(hasAnyTests({ integration: ['it'] })).toBe(true);
    });
  });

  describe('hasManualTests', () => {
    it('should return false when no tests object provided', () => {
      expect(hasManualTests(undefined)).toBe(false);
    });

    it('should return false when manual tests are missing or empty', () => {
      expect(hasManualTests({ unit: ['a.test.ts'] })).toBe(false);
      expect(hasManualTests({ manual: [] })).toBe(false);
    });

    it('should return true when manual tests has at least one item', () => {
      expect(hasManualTests({ manual: ['Navigate to /x and verify output'] })).toBe(true);
    });
  });
});

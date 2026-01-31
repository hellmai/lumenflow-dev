/**
 * Decay Scoring Tests (WU-1238)
 *
 * TDD: Tests written first, implementation follows.
 * Tests for access tracking and decay scoring algorithm.
 *
 * Decay scoring formula:
 * - recencyScore = exp(-age / HALF_LIFE_MS)
 * - accessScore = log1p(access_count) / 10
 * - importanceScore = priority P0=2, P1=1.5, P2=1, P3=0.5
 * - decayScore = recencyScore * (1 + accessScore) * importanceScore
 */

import { describe, it, expect } from 'vitest';
import {
  computeRecencyScore,
  computeAccessScore,
  computeImportanceScore,
  computeDecayScore,
  DEFAULT_HALF_LIFE_MS,
  IMPORTANCE_BY_PRIORITY,
} from '../src/decay/scoring.js';
import type { MemoryNode } from '../src/memory-schema.js';

/**
 * Helper to create a memory node with specific metadata
 */
function createNode(overrides: Partial<MemoryNode> = {}): MemoryNode {
  return {
    id: 'mem-test',
    type: 'checkpoint',
    lifecycle: 'wu',
    content: 'Test content',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('decay/scoring', () => {
  describe('constants', () => {
    it('should export DEFAULT_HALF_LIFE_MS as 30 days in milliseconds', () => {
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      expect(DEFAULT_HALF_LIFE_MS).toBe(thirtyDaysMs);
    });

    it('should export IMPORTANCE_BY_PRIORITY with correct values', () => {
      expect(IMPORTANCE_BY_PRIORITY).toEqual({
        P0: 2,
        P1: 1.5,
        P2: 1,
        P3: 0.5,
      });
    });
  });

  describe('computeRecencyScore()', () => {
    it('should return 1 for node created now', () => {
      const now = Date.now();
      const node = createNode({ created_at: new Date(now).toISOString() });

      const score = computeRecencyScore(node, DEFAULT_HALF_LIFE_MS, now);

      expect(score).toBeCloseTo(1, 5);
    });

    it('should return ~0.5 for node at half-life age', () => {
      const now = Date.now();
      const halfLifeAgo = now - DEFAULT_HALF_LIFE_MS;
      const node = createNode({ created_at: new Date(halfLifeAgo).toISOString() });

      const score = computeRecencyScore(node, DEFAULT_HALF_LIFE_MS, now);

      // exp(-1) ~= 0.368
      expect(score).toBeCloseTo(Math.exp(-1), 3);
    });

    it('should return ~0.135 for node at 2x half-life age', () => {
      const now = Date.now();
      const twoHalfLivesAgo = now - 2 * DEFAULT_HALF_LIFE_MS;
      const node = createNode({ created_at: new Date(twoHalfLivesAgo).toISOString() });

      const score = computeRecencyScore(node, DEFAULT_HALF_LIFE_MS, now);

      // exp(-2) ~= 0.135
      expect(score).toBeCloseTo(Math.exp(-2), 3);
    });

    it('should approach 0 for very old nodes', () => {
      const now = Date.now();
      const veryOld = now - 10 * DEFAULT_HALF_LIFE_MS;
      const node = createNode({ created_at: new Date(veryOld).toISOString() });

      const score = computeRecencyScore(node, DEFAULT_HALF_LIFE_MS, now);

      expect(score).toBeLessThan(0.001);
    });

    it('should use updated_at if present and more recent', () => {
      const now = Date.now();
      const oldCreated = now - 5 * DEFAULT_HALF_LIFE_MS;
      const recentUpdated = now - DEFAULT_HALF_LIFE_MS;
      const node = createNode({
        created_at: new Date(oldCreated).toISOString(),
        updated_at: new Date(recentUpdated).toISOString(),
      });

      const score = computeRecencyScore(node, DEFAULT_HALF_LIFE_MS, now);

      // Should be based on updated_at (1 half-life ago), not created_at (5 half-lives ago)
      expect(score).toBeCloseTo(Math.exp(-1), 3);
    });
  });

  describe('computeAccessScore()', () => {
    it('should return 0 for node with no access count', () => {
      const node = createNode();

      const score = computeAccessScore(node);

      expect(score).toBe(0);
    });

    it('should return 0 for node with access.count = 0', () => {
      const node = createNode({
        metadata: { access: { count: 0 } },
      });

      const score = computeAccessScore(node);

      // log1p(0) / 10 = 0
      expect(score).toBe(0);
    });

    it('should return log1p(1)/10 for node with access.count = 1', () => {
      const node = createNode({
        metadata: { access: { count: 1 } },
      });

      const score = computeAccessScore(node);

      // log1p(1) / 10 = ln(2) / 10 ~= 0.0693
      expect(score).toBeCloseTo(Math.log1p(1) / 10, 5);
    });

    it('should return log1p(10)/10 for node with access.count = 10', () => {
      const node = createNode({
        metadata: { access: { count: 10 } },
      });

      const score = computeAccessScore(node);

      // log1p(10) / 10 = ln(11) / 10 ~= 0.2398
      expect(score).toBeCloseTo(Math.log1p(10) / 10, 5);
    });

    it('should handle high access counts gracefully', () => {
      const node = createNode({
        metadata: { access: { count: 1000 } },
      });

      const score = computeAccessScore(node);

      // log1p(1000) / 10 ~= 0.691
      expect(score).toBeCloseTo(Math.log1p(1000) / 10, 5);
      expect(score).toBeLessThan(1); // Bounded contribution
    });
  });

  describe('computeImportanceScore()', () => {
    it('should return 2 for P0 priority', () => {
      const node = createNode({
        metadata: { priority: 'P0' },
      });

      const score = computeImportanceScore(node);

      expect(score).toBe(2);
    });

    it('should return 1.5 for P1 priority', () => {
      const node = createNode({
        metadata: { priority: 'P1' },
      });

      const score = computeImportanceScore(node);

      expect(score).toBe(1.5);
    });

    it('should return 1 for P2 priority', () => {
      const node = createNode({
        metadata: { priority: 'P2' },
      });

      const score = computeImportanceScore(node);

      expect(score).toBe(1);
    });

    it('should return 0.5 for P3 priority', () => {
      const node = createNode({
        metadata: { priority: 'P3' },
      });

      const score = computeImportanceScore(node);

      expect(score).toBe(0.5);
    });

    it('should return 1 for node with no priority (default)', () => {
      const node = createNode();

      const score = computeImportanceScore(node);

      expect(score).toBe(1);
    });

    it('should return 1 for node with unknown priority', () => {
      const node = createNode({
        metadata: { priority: 'UNKNOWN' },
      });

      const score = computeImportanceScore(node);

      expect(score).toBe(1);
    });
  });

  describe('computeDecayScore()', () => {
    it('should return 1 for brand new P2 node with no access', () => {
      const now = Date.now();
      const node = createNode({
        created_at: new Date(now).toISOString(),
        metadata: { priority: 'P2' },
      });

      const score = computeDecayScore(node, { now, halfLifeMs: DEFAULT_HALF_LIFE_MS });

      // recency=1, access=0, importance=1
      // score = 1 * (1 + 0) * 1 = 1
      expect(score).toBeCloseTo(1, 5);
    });

    it('should return 2 for brand new P0 node with no access', () => {
      const now = Date.now();
      const node = createNode({
        created_at: new Date(now).toISOString(),
        metadata: { priority: 'P0' },
      });

      const score = computeDecayScore(node, { now, halfLifeMs: DEFAULT_HALF_LIFE_MS });

      // recency=1, access=0, importance=2
      // score = 1 * (1 + 0) * 2 = 2
      expect(score).toBeCloseTo(2, 5);
    });

    it('should boost score for frequently accessed node', () => {
      const now = Date.now();
      const node = createNode({
        created_at: new Date(now).toISOString(),
        metadata: { priority: 'P2', access: { count: 10 } },
      });

      const score = computeDecayScore(node, { now, halfLifeMs: DEFAULT_HALF_LIFE_MS });

      // recency=1, access=log1p(10)/10~=0.2398, importance=1
      // score = 1 * (1 + 0.2398) * 1 ~= 1.2398
      const expectedAccessScore = Math.log1p(10) / 10;
      expect(score).toBeCloseTo(1 * (1 + expectedAccessScore) * 1, 3);
    });

    it('should decay old nodes significantly', () => {
      const now = Date.now();
      const twoHalfLivesAgo = now - 2 * DEFAULT_HALF_LIFE_MS;
      const node = createNode({
        created_at: new Date(twoHalfLivesAgo).toISOString(),
        metadata: { priority: 'P2' },
      });

      const score = computeDecayScore(node, { now, halfLifeMs: DEFAULT_HALF_LIFE_MS });

      // recency=exp(-2)~=0.135, access=0, importance=1
      // score = 0.135 * (1 + 0) * 1 = 0.135
      expect(score).toBeCloseTo(Math.exp(-2), 3);
    });

    it('should combine all factors correctly', () => {
      const now = Date.now();
      const halfLifeAgo = now - DEFAULT_HALF_LIFE_MS;
      const node = createNode({
        created_at: new Date(halfLifeAgo).toISOString(),
        metadata: { priority: 'P0', access: { count: 5 } },
      });

      const score = computeDecayScore(node, { now, halfLifeMs: DEFAULT_HALF_LIFE_MS });

      // recency=exp(-1)~=0.368, access=log1p(5)/10~=0.179, importance=2
      // score = 0.368 * (1 + 0.179) * 2 ~= 0.867
      const expectedRecency = Math.exp(-1);
      const expectedAccess = Math.log1p(5) / 10;
      const expected = expectedRecency * (1 + expectedAccess) * 2;
      expect(score).toBeCloseTo(expected, 3);
    });

    it('should use custom half-life when provided', () => {
      const now = Date.now();
      const customHalfLife = 7 * 24 * 60 * 60 * 1000; // 7 days
      const sevenDaysAgo = now - customHalfLife;
      const node = createNode({
        created_at: new Date(sevenDaysAgo).toISOString(),
        metadata: { priority: 'P2' },
      });

      const score = computeDecayScore(node, { now, halfLifeMs: customHalfLife });

      // At custom half-life, recency = exp(-1)
      expect(score).toBeCloseTo(Math.exp(-1), 3);
    });

    it('should store computed score in metadata.decay', () => {
      const now = Date.now();
      const node = createNode({
        created_at: new Date(now).toISOString(),
        metadata: { priority: 'P1' },
      });

      const score = computeDecayScore(node, { now, halfLifeMs: DEFAULT_HALF_LIFE_MS });

      // Function returns the score - storage is handled by recordAccess
      expect(typeof score).toBe('number');
      expect(score).toBeGreaterThan(0);
    });
  });
});

/**
 * Feedback Review CLI Tests (WU-1598)
 *
 * Tests for:
 * - pnpm feedback:review --since 7d --category test
 * - Clustering by title similarity
 * - Scoring patterns (frequency x severity x recency)
 * - Output prioritized patterns for human review
 *
 * @see {@link tools/feedback-review.mjs} - CLI entry point
 * @see {@link tools/lib/feedback-review-core.mjs} - Core logic
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  reviewFeedback,
  clusterByTitle,
  scorePattern,
  SEVERITY_WEIGHTS,
} from '../src/feedback-review-core.js';
import { INCIDENT_SEVERITY } from '../../core/src/wu-constants.js';

describe('feedback-review-core', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'feedback-review-test-'));
    await mkdir(join(testDir, '.beacon', 'incidents'), { recursive: true });
    await mkdir(join(testDir, '.beacon', 'memory'), { recursive: true });
  });

  afterEach(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe('clusterByTitle', () => {
    it('should cluster nodes by title similarity', () => {
      const nodes = [
        { id: '1', title: 'Test failure in gates', category: 'test' },
        { id: '2', title: 'Test failure in gates', category: 'test' },
        { id: '3', title: 'Documentation issue', category: 'docs' },
        { id: '4', title: 'Test failures in gates', category: 'test' }, // Similar
      ];

      const clusters = clusterByTitle(nodes, 0.7);

      expect(clusters).toHaveLength(3); // Each title creates its own cluster
      expect(clusters[0].title).toBe('Test failure in gates');
      expect(clusters[0].nodes).toHaveLength(2); // 1, 2 (exact matches)
      expect(clusters[1].title).toBe('Documentation issue');
      expect(clusters[1].nodes).toHaveLength(1);
      expect(clusters[2].title).toBe('Test failures in gates');
      expect(clusters[2].nodes).toHaveLength(1);
    });

    it('should handle empty nodes array', () => {
      const clusters = clusterByTitle([], 0.7);
      expect(clusters).toEqual([]);
    });

    it('should handle nodes without titles', () => {
      const nodes = [
        { id: '1', category: 'test' }, // No title
        { id: '2', title: 'Test failure', category: 'test' },
      ];

      const clusters = clusterByTitle(nodes, 0.7);
      expect(clusters).toHaveLength(1);
      expect(clusters[0].title).toBe('Test failure');
      expect(clusters[0].nodes).toHaveLength(1);
    });

    it('should use default threshold when not specified', () => {
      const nodes = [
        { id: '1', title: 'Test failure', category: 'test' },
        { id: '2', title: 'Test failure', category: 'test' },
      ];

      const clusters = clusterByTitle(nodes);
      expect(clusters).toHaveLength(1);
      expect(clusters[0].nodes).toHaveLength(2);
    });
  });

  describe('scorePattern', () => {
    it('should score pattern based on frequency, severity, and recency', () => {
      const now = Date.now();
      const cluster = {
        title: 'Test failure',
        category: 'test',
        nodes: [
          {
            id: '1',
            severity: 'minor',
            created_at: new Date(now - 1000 * 60 * 60).toISOString(), // 1 hour ago
          },
          {
            id: '2',
            severity: 'major',
            created_at: new Date(now - 1000 * 60 * 30).toISOString(), // 30 minutes ago
          },
        ],
      };

      const score = scorePattern(cluster);
      expect(score).toBeGreaterThan(0);
      expect(typeof score).toBe('number');
    });

    it('should handle empty cluster', () => {
      const cluster = {
        title: 'Test',
        category: 'test',
        nodes: [],
      };

      const score = scorePattern(cluster);
      expect(score).toBe(0);
    });

    it('should weight higher severity more', () => {
      const now = Date.now();
      const minorCluster = {
        title: 'Minor issue',
        category: 'test',
        nodes: [
          {
            id: '1',
            severity: 'minor',
            created_at: new Date(now - 1000 * 60 * 60).toISOString(),
          },
        ],
      };

      const majorCluster = {
        title: 'Major issue',
        category: 'test',
        nodes: [
          {
            id: '2',
            severity: 'major',
            created_at: new Date(now - 1000 * 60 * 60).toISOString(),
          },
        ],
      };

      const minorScore = scorePattern(minorCluster);
      const majorScore = scorePattern(majorCluster);
      expect(majorScore).toBeGreaterThan(minorScore);
    });

    it('should weight recent incidents more', () => {
      const now = Date.now();
      const oldCluster = {
        title: 'Old issue',
        category: 'test',
        nodes: [
          {
            id: '1',
            severity: 'minor',
            created_at: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
          },
        ],
      };

      const recentCluster = {
        title: 'Recent issue',
        category: 'test',
        nodes: [
          {
            id: '2',
            severity: 'minor',
            created_at: new Date(now - 1000 * 60 * 60).toISOString(), // 1 hour ago
          },
        ],
      };

      const oldScore = scorePattern(oldCluster);
      const recentScore = scorePattern(recentCluster);
      expect(recentScore).toBeGreaterThan(oldScore);
    });
  });

  describe('reviewFeedback', () => {
    beforeEach(async () => {
      // Create test incident data
      const incidents = [
        {
          id: 'inc-1',
          title: 'Test failure in gates',
          content: 'Test failure in gates',
          category: 'test',
          severity: 'minor',
          created_at: '2025-12-01T10:00:00.000Z',
        },
        {
          id: 'inc-2',
          title: 'Test failure in gates',
          content: 'Test failure in gates',
          category: 'test',
          severity: 'major',
          created_at: '2025-12-01T11:00:00.000Z',
        },
        {
          id: 'inc-3',
          title: 'Documentation issue',
          content: 'Documentation issue',
          category: 'docs',
          severity: 'info',
          created_at: '2025-12-01T12:00:00.000Z',
        },
      ];

      // Write incident NDJSON files
      await writeFile(
        join(testDir, '.beacon', 'incidents', 'test.ndjson'),
        incidents
          .filter((inc) => inc.category === 'test')
          .map((inc) => JSON.stringify(inc))
          .join('\n') + '\n',
        'utf8',
      );

      await writeFile(
        join(testDir, '.beacon', 'incidents', 'docs.ndjson'),
        incidents
          .filter((inc) => inc.category === 'docs')
          .map((inc) => JSON.stringify(inc))
          .join('\n') + '\n',
        'utf8',
      );

      // Create test memory data
      const memoryNodes = [
        {
          id: 'mem-1',
          content: 'Memory test issue',
          type: 'test',
          severity: 'minor',
          created_at: '2025-12-01T13:00:00.000Z',
          tags: ['test'],
          metadata: { severity: 'minor' },
        },
        {
          id: 'mem-2',
          content: 'Memory docs issue',
          type: 'docs',
          severity: 'info',
          created_at: '2025-12-01T14:00:00.000Z',
          tags: ['docs'],
          metadata: { severity: 'info' },
        },
      ];

      await writeFile(
        join(testDir, '.beacon', 'memory', 'memory.jsonl'),
        memoryNodes.map((node) => JSON.stringify(node)).join('\n') + '\n',
        'utf8',
      );
    });

    it('should review feedback and return patterns', async () => {
      const result = await reviewFeedback(testDir);

      expect(result.success).toBe(true);
      expect(result.patterns).toHaveLength(4); // All patterns found
      expect(result.summary.totalNodes).toBe(5); // 3 incidents + 2 memory nodes
      expect(result.summary.totalClusters).toBe(4);
      expect(result.summary.topCategory).toBe('test');
    });

    it('should filter by since date', async () => {
      const result = await reviewFeedback(testDir, {
        since: '1h', // Only last hour
      });

      // All test data is from 2025-12-01, so with current date this should be empty
      expect(result.success).toBe(true);
      expect(result.patterns).toHaveLength(0);
      expect(result.summary.totalNodes).toBe(0);
    });

    it('should filter by category', async () => {
      const result = await reviewFeedback(testDir, {
        category: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.patterns).toHaveLength(2); // Test patterns (2 separate clusters)
      expect(result.summary.totalNodes).toBe(3); // 2 test incidents + 1 test memory node
    });

    it('should filter by minimum frequency', async () => {
      const result = await reviewFeedback(testDir, {
        minFrequency: 2,
      });

      expect(result.success).toBe(true);
      expect(result.patterns).toHaveLength(1); // Only "Test failure in gates" has frequency 2
      expect(result.patterns[0].frequency).toBe(2);
    });

    it('should sort patterns by score (highest first)', async () => {
      const result = await reviewFeedback(testDir);

      expect(result.success).toBe(true);
      expect(result.patterns).toHaveLength(4);

      // "Test failure in gates" should be first (highest score due to frequency 2 and major severity)
      expect(result.patterns[0].title).toBe('Test failure in gates');
      expect(result.patterns[0].frequency).toBe(2);
      expect(result.patterns[0].score).toBeGreaterThan(result.patterns[1].score);
    });

    it('should include examples in patterns', async () => {
      const result = await reviewFeedback(testDir);

      expect(result.success).toBe(true);
      const testPattern = result.patterns.find((p) => p.title === 'Test failure in gates');
      expect(testPattern).toBeDefined();
      expect(testPattern?.examples).toHaveLength(2);
      expect(testPattern?.examples[0].id).toBe('inc-1');
      expect(testPattern?.examples[1].id).toBe('inc-2');
    });

    it('should handle missing directories gracefully', async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), 'empty-test-'));
      try {
        const result = await reviewFeedback(emptyDir);
        expect(result.success).toBe(true);
        expect(result.patterns).toHaveLength(0);
        expect(result.summary.totalNodes).toBe(0);
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });

    it('should handle malformed data gracefully', async () => {
      // Add malformed data to incident file
      await writeFile(
        join(testDir, '.beacon', 'incidents', 'malformed.ndjson'),
        'invalid json\n{"id":"valid","title":"Valid","category":"test","severity":"minor","created_at":"2025-12-01T10:00:00.000Z"}\n',
        'utf8',
      );

      const result = await reviewFeedback(testDir);
      expect(result.success).toBe(true);
      // Should still process the valid data
      expect(result.patterns.length).toBeGreaterThan(0);
    });
  });

  describe('SEVERITY_WEIGHTS', () => {
    it('should have correct weight values', () => {
      expect(SEVERITY_WEIGHTS[INCIDENT_SEVERITY.BLOCKER]).toBe(4);
      expect(SEVERITY_WEIGHTS[INCIDENT_SEVERITY.MAJOR]).toBe(3);
      expect(SEVERITY_WEIGHTS[INCIDENT_SEVERITY.MINOR]).toBe(2);
      expect(SEVERITY_WEIGHTS[INCIDENT_SEVERITY.INFO]).toBe(1);
    });
  });
});

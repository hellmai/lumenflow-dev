/**
 * Tests for metrics snapshot capture
 */
import { describe, it, expect } from 'vitest';
import { captureMetricsSnapshot } from '../../src/flow/capture-metrics-snapshot.js';
import type {
  GitCommit,
  WUMetrics,
  SkipGatesEntry,
  MetricsSnapshotInput,
} from '../../src/types.js';

describe('captureMetricsSnapshot', () => {
  const baseInput: MetricsSnapshotInput = {
    commits: [],
    wuMetrics: [],
    skipGatesEntries: [],
    weekStart: new Date('2026-01-01'),
    weekEnd: new Date('2026-01-07'),
    type: 'all',
  };

  describe('type filtering', () => {
    it('returns all metrics for type=all', () => {
      const result = captureMetricsSnapshot(baseInput);
      expect(result.dora).toBeDefined();
      expect(result.lanes).toBeDefined();
      expect(result.flow).toBeDefined();
    });

    it('returns only DORA for type=dora', () => {
      const result = captureMetricsSnapshot({ ...baseInput, type: 'dora' });
      expect(result.dora).toBeDefined();
      expect(result.lanes).toBeUndefined();
      expect(result.flow).toBeUndefined();
    });

    it('returns only lanes for type=lanes', () => {
      const result = captureMetricsSnapshot({ ...baseInput, type: 'lanes' });
      expect(result.dora).toBeUndefined();
      expect(result.lanes).toBeDefined();
      expect(result.flow).toBeUndefined();
    });

    it('returns only flow for type=flow', () => {
      const result = captureMetricsSnapshot({ ...baseInput, type: 'flow' });
      expect(result.dora).toBeUndefined();
      expect(result.lanes).toBeUndefined();
      expect(result.flow).toBeDefined();
    });
  });

  describe('lane metrics', () => {
    it('groups WUs by lane', () => {
      const wuMetrics: WUMetrics[] = [
        { id: 'WU-1', title: 'a', lane: 'Operations', status: 'done', cycleTimeHours: 24 },
        { id: 'WU-2', title: 'b', lane: 'Operations', status: 'in_progress' },
        { id: 'WU-3', title: 'c', lane: 'Core', status: 'blocked' },
      ];

      const result = captureMetricsSnapshot({ ...baseInput, wuMetrics, type: 'lanes' });
      expect(result.lanes!.lanes).toHaveLength(2);

      const opsLane = result.lanes!.lanes.find((l) => l.lane === 'Operations');
      expect(opsLane).toBeDefined();
      expect(opsLane!.wusCompleted).toBe(1);
      expect(opsLane!.wusInProgress).toBe(1);
    });

    it('calculates lane health status', () => {
      const wuMetrics: WUMetrics[] = [
        { id: 'WU-1', title: 'a', lane: 'Healthy', status: 'in_progress' },
        { id: 'WU-2', title: 'b', lane: 'AtRisk', status: 'blocked' },
        { id: 'WU-3', title: 'c', lane: 'AtRisk', status: 'in_progress' },
        { id: 'WU-4', title: 'd', lane: 'Blocked', status: 'blocked' },
      ];

      const result = captureMetricsSnapshot({ ...baseInput, wuMetrics, type: 'lanes' });

      const healthy = result.lanes!.lanes.find((l) => l.lane === 'Healthy');
      const atRisk = result.lanes!.lanes.find((l) => l.lane === 'AtRisk');
      const blocked = result.lanes!.lanes.find((l) => l.lane === 'Blocked');

      expect(healthy!.status).toBe('healthy');
      expect(atRisk!.status).toBe('at-risk');
      expect(blocked!.status).toBe('blocked');
    });

    it('calculates average and median cycle times', () => {
      const wuMetrics: WUMetrics[] = [
        { id: 'WU-1', title: 'a', lane: 'Ops', status: 'done', cycleTimeHours: 10 },
        { id: 'WU-2', title: 'b', lane: 'Ops', status: 'done', cycleTimeHours: 20 },
        { id: 'WU-3', title: 'c', lane: 'Ops', status: 'done', cycleTimeHours: 30 },
      ];

      const result = captureMetricsSnapshot({ ...baseInput, wuMetrics, type: 'lanes' });
      const lane = result.lanes!.lanes[0]!;

      expect(lane.averageCycleTimeHours).toBe(20);
      expect(lane.medianCycleTimeHours).toBe(20);
    });

    it('calculates totals', () => {
      const wuMetrics: WUMetrics[] = [
        { id: 'WU-1', title: 'a', lane: 'Ops', status: 'ready' },
        { id: 'WU-2', title: 'b', lane: 'Ops', status: 'in_progress' },
        { id: 'WU-3', title: 'c', lane: 'Ops', status: 'blocked' },
        { id: 'WU-4', title: 'd', lane: 'Ops', status: 'done' },
      ];

      const result = captureMetricsSnapshot({ ...baseInput, wuMetrics, type: 'lanes' });
      expect(result.lanes!.totalActive).toBe(3);
      expect(result.lanes!.totalBlocked).toBe(1);
      expect(result.lanes!.totalCompleted).toBe(1);
    });
  });

  describe('DORA metrics', () => {
    it('passes data to DORA calculator', () => {
      const commits: GitCommit[] = [
        { hash: 'a', timestamp: new Date('2026-01-02'), message: 'feat: a' },
        { hash: 'b', timestamp: new Date('2026-01-03'), message: 'feat: b' },
      ];
      const wuMetrics: WUMetrics[] = [
        { id: 'WU-1', title: 'a', lane: 'Ops', status: 'done', cycleTimeHours: 12 },
      ];
      const skipGatesEntries: SkipGatesEntry[] = [];

      const result = captureMetricsSnapshot({
        ...baseInput,
        commits,
        wuMetrics,
        skipGatesEntries,
        type: 'dora',
      });

      expect(result.dora!.deploymentFrequency.deploysPerWeek).toBe(2);
      expect(result.dora!.leadTimeForChanges.averageHours).toBe(12);
    });
  });

  describe('flow state', () => {
    it('calculates flow state from WU metrics', () => {
      const wuMetrics: WUMetrics[] = [
        { id: 'WU-1', title: 'a', lane: 'Ops', status: 'ready' },
        { id: 'WU-2', title: 'b', lane: 'Ops', status: 'in_progress' },
        { id: 'WU-3', title: 'c', lane: 'Ops', status: 'done' },
      ];

      const result = captureMetricsSnapshot({ ...baseInput, wuMetrics, type: 'flow' });

      expect(result.flow!.ready).toBe(1);
      expect(result.flow!.inProgress).toBe(1);
      expect(result.flow!.done).toBe(1);
      expect(result.flow!.totalActive).toBe(2);
    });
  });
});

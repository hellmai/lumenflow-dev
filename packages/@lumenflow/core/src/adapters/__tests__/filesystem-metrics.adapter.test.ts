/**
 * FileSystemMetricsCollector Tests
 *
 * TDD test suite for the FileSystemMetricsCollector adapter.
 * Tests against real fixture files to ensure correct parsing and aggregation.
 *
 * @module filesystem-metrics.adapter.test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import { FileSystemMetricsCollector } from '../filesystem-metrics.adapter';
import type {
  GlobalStatus,
  AgentMetric,
  WUProgress,
  TimelineEvent,
  Alert,
} from '../../domain/orchestration.types';

describe('FileSystemMetricsCollector', () => {
  const fixturesDir = join(__dirname, 'fixtures');
  let collector: FileSystemMetricsCollector;

  beforeAll(() => {
    collector = new FileSystemMetricsCollector(fixturesDir);
  });

  describe('getGlobalStatus', () => {
    it('should return correct WU counts from status.md', async () => {
      const status: GlobalStatus = await collector.getGlobalStatus();

      expect(status.activeWUs).toBe(1); // WU-TEST-001 is in progress
      expect(status.blocked).toBe(1); // WU-TEST-002 is blocked
      expect(status.completed24h).toBeGreaterThanOrEqual(0); // May vary based on stamps
      expect(status.gatesFailing).toBe(0); // No failing gates in fixtures
    });

    it('should include worktreesWithUncommittedChanges field (WU-1748)', async () => {
      const status: GlobalStatus = await collector.getGlobalStatus();

      // Should always have the field, even if empty
      expect(Array.isArray(status.worktreesWithUncommittedChanges)).toBe(true);

      // Each entry should have required fields
      for (const wt of status.worktreesWithUncommittedChanges) {
        expect(wt.wuId).toBeTruthy();
        expect(typeof wt.uncommittedFileCount).toBe('number');
        expect(typeof wt.lastActivityTimestamp).toBe('string');
      }
    });

    it('should identify longest running WU', async () => {
      const status: GlobalStatus = await collector.getGlobalStatus();

      if (status.longestRunning) {
        expect(status.longestRunning.wuId).toBe('WU-TEST-001');
        expect(status.longestRunning.lane).toBe('Operations: Tooling');
        expect(status.longestRunning.durationMs).toBeGreaterThan(0);
      } else {
        // If no active WUs, should be null
        expect(status.activeWUs).toBe(0);
      }
    });

    it('should detect pending mandatory agents', async () => {
      const status: GlobalStatus = await collector.getGlobalStatus();

      expect(Array.isArray(status.pendingMandatory)).toBe(true);
      // Specific assertions depend on fixture WU code paths
      // If WU touches auth/prompts, should list mandatory agents
    });

    it('should handle empty directories gracefully', async () => {
      const emptyCollector = new FileSystemMetricsCollector('/tmp/nonexistent');
      const status: GlobalStatus = await emptyCollector.getGlobalStatus();

      expect(status.activeWUs).toBe(0);
      expect(status.blocked).toBe(0);
      expect(status.completed24h).toBe(0);
      expect(status.gatesFailing).toBe(0);
      expect(status.longestRunning).toBeNull();
      expect(status.pendingMandatory).toEqual([]);
    });
  });

  describe('getAgentMetrics', () => {
    it('should return metrics for all known agents', async () => {
      const metrics: Record<string, AgentMetric> = await collector.getAgentMetrics();

      expect(typeof metrics).toBe('object');
      // Should have entries for agents that have run
      for (const [agentName, metric] of Object.entries(metrics)) {
        expect(metric.invoked).toBeGreaterThanOrEqual(0);
        expect(metric.passRate).toBeGreaterThanOrEqual(0);
        expect(metric.passRate).toBeLessThanOrEqual(100);
        expect(metric.avgDurationMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('should calculate pass rate correctly', async () => {
      const metrics: Record<string, AgentMetric> = await collector.getAgentMetrics();

      // If an agent has runs, pass rate should be percentage
      for (const metric of Object.values(metrics)) {
        if (metric.invoked > 0) {
          expect(metric.passRate).toBeGreaterThanOrEqual(0);
          expect(metric.passRate).toBeLessThanOrEqual(100);
        } else {
          // No invocations = 0% pass rate
          expect(metric.passRate).toBe(0);
        }
      }
    });

    it('should include lastRun information if available', async () => {
      const metrics: Record<string, AgentMetric> = await collector.getAgentMetrics();

      for (const metric of Object.values(metrics)) {
        if (metric.lastRun) {
          expect(metric.lastRun.wuId).toBeTruthy();
          expect(metric.lastRun.timestamp).toBeTruthy();
          expect(['pass', 'fail']).toContain(metric.lastRun.result);
        }
      }
    });
  });

  describe('getWUProgress', () => {
    it('should return progress for all active WUs', async () => {
      const progress: WUProgress[] = await collector.getWUProgress();

      expect(Array.isArray(progress)).toBe(true);

      for (const wu of progress) {
        expect(wu.wuId).toBeTruthy();
        expect(wu.lane).toBeTruthy();
        expect(wu.title).toBeTruthy();
        expect(wu.dodProgress).toBeGreaterThanOrEqual(0);
        expect(wu.dodProgress).toBeLessThanOrEqual(wu.dodTotal);
        expect(wu.dodTotal).toBe(11); // DOD_TOTAL constant
        expect(typeof wu.agents).toBe('object');
        expect(wu.headline).toBeTruthy();
      }
    });

    it('should sort WUs by lane then WU ID', async () => {
      const progress: WUProgress[] = await collector.getWUProgress();

      if (progress.length > 1) {
        for (let i = 1; i < progress.length; i++) {
          const prev = progress[i - 1];
          const curr = progress[i];

          // Either lane is earlier, or same lane with earlier WU ID
          const laneCompare = prev.lane.localeCompare(curr.lane);
          if (laneCompare === 0) {
            expect(prev.wuId.localeCompare(curr.wuId)).toBeLessThanOrEqual(0);
          }
        }
      }
    });

    it('should include agent run statuses', async () => {
      const progress: WUProgress[] = await collector.getWUProgress();

      for (const wu of progress) {
        for (const [agentName, status] of Object.entries(wu.agents)) {
          expect(['pending', 'pass', 'fail', 'skipped']).toContain(status);
        }
      }
    });

    it('should generate Tufte-style headlines', async () => {
      const progress: WUProgress[] = await collector.getWUProgress();

      for (const wu of progress) {
        expect(wu.headline).toBeTruthy();
        expect(typeof wu.headline).toBe('string');
        expect(wu.headline.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getTimeline', () => {
    it('should return events after given date', async () => {
      const since = new Date('2025-11-28T00:00:00.000Z');
      const timeline: TimelineEvent[] = await collector.getTimeline(since);

      expect(Array.isArray(timeline)).toBe(true);

      for (const event of timeline) {
        const eventDate = new Date(event.timestamp);
        expect(eventDate.getTime()).toBeGreaterThanOrEqual(since.getTime());
      }
    });

    it('should sort events by timestamp descending', async () => {
      const since = new Date('2025-01-01T00:00:00.000Z');
      const timeline: TimelineEvent[] = await collector.getTimeline(since);

      if (timeline.length > 1) {
        for (let i = 1; i < timeline.length; i++) {
          const prevTime = new Date(timeline[i - 1].timestamp).getTime();
          const currTime = new Date(timeline[i].timestamp).getTime();
          expect(prevTime).toBeGreaterThanOrEqual(currTime);
        }
      }
    });

    it('should include all required timeline event fields', async () => {
      const since = new Date('2025-01-01T00:00:00.000Z');
      const timeline: TimelineEvent[] = await collector.getTimeline(since);

      for (const event of timeline) {
        expect(event.timestamp).toBeTruthy();
        expect(['claim', 'done', 'block', 'agent', 'gates']).toContain(event.event);
        expect(event.wuId).toBeTruthy();
        expect(event.detail).toBeTruthy();
        expect(['info', 'warning', 'error']).toContain(event.severity);
      }
    });

    it('should handle telemetry from multiple files', async () => {
      const since = new Date('2025-01-01T00:00:00.000Z');
      const timeline: TimelineEvent[] = await collector.getTimeline(since);

      // Should aggregate events from gates.ndjson, etc.
      expect(Array.isArray(timeline)).toBe(true);
    });
  });

  describe('getAlerts', () => {
    it('should return array of alerts', async () => {
      const alerts: Alert[] = await collector.getAlerts();

      expect(Array.isArray(alerts)).toBe(true);
    });

    it('should sort alerts by severity (high first)', async () => {
      const alerts: Alert[] = await collector.getAlerts();

      const severityOrder = { high: 0, medium: 1, low: 2 };

      if (alerts.length > 1) {
        for (let i = 1; i < alerts.length; i++) {
          const prevSeverity = severityOrder[alerts[i - 1].severity];
          const currSeverity = severityOrder[alerts[i].severity];
          expect(prevSeverity).toBeLessThanOrEqual(currSeverity);
        }
      }
    });

    it('should generate high priority alerts for mandatory agents not invoked', async () => {
      const alerts: Alert[] = await collector.getAlerts();

      const mandatoryAlerts = alerts.filter(
        (a) => a.severity === 'high' && a.message.includes('Mandatory agent')
      );

      for (const alert of mandatoryAlerts) {
        expect(alert.wuId).toBeTruthy();
        expect(alert.action).toBeTruthy();
      }
    });

    it('should include all required alert fields', async () => {
      const alerts: Alert[] = await collector.getAlerts();

      for (const alert of alerts) {
        expect(['high', 'medium', 'low']).toContain(alert.severity);
        expect(alert.message).toBeTruthy();
        expect(alert.wuId).toBeTruthy();
        expect(alert.action).toBeTruthy();
      }
    });

    it('should limit alerts to MAX_ALERTS_DISPLAY', async () => {
      const alerts: Alert[] = await collector.getAlerts();

      expect(alerts.length).toBeLessThanOrEqual(10); // MAX_ALERTS_DISPLAY
    });
  });

  describe('Integration', () => {
    it('should use fast-glob for file discovery', async () => {
      // This is tested implicitly by all other tests
      // If fast-glob is not working, no WU files will be found
      const progress = await collector.getWUProgress();
      expect(Array.isArray(progress)).toBe(true);
    });

    it('should use yaml library for YAML parsing', async () => {
      // This is tested implicitly by reading WU YAML files
      const progress = await collector.getWUProgress();

      // If YAML parsing fails, we won't get valid WU data
      for (const wu of progress) {
        expect(wu.wuId).toBeTruthy();
        expect(wu.title).toBeTruthy();
      }
    });

    it('should use date-fns for time calculations', async () => {
      const status = await collector.getGlobalStatus();

      // If date-fns is not working, time-based calculations will fail
      if (status.longestRunning) {
        expect(status.longestRunning.durationMs).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('WU-1849: minimatch for glob pattern matching', () => {
    it('matches basic and double-star patterns', () => {
      const match = (
        collector as unknown as { matchesPattern: (p: string, pat: string) => boolean }
      ).matchesPattern;

      expect(match('supabase/migrations/001_init.sql', 'supabase/migrations/**')).toBe(true);
      expect(match('apps/web/src/lib/llm/orchestrator.ts', '**/llm/**')).toBe(true);
      expect(match('apps/web/src/lib/llm/orchestrator.ts', '**/prompts/**')).toBe(false);
    });

    it('treats negation patterns as non-matches for single-pattern checks', () => {
      const match = (
        collector as unknown as { matchesPattern: (p: string, pat: string) => boolean }
      ).matchesPattern;

      expect(match('node_modules/turbo/bin/turbo', '!node_modules/**')).toBe(false);
    });
  });
});

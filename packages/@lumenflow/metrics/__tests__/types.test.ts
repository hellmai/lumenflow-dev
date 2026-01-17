/**
 * Tests for @lumenflow/metrics types
 * Validates type exports and structure
 */
import { describe, it, expect } from 'vitest';
import type {
  DORAStatusTier,
  WUMetrics,
  GitCommit,
  DORAMetrics,
  FlowState,
  GateTelemetryEvent,
  LLMTelemetryEvent,
  BottleneckAnalysis,
  MetricsSnapshot,
  GateEventInput,
  LLMClassificationCompleteInput,
  FlowReportInput,
} from '../src/types.js';

describe('types', () => {
  describe('DORAStatusTier', () => {
    it('should accept valid status tiers', () => {
      const elite: DORAStatusTier = 'elite';
      const high: DORAStatusTier = 'high';
      const medium: DORAStatusTier = 'medium';
      const low: DORAStatusTier = 'low';

      expect(elite).toBe('elite');
      expect(high).toBe('high');
      expect(medium).toBe('medium');
      expect(low).toBe('low');
    });
  });

  describe('WUMetrics', () => {
    it('should structure WU metrics correctly', () => {
      const wu: WUMetrics = {
        id: 'WU-100',
        title: 'Test WU',
        lane: 'Operations',
        status: 'done',
        claimedAt: new Date('2026-01-10'),
        completedAt: new Date('2026-01-11'),
        cycleTimeHours: 24,
      };

      expect(wu.id).toBe('WU-100');
      expect(wu.status).toBe('done');
    });

    it('should allow optional fields', () => {
      const wu: WUMetrics = {
        id: 'WU-101',
        title: 'Minimal WU',
        lane: 'Core',
        status: 'ready',
      };

      expect(wu.claimedAt).toBeUndefined();
      expect(wu.cycleTimeHours).toBeUndefined();
    });
  });

  describe('GitCommit', () => {
    it('should structure git commit correctly', () => {
      const commit: GitCommit = {
        hash: 'abc123',
        timestamp: new Date('2026-01-10'),
        message: 'feat: add feature',
        type: 'feat',
        wuId: 'WU-100',
      };

      expect(commit.hash).toBe('abc123');
      expect(commit.type).toBe('feat');
    });
  });

  describe('FlowState', () => {
    it('should aggregate WU states', () => {
      const state: FlowState = {
        ready: 5,
        inProgress: 3,
        blocked: 2,
        waiting: 1,
        done: 10,
        totalActive: 11,
      };

      expect(state.totalActive).toBe(11);
    });
  });

  describe('DORAMetrics', () => {
    it('should combine all DORA metrics', () => {
      const metrics: DORAMetrics = {
        deploymentFrequency: { deploysPerWeek: 7, status: 'elite' },
        leadTimeForChanges: { averageHours: 1, medianHours: 0.5, p90Hours: 2, status: 'elite' },
        changeFailureRate: {
          failurePercentage: 5,
          totalDeployments: 20,
          failures: 1,
          status: 'high',
        },
        meanTimeToRecovery: { averageHours: 1, incidents: 2, status: 'elite' },
      };

      expect(metrics.deploymentFrequency.status).toBe('elite');
    });
  });

  describe('GateTelemetryEvent', () => {
    it('should structure gate event correctly', () => {
      const event: GateTelemetryEvent = {
        timestamp: '2026-01-10T10:00:00Z',
        wuId: 'WU-100',
        lane: 'Operations',
        gateName: 'lint',
        passed: true,
        durationMs: 1500,
      };

      expect(event.passed).toBe(true);
      expect(event.durationMs).toBe(1500);
    });
  });

  describe('LLMTelemetryEvent', () => {
    it('should structure LLM event correctly', () => {
      const event: LLMTelemetryEvent = {
        timestamp: '2026-01-10T10:00:00Z',
        eventType: 'llm.classification.complete',
        classificationType: 'mode_detection',
        durationMs: 200,
        tokensUsed: 150,
        estimatedCostUsd: 0.001,
        confidence: 0.95,
        fallbackUsed: false,
      };

      expect(event.eventType).toBe('llm.classification.complete');
      expect(event.confidence).toBe(0.95);
    });
  });

  describe('BottleneckAnalysis', () => {
    it('should structure bottleneck analysis correctly', () => {
      const analysis: BottleneckAnalysis = {
        bottlenecks: [
          { id: 'WU-1', score: 5, title: 'Foundation' },
          { id: 'WU-2', score: 3, title: 'API Layer' },
        ],
        criticalPath: {
          path: ['WU-1', 'WU-2', 'WU-3'],
          length: 2,
        },
      };

      expect(analysis.bottlenecks).toHaveLength(2);
      expect(analysis.criticalPath.length).toBe(2);
    });
  });

  describe('MetricsSnapshot', () => {
    it('should allow partial snapshots', () => {
      const doraOnly: MetricsSnapshot = {
        dora: {
          deploymentFrequency: { deploysPerWeek: 5, status: 'high' },
          leadTimeForChanges: { averageHours: 4, medianHours: 3, p90Hours: 8, status: 'high' },
          changeFailureRate: {
            failurePercentage: 10,
            totalDeployments: 10,
            failures: 1,
            status: 'medium',
          },
          meanTimeToRecovery: { averageHours: 2, incidents: 1, status: 'elite' },
        },
      };

      expect(doraOnly.dora).toBeDefined();
      expect(doraOnly.lanes).toBeUndefined();
      expect(doraOnly.flow).toBeUndefined();
    });
  });

  describe('Input types', () => {
    it('should structure GateEventInput', () => {
      const input: GateEventInput = {
        gateName: 'lint',
        passed: true,
        durationMs: 100,
      };

      expect(input.gateName).toBe('lint');
    });

    it('should structure LLMClassificationCompleteInput', () => {
      const input: LLMClassificationCompleteInput = {
        classificationType: 'mode_detection',
        durationMs: 200,
        tokensUsed: 100,
        estimatedCostUsd: 0.001,
        confidence: 0.95,
        fallbackUsed: false,
      };

      expect(input.confidence).toBe(0.95);
    });

    it('should structure FlowReportInput', () => {
      const input: FlowReportInput = {
        gateEvents: [],
        llmEvents: [],
        completedWUs: [],
        dateRange: { start: '2026-01-01', end: '2026-01-08' },
      };

      expect(input.dateRange.start).toBe('2026-01-01');
    });
  });
});

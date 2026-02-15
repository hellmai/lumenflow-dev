/**
 * Tests for flow report generation
 */
import { describe, it, expect } from 'vitest';
import { generateFlowReport } from '../../src/flow/generate-flow-report.js';
import type {
  FlowReportInput,
  GateTelemetryEvent,
  LLMTelemetryEvent,
  WUMetrics,
} from '../../src/types.js';

describe('generateFlowReport', () => {
  const baseInput: FlowReportInput = {
    gateEvents: [],
    llmEvents: [],
    completedWUs: [],
    dateRange: { start: '2026-01-01', end: '2026-01-08' },
  };

  describe('gate metrics', () => {
    it('calculates pass rate correctly', () => {
      const gateEvents: GateTelemetryEvent[] = [
        {
          timestamp: '2026-01-02T10:00:00Z',
          wuId: 'WU-1',
          lane: 'Ops',
          gateName: 'lint',
          passed: true,
          durationMs: 100,
        },
        {
          timestamp: '2026-01-02T11:00:00Z',
          wuId: 'WU-1',
          lane: 'Ops',
          gateName: 'lint',
          passed: true,
          durationMs: 120,
        },
        {
          timestamp: '2026-01-02T12:00:00Z',
          wuId: 'WU-2',
          lane: 'Ops',
          gateName: 'lint',
          passed: false,
          durationMs: 150,
        },
      ];

      const result = generateFlowReport({ ...baseInput, gateEvents });
      expect(result.gates.total).toBe(3);
      expect(result.gates.passed).toBe(2);
      expect(result.gates.failed).toBe(1);
      expect(result.gates.passRate).toBe('66.7');
    });

    it('groups by gate name', () => {
      const gateEvents: GateTelemetryEvent[] = [
        {
          timestamp: '2026-01-02T10:00:00Z',
          wuId: 'WU-1',
          lane: 'Ops',
          gateName: 'lint',
          passed: true,
          durationMs: 100,
        },
        {
          timestamp: '2026-01-02T11:00:00Z',
          wuId: 'WU-1',
          lane: 'Ops',
          gateName: 'typecheck',
          passed: true,
          durationMs: 200,
        },
        {
          timestamp: '2026-01-02T12:00:00Z',
          wuId: 'WU-2',
          lane: 'Ops',
          gateName: 'lint',
          passed: false,
          durationMs: 150,
        },
      ];

      const result = generateFlowReport({ ...baseInput, gateEvents });
      expect(result.gates.byName['lint']).toBeDefined();
      expect(result.gates.byName['lint']!.total).toBe(2);
      expect(result.gates.byName['typecheck']!.total).toBe(1);
    });

    it('calculates P95 duration', () => {
      const gateEvents: GateTelemetryEvent[] = Array.from({ length: 100 }, (_, i) => ({
        timestamp: '2026-01-02T10:00:00Z',
        wuId: 'WU-1',
        lane: 'Ops',
        gateName: 'lint',
        passed: true,
        durationMs: (i + 1) * 10, // 10ms to 1000ms
      }));

      const result = generateFlowReport({ ...baseInput, gateEvents });
      expect(result.gates.p95).toBeGreaterThanOrEqual(950);
    });
  });

  describe('LLM metrics', () => {
    it('returns zeros for no events', () => {
      const result = generateFlowReport(baseInput);
      expect(result.llm.totalClassifications).toBe(0);
      expect(result.llm.errorRate).toBe('0.0');
      expect(result.llm.avgLatencyMs).toBe(0);
    });

    it('calculates error rate', () => {
      const llmEvents: LLMTelemetryEvent[] = [
        {
          timestamp: '2026-01-02T10:00:00Z',
          eventType: 'llm.classification.complete',
          classificationType: 'mode',
          durationMs: 100,
          tokensUsed: 50,
          estimatedCostUsd: 0.001,
          confidence: 0.9,
          fallbackUsed: false,
        },
        {
          timestamp: '2026-01-02T11:00:00Z',
          eventType: 'llm.classification.complete',
          classificationType: 'mode',
          durationMs: 110,
          tokensUsed: 55,
          estimatedCostUsd: 0.001,
          confidence: 0.95,
          fallbackUsed: false,
        },
        {
          timestamp: '2026-01-02T12:00:00Z',
          eventType: 'llm.classification.error',
          classificationType: 'mode',
          errorType: 'timeout',
          errorMessage: 'timed out',
        },
      ];

      const result = generateFlowReport({ ...baseInput, llmEvents });
      expect(result.llm.totalClassifications).toBe(2);
      expect(result.llm.errorRate).toBe('33.3');
    });

    it('calculates fallback rate', () => {
      const llmEvents: LLMTelemetryEvent[] = [
        {
          timestamp: '2026-01-02T10:00:00Z',
          eventType: 'llm.classification.complete',
          classificationType: 'mode',
          durationMs: 100,
          tokensUsed: 50,
          estimatedCostUsd: 0.001,
          confidence: 0.9,
          fallbackUsed: true,
        },
        {
          timestamp: '2026-01-02T11:00:00Z',
          eventType: 'llm.classification.complete',
          classificationType: 'mode',
          durationMs: 110,
          tokensUsed: 55,
          estimatedCostUsd: 0.001,
          confidence: 0.95,
          fallbackUsed: false,
        },
      ];

      const result = generateFlowReport({ ...baseInput, llmEvents });
      expect(result.llm.fallbackRate).toBe('50.0');
    });

    it('aggregates by type', () => {
      const llmEvents: LLMTelemetryEvent[] = [
        {
          timestamp: '2026-01-02T10:00:00Z',
          eventType: 'llm.classification.complete',
          classificationType: 'mode_detection',
          durationMs: 100,
          tokensUsed: 50,
          estimatedCostUsd: 0.001,
          confidence: 0.9,
          fallbackUsed: false,
        },
        {
          timestamp: '2026-01-02T11:00:00Z',
          eventType: 'llm.classification.complete',
          classificationType: 'sensitive_data_detection',
          durationMs: 200,
          tokensUsed: 100,
          estimatedCostUsd: 0.002,
          confidence: 0.8,
          fallbackUsed: true,
        },
      ];

      const result = generateFlowReport({ ...baseInput, llmEvents });
      expect(result.llm.byType['mode_detection']).toBeDefined();
      expect(result.llm.byType['sensitive_data_detection']).toBeDefined();
      expect(result.llm.byType['mode_detection']!.count).toBe(1);
      expect(result.llm.byType['sensitive_data_detection']!.fallbackRate).toBe('100.0');
    });

    it('sums tokens and costs', () => {
      const llmEvents: LLMTelemetryEvent[] = [
        {
          timestamp: '2026-01-02T10:00:00Z',
          eventType: 'llm.classification.complete',
          classificationType: 'mode',
          durationMs: 100,
          tokensUsed: 50,
          estimatedCostUsd: 0.001,
          confidence: 0.9,
          fallbackUsed: false,
        },
        {
          timestamp: '2026-01-02T11:00:00Z',
          eventType: 'llm.classification.complete',
          classificationType: 'mode',
          durationMs: 110,
          tokensUsed: 70,
          estimatedCostUsd: 0.002,
          confidence: 0.95,
          fallbackUsed: false,
        },
      ];

      const result = generateFlowReport({ ...baseInput, llmEvents });
      expect(result.llm.totalTokens).toBe(120);
      expect(result.llm.totalCostUsd).toBeCloseTo(0.003, 4);
    });
  });

  describe('completed WUs', () => {
    it('formats completed WUs list', () => {
      const completedWUs: WUMetrics[] = [
        {
          id: 'WU-100',
          title: 'Test WU',
          lane: 'Operations',
          status: 'done',
          completedAt: new Date('2026-01-05'),
        },
      ];

      const result = generateFlowReport({ ...baseInput, completedWUs });
      expect(result.wus.completed).toBe(1);
      expect(result.wus.list[0]!.wuId).toBe('WU-100');
      expect(result.wus.list[0]!.lane).toBe('Operations');
    });

    it('handles missing completedAt', () => {
      const completedWUs: WUMetrics[] = [
        { id: 'WU-100', title: 'Test WU', lane: 'Operations', status: 'done' },
      ];

      const result = generateFlowReport({ ...baseInput, completedWUs });
      expect(result.wus.list[0]!.completedDate).toBe('');
    });
  });

  describe('date range', () => {
    it('includes date range in output', () => {
      const result = generateFlowReport(baseInput);
      expect(result.range.start).toBe('2026-01-01');
      expect(result.range.end).toBe('2026-01-08');
    });
  });
});

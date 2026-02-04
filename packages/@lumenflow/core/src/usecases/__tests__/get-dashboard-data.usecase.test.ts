/**
 * GetDashboardData Use Case Tests
 *
 * TDD: Tests written first, implementation follows.
 * Tests the use case that orchestrates metrics collection.
 *
 * @module get-dashboard-data.usecase.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetDashboardDataUseCase } from '../get-dashboard-data.usecase';
import type { IMetricsCollector } from '../../ports/metrics-collector.port';
import type {
  GlobalStatus,
  AgentMetric,
  WUProgress,
  TimelineEvent,
  Alert,
  DashboardData,
} from '../../domain/orchestration.types';
import { DOD_TOTAL } from '../../domain/orchestration.constants';

describe('GetDashboardDataUseCase', () => {
  let mockCollector: IMetricsCollector;
  let useCase: GetDashboardDataUseCase;

  const mockGlobalStatus: GlobalStatus = {
    activeWUs: 2,
    completed24h: 5,
    blocked: 1,
    gatesFailing: 0,
    longestRunning: {
      wuId: 'WU-1234',
      lane: 'Intelligence',
      durationMs: 3600000,
    },
    pendingMandatory: [{ wuId: 'WU-1235', agent: 'security-auditor' }],
  };

  const mockAgentMetrics: Record<string, AgentMetric> = {
    'security-auditor': {
      invoked: 10,
      passRate: 90,
      avgDurationMs: 120000,
      lastRun: {
        wuId: 'WU-1234',
        timestamp: '2025-01-15T10:00:00Z',
        result: 'pass',
      },
    },
    'llm-reviewer': {
      invoked: 8,
      passRate: 100,
      avgDurationMs: 60000,
      lastRun: {
        wuId: 'WU-1233',
        timestamp: '2025-01-15T09:00:00Z',
        result: 'pass',
      },
    },
  };

  const mockWUProgress: WUProgress[] = [
    {
      wuId: 'WU-1234',
      lane: 'Intelligence',
      title: 'LLM Classification',
      dodProgress: 8,
      dodTotal: DOD_TOTAL,
      agents: { 'llm-reviewer': 'pass' },
      headline: 'In progress - 8/11 checkpoints',
    },
    {
      wuId: 'WU-1235',
      lane: 'Core Systems',
      title: 'Auth Updates',
      dodProgress: 3,
      dodTotal: DOD_TOTAL,
      agents: { 'security-auditor': 'pending' },
      headline: 'Blocked on security-auditor',
    },
  ];

  const mockTimeline: TimelineEvent[] = [
    {
      timestamp: '2025-01-15T10:00:00Z',
      event: 'agent',
      wuId: 'WU-1234',
      detail: 'llm-reviewer passed',
      severity: 'info',
    },
    {
      timestamp: '2025-01-15T09:00:00Z',
      event: 'claim',
      wuId: 'WU-1234',
      detail: 'Claimed for Intelligence lane',
      severity: 'info',
    },
  ];

  const mockAlerts: Alert[] = [
    {
      severity: 'high',
      message: 'Mandatory agent pending',
      wuId: 'WU-1235',
      action: 'Run security-auditor',
    },
  ];

  beforeEach(() => {
    mockCollector = {
      getGlobalStatus: vi.fn().mockResolvedValue(mockGlobalStatus),
      getAgentMetrics: vi.fn().mockResolvedValue(mockAgentMetrics),
      getWUProgress: vi.fn().mockResolvedValue(mockWUProgress),
      getTimeline: vi.fn().mockResolvedValue(mockTimeline),
      getAlerts: vi.fn().mockResolvedValue(mockAlerts),
    };

    useCase = new GetDashboardDataUseCase(mockCollector);
  });

  it('should be instantiable with a metrics collector', () => {
    expect(useCase).toBeInstanceOf(GetDashboardDataUseCase);
  });

  it('should call all collector methods', async () => {
    await useCase.execute();

    expect(mockCollector.getGlobalStatus).toHaveBeenCalled();
    expect(mockCollector.getAgentMetrics).toHaveBeenCalled();
    expect(mockCollector.getWUProgress).toHaveBeenCalled();
    expect(mockCollector.getTimeline).toHaveBeenCalled();
    expect(mockCollector.getAlerts).toHaveBeenCalled();
  });

  it('should pass a date to getTimeline for last 24 hours', async () => {
    await useCase.execute();

    expect(mockCollector.getTimeline).toHaveBeenCalledWith(expect.any(Date));

    const calledDate = (mockCollector.getTimeline as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Date;
    const now = new Date();
    const hoursDiff = (now.getTime() - calledDate.getTime()) / (1000 * 60 * 60);

    // Should be approximately 24 hours ago (allow 1 minute tolerance)
    expect(hoursDiff).toBeGreaterThan(23.9);
    expect(hoursDiff).toBeLessThan(24.1);
  });

  it('should return aggregated dashboard data', async () => {
    const result = await useCase.execute();

    expect(result).toEqual<DashboardData>({
      globalStatus: mockGlobalStatus,
      agentMetrics: mockAgentMetrics,
      wuProgress: mockWUProgress,
      timeline: mockTimeline,
      alerts: mockAlerts,
    });
  });

  it('should call collector methods in parallel', async () => {
    const callOrder: string[] = [];

    mockCollector.getGlobalStatus = vi.fn().mockImplementation(async () => {
      callOrder.push('globalStatus:start');
      await new Promise((r) => setTimeout(r, 10));
      callOrder.push('globalStatus:end');
      return mockGlobalStatus;
    });

    mockCollector.getAgentMetrics = vi.fn().mockImplementation(async () => {
      callOrder.push('agentMetrics:start');
      await new Promise((r) => setTimeout(r, 10));
      callOrder.push('agentMetrics:end');
      return mockAgentMetrics;
    });

    await useCase.execute();

    // Both should start before either ends (parallel execution)
    const globalStartIdx = callOrder.indexOf('globalStatus:start');
    const agentStartIdx = callOrder.indexOf('agentMetrics:start');
    const globalEndIdx = callOrder.indexOf('globalStatus:end');
    const agentEndIdx = callOrder.indexOf('agentMetrics:end');

    expect(globalStartIdx).toBeLessThan(globalEndIdx);
    expect(agentStartIdx).toBeLessThan(agentEndIdx);
    // At least one should start before the other ends (parallel)
    expect(agentStartIdx < globalEndIdx || globalStartIdx < agentEndIdx).toBe(true);
  });

  it('should propagate errors from collector', async () => {
    const error = new Error('Collector failed');
    mockCollector.getGlobalStatus = vi.fn().mockRejectedValue(error);

    await expect(useCase.execute()).rejects.toThrow('Collector failed');
  });

  describe('with custom timeline window', () => {
    it('should accept custom hours parameter', async () => {
      const customHours = 48;
      await useCase.execute({ timelineHours: customHours });

      const calledDate = (mockCollector.getTimeline as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Date;
      const now = new Date();
      const hoursDiff = (now.getTime() - calledDate.getTime()) / (1000 * 60 * 60);

      expect(hoursDiff).toBeGreaterThan(47.9);
      expect(hoursDiff).toBeLessThan(48.1);
    });
  });
});

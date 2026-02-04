/**
 * GetSuggestions Use Case Tests
 *
 * TDD: Tests written first, implementation follows.
 * Tests the use case that applies rules to generate recommendations.
 *
 * @module get-suggestions.usecase.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetSuggestionsUseCase } from '../get-suggestions.usecase';
import type { IMetricsCollector } from '../../ports/metrics-collector.port';
import type { WUProgress, AgentMetric, Suggestion } from '../../domain/orchestration.types';
import { DOD_TOTAL } from '../../domain/orchestration.constants';

describe('GetSuggestionsUseCase', () => {
  let mockCollector: IMetricsCollector;
  let useCase: GetSuggestionsUseCase;

  const mockWUProgress: WUProgress[] = [
    {
      wuId: 'WU-1234',
      lane: 'Intelligence',
      title: 'LLM Classification',
      dodProgress: 9,
      dodTotal: DOD_TOTAL,
      agents: { 'llm-reviewer': 'pass', 'code-reviewer': 'pending' },
      headline: 'Near completion',
    },
    {
      wuId: 'WU-1235',
      lane: 'Core Systems',
      title: 'Auth Updates',
      dodProgress: 3,
      dodTotal: DOD_TOTAL,
      agents: { 'security-auditor': 'pending', 'test-engineer': 'pending' },
      headline: 'In early stages',
    },
  ];

  const mockAgentMetrics: Record<string, AgentMetric> = {
    'security-auditor': {
      invoked: 10,
      passRate: 90,
      avgDurationMs: 120000,
      lastRun: null,
    },
    'code-reviewer': {
      invoked: 15,
      passRate: 95,
      avgDurationMs: 60000,
      lastRun: null,
    },
  };

  beforeEach(() => {
    mockCollector = {
      getGlobalStatus: vi.fn().mockResolvedValue({
        activeWUs: 2,
        completed24h: 0,
        blocked: 0,
        gatesFailing: 0,
        longestRunning: null,
        pendingMandatory: [],
      }),
      getAgentMetrics: vi.fn().mockResolvedValue(mockAgentMetrics),
      getWUProgress: vi.fn().mockResolvedValue(mockWUProgress),
      getTimeline: vi.fn().mockResolvedValue([]),
      getAlerts: vi.fn().mockResolvedValue([]),
    };

    useCase = new GetSuggestionsUseCase(mockCollector);
  });

  it('should be instantiable with a metrics collector', () => {
    expect(useCase).toBeInstanceOf(GetSuggestionsUseCase);
  });

  it('should call collector to get WU progress and agent metrics', async () => {
    await useCase.execute();

    expect(mockCollector.getWUProgress).toHaveBeenCalled();
    expect(mockCollector.getAgentMetrics).toHaveBeenCalled();
  });

  it('should return suggestions based on WU progress', async () => {
    const result = await useCase.execute();

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('id');
    expect(result[0]).toHaveProperty('priority');
    expect(result[0]).toHaveProperty('action');
    expect(result[0]).toHaveProperty('reason');
    expect(result[0]).toHaveProperty('command');
  });

  // Skip: Depends on MANDATORY_TRIGGERS which is empty in LumenFlow framework
  it.skip('should prioritise mandatory agent suggestions as high', async () => {
    const result = await useCase.execute();

    const securitySuggestion = result.find((s) => s.action.includes('security-auditor'));
    expect(securitySuggestion?.priority).toBe('high');
  });

  it('should suggest code-reviewer for near-completion WUs', async () => {
    const result = await useCase.execute();

    const reviewerSuggestion = result.find((s) => s.action.includes('code-reviewer'));
    expect(reviewerSuggestion).toBeDefined();
    expect(reviewerSuggestion?.priority).toBe('medium');
  });

  it('should return empty array when no WUs in progress', async () => {
    mockCollector.getWUProgress = vi.fn().mockResolvedValue([]);

    const result = await useCase.execute();

    expect(result).toEqual([]);
  });

  // Skip: Depends on MANDATORY_TRIGGERS which is empty in LumenFlow framework
  it.skip('should include code paths in detection when provided', async () => {
    const codePaths = ['supabase/migrations/001.sql'];

    const result = await useCase.execute({ codePaths });

    // Should detect security-auditor is needed for migrations
    const securitySuggestion = result.find((s) => s.action.includes('security-auditor'));
    expect(securitySuggestion).toBeDefined();
  });

  it('should sort suggestions by priority', async () => {
    const result = await useCase.execute();

    const priorities = result.map((s) => s.priority);
    const expectedOrder = [...priorities].sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a] - order[b];
    });

    expect(priorities).toEqual(expectedOrder);
  });

  it('should handle collector errors', async () => {
    const error = new Error('Collector failed');
    mockCollector.getWUProgress = vi.fn().mockRejectedValue(error);

    await expect(useCase.execute()).rejects.toThrow('Collector failed');
  });

  // Skip: These tests rely on mandatory agent suggestions which require MANDATORY_TRIGGERS to be configured
  // MANDATORY_TRIGGERS is empty in LumenFlow framework (projects configure their own)
  describe.skip('with bottleneck impact scores (WU-1596)', () => {
    it('should factor impact scores into suggestion ranking within same priority', async () => {
      // Setup: Both WUs have same priority (high) suggestions
      // WU-1234 has security-auditor pending (set in new mock)
      // WU-1235 has security-auditor pending (set in new mock)
      mockCollector.getWUProgress = vi.fn().mockResolvedValue([
        {
          wuId: 'WU-1234',
          lane: 'Core Systems',
          title: 'Feature A',
          dodProgress: 3,
          dodTotal: DOD_TOTAL,
          agents: { 'security-auditor': 'pending' },
          headline: 'In progress',
        },
        {
          wuId: 'WU-1235',
          lane: 'Core Systems',
          title: 'Feature B',
          dodProgress: 3,
          dodTotal: DOD_TOTAL,
          agents: { 'security-auditor': 'pending' },
          headline: 'In progress',
        },
      ]);

      // WU-1235 blocks more downstream WUs, should be prioritised
      const result = await useCase.execute({
        bottleneckScores: {
          'WU-1235': 10, // Blocks 10 downstream WUs (higher impact)
          'WU-1234': 2, // Blocks 2 downstream WUs
        },
      });

      // Both have high priority, but WU-1235 has higher impact score
      // so WU-1235 suggestion should come first
      const highPrioritySuggestions = result.filter((s) => s.priority === 'high');
      expect(highPrioritySuggestions.length).toBeGreaterThanOrEqual(2);
      expect(highPrioritySuggestions[0].command).toContain('WU-1235');
    });

    it('should add impact score to suggestion reason when provided', async () => {
      const result = await useCase.execute({
        bottleneckScores: {
          'WU-1235': 10,
        },
      });

      const wu1235Suggestion = result.find(
        (s) => s.command?.includes('WU-1235') && s.priority === 'high',
      );
      expect(wu1235Suggestion?.reason).toContain('blocks 10');
    });

    it('should handle WUs without impact scores', async () => {
      // Only WU-1234 has an impact score
      const result = await useCase.execute({
        bottleneckScores: {
          'WU-1234': 3,
        },
      });

      // Should still return suggestions for both WUs
      const wuIds = result.map((s) => s.command?.match(/WU-\d+/)?.[0]).filter(Boolean);
      expect(wuIds).toContain('WU-1234');
      expect(wuIds).toContain('WU-1235');
    });

    it('should treat empty bottleneckScores same as no scores', async () => {
      const withEmptyScores = await useCase.execute({ bottleneckScores: {} });
      const withoutScores = await useCase.execute();

      expect(withEmptyScores.length).toBe(withoutScores.length);
    });
  });

  // Skip: MANDATORY_TRIGGERS is empty in LumenFlow framework (projects configure their own)
  // These tests would work if MANDATORY_TRIGGERS had entries
  describe.skip('with code path analysis (requires MANDATORY_TRIGGERS)', () => {
    it('should add mandatory agent suggestions for matching paths', async () => {
      // WU without pending mandatory agents, but code paths indicate need
      mockCollector.getWUProgress = vi.fn().mockResolvedValue([
        {
          wuId: 'WU-1236',
          lane: 'Core Systems',
          title: 'New Feature',
          dodProgress: 5,
          dodTotal: DOD_TOTAL,
          agents: {},
          headline: 'In progress',
        },
      ]);

      const result = await useCase.execute({
        codePaths: ['src/prompts/system-prompt.ts'],
      });

      const llmSuggestion = result.find((s) => s.action.includes('llm-reviewer'));
      expect(llmSuggestion).toBeDefined();
      expect(llmSuggestion?.priority).toBe('high');
    });

    it('should not duplicate mandatory agent suggestions', async () => {
      // WU already has llm-reviewer pending, code paths also trigger it
      mockCollector.getWUProgress = vi.fn().mockResolvedValue([
        {
          wuId: 'WU-1237',
          lane: 'Intelligence',
          title: 'LLM Feature',
          dodProgress: 5,
          dodTotal: DOD_TOTAL,
          agents: { 'llm-reviewer': 'pending' },
          headline: 'In progress',
        },
      ]);

      const result = await useCase.execute({
        codePaths: ['src/prompts/system-prompt.ts'],
      });

      const llmSuggestions = result.filter((s) => s.action.includes('llm-reviewer'));
      // Should only have one suggestion, not duplicated
      expect(llmSuggestions.length).toBe(1);
    });
  });
});

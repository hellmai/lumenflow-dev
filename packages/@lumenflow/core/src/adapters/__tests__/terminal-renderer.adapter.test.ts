/**
 * Terminal Dashboard Renderer Adapter Tests
 *
 * Following TDD: Tests written FIRST before implementation.
 * Tests the terminal rendering adapter against the DashboardRenderer port interface.
 *
 * @module terminal-renderer.adapter.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  DashboardData,
  GlobalStatus,
  AgentMetric,
  WUProgress,
  TimelineEvent,
  Alert,
  Suggestion,
  ExecutionPlan,
} from '../../domain/orchestration.types';
import { TerminalDashboardRenderer } from '../terminal-renderer.adapter';
import { DOD_TOTAL } from '../../domain/orchestration.constants';

describe('TerminalDashboardRenderer', () => {
  let renderer: TerminalDashboardRenderer;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    renderer = new TerminalDashboardRenderer();
    // Capture console.log output
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('render()', () => {
    it('should render all 5 sections for complete dashboard data', () => {
      const mockData: DashboardData = {
        globalStatus: createMockGlobalStatus(),
        agentMetrics: {
          'security-auditor': createMockAgentMetric('pass'),
          'code-reviewer': createMockAgentMetric('pending'),
        },
        wuProgress: [createMockWUProgress('WU-1320', 8, 11)],
        timeline: [createMockTimelineEvent()],
        alerts: [createMockAlert()],
      };

      renderer.render(mockData);

      // Verify console.log was called (output produced)
      expect(consoleSpy).toHaveBeenCalled();

      // Get all output
      const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');

      // Section 1: Global Status
      expect(output).toContain('Global Status');
      expect(output).toContain('Active WUs: 2');
      expect(output).toContain('Completed (24h): 5');

      // Section 2: Agent Small Multiples (table)
      expect(output).toContain('Agent Metrics');
      expect(output).toContain('security-auditor');
      expect(output).toContain('code-reviewer');

      // Section 3: WU Progress
      expect(output).toContain('WU Progress');
      expect(output).toContain('WU-1320');

      // Section 4: Timeline
      expect(output).toContain('Timeline');

      // Section 5: Alerts
      expect(output).toContain('Alerts');
    });

    it('should handle empty dashboard data gracefully', () => {
      const emptyData: DashboardData = {
        globalStatus: {
          activeWUs: 0,
          completed24h: 0,
          blocked: 0,
          gatesFailing: 0,
          longestRunning: null,
          pendingMandatory: [],
        },
        agentMetrics: {},
        wuProgress: [],
        timeline: [],
        alerts: [],
      };

      renderer.render(emptyData);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');

      // Should still render sections
      expect(output).toContain('Global Status');
      expect(output).toContain('Active WUs: 0');
    });

    it('should include headline sentences for each WU', () => {
      const mockData: DashboardData = {
        globalStatus: createMockGlobalStatus(),
        agentMetrics: {},
        wuProgress: [
          {
            wuId: 'WU-1320',
            lane: 'Operations: Tooling',
            title: 'Domain Types + Ports',
            dodProgress: 11,
            dodTotal: DOD_TOTAL,
            agents: { 'security-auditor': 'pass' },
            headline: 'All DoD checkpoints complete - ready for wu:done',
          },
        ],
        timeline: [],
        alerts: [],
      };

      renderer.render(mockData);

      const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');

      // Headline sentence should appear in WU Progress section
      expect(output).toContain('All DoD checkpoints complete - ready for wu:done');
    });

    it('should use semantic colours via picocolors (not raw ANSI)', () => {
      const mockData: DashboardData = {
        globalStatus: createMockGlobalStatus(),
        agentMetrics: {
          'security-auditor': createMockAgentMetric('pass'),
          'code-reviewer': createMockAgentMetric('fail'),
        },
        wuProgress: [],
        timeline: [],
        alerts: [
          {
            severity: 'high',
            message: 'Gates failing',
            wuId: 'WU-1234',
            action: 'Fix gates',
          },
        ],
      };

      renderer.render(mockData);

      const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');

      // Should NOT contain raw ANSI escape codes
      expect(output).not.toContain('\x1b[31m'); // raw red
      expect(output).not.toContain('\x1b[32m'); // raw green

      // Output should exist (colours applied via picocolors)
      expect(output).toBeTruthy();
    });

    it('should be scannable within 5 seconds (compact layout)', () => {
      const mockData: DashboardData = {
        globalStatus: createMockGlobalStatus(),
        agentMetrics: {
          'security-auditor': createMockAgentMetric('pass'),
          'code-reviewer': createMockAgentMetric('pass'),
          'test-engineer': createMockAgentMetric('pending'),
        },
        wuProgress: [
          createMockWUProgress('WU-1320', 8, 11),
          createMockWUProgress('WU-1321', 3, 11),
        ],
        timeline: [createMockTimelineEvent(), createMockTimelineEvent(), createMockTimelineEvent()],
        alerts: [createMockAlert(), createMockAlert()],
      };

      renderer.render(mockData);

      const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
      const lineCount = output.split('\n').length;

      // Tufte principle: compact, high data-ink ratio
      // Reasonable upper bound for terminal height (~50 lines for rich dashboard)
      expect(lineCount).toBeLessThan(80);
    });
  });

  describe('renderSuggestions()', () => {
    it('should render prioritised suggestions with priority indicators', () => {
      const suggestions: Suggestion[] = [
        {
          id: 'sug-001',
          priority: 'high',
          action: 'Run security-auditor',
          reason: 'WU touches auth paths',
          command: 'pnpm orchestrate:run security-auditor',
        },
        {
          id: 'sug-002',
          priority: 'medium',
          action: 'Run tests',
          reason: 'No test run in 1 hour',
          command: 'pnpm test',
        },
      ];

      renderer.renderSuggestions(suggestions);

      const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');

      expect(output).toContain('Suggestions');
      expect(output).toContain('Run security-auditor');
      expect(output).toContain('Run tests');
      expect(output).toContain('pnpm orchestrate:run security-auditor');
    });

    it('should handle empty suggestions gracefully', () => {
      renderer.renderSuggestions([]);

      const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');

      expect(output).toContain('No suggestions');
    });
  });

  describe('renderPlan()', () => {
    it('should render execution plan with steps and token estimate', async () => {
      const plan: ExecutionPlan = {
        wuId: 'WU-1320',
        steps: [
          { order: 1, agent: 'security-auditor', status: 'pending' },
          { order: 2, action: 'gates', status: 'pending' },
        ],
        estimatedTokens: 5000,
      };

      // Mock user input (approve)
      const mockPrompt = vi.fn().mockResolvedValue({ choice: 'approve', modifications: undefined });
      (renderer as any).promptUser = mockPrompt;

      const choice = await renderer.renderPlan(plan);

      const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');

      expect(output).toContain('Execution Plan');
      expect(output).toContain('WU-1320');
      expect(output).toContain('security-auditor');
      expect(output).toContain('5000');

      expect(choice.choice).toBe('approve');
    });

    it('should return reject when user rejects plan', async () => {
      const plan: ExecutionPlan = {
        wuId: 'WU-1320',
        steps: [],
        estimatedTokens: 1000,
      };

      const mockPrompt = vi.fn().mockResolvedValue({ choice: 'reject', modifications: undefined });
      (renderer as any).promptUser = mockPrompt;

      const choice = await renderer.renderPlan(plan);

      expect(choice.choice).toBe('reject');
    });

    it('should return edit with modifications when user edits plan', async () => {
      const plan: ExecutionPlan = {
        wuId: 'WU-1320',
        steps: [],
        estimatedTokens: 1000,
      };

      const mockPrompt = vi.fn().mockResolvedValue({
        choice: 'edit',
        modifications: ['Skip step 1', 'Add step 3'],
      });
      (renderer as any).promptUser = mockPrompt;

      const choice = await renderer.renderPlan(plan);

      expect(choice.choice).toBe('edit');
      expect(choice.modifications).toEqual(['Skip step 1', 'Add step 3']);
    });
  });

  describe('clear()', () => {
    it('should clear terminal output', () => {
      renderer.clear();

      const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');

      // Clear should print ANSI clear sequence or newlines
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('render consistency', () => {
    it('should render complete dashboard fixture with expected sections', () => {
      const mockData: DashboardData = {
        globalStatus: {
          activeWUs: 2,
          completed24h: 5,
          blocked: 1,
          gatesFailing: 0,
          longestRunning: {
            wuId: 'WU-1234',
            lane: 'Intelligence',
            durationMs: 2700000,
          },
          pendingMandatory: [{ wuId: 'WU-1235', agent: 'security-auditor' }],
        },
        agentMetrics: {
          'security-auditor': {
            invoked: 3,
            passRate: 100,
            avgDurationMs: 120000,
            lastRun: {
              wuId: 'WU-1234',
              timestamp: '2025-01-15T10:00:00Z',
              result: 'pass',
            },
          },
          'code-reviewer': {
            invoked: 2,
            passRate: 50,
            avgDurationMs: 180000,
            lastRun: {
              wuId: 'WU-1235',
              timestamp: '2025-01-15T11:00:00Z',
              result: 'fail',
            },
          },
        },
        wuProgress: [
          {
            wuId: 'WU-1320',
            lane: 'Operations: Tooling',
            title: 'Domain Types + Ports',
            dodProgress: 11,
            dodTotal: 11,
            agents: { 'security-auditor': 'pass', 'code-reviewer': 'pass' },
            headline: 'All DoD checkpoints complete',
          },
          {
            wuId: 'WU-1321',
            lane: 'Intelligence',
            title: 'Metrics Collector',
            dodProgress: 3,
            dodTotal: 11,
            agents: { 'code-reviewer': 'pending' },
            headline: 'Awaiting code-reviewer review',
          },
        ],
        timeline: [
          {
            timestamp: '2025-01-15T09:00:00Z',
            event: 'claim',
            wuId: 'WU-1320',
            detail: 'Claimed for Operations: Tooling',
            severity: 'info',
          },
          {
            timestamp: '2025-01-15T10:00:00Z',
            event: 'agent',
            wuId: 'WU-1320',
            detail: 'security-auditor: pass',
            severity: 'info',
          },
        ],
        alerts: [
          {
            severity: 'high',
            message: 'Mandatory agent not yet invoked',
            wuId: 'WU-1235',
            action: 'Run security-auditor before wu:done',
          },
          {
            severity: 'medium',
            message: 'WU blocked for 3 hours',
            wuId: 'WU-1236',
            action: 'Check blocker status',
          },
        ],
      };

      renderer.render(mockData);

      const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');

      expect(output).toContain('Global Status');
      expect(output).toContain('Pending Mandatory Agents');
      expect(output).toContain('Agent Metrics');
      expect(output).toContain('WU Progress');
      expect(output).toContain('Timeline');
      expect(output).toContain('Alerts');
    });
  });
});

// Helper functions to create mock data
function createMockGlobalStatus(): GlobalStatus {
  return {
    activeWUs: 2,
    completed24h: 5,
    blocked: 1,
    gatesFailing: 0,
    longestRunning: {
      wuId: 'WU-1234',
      lane: 'Intelligence',
      durationMs: 2700000,
    },
    pendingMandatory: [],
  };
}

function createMockAgentMetric(result: 'pass' | 'fail' | 'pending'): AgentMetric {
  return {
    invoked: 3,
    passRate: result === 'pass' ? 100 : result === 'fail' ? 0 : 50,
    avgDurationMs: 120000,
    lastRun: {
      wuId: 'WU-1234',
      timestamp: '2025-01-15T10:00:00Z',
      result: result === 'pending' ? 'pass' : result,
    },
  };
}

function createMockWUProgress(wuId: string, dodProgress: number, dodTotal: number): WUProgress {
  return {
    wuId,
    lane: 'Operations: Tooling',
    title: 'Mock WU Title',
    dodProgress,
    dodTotal,
    agents: { 'security-auditor': 'pass' },
    headline: `Progress: ${dodProgress}/${dodTotal} checkpoints complete`,
  };
}

function createMockTimelineEvent(): TimelineEvent {
  return {
    timestamp: '2025-01-15T09:00:00Z',
    event: 'claim',
    wuId: 'WU-1234',
    detail: 'Claimed for Operations lane',
    severity: 'info',
  };
}

function createMockAlert(): Alert {
  return {
    severity: 'high',
    message: 'Mock alert message',
    wuId: 'WU-1234',
    action: 'Take action',
  };
}

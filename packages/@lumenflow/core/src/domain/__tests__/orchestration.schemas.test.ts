/**
 * Orchestration Schemas Tests
 *
 * TDD: Tests written BEFORE implementation.
 * Tests Zod schema validation for all orchestration domain types.
 *
 * @see {@link ../orchestration.schemas.ts} - Implementation (to be created)
 * @see {@link ../orchestration.constants.ts} - Constants used in schemas
 */

import { describe, it, expect } from 'vitest';
import {
  GlobalStatusSchema,
  AgentMetricSchema,
  WUProgressSchema,
  TimelineEventSchema,
  AlertSchema,
  SuggestionSchema,
  ExecutionPlanSchema,
  UserChoiceSchema,
  DashboardDataSchema,
} from '../orchestration.schemas';
import {
  DOD_TOTAL,
  LANES,
  AGENT_NAMES,
  SEVERITY_LEVELS,
  AGENT_RESULT_STATUSES,
  TIMELINE_EVENT_TYPES,
  EVENT_SEVERITY_LEVELS,
  USER_CHOICE_OPTIONS,
} from '../orchestration.constants';

describe('Orchestration Schemas', () => {
  describe('GlobalStatusSchema', () => {
    const validGlobalStatus = {
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
    };

    it('validates valid global status with longestRunning', () => {
      const result = GlobalStatusSchema.safeParse(validGlobalStatus);
      expect(result.success).toBe(true);
    });

    it('validates global status with null longestRunning', () => {
      const status = { ...validGlobalStatus, longestRunning: null };
      const result = GlobalStatusSchema.safeParse(status);
      expect(result.success).toBe(true);
    });

    it('validates global status with empty pendingMandatory', () => {
      const status = { ...validGlobalStatus, pendingMandatory: [] };
      const result = GlobalStatusSchema.safeParse(status);
      expect(result.success).toBe(true);
    });

    it('rejects negative activeWUs', () => {
      const status = { ...validGlobalStatus, activeWUs: -1 };
      const result = GlobalStatusSchema.safeParse(status);
      expect(result.success).toBe(false);
    });

    it('rejects negative completed24h', () => {
      const status = { ...validGlobalStatus, completed24h: -5 };
      const result = GlobalStatusSchema.safeParse(status);
      expect(result.success).toBe(false);
    });

    it('rejects negative blocked count', () => {
      const status = { ...validGlobalStatus, blocked: -1 };
      const result = GlobalStatusSchema.safeParse(status);
      expect(result.success).toBe(false);
    });

    it('rejects negative gatesFailing count', () => {
      const status = { ...validGlobalStatus, gatesFailing: -2 };
      const result = GlobalStatusSchema.safeParse(status);
      expect(result.success).toBe(false);
    });

    it('rejects non-integer activeWUs', () => {
      const status = { ...validGlobalStatus, activeWUs: 2.5 };
      const result = GlobalStatusSchema.safeParse(status);
      expect(result.success).toBe(false);
    });

    it('rejects invalid lane in longestRunning', () => {
      const status = {
        ...validGlobalStatus,
        longestRunning: { wuId: 'WU-1234', lane: 'InvalidLane', durationMs: 1000 },
      };
      const result = GlobalStatusSchema.safeParse(status);
      expect(result.success).toBe(false);
    });

    it('rejects invalid agent in pendingMandatory', () => {
      const status = {
        ...validGlobalStatus,
        pendingMandatory: [{ wuId: 'WU-1235', agent: 'invalid-agent' }],
      };
      const result = GlobalStatusSchema.safeParse(status);
      expect(result.success).toBe(false);
    });

    it('rejects missing required fields', () => {
      const status = { activeWUs: 2 };
      const result = GlobalStatusSchema.safeParse(status);
      expect(result.success).toBe(false);
    });
  });

  describe('AgentMetricSchema', () => {
    const validAgentMetric = {
      invoked: 3,
      passRate: 100,
      avgDurationMs: 120000,
      lastRun: {
        wuId: 'WU-1234',
        timestamp: new Date().toISOString(),
        result: 'pass',
      },
    };

    it('validates valid agent metric', () => {
      const result = AgentMetricSchema.safeParse(validAgentMetric);
      expect(result.success).toBe(true);
    });

    it('validates agent metric with null lastRun', () => {
      const metric = { ...validAgentMetric, lastRun: null };
      const result = AgentMetricSchema.safeParse(metric);
      expect(result.success).toBe(true);
    });

    it('validates passRate at 0', () => {
      const metric = { ...validAgentMetric, passRate: 0 };
      const result = AgentMetricSchema.safeParse(metric);
      expect(result.success).toBe(true);
    });

    it('validates passRate at 100', () => {
      const metric = { ...validAgentMetric, passRate: 100 };
      const result = AgentMetricSchema.safeParse(metric);
      expect(result.success).toBe(true);
    });

    it('rejects passRate above 100', () => {
      const metric = { ...validAgentMetric, passRate: 101 };
      const result = AgentMetricSchema.safeParse(metric);
      expect(result.success).toBe(false);
    });

    it('rejects negative passRate', () => {
      const metric = { ...validAgentMetric, passRate: -1 };
      const result = AgentMetricSchema.safeParse(metric);
      expect(result.success).toBe(false);
    });

    it('rejects negative invoked count', () => {
      const metric = { ...validAgentMetric, invoked: -1 };
      const result = AgentMetricSchema.safeParse(metric);
      expect(result.success).toBe(false);
    });

    it('rejects negative avgDurationMs', () => {
      const metric = { ...validAgentMetric, avgDurationMs: -1000 };
      const result = AgentMetricSchema.safeParse(metric);
      expect(result.success).toBe(false);
    });

    it('rejects invalid result in lastRun', () => {
      const metric = {
        ...validAgentMetric,
        lastRun: { wuId: 'WU-1234', timestamp: new Date().toISOString(), result: 'invalid' },
      };
      const result = AgentMetricSchema.safeParse(metric);
      expect(result.success).toBe(false);
    });
  });

  describe('WUProgressSchema', () => {
    const validWUProgress = {
      wuId: 'WU-1234',
      lane: 'Intelligence',
      title: 'LLM Classification Feature',
      dodProgress: 8,
      dodTotal: DOD_TOTAL,
      agents: {
        'llm-reviewer': 'pass',
        'test-engineer': 'pass',
        'code-reviewer': 'pending',
      },
      headline: 'Blocked on code-reviewer - awaiting approval',
    };

    it('validates valid WU progress', () => {
      const result = WUProgressSchema.safeParse(validWUProgress);
      expect(result.success).toBe(true);
    });

    it('validates WU progress with empty agents', () => {
      const progress = { ...validWUProgress, agents: {} };
      const result = WUProgressSchema.safeParse(progress);
      expect(result.success).toBe(true);
    });

    it('validates dodProgress at 0', () => {
      const progress = { ...validWUProgress, dodProgress: 0 };
      const result = WUProgressSchema.safeParse(progress);
      expect(result.success).toBe(true);
    });

    it('validates dodProgress at DOD_TOTAL', () => {
      const progress = { ...validWUProgress, dodProgress: DOD_TOTAL };
      const result = WUProgressSchema.safeParse(progress);
      expect(result.success).toBe(true);
    });

    it('rejects dodProgress above DOD_TOTAL', () => {
      const progress = { ...validWUProgress, dodProgress: DOD_TOTAL + 1 };
      const result = WUProgressSchema.safeParse(progress);
      expect(result.success).toBe(false);
    });

    it('rejects negative dodProgress', () => {
      const progress = { ...validWUProgress, dodProgress: -1 };
      const result = WUProgressSchema.safeParse(progress);
      expect(result.success).toBe(false);
    });

    it('rejects invalid lane', () => {
      const progress = { ...validWUProgress, lane: 'InvalidLane' };
      const result = WUProgressSchema.safeParse(progress);
      expect(result.success).toBe(false);
    });

    it('rejects invalid agent status', () => {
      const progress = {
        ...validWUProgress,
        agents: { 'llm-reviewer': 'invalid-status' },
      };
      const result = WUProgressSchema.safeParse(progress);
      expect(result.success).toBe(false);
    });

    it('validates all valid agent statuses', () => {
      for (const status of AGENT_RESULT_STATUSES) {
        const progress = {
          ...validWUProgress,
          agents: { 'llm-reviewer': status },
        };
        const result = WUProgressSchema.safeParse(progress);
        expect(result.success).toBe(true);
      }
    });

    it('validates all valid lanes', () => {
      for (const lane of LANES) {
        const progress = { ...validWUProgress, lane };
        const result = WUProgressSchema.safeParse(progress);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('TimelineEventSchema', () => {
    const validTimelineEvent = {
      timestamp: new Date().toISOString(),
      event: 'claim',
      wuId: 'WU-1234',
      detail: 'Claimed for Intelligence lane',
      severity: 'info',
    };

    it('validates valid timeline event', () => {
      const result = TimelineEventSchema.safeParse(validTimelineEvent);
      expect(result.success).toBe(true);
    });

    it('validates all event types', () => {
      for (const event of TIMELINE_EVENT_TYPES) {
        const timelineEvent = { ...validTimelineEvent, event };
        const result = TimelineEventSchema.safeParse(timelineEvent);
        expect(result.success).toBe(true);
      }
    });

    it('validates all severity levels', () => {
      for (const severity of EVENT_SEVERITY_LEVELS) {
        const timelineEvent = { ...validTimelineEvent, severity };
        const result = TimelineEventSchema.safeParse(timelineEvent);
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid event type', () => {
      const timelineEvent = { ...validTimelineEvent, event: 'invalid-event' };
      const result = TimelineEventSchema.safeParse(timelineEvent);
      expect(result.success).toBe(false);
    });

    it('rejects invalid severity', () => {
      const timelineEvent = { ...validTimelineEvent, severity: 'critical' };
      const result = TimelineEventSchema.safeParse(timelineEvent);
      expect(result.success).toBe(false);
    });

    it('rejects invalid timestamp format', () => {
      const timelineEvent = { ...validTimelineEvent, timestamp: 'not-a-date' };
      const result = TimelineEventSchema.safeParse(timelineEvent);
      expect(result.success).toBe(false);
    });
  });

  describe('AlertSchema', () => {
    const validAlert = {
      severity: 'high',
      message: 'Mandatory agent not yet invoked',
      wuId: 'WU-1235',
      action: 'Run security-auditor before wu:done',
    };

    it('validates valid alert', () => {
      const result = AlertSchema.safeParse(validAlert);
      expect(result.success).toBe(true);
    });

    it('validates all severity levels', () => {
      for (const severity of SEVERITY_LEVELS) {
        const alert = { ...validAlert, severity };
        const result = AlertSchema.safeParse(alert);
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid severity', () => {
      const alert = { ...validAlert, severity: 'critical' };
      const result = AlertSchema.safeParse(alert);
      expect(result.success).toBe(false);
    });

    it('rejects empty message', () => {
      const alert = { ...validAlert, message: '' };
      const result = AlertSchema.safeParse(alert);
      expect(result.success).toBe(false);
    });

    it('rejects empty wuId', () => {
      const alert = { ...validAlert, wuId: '' };
      const result = AlertSchema.safeParse(alert);
      expect(result.success).toBe(false);
    });
  });

  describe('SuggestionSchema', () => {
    const validSuggestion = {
      id: 'sug-001',
      priority: 'high',
      action: 'Run security-auditor',
      reason: 'WU touches auth paths',
      command: 'pnpm orchestrate:run security-auditor',
    };

    it('validates valid suggestion', () => {
      const result = SuggestionSchema.safeParse(validSuggestion);
      expect(result.success).toBe(true);
    });

    it('validates all priority levels', () => {
      for (const priority of SEVERITY_LEVELS) {
        const suggestion = { ...validSuggestion, priority };
        const result = SuggestionSchema.safeParse(suggestion);
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid priority', () => {
      const suggestion = { ...validSuggestion, priority: 'critical' };
      const result = SuggestionSchema.safeParse(suggestion);
      expect(result.success).toBe(false);
    });

    it('rejects empty id', () => {
      const suggestion = { ...validSuggestion, id: '' };
      const result = SuggestionSchema.safeParse(suggestion);
      expect(result.success).toBe(false);
    });
  });

  describe('ExecutionPlanSchema', () => {
    const validExecutionPlan = {
      wuId: 'WU-1234',
      steps: [
        { order: 1, agent: 'llm-reviewer', status: 'pending' },
        { order: 2, agent: 'test-engineer', status: 'pending' },
        { order: 3, action: 'gates', status: 'pending' },
      ],
      estimatedTokens: 5000,
    };

    it('validates valid execution plan', () => {
      const result = ExecutionPlanSchema.safeParse(validExecutionPlan);
      expect(result.success).toBe(true);
    });

    it('validates plan with empty steps', () => {
      const plan = { ...validExecutionPlan, steps: [] };
      const result = ExecutionPlanSchema.safeParse(plan);
      expect(result.success).toBe(true);
    });

    it('rejects negative estimatedTokens', () => {
      const plan = { ...validExecutionPlan, estimatedTokens: -100 };
      const result = ExecutionPlanSchema.safeParse(plan);
      expect(result.success).toBe(false);
    });

    it('rejects invalid step status', () => {
      const plan = {
        ...validExecutionPlan,
        steps: [{ order: 1, agent: 'llm-reviewer', status: 'invalid' }],
      };
      const result = ExecutionPlanSchema.safeParse(plan);
      expect(result.success).toBe(false);
    });
  });

  describe('UserChoiceSchema', () => {
    it('validates all choice options', () => {
      for (const choice of USER_CHOICE_OPTIONS) {
        const result = UserChoiceSchema.safeParse({ choice });
        expect(result.success).toBe(true);
      }
    });

    it('validates choice with modifications', () => {
      const result = UserChoiceSchema.safeParse({
        choice: 'edit',
        modifications: ['Skip step 2', 'Add code-reviewer'],
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid choice', () => {
      const result = UserChoiceSchema.safeParse({ choice: 'cancel' });
      expect(result.success).toBe(false);
    });
  });

  describe('DashboardDataSchema', () => {
    const validDashboardData = {
      globalStatus: {
        activeWUs: 2,
        completed24h: 5,
        blocked: 1,
        gatesFailing: 0,
        longestRunning: null,
        pendingMandatory: [],
      },
      agentMetrics: {
        'security-auditor': {
          invoked: 3,
          passRate: 100,
          avgDurationMs: 120000,
          lastRun: null,
        },
      },
      wuProgress: [
        {
          wuId: 'WU-1234',
          lane: 'Intelligence',
          title: 'Test WU',
          dodProgress: 5,
          dodTotal: DOD_TOTAL,
          agents: {},
          headline: 'In progress',
        },
      ],
      timeline: [
        {
          timestamp: new Date().toISOString(),
          event: 'claim',
          wuId: 'WU-1234',
          detail: 'Claimed',
          severity: 'info',
        },
      ],
      alerts: [
        {
          severity: 'high',
          message: 'Test alert',
          wuId: 'WU-1234',
          action: 'Do something',
        },
      ],
    };

    it('validates valid dashboard data', () => {
      const result = DashboardDataSchema.safeParse(validDashboardData);
      expect(result.success).toBe(true);
    });

    it('validates dashboard data with empty arrays', () => {
      const data = {
        ...validDashboardData,
        wuProgress: [],
        timeline: [],
        alerts: [],
      };
      const result = DashboardDataSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('validates dashboard data with empty agentMetrics', () => {
      const data = { ...validDashboardData, agentMetrics: {} };
      const result = DashboardDataSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('rejects invalid nested globalStatus', () => {
      const data = {
        ...validDashboardData,
        globalStatus: { ...validDashboardData.globalStatus, activeWUs: -1 },
      };
      const result = DashboardDataSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('rejects invalid agentMetric in record', () => {
      const data = {
        ...validDashboardData,
        agentMetrics: {
          'security-auditor': {
            ...validDashboardData.agentMetrics['security-auditor'],
            passRate: 150,
          },
        },
      };
      const result = DashboardDataSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });
});

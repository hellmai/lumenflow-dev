/**
 * Orchestration Rules Tests
 *
 * TDD: Tests written first, implementation follows.
 * Tests pure functions for agent detection and suggestion generation.
 *
 * @module orchestration-rules.test
 */

import { describe, it, expect } from 'vitest';
import { detectMandatoryAgents, generateSuggestions } from '../orchestration-rules';
import type { WUProgress, AgentMetric } from '../domain/orchestration.types';
import { DOD_TOTAL } from '../domain/orchestration.constants';

describe('orchestration-rules', () => {
  describe('detectMandatoryAgents', () => {
    it('should return empty array for empty code paths', () => {
      const result = detectMandatoryAgents([]);
      expect(result).toEqual([]);
    });

    it('should return empty array for paths that do not trigger any agent', () => {
      const paths = ['src/utils/helpers.ts', 'README.md', 'package.json'];
      const result = detectMandatoryAgents(paths);
      expect(result).toEqual([]);
    });

    describe('security-auditor triggers', () => {
      it('should detect supabase migrations', () => {
        const paths = ['supabase/migrations/20250101_add_users.sql'];
        const result = detectMandatoryAgents(paths);
        expect(result).toContain('security-auditor');
      });

      it('should detect auth paths', () => {
        const paths = ['src/auth/login.ts'];
        const result = detectMandatoryAgents(paths);
        expect(result).toContain('security-auditor');
      });

      it('should detect nested auth paths', () => {
        const paths = ['packages/core/src/auth/middleware.ts'];
        const result = detectMandatoryAgents(paths);
        expect(result).toContain('security-auditor');
      });

      it('should detect rls paths', () => {
        const paths = ['src/rls/policies.ts'];
        const result = detectMandatoryAgents(paths);
        expect(result).toContain('security-auditor');
      });

      it('should detect permissions paths', () => {
        const paths = ['lib/permissions/check.ts'];
        const result = detectMandatoryAgents(paths);
        expect(result).toContain('security-auditor');
      });
    });

    describe('beacon-guardian triggers', () => {
      it('should detect prompts paths', () => {
        const paths = ['src/prompts/classification.ts'];
        const result = detectMandatoryAgents(paths);
        expect(result).toContain('beacon-guardian');
      });

      it('should detect classification paths', () => {
        const paths = ['packages/intelligence/classification/detector.ts'];
        const result = detectMandatoryAgents(paths);
        expect(result).toContain('beacon-guardian');
      });

      it('should detect detector paths', () => {
        const paths = ['src/detector/red-flag.ts'];
        const result = detectMandatoryAgents(paths);
        expect(result).toContain('beacon-guardian');
      });

      it('should detect llm paths', () => {
        const paths = ['services/llm/openai-adapter.ts'];
        const result = detectMandatoryAgents(paths);
        expect(result).toContain('beacon-guardian');
      });
    });

    describe('multiple agents', () => {
      it('should detect both agents when paths trigger both', () => {
        const paths = ['supabase/migrations/20250101_add_rls.sql', 'src/prompts/system-prompt.ts'];
        const result = detectMandatoryAgents(paths);
        expect(result).toContain('security-auditor');
        expect(result).toContain('beacon-guardian');
        expect(result).toHaveLength(2);
      });

      it('should not duplicate agents for multiple matching paths', () => {
        const paths = ['src/auth/login.ts', 'src/auth/logout.ts', 'supabase/migrations/001.sql'];
        const result = detectMandatoryAgents(paths);
        expect(result.filter((a) => a === 'security-auditor')).toHaveLength(1);
      });
    });
  });

  describe('generateSuggestions', () => {
    const createWUProgress = (overrides: Partial<WUProgress> = {}): WUProgress => ({
      wuId: 'WU-1234',
      lane: 'Intelligence',
      title: 'Test WU',
      dodProgress: 5,
      dodTotal: DOD_TOTAL,
      agents: {},
      headline: 'In progress',
      ...overrides,
    });

    const createAgentMetric = (overrides: Partial<AgentMetric> = {}): AgentMetric => ({
      invoked: 0,
      passRate: 0,
      avgDurationMs: 0,
      lastRun: null,
      ...overrides,
    });

    it('should return empty array when no WUs are in progress', () => {
      const result = generateSuggestions([], {});
      expect(result).toEqual([]);
    });

    it('should suggest code-reviewer for WUs near completion', () => {
      const wuProgress = [
        createWUProgress({
          dodProgress: 9,
          agents: {},
        }),
      ];
      const result = generateSuggestions(wuProgress, {});
      expect(result.some((s) => s.action.includes('code-reviewer'))).toBe(true);
    });

    it('should suggest test-engineer for new features without tests', () => {
      const wuProgress = [
        createWUProgress({
          dodProgress: 3,
          agents: { 'test-engineer': 'pending' },
        }),
      ];
      const result = generateSuggestions(wuProgress, {});
      expect(result.some((s) => s.action.includes('test-engineer'))).toBe(true);
    });

    it('should not suggest code-reviewer if already passed', () => {
      const wuProgress = [
        createWUProgress({
          dodProgress: 9,
          agents: { 'code-reviewer': 'pass' },
        }),
      ];
      const result = generateSuggestions(wuProgress, {});
      expect(result.some((s) => s.action.includes('code-reviewer'))).toBe(false);
    });

    it('should prioritise mandatory agent alerts over suggested', () => {
      const wuProgress = [
        createWUProgress({
          dodProgress: 9,
          agents: {
            'security-auditor': 'pending',
            'code-reviewer': 'pending',
          },
        }),
      ];
      const result = generateSuggestions(wuProgress, {});

      const securitySuggestion = result.find((s) => s.action.includes('security-auditor'));
      const reviewerSuggestion = result.find((s) => s.action.includes('code-reviewer'));

      if (securitySuggestion && reviewerSuggestion) {
        expect(securitySuggestion.priority).toBe('high');
        expect(reviewerSuggestion.priority).toBe('medium');
      }
    });

    it('should include unique IDs for each suggestion', () => {
      const wuProgress = [
        createWUProgress({
          wuId: 'WU-1234',
          dodProgress: 9,
          agents: { 'code-reviewer': 'pending' },
        }),
        createWUProgress({
          wuId: 'WU-1235',
          dodProgress: 9,
          agents: { 'code-reviewer': 'pending' },
        }),
      ];
      const result = generateSuggestions(wuProgress, {});
      const ids = result.map((s) => s.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should include command in suggestions', () => {
      const wuProgress = [
        createWUProgress({
          dodProgress: 9,
          agents: { 'code-reviewer': 'pending' },
        }),
      ];
      const result = generateSuggestions(wuProgress, {});
      const suggestion = result.find((s) => s.action.includes('code-reviewer'));
      expect(suggestion?.command).toContain('code-reviewer');
    });
  });
});

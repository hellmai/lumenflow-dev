/**
 * Orchestration Advisory Loader Tests
 *
 * Tests the JavaScript version of mandatory agent advisory.
 * Mirrors the TypeScript tests in orchestration-advisory.test.ts.
 *
 * @module orchestration-advisory-loader.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  emitMandatoryAgentAdvisory,
  checkMandatoryAgentsCompliance,
} from '../orchestration-advisory-loader.mjs';

describe('orchestration-advisory-loader', () => {
  let consoleLogSpy;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('emitMandatoryAgentAdvisory', () => {
    it('emits nothing when codePaths is empty', () => {
      emitMandatoryAgentAdvisory([], 'WU-1234');
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('emits nothing when no mandatory agents triggered', () => {
      emitMandatoryAgentAdvisory(['src/components/Button.tsx'], 'WU-1234');
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('emits security-auditor advisory for auth paths', () => {
      emitMandatoryAgentAdvisory(['src/auth/login.ts'], 'WU-1234');

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join('\n');
      expect(allOutput).toContain('MANDATORY AGENT ADVISORY');
      expect(allOutput).toContain('security-auditor');
    });

    it('emits security-auditor advisory for supabase migrations', () => {
      emitMandatoryAgentAdvisory(['supabase/migrations/001_create_users.sql'], 'WU-1234');

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join('\n');
      expect(allOutput).toContain('security-auditor');
    });

    it('emits beacon-guardian advisory for prompts paths', () => {
      emitMandatoryAgentAdvisory(['src/prompts/system.ts'], 'WU-1234');

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join('\n');
      expect(allOutput).toContain('beacon-guardian');
    });

    it('emits both agents when both triggers present', () => {
      emitMandatoryAgentAdvisory(['src/auth/login.ts', 'src/prompts/system.ts'], 'WU-1234');

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join('\n');
      expect(allOutput).toContain('security-auditor');
      expect(allOutput).toContain('beacon-guardian');
    });

    it('includes WU ID in output', () => {
      emitMandatoryAgentAdvisory(['src/auth/login.ts'], 'WU-5678');

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join('\n');
      expect(allOutput).toContain('WU-5678');
    });
  });

  describe('checkMandatoryAgentsCompliance', () => {
    it('returns compliant=true when codePaths is empty', () => {
      const result = checkMandatoryAgentsCompliance([], 'WU-1234');
      expect(result.compliant).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('returns compliant=true when no mandatory agents triggered', () => {
      const result = checkMandatoryAgentsCompliance(['src/components/Button.tsx'], 'WU-1234');
      expect(result.compliant).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('returns compliant=false with missing security-auditor for auth paths', () => {
      const result = checkMandatoryAgentsCompliance(['src/auth/login.ts'], 'WU-1234');
      expect(result.compliant).toBe(false);
      expect(result.missing).toContain('security-auditor');
    });

    it('returns compliant=false with missing beacon-guardian for prompts paths', () => {
      const result = checkMandatoryAgentsCompliance(['src/prompts/system.ts'], 'WU-1234');
      expect(result.compliant).toBe(false);
      expect(result.missing).toContain('beacon-guardian');
    });

    it('returns both missing agents when both triggered', () => {
      const result = checkMandatoryAgentsCompliance(
        ['src/auth/login.ts', 'src/prompts/system.ts'],
        'WU-1234'
      );
      expect(result.compliant).toBe(false);
      expect(result.missing).toContain('security-auditor');
      expect(result.missing).toContain('beacon-guardian');
    });
  });
});

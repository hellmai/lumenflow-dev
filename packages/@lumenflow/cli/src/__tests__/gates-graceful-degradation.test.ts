/**
 * @file gates-graceful-degradation.test.ts
 * @description Tests for WU-1520: Gates graceful degradation for missing optional scripts
 *
 * Acceptance criteria:
 * - Missing gate scripts cause a warning and skip, not a hard failure
 * - Warning message includes how to add the missing script
 * - Invariants check is never skippable
 * - --strict flag makes missing scripts a hard failure for CI
 * - Gate summary shows which gates were skipped vs passed vs failed
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import path from 'node:path';

// Import the functions we'll create/modify
import {
  checkScriptExists,
  buildMissingScriptWarning,
  resolveGateAction,
  loadPackageJsonScripts,
  type GateResult,
  type GateStatus,
  SKIPPABLE_GATE_SCRIPTS,
  NON_SKIPPABLE_GATES,
  formatGateSummary,
} from '../gates-graceful-degradation.js';

describe('WU-1520: Gates graceful degradation for missing optional scripts', () => {
  describe('checkScriptExists', () => {
    it('should return true when script exists in package.json', () => {
      const scripts = {
        lint: 'eslint .',
        typecheck: 'tsc --noEmit',
        'format:check': 'prettier --check .',
      };
      expect(checkScriptExists('lint', scripts)).toBe(true);
      expect(checkScriptExists('typecheck', scripts)).toBe(true);
      expect(checkScriptExists('format:check', scripts)).toBe(true);
    });

    it('should return false when script does not exist in package.json', () => {
      const scripts = { lint: 'eslint .' };
      expect(checkScriptExists('typecheck', scripts)).toBe(false);
      expect(checkScriptExists('format:check', scripts)).toBe(false);
      expect(checkScriptExists('spec:linter', scripts)).toBe(false);
    });

    it('should return false when scripts object is empty', () => {
      expect(checkScriptExists('lint', {})).toBe(false);
    });

    it('should return false when scripts is undefined', () => {
      expect(checkScriptExists('lint', undefined)).toBe(false);
    });
  });

  describe('buildMissingScriptWarning', () => {
    it('should include the script name in the warning', () => {
      const warning = buildMissingScriptWarning('format:check');
      expect(warning).toContain('format:check');
    });

    it('should include how to add the missing script', () => {
      const warning = buildMissingScriptWarning('lint');
      // AC: Warning message includes how to add the missing script
      expect(warning).toContain('package.json');
      expect(warning).toContain('"lint"');
    });

    it('should indicate the gate is being skipped', () => {
      const warning = buildMissingScriptWarning('typecheck');
      expect(warning).toMatch(/skip/i);
    });

    it('should include a suggestion command for common scripts', () => {
      const warning = buildMissingScriptWarning('format:check');
      expect(warning).toContain('"format:check"');
      expect(warning).toContain('scripts');
    });
  });

  describe('SKIPPABLE_GATE_SCRIPTS', () => {
    it('should include format:check, lint, typecheck, and spec:linter', () => {
      expect(SKIPPABLE_GATE_SCRIPTS).toContain('format:check');
      expect(SKIPPABLE_GATE_SCRIPTS).toContain('lint');
      expect(SKIPPABLE_GATE_SCRIPTS).toContain('typecheck');
      expect(SKIPPABLE_GATE_SCRIPTS).toContain('spec:linter');
    });
  });

  describe('NON_SKIPPABLE_GATES', () => {
    // AC: Invariants check is never skippable
    it('should include invariants gate', () => {
      expect(NON_SKIPPABLE_GATES).toContain('invariants');
    });

    it('should not include format:check, lint, typecheck', () => {
      expect(NON_SKIPPABLE_GATES).not.toContain('format:check');
      expect(NON_SKIPPABLE_GATES).not.toContain('lint');
      expect(NON_SKIPPABLE_GATES).not.toContain('typecheck');
    });
  });

  describe('formatGateSummary', () => {
    // AC: Gate summary shows which gates were skipped vs passed vs failed
    it('should show passed gates', () => {
      const results: GateResult[] = [
        { name: 'invariants', status: 'passed', durationMs: 100 },
        { name: 'lint', status: 'passed', durationMs: 500 },
      ];
      const summary = formatGateSummary(results);
      expect(summary).toContain('invariants');
      expect(summary).toContain('passed');
    });

    it('should show skipped gates', () => {
      const results: GateResult[] = [
        { name: 'invariants', status: 'passed', durationMs: 100 },
        {
          name: 'format:check',
          status: 'skipped',
          durationMs: 0,
          reason: 'script not found in package.json',
        },
      ];
      const summary = formatGateSummary(results);
      expect(summary).toContain('format:check');
      expect(summary).toContain('skipped');
    });

    it('should show failed gates', () => {
      const results: GateResult[] = [
        { name: 'invariants', status: 'passed', durationMs: 100 },
        { name: 'lint', status: 'failed', durationMs: 300 },
      ];
      const summary = formatGateSummary(results);
      expect(summary).toContain('lint');
      expect(summary).toContain('failed');
    });

    it('should show counts of passed, skipped, and failed', () => {
      const results: GateResult[] = [
        { name: 'invariants', status: 'passed', durationMs: 100 },
        { name: 'format:check', status: 'skipped', durationMs: 0, reason: 'missing script' },
        { name: 'lint', status: 'passed', durationMs: 500 },
        { name: 'typecheck', status: 'failed', durationMs: 300 },
      ];
      const summary = formatGateSummary(results);
      // Should show aggregate counts
      expect(summary).toContain('2 passed');
      expect(summary).toContain('1 skipped');
      expect(summary).toContain('1 failed');
    });

    it('should return empty summary for empty results', () => {
      const summary = formatGateSummary([]);
      expect(summary).toBeDefined();
    });
  });

  describe('loadPackageJsonScripts', () => {
    it('should load scripts from a valid package.json', () => {
      // Use this package's own directory which has a package.json
      const pkgDir = path.join(import.meta.dirname, '..', '..');
      const scripts = loadPackageJsonScripts(pkgDir);
      expect(scripts).toBeDefined();
      expect(scripts).toHaveProperty('build');
      expect(scripts).toHaveProperty('test');
    });

    it('should return undefined for a nonexistent directory', () => {
      const scripts = loadPackageJsonScripts('/nonexistent/path/that/does/not/exist');
      expect(scripts).toBeUndefined();
    });
  });

  describe('resolveGateAction', () => {
    const scripts = {
      lint: 'eslint .',
      typecheck: 'tsc --noEmit',
    };

    it('should return "run" when script exists', () => {
      expect(resolveGateAction('lint', 'lint', scripts, false)).toBe('run');
    });

    it('should return "skip" when script is missing and not strict', () => {
      expect(resolveGateAction('format:check', 'format:check', scripts, false)).toBe('skip');
    });

    // AC: --strict flag makes missing scripts a hard failure for CI
    it('should return "fail" when script is missing and strict is true', () => {
      expect(resolveGateAction('format:check', 'format:check', scripts, true)).toBe('fail');
    });

    // AC: Invariants check is never skippable
    it('should always return "run" for invariants gate, even without scripts', () => {
      expect(resolveGateAction('invariants', null, undefined, false)).toBe('run');
      expect(resolveGateAction('invariants', null, undefined, true)).toBe('run');
    });

    it('should return "run" for gates without a scriptName (custom run functions)', () => {
      expect(resolveGateAction('backlog-sync', null, scripts, false)).toBe('run');
      expect(resolveGateAction('lane-health', null, scripts, true)).toBe('run');
    });

    it('should return "skip" when scripts object is undefined and not strict', () => {
      expect(resolveGateAction('lint', 'lint', undefined, false)).toBe('skip');
    });

    it('should return "fail" when scripts object is undefined and strict', () => {
      expect(resolveGateAction('lint', 'lint', undefined, true)).toBe('fail');
    });
  });

  describe('--strict flag behavior', () => {
    // AC: --strict flag makes missing scripts a hard failure for CI
    it('should define strict option in GATES_OPTIONS', async () => {
      const { GATES_OPTIONS } = await import('../gates.js');
      expect(GATES_OPTIONS.strict).toBeDefined();
      expect(GATES_OPTIONS.strict.flags).toBe('--strict');
    });
  });
});

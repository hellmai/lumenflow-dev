// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file gate-registry-defaults.test.ts
 * @description Tests for WU-1550: Default gate and validator registration
 *
 * Verifies that:
 * - registerDefaultGates() populates the registry with all expected gates
 * - registerDefaultValidators() populates the registry with all expected validators
 * - Gates match the previously hardcoded arrays in executeGates()
 * - New gates can be added by registering without modifying executeGates()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GateRegistry } from '../gate-registry.js';
import { ValidatorRegistry } from '../validator-registry.js';
import { registerDocsOnlyGates, registerCodeGates } from '../gate-defaults.js';
import {
  registerPreflightValidators,
  registerCompletionValidators,
} from '../validator-defaults.js';
import { GATE_NAMES } from '@lumenflow/core/wu-constants';

// ---------------------------------------------------------------------------
// Default Gate Registration
// ---------------------------------------------------------------------------
describe('WU-1550: Default gate registration', () => {
  describe('registerDocsOnlyGates', () => {
    it('should register docs-only gates in the correct order', () => {
      const registry = new GateRegistry();
      registerDocsOnlyGates(registry, {
        laneHealthMode: 'warn',
        testsRequired: true,
        docsOnlyTestPlan: null,
      });

      const gates = registry.getAll();
      const names = gates.map((g) => g.name);

      // Verify essential docs-only gates are present
      expect(names).toContain(GATE_NAMES.INVARIANTS);
      expect(names).toContain(GATE_NAMES.FORMAT_CHECK);
      expect(names).toContain(GATE_NAMES.SPEC_LINTER);
      expect(names).toContain(GATE_NAMES.BACKLOG_SYNC);
      expect(names).toContain(GATE_NAMES.CLAIM_VALIDATION);
      expect(names).toContain(GATE_NAMES.LANE_HEALTH);
      expect(names).toContain(GATE_NAMES.ONBOARDING_SMOKE_TEST);

      // Invariants should be first
      expect(names[0]).toBe(GATE_NAMES.INVARIANTS);
    });

    it('should NOT include lint, typecheck, or full test gates in docs-only mode', () => {
      const registry = new GateRegistry();
      registerDocsOnlyGates(registry, {
        laneHealthMode: 'warn',
        testsRequired: true,
        docsOnlyTestPlan: null,
      });

      const names = registry.getAll().map((g) => g.name);
      expect(names).not.toContain(GATE_NAMES.LINT);
      expect(names).not.toContain(GATE_NAMES.TYPECHECK);
      expect(names).not.toContain(GATE_NAMES.COVERAGE);
      expect(names).not.toContain(GATE_NAMES.SUPABASE_DOCS_LINTER);
    });

    it('should include filtered test gate when docsOnlyTestPlan has packages', () => {
      const registry = new GateRegistry();
      registerDocsOnlyGates(registry, {
        laneHealthMode: 'warn',
        testsRequired: true,
        docsOnlyTestPlan: { mode: 'filtered', packages: ['@lumenflow/cli'] },
      });

      const names = registry.getAll().map((g) => g.name);
      expect(names).toContain(GATE_NAMES.TEST);
    });

    it('should NOT include test gate when docsOnlyTestPlan is skip', () => {
      const registry = new GateRegistry();
      registerDocsOnlyGates(registry, {
        laneHealthMode: 'warn',
        testsRequired: true,
        docsOnlyTestPlan: { mode: 'skip', packages: [], reason: 'no-code-packages' },
      });

      const names = registry.getAll().map((g) => g.name);
      expect(names).not.toContain(GATE_NAMES.TEST);
    });
  });

  describe('registerCodeGates', () => {
    it('should register code gates in the correct order', () => {
      const registry = new GateRegistry();
      registerCodeGates(registry, {
        isFullLint: false,
        isFullTests: false,
        isFullCoverage: false,
        laneHealthMode: 'warn',
        testsRequired: true,
        shouldRunIntegration: false,
        configuredTestFullCmd: 'pnpm turbo run test',
      });

      const gates = registry.getAll();
      const names = gates.map((g) => g.name);

      // Verify essential code gates are present
      expect(names).toContain(GATE_NAMES.INVARIANTS);
      expect(names).toContain(GATE_NAMES.FORMAT_CHECK);
      expect(names).toContain(GATE_NAMES.LINT);
      expect(names).toContain(GATE_NAMES.CO_CHANGE);
      expect(names).toContain(GATE_NAMES.TYPECHECK);
      expect(names).toContain(GATE_NAMES.SPEC_LINTER);
      expect(names).toContain(GATE_NAMES.BACKLOG_SYNC);
      expect(names).toContain(GATE_NAMES.CLAIM_VALIDATION);
      expect(names).toContain(GATE_NAMES.SAFETY_CRITICAL_TEST);
      expect(names).toContain(GATE_NAMES.TEST);
      expect(names).toContain(GATE_NAMES.COVERAGE);

      // Invariants should be first
      expect(names[0]).toBe(GATE_NAMES.INVARIANTS);
      expect(names.indexOf(GATE_NAMES.CO_CHANGE)).toBeGreaterThan(names.indexOf(GATE_NAMES.LINT));
      expect(names.indexOf(GATE_NAMES.CO_CHANGE)).toBeLessThan(names.indexOf(GATE_NAMES.TEST));
    });

    it('should include integration test gate when shouldRunIntegration is true', () => {
      const registry = new GateRegistry();
      registerCodeGates(registry, {
        isFullLint: false,
        isFullTests: false,
        isFullCoverage: false,
        laneHealthMode: 'warn',
        testsRequired: true,
        shouldRunIntegration: true,
        configuredTestFullCmd: 'pnpm turbo run test',
      });

      const names = registry.getAll().map((g) => g.name);
      expect(names).toContain(GATE_NAMES.INTEGRATION_TEST);
    });

    it('should NOT include integration test gate when shouldRunIntegration is false', () => {
      const registry = new GateRegistry();
      registerCodeGates(registry, {
        isFullLint: false,
        isFullTests: false,
        isFullCoverage: false,
        laneHealthMode: 'warn',
        testsRequired: true,
        shouldRunIntegration: false,
        configuredTestFullCmd: 'pnpm turbo run test',
      });

      const names = registry.getAll().map((g) => g.name);
      expect(names).not.toContain(GATE_NAMES.INTEGRATION_TEST);
    });

    it('should set warnOnly=true on test gates when testsRequired=false', () => {
      const registry = new GateRegistry();
      registerCodeGates(registry, {
        isFullLint: false,
        isFullTests: false,
        isFullCoverage: false,
        laneHealthMode: 'warn',
        testsRequired: false,
        shouldRunIntegration: false,
        configuredTestFullCmd: 'pnpm turbo run test',
      });

      const testGate = registry.get(GATE_NAMES.TEST);
      expect(testGate?.warnOnly).toBe(true);

      const safetyGate = registry.get(GATE_NAMES.SAFETY_CRITICAL_TEST);
      expect(safetyGate?.warnOnly).toBe(true);
    });
  });

  // ---- AC3: New gates added by creating a file and registering ----
  describe('extensibility (AC3)', () => {
    it('should allow adding a new gate without modifying registration functions', () => {
      const registry = new GateRegistry();

      // Register default gates
      registerCodeGates(registry, {
        isFullLint: false,
        isFullTests: false,
        isFullCoverage: false,
        laneHealthMode: 'warn',
        testsRequired: true,
        shouldRunIntegration: false,
        configuredTestFullCmd: 'pnpm turbo run test',
      });

      const countBefore = registry.getAll().length;

      // A new gate file would just call register()
      registry.register({
        name: 'my-custom-gate',
        cmd: 'pnpm my-custom-gate',
        scriptName: 'my-custom-gate',
      });

      expect(registry.getAll().length).toBe(countBefore + 1);
      expect(registry.has('my-custom-gate')).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Default Validator Registration
// ---------------------------------------------------------------------------
describe('WU-1550: Default validator registration', () => {
  describe('registerPreflightValidators', () => {
    it('should register preflight validators', () => {
      const registry = new ValidatorRegistry();
      registerPreflightValidators(registry);

      const validators = registry.getByPhase('preflight');
      expect(validators.length).toBeGreaterThan(0);
    });

    it('should include code-path-preflight validator', () => {
      const registry = new ValidatorRegistry();
      registerPreflightValidators(registry);

      expect(registry.has('code-path-preflight')).toBe(true);
    });

    it('should include type-vs-code-paths validator', () => {
      const registry = new ValidatorRegistry();
      registerPreflightValidators(registry);

      expect(registry.has('type-vs-code-paths')).toBe(true);
    });

    it('should include spec-completeness validator', () => {
      const registry = new ValidatorRegistry();
      registerPreflightValidators(registry);

      expect(registry.has('spec-completeness')).toBe(true);
    });
  });

  describe('registerCompletionValidators', () => {
    it('should register completion validators', () => {
      const registry = new ValidatorRegistry();
      registerCompletionValidators(registry);

      const validators = registry.getByPhase('completion');
      expect(validators.length).toBeGreaterThan(0);
    });

    it('should include code-paths-exist validator', () => {
      const registry = new ValidatorRegistry();
      registerCompletionValidators(registry);

      expect(registry.has('code-paths-exist')).toBe(true);
    });

    it('should include mandatory-agents-compliance validator', () => {
      const registry = new ValidatorRegistry();
      registerCompletionValidators(registry);

      expect(registry.has('mandatory-agents-compliance')).toBe(true);
    });

    it('should include docs-only-flag validator', () => {
      const registry = new ValidatorRegistry();
      registerCompletionValidators(registry);

      expect(registry.has('docs-only-flag')).toBe(true);
    });
  });

  describe('extensibility (AC3)', () => {
    it('should allow adding a new validator without modifying registration functions', () => {
      const registry = new ValidatorRegistry();
      registerPreflightValidators(registry);

      const countBefore = registry.getAll().length;

      // A new validator file would just call register()
      registry.register({
        name: 'my-custom-validator',
        phase: 'preflight',
        validate: () => ({ valid: true, errors: [] }),
      });

      expect(registry.getAll().length).toBe(countBefore + 1);
      expect(registry.has('my-custom-validator')).toBe(true);
    });
  });
});

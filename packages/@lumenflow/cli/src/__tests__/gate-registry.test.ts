/**
 * @file gate-registry.test.ts
 * @description Tests for WU-1550: Gate and Validator registry patterns
 *
 * Acceptance criteria:
 * - Gates registered via GateRegistry pattern instead of hardcoded arrays
 * - Validators use ValidatorRegistry for declarative registration
 * - New gates/validators added by creating a file and registering, not modifying
 *   executeGates() or wu-done.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GateRegistry, type GateDefinition, type GateLogContext } from '../gate-registry.js';

import {
  ValidatorRegistry,
  type ValidatorDefinition,
  type ValidatorPhase,
} from '../validator-registry.js';

// ---------------------------------------------------------------------------
// GateRegistry
// ---------------------------------------------------------------------------
describe('WU-1550: GateRegistry', () => {
  let registry: GateRegistry;

  beforeEach(() => {
    registry = new GateRegistry();
  });

  // ---- Registration ----
  describe('register', () => {
    it('should register a gate with a command', () => {
      registry.register({
        name: 'lint',
        cmd: 'pnpm lint',
      });

      const gates = registry.getAll();
      expect(gates).toHaveLength(1);
      expect(gates[0].name).toBe('lint');
      expect(gates[0].cmd).toBe('pnpm lint');
    });

    it('should register a gate with a run function', () => {
      const runFn = vi.fn().mockResolvedValue({ ok: true, duration: 100 });

      registry.register({
        name: 'backlog-sync',
        run: runFn,
      });

      const gates = registry.getAll();
      expect(gates).toHaveLength(1);
      expect(gates[0].name).toBe('backlog-sync');
      expect(gates[0].run).toBe(runFn);
    });

    it('should register multiple gates and preserve insertion order', () => {
      registry.register({ name: 'format:check', cmd: 'pnpm format:check' });
      registry.register({ name: 'lint', cmd: 'pnpm lint' });
      registry.register({ name: 'typecheck', cmd: 'pnpm typecheck' });

      const gates = registry.getAll();
      expect(gates).toHaveLength(3);
      expect(gates.map((g) => g.name)).toEqual(['format:check', 'lint', 'typecheck']);
    });

    it('should support optional scriptName for graceful degradation', () => {
      registry.register({
        name: 'format:check',
        cmd: 'pnpm format:check',
        scriptName: 'format:check',
      });

      const gates = registry.getAll();
      expect(gates[0].scriptName).toBe('format:check');
    });

    it('should support warnOnly flag', () => {
      registry.register({
        name: 'system-map:validate',
        run: vi.fn(),
        warnOnly: true,
      });

      const gates = registry.getAll();
      expect(gates[0].warnOnly).toBe(true);
    });

    it('should throw when registering a gate with duplicate name', () => {
      registry.register({ name: 'lint', cmd: 'pnpm lint' });

      expect(() => {
        registry.register({ name: 'lint', cmd: 'pnpm lint:fix' });
      }).toThrow(/already registered/);
    });
  });

  // ---- Retrieval ----
  describe('getAll', () => {
    it('should return empty array when no gates registered', () => {
      expect(registry.getAll()).toEqual([]);
    });

    it('should return a copy (not a reference to internal array)', () => {
      registry.register({ name: 'lint', cmd: 'pnpm lint' });
      const gates1 = registry.getAll();
      const gates2 = registry.getAll();
      expect(gates1).not.toBe(gates2);
      expect(gates1).toEqual(gates2);
    });
  });

  describe('get', () => {
    it('should return a gate by name', () => {
      registry.register({ name: 'lint', cmd: 'pnpm lint' });
      const gate = registry.get('lint');
      expect(gate).toBeDefined();
      expect(gate!.name).toBe('lint');
    });

    it('should return undefined for unknown gate', () => {
      expect(registry.get('unknown')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return true for registered gate', () => {
      registry.register({ name: 'lint', cmd: 'pnpm lint' });
      expect(registry.has('lint')).toBe(true);
    });

    it('should return false for unregistered gate', () => {
      expect(registry.has('lint')).toBe(false);
    });
  });

  // ---- Bulk registration ----
  describe('registerAll', () => {
    it('should register multiple gates at once', () => {
      registry.registerAll([
        { name: 'format:check', cmd: 'pnpm format:check' },
        { name: 'lint', cmd: 'pnpm lint' },
        { name: 'typecheck', cmd: 'pnpm typecheck' },
      ]);

      expect(registry.getAll()).toHaveLength(3);
    });
  });

  // ---- Clear ----
  describe('clear', () => {
    it('should remove all registered gates', () => {
      registry.register({ name: 'lint', cmd: 'pnpm lint' });
      registry.register({ name: 'typecheck', cmd: 'pnpm typecheck' });
      registry.clear();
      expect(registry.getAll()).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// ValidatorRegistry
// ---------------------------------------------------------------------------
describe('WU-1550: ValidatorRegistry', () => {
  let registry: ValidatorRegistry;

  beforeEach(() => {
    registry = new ValidatorRegistry();
  });

  // ---- Registration ----
  describe('register', () => {
    it('should register a validator with a phase', () => {
      const validateFn = vi.fn().mockReturnValue({ valid: true, errors: [] });

      registry.register({
        name: 'spec-completeness',
        phase: 'preflight',
        validate: validateFn,
      });

      const validators = registry.getByPhase('preflight');
      expect(validators).toHaveLength(1);
      expect(validators[0].name).toBe('spec-completeness');
    });

    it('should register validators in multiple phases', () => {
      registry.register({
        name: 'code-paths',
        phase: 'preflight',
        validate: vi.fn(),
      });

      registry.register({
        name: 'backlog-sync',
        phase: 'completion',
        validate: vi.fn(),
      });

      expect(registry.getByPhase('preflight')).toHaveLength(1);
      expect(registry.getByPhase('completion')).toHaveLength(1);
    });

    it('should preserve insertion order within a phase', () => {
      registry.register({
        name: 'first',
        phase: 'preflight',
        validate: vi.fn(),
      });

      registry.register({
        name: 'second',
        phase: 'preflight',
        validate: vi.fn(),
      });

      registry.register({
        name: 'third',
        phase: 'preflight',
        validate: vi.fn(),
      });

      const validators = registry.getByPhase('preflight');
      expect(validators.map((v) => v.name)).toEqual(['first', 'second', 'third']);
    });

    it('should throw when registering a validator with duplicate name', () => {
      registry.register({
        name: 'code-paths',
        phase: 'preflight',
        validate: vi.fn(),
      });

      expect(() => {
        registry.register({
          name: 'code-paths',
          phase: 'preflight',
          validate: vi.fn(),
        });
      }).toThrow(/already registered/);
    });

    it('should support optional blocking flag (default true)', () => {
      registry.register({
        name: 'exposure-check',
        phase: 'completion',
        validate: vi.fn(),
      });

      const validators = registry.getByPhase('completion');
      // Default should be blocking=true (validators block by default)
      expect(validators[0].blocking).not.toBe(false);
    });

    it('should support non-blocking validators', () => {
      registry.register({
        name: 'exposure-check',
        phase: 'completion',
        validate: vi.fn(),
        blocking: false,
      });

      const validators = registry.getByPhase('completion');
      expect(validators[0].blocking).toBe(false);
    });
  });

  // ---- Retrieval ----
  describe('getByPhase', () => {
    it('should return empty array for phase with no validators', () => {
      expect(registry.getByPhase('preflight')).toEqual([]);
    });

    it('should return only validators for the requested phase', () => {
      registry.register({
        name: 'preflight-check',
        phase: 'preflight',
        validate: vi.fn(),
      });

      registry.register({
        name: 'completion-check',
        phase: 'completion',
        validate: vi.fn(),
      });

      const preflight = registry.getByPhase('preflight');
      expect(preflight).toHaveLength(1);
      expect(preflight[0].name).toBe('preflight-check');
    });

    it('should return a copy (not a reference to internal array)', () => {
      registry.register({
        name: 'check',
        phase: 'preflight',
        validate: vi.fn(),
      });

      const v1 = registry.getByPhase('preflight');
      const v2 = registry.getByPhase('preflight');
      expect(v1).not.toBe(v2);
    });
  });

  describe('getAll', () => {
    it('should return all validators across all phases', () => {
      registry.register({
        name: 'preflight-a',
        phase: 'preflight',
        validate: vi.fn(),
      });

      registry.register({
        name: 'completion-a',
        phase: 'completion',
        validate: vi.fn(),
      });

      expect(registry.getAll()).toHaveLength(2);
    });
  });

  describe('has', () => {
    it('should return true for registered validator', () => {
      registry.register({
        name: 'code-paths',
        phase: 'preflight',
        validate: vi.fn(),
      });
      expect(registry.has('code-paths')).toBe(true);
    });

    it('should return false for unregistered validator', () => {
      expect(registry.has('unknown')).toBe(false);
    });
  });

  // ---- Clear ----
  describe('clear', () => {
    it('should remove all registered validators', () => {
      registry.register({
        name: 'a',
        phase: 'preflight',
        validate: vi.fn(),
      });
      registry.register({
        name: 'b',
        phase: 'completion',
        validate: vi.fn(),
      });
      registry.clear();
      expect(registry.getAll()).toHaveLength(0);
    });
  });

  // ---- Phases ----
  describe('getPhases', () => {
    it('should return all phases that have registered validators', () => {
      registry.register({
        name: 'a',
        phase: 'preflight',
        validate: vi.fn(),
      });
      registry.register({
        name: 'b',
        phase: 'completion',
        validate: vi.fn(),
      });

      const phases = registry.getPhases();
      expect(phases).toContain('preflight');
      expect(phases).toContain('completion');
    });
  });
});

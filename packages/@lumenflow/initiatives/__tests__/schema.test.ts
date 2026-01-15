/**
 * Initiative Schema Tests
 *
 * Tests for initiative schema validation.
 *
 * @module @lumenflow/initiatives/__tests__/schema
 */

import { describe, it, expect } from 'vitest';
import {
  validateInitiative,
  validatePhase,
  InitiativeSchema,
  PhaseSchema,
  INITIATIVE_STATUSES,
  PHASE_STATUSES,
  INITIATIVE_PATTERNS,
} from '../src/schema.js';

describe('Initiative Schema', () => {
  describe('INITIATIVE_PATTERNS', () => {
    it('validates initiative ID format', () => {
      expect(INITIATIVE_PATTERNS.INIT_ID.test('INIT-001')).toBe(true);
      expect(INITIATIVE_PATTERNS.INIT_ID.test('INIT-123')).toBe(true);
      expect(INITIATIVE_PATTERNS.INIT_ID.test('INIT-999')).toBe(true);
      expect(INITIATIVE_PATTERNS.INIT_ID.test('INIT-1234')).toBe(false);
      expect(INITIATIVE_PATTERNS.INIT_ID.test('INIT-1')).toBe(false);
      expect(INITIATIVE_PATTERNS.INIT_ID.test('invalid')).toBe(false);
    });

    it('validates WU ID format', () => {
      expect(INITIATIVE_PATTERNS.WU_ID.test('WU-123')).toBe(true);
      expect(INITIATIVE_PATTERNS.WU_ID.test('WU-1')).toBe(true);
      expect(INITIATIVE_PATTERNS.WU_ID.test('WU-')).toBe(false);
      expect(INITIATIVE_PATTERNS.WU_ID.test('wu-123')).toBe(false);
    });
  });

  describe('validatePhase', () => {
    const validPhase = {
      number: 1,
      name: 'Foundation',
      status: 'pending',
      wus: ['WU-100', 'WU-101'],
    };

    it('accepts valid phase', () => {
      const result = validatePhase(validPhase);
      expect(result.success).toBe(true);
    });

    it('accepts phase with optional description', () => {
      const phaseWithDesc = { ...validPhase, description: 'Build the foundation' };
      const result = validatePhase(phaseWithDesc);
      expect(result.success).toBe(true);
    });

    it('rejects invalid status', () => {
      const result = validatePhase({ ...validPhase, status: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid WU ID format', () => {
      const result = validatePhase({ ...validPhase, wus: ['invalid-id'] });
      expect(result.success).toBe(false);
    });
  });

  describe('validateInitiative', () => {
    const validInitiative = {
      id: 'INIT-051',
      title: 'LumenFlow Extraction',
      description: 'Extract LumenFlow to hellmai/os',
      status: 'in_progress',
      phases: [
        { number: 0, name: 'Foundation', status: 'complete', wus: ['WU-2562'] },
        { number: 1, name: 'Core', status: 'in_progress', wus: ['WU-2537'] },
      ],
    };

    it('accepts valid initiative', () => {
      const result = validateInitiative(validInitiative);
      expect(result.success).toBe(true);
    });

    it('accepts initiative with optional fields', () => {
      const initWithOptionals = {
        ...validInitiative,
        created_at: '2026-01-15T10:00:00.000Z',
        updated_at: '2026-01-15T12:00:00.000Z',
        owner: 'tom@hellm.ai',
        metadata: { priority: 'high' },
      };
      const result = validateInitiative(initWithOptionals);
      expect(result.success).toBe(true);
    });

    it('rejects invalid initiative ID', () => {
      const result = validateInitiative({ ...validInitiative, id: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid status', () => {
      const result = validateInitiative({ ...validInitiative, status: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('rejects empty title', () => {
      const result = validateInitiative({ ...validInitiative, title: '' });
      expect(result.success).toBe(false);
    });

    it('rejects empty description', () => {
      const result = validateInitiative({ ...validInitiative, description: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('constants', () => {
    it('exports all initiative statuses', () => {
      expect(INITIATIVE_STATUSES).toContain('draft');
      expect(INITIATIVE_STATUSES).toContain('ready');
      expect(INITIATIVE_STATUSES).toContain('in_progress');
      expect(INITIATIVE_STATUSES).toContain('blocked');
      expect(INITIATIVE_STATUSES).toContain('complete');
      expect(INITIATIVE_STATUSES).toContain('cancelled');
      expect(INITIATIVE_STATUSES).toHaveLength(6);
    });

    it('exports all phase statuses', () => {
      expect(PHASE_STATUSES).toContain('pending');
      expect(PHASE_STATUSES).toContain('in_progress');
      expect(PHASE_STATUSES).toContain('complete');
      expect(PHASE_STATUSES).toContain('blocked');
      expect(PHASE_STATUSES).toHaveLength(4);
    });
  });
});

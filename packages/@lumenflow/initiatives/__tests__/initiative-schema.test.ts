/**
 * Initiative Schema Tests (WU-1246)
 *
 * TDD: Tests written first, implementation follows.
 *
 * @see {@link tools/lib/initiative-schema.mjs} - Implementation
 */

import { describe, it, expect } from 'vitest';
import {
  InitiativeSchema,
  InitiativePhaseSchema,
  validateInitiative,
} from '../src/initiative-schema.js';

describe('initiative-schema', () => {
  describe('InitiativePhaseSchema', () => {
    it('should validate a valid phase', () => {
      const phase = {
        id: 1,
        title: 'Foundation',
        status: 'pending',
      };
      const result = InitiativePhaseSchema.safeParse(phase);
      expect(result.success).toBe(true);
    });

    it('should accept phase id 0 for foundation phases (WU-2567)', () => {
      const phase = {
        id: 0,
        title: 'Foundation Bootstrap',
        status: 'pending',
      };
      const result = InitiativePhaseSchema.safeParse(phase);
      expect(result.success).toBe(true);
    });

    it('should reject negative phase id', () => {
      const phase = {
        id: -1,
        title: 'Invalid',
        status: 'pending',
      };
      const result = InitiativePhaseSchema.safeParse(phase);
      expect(result.success).toBe(false);
    });

    it('should reject non-integer phase id', () => {
      const phase = {
        id: 1.5,
        title: 'Invalid',
        status: 'pending',
      };
      const result = InitiativePhaseSchema.safeParse(phase);
      expect(result.success).toBe(false);
    });

    it('should reject invalid status enum', () => {
      const phase = {
        id: 1,
        title: 'Invalid',
        status: 'invalid_status',
      };
      const result = InitiativePhaseSchema.safeParse(phase);
      expect(result.success).toBe(false);
    });

    it('should accept all valid status values', () => {
      const statuses = ['pending', 'in_progress', 'done', 'blocked'];
      for (const status of statuses) {
        const phase = { id: 1, title: 'Test', status };
        const result = InitiativePhaseSchema.safeParse(phase);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('InitiativeSchema', () => {
    const validInitiative = {
      id: 'INIT-001',
      slug: 'shock-protocol',
      title: 'Shock Protocol Implementation',
      status: 'open',
      created: '2025-11-26',
    };

    it('should validate a minimal valid initiative', () => {
      const result = InitiativeSchema.safeParse(validInitiative);
      expect(result.success).toBe(true);
    });

    it('should validate a complete initiative with all fields', () => {
      const complete = {
        ...validInitiative,
        description: 'Full description of the initiative',
        priority: 'P0',
        owner: 'intelligence-team',
        target_date: '2025-12-15',
        phases: [
          { id: 1, title: 'Foundation', status: 'done' },
          { id: 2, title: 'Integration', status: 'in_progress' },
        ],
        success_metrics: ['Zero regex', 'Witness-only on shock_turn1'],
        labels: ['safety', 'llm', 'p0-critical'],
      };
      const result = InitiativeSchema.safeParse(complete);
      expect(result.success).toBe(true);
    });

    describe('id validation', () => {
      it('should reject invalid id format (not INIT-NNN)', () => {
        const invalid = { ...validInitiative, id: 'EPIC-001' };
        const result = InitiativeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should reject id with empty suffix', () => {
        const invalid = { ...validInitiative, id: 'INIT-' };
        const result = InitiativeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should accept multi-digit ids', () => {
        const valid = { ...validInitiative, id: 'INIT-999' };
        const result = InitiativeSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should accept named initiative ids (INIT-NAME format)', () => {
        const namedIds = ['INIT-INPATIENT-SAFETY', 'INIT-UI', 'INIT-A1', 'INIT-ABC-DEF-123'];
        for (const id of namedIds) {
          const valid = { ...validInitiative, id };
          const result = InitiativeSchema.safeParse(valid);
          expect(result.success).toBe(true);
        }
      });

      it('should reject lowercase named ids', () => {
        const invalid = { ...validInitiative, id: 'INIT-inpatient-safety' };
        const result = InitiativeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });
    });

    describe('slug validation', () => {
      it('should reject non-kebab-case slug', () => {
        const invalid = { ...validInitiative, slug: 'ShockProtocol' };
        const result = InitiativeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should reject slug with spaces', () => {
        const invalid = { ...validInitiative, slug: 'shock protocol' };
        const result = InitiativeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should reject slug with underscores', () => {
        const invalid = { ...validInitiative, slug: 'shock_protocol' };
        const result = InitiativeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should accept valid kebab-case slugs', () => {
        const slugs = ['shock-protocol', 'web-search-v2', 'single', 'a-b-c-d'];
        for (const slug of slugs) {
          const valid = { ...validInitiative, slug };
          const result = InitiativeSchema.safeParse(valid);
          expect(result.success).toBe(true);
        }
      });
    });

    describe('status validation', () => {
      it('should reject invalid status enum', () => {
        const invalid = { ...validInitiative, status: 'invalid' };
        const result = InitiativeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should accept all valid status values', () => {
        const statuses = ['draft', 'open', 'in_progress', 'done', 'archived'];
        for (const status of statuses) {
          const valid = { ...validInitiative, status };
          const result = InitiativeSchema.safeParse(valid);
          expect(result.success).toBe(true);
        }
      });
    });

    describe('priority validation', () => {
      it('should accept all valid priority values', () => {
        const priorities = ['P0', 'P1', 'P2', 'P3'];
        for (const priority of priorities) {
          const valid = { ...validInitiative, priority };
          const result = InitiativeSchema.safeParse(valid);
          expect(result.success).toBe(true);
        }
      });

      it('should reject invalid priority', () => {
        const invalid = { ...validInitiative, priority: 'P4' };
        const result = InitiativeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should allow missing priority (optional)', () => {
        const { priority: _unused, ...withoutPriority } = validInitiative;
        void _unused; // Silence unused variable warning
        const result = InitiativeSchema.safeParse(withoutPriority);
        expect(result.success).toBe(true);
      });
    });

    describe('date validation', () => {
      it('should reject invalid created date format', () => {
        const invalid = { ...validInitiative, created: '2025/11/26' };
        const result = InitiativeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should reject invalid target_date format', () => {
        const invalid = { ...validInitiative, target_date: 'Dec 15 2025' };
        const result = InitiativeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should allow missing target_date (optional)', () => {
        const result = InitiativeSchema.safeParse(validInitiative);
        expect(result.success).toBe(true);
      });
    });

    describe('phases validation', () => {
      it('should validate initiative with phases array', () => {
        const withPhases = {
          ...validInitiative,
          phases: [
            { id: 1, title: 'Phase 1', status: 'done' },
            { id: 2, title: 'Phase 2', status: 'pending' },
          ],
        };
        const result = InitiativeSchema.safeParse(withPhases);
        expect(result.success).toBe(true);
      });

      it('should reject invalid phase in array', () => {
        const invalid = {
          ...validInitiative,
          phases: [{ id: 'not-a-number', title: 'Invalid', status: 'pending' }],
        };
        const result = InitiativeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should allow empty phases array', () => {
        const withEmptyPhases = { ...validInitiative, phases: [] };
        const result = InitiativeSchema.safeParse(withEmptyPhases);
        expect(result.success).toBe(true);
      });
    });

    describe('optional fields', () => {
      it('should allow missing description', () => {
        const result = InitiativeSchema.safeParse(validInitiative);
        expect(result.success).toBe(true);
      });

      it('should allow missing owner', () => {
        const result = InitiativeSchema.safeParse(validInitiative);
        expect(result.success).toBe(true);
      });

      it('should allow missing success_metrics', () => {
        const result = InitiativeSchema.safeParse(validInitiative);
        expect(result.success).toBe(true);
      });

      it('should allow missing labels', () => {
        const result = InitiativeSchema.safeParse(validInitiative);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('validateInitiative', () => {
    it('should return success for valid initiative', () => {
      const valid = {
        id: 'INIT-001',
        slug: 'test-initiative',
        title: 'Test Initiative',
        status: 'open',
        created: '2025-11-26',
      };
      const result = validateInitiative(valid);
      expect(result.success).toBe(true);
    });

    it('should return error for invalid initiative', () => {
      const invalid = {
        id: 'INVALID',
        slug: 'Invalid Slug',
        title: '',
        status: 'invalid',
        created: 'not-a-date',
      };
      const result = validateInitiative(invalid);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error.issues.length).toBeGreaterThan(0);
    });
  });
});

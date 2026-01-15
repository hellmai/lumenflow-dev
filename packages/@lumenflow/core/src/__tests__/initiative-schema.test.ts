/**
 * Initiative Schema Tests (WU-1246)
 *
 * TDD: Tests written first, implementation follows.
 *
 * @see {@link tools/lib/initiative-schema.mjs} - Implementation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  InitiativeSchema,
  InitiativePhaseSchema,
  validateInitiative,
} from '../initiative-schema.mjs';

describe('initiative-schema', () => {
  describe('InitiativePhaseSchema', () => {
    it('should validate a valid phase', () => {
      const phase = {
        id: 1,
        title: 'Foundation',
        status: 'pending',
      };
      const result = InitiativePhaseSchema.safeParse(phase);
      assert.ok(result.success, 'Valid phase should parse');
    });

    it('should accept phase id 0 for foundation phases (WU-2567)', () => {
      const phase = {
        id: 0,
        title: 'Foundation Bootstrap',
        status: 'pending',
      };
      const result = InitiativePhaseSchema.safeParse(phase);
      assert.ok(result.success, 'Phase id 0 should be valid for foundation phases');
    });

    it('should reject negative phase id', () => {
      const phase = {
        id: -1,
        title: 'Invalid',
        status: 'pending',
      };
      const result = InitiativePhaseSchema.safeParse(phase);
      assert.ok(!result.success, 'Negative phase id must be rejected');
    });

    it('should reject non-integer phase id', () => {
      const phase = {
        id: 1.5,
        title: 'Invalid',
        status: 'pending',
      };
      const result = InitiativePhaseSchema.safeParse(phase);
      assert.ok(!result.success, 'Phase id must be integer');
    });

    it('should reject invalid status enum', () => {
      const phase = {
        id: 1,
        title: 'Invalid',
        status: 'invalid_status',
      };
      const result = InitiativePhaseSchema.safeParse(phase);
      assert.ok(!result.success, 'Invalid status should fail');
    });

    it('should accept all valid status values', () => {
      const statuses = ['pending', 'in_progress', 'done', 'blocked'];
      for (const status of statuses) {
        const phase = { id: 1, title: 'Test', status };
        const result = InitiativePhaseSchema.safeParse(phase);
        assert.ok(result.success, `Status '${status}' should be valid`);
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
      assert.ok(result.success, 'Valid initiative should parse');
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
        labels: ['safety', 'beacon', 'p0-critical'],
      };
      const result = InitiativeSchema.safeParse(complete);
      assert.ok(result.success, 'Complete initiative should parse');
    });

    describe('id validation', () => {
      it('should reject invalid id format (not INIT-NNN)', () => {
        const invalid = { ...validInitiative, id: 'EPIC-001' };
        const result = InitiativeSchema.safeParse(invalid);
        assert.ok(!result.success, 'Invalid id format should fail');
      });

      it('should reject id with empty suffix', () => {
        const invalid = { ...validInitiative, id: 'INIT-' };
        const result = InitiativeSchema.safeParse(invalid);
        assert.ok(!result.success, 'Id with empty suffix should fail');
      });

      it('should accept multi-digit ids', () => {
        const valid = { ...validInitiative, id: 'INIT-999' };
        const result = InitiativeSchema.safeParse(valid);
        assert.ok(result.success, 'Multi-digit id should be valid');
      });

      it('should accept named initiative ids (INIT-NAME format)', () => {
        const namedIds = ['INIT-INPATIENT-SAFETY', 'INIT-UI', 'INIT-A1', 'INIT-ABC-DEF-123'];
        for (const id of namedIds) {
          const valid = { ...validInitiative, id };
          const result = InitiativeSchema.safeParse(valid);
          assert.ok(result.success, `Named id '${id}' should be valid`);
        }
      });

      it('should reject lowercase named ids', () => {
        const invalid = { ...validInitiative, id: 'INIT-inpatient-safety' };
        const result = InitiativeSchema.safeParse(invalid);
        assert.ok(!result.success, 'Lowercase named id should fail');
      });
    });

    describe('slug validation', () => {
      it('should reject non-kebab-case slug', () => {
        const invalid = { ...validInitiative, slug: 'ShockProtocol' };
        const result = InitiativeSchema.safeParse(invalid);
        assert.ok(!result.success, 'Non-kebab-case slug should fail');
      });

      it('should reject slug with spaces', () => {
        const invalid = { ...validInitiative, slug: 'shock protocol' };
        const result = InitiativeSchema.safeParse(invalid);
        assert.ok(!result.success, 'Slug with spaces should fail');
      });

      it('should reject slug with underscores', () => {
        const invalid = { ...validInitiative, slug: 'shock_protocol' };
        const result = InitiativeSchema.safeParse(invalid);
        assert.ok(!result.success, 'Slug with underscores should fail');
      });

      it('should accept valid kebab-case slugs', () => {
        const slugs = ['shock-protocol', 'web-search-v2', 'single', 'a-b-c-d'];
        for (const slug of slugs) {
          const valid = { ...validInitiative, slug };
          const result = InitiativeSchema.safeParse(valid);
          assert.ok(result.success, `Slug '${slug}' should be valid`);
        }
      });
    });

    describe('status validation', () => {
      it('should reject invalid status enum', () => {
        const invalid = { ...validInitiative, status: 'invalid' };
        const result = InitiativeSchema.safeParse(invalid);
        assert.ok(!result.success, 'Invalid status should fail');
      });

      it('should accept all valid status values', () => {
        const statuses = ['draft', 'open', 'in_progress', 'done', 'archived'];
        for (const status of statuses) {
          const valid = { ...validInitiative, status };
          const result = InitiativeSchema.safeParse(valid);
          assert.ok(result.success, `Status '${status}' should be valid`);
        }
      });
    });

    describe('priority validation', () => {
      it('should accept all valid priority values', () => {
        const priorities = ['P0', 'P1', 'P2', 'P3'];
        for (const priority of priorities) {
          const valid = { ...validInitiative, priority };
          const result = InitiativeSchema.safeParse(valid);
          assert.ok(result.success, `Priority '${priority}' should be valid`);
        }
      });

      it('should reject invalid priority', () => {
        const invalid = { ...validInitiative, priority: 'P4' };
        const result = InitiativeSchema.safeParse(invalid);
        assert.ok(!result.success, 'Invalid priority should fail');
      });

      it('should allow missing priority (optional)', () => {
        const { priority: _unused, ...withoutPriority } = validInitiative;
        void _unused; // Silence unused variable warning
        const result = InitiativeSchema.safeParse(withoutPriority);
        assert.ok(result.success, 'Missing priority should be valid');
      });
    });

    describe('date validation', () => {
      it('should reject invalid created date format', () => {
        const invalid = { ...validInitiative, created: '2025/11/26' };
        const result = InitiativeSchema.safeParse(invalid);
        assert.ok(!result.success, 'Invalid date format should fail');
      });

      it('should reject invalid target_date format', () => {
        const invalid = { ...validInitiative, target_date: 'Dec 15 2025' };
        const result = InitiativeSchema.safeParse(invalid);
        assert.ok(!result.success, 'Invalid target_date format should fail');
      });

      it('should allow missing target_date (optional)', () => {
        const result = InitiativeSchema.safeParse(validInitiative);
        assert.ok(result.success, 'Missing target_date should be valid');
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
        assert.ok(result.success, 'Initiative with phases should parse');
      });

      it('should reject invalid phase in array', () => {
        const invalid = {
          ...validInitiative,
          phases: [{ id: 'not-a-number', title: 'Invalid', status: 'pending' }],
        };
        const result = InitiativeSchema.safeParse(invalid);
        assert.ok(!result.success, 'Invalid phase should fail');
      });

      it('should allow empty phases array', () => {
        const withEmptyPhases = { ...validInitiative, phases: [] };
        const result = InitiativeSchema.safeParse(withEmptyPhases);
        assert.ok(result.success, 'Empty phases array should be valid');
      });
    });

    describe('optional fields', () => {
      it('should allow missing description', () => {
        const result = InitiativeSchema.safeParse(validInitiative);
        assert.ok(result.success, 'Missing description should be valid');
      });

      it('should allow missing owner', () => {
        const result = InitiativeSchema.safeParse(validInitiative);
        assert.ok(result.success, 'Missing owner should be valid');
      });

      it('should allow missing success_metrics', () => {
        const result = InitiativeSchema.safeParse(validInitiative);
        assert.ok(result.success, 'Missing success_metrics should be valid');
      });

      it('should allow missing labels', () => {
        const result = InitiativeSchema.safeParse(validInitiative);
        assert.ok(result.success, 'Missing labels should be valid');
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
      assert.ok(result.success, 'Valid initiative should pass');
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
      assert.ok(!result.success, 'Invalid initiative should fail');
      assert.ok(result.error, 'Should have error object');
      assert.ok(result.error.issues.length > 0, 'Should have validation issues');
    });
  });
});

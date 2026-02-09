/**
 * Initiative Completeness Validation Tests (WU-1211)
 *
 * TDD: Tests written first, implementation follows.
 * Tests for:
 * - initiative:create warning when description not provided
 * - wu:create warning when initiative has no phases
 * - Initiative status auto-progression (draft -> in_progress)
 * - state:doctor incomplete initiative detection
 */

import { describe, it, expect } from 'vitest';
import {
  validateInitiativeCompleteness,
  checkInitiativePhases,
  shouldProgressInitiativeStatus,
  findIncompleteInitiatives,
} from '../src/initiative-validation.js';
import {
  PROTECTED_WU_STATUSES,
  PROGRESSABLE_WU_STATUSES,
  WU_STATUS,
} from '@lumenflow/core/dist/wu-constants.js';

// Constants for repeated test values
const TEST_INIT_ID = 'INIT-001';
const TEST_INIT_ID_2 = 'INIT-002';
const TEST_SLUG = 'test-initiative';
const TEST_TITLE = 'Test Initiative';
const TEST_CREATED = '2026-01-29';
const TEST_COMPLETE_DESC = 'A complete description';
const TEST_WU_ID = 'WU-001';
const TEST_WU_ID_2 = 'WU-002';

describe('initiative-validation', () => {
  describe('validateInitiativeCompleteness', () => {
    it('should return valid for complete initiative', () => {
      const initiative = {
        id: TEST_INIT_ID,
        slug: TEST_SLUG,
        title: TEST_TITLE,
        description: 'A complete description of the initiative',
        status: 'draft',
        created: TEST_CREATED,
        phases: [{ id: 1, title: 'Phase 1', status: 'pending' }],
        success_metrics: ['Metric 1'],
      };
      const result = validateInitiativeCompleteness(initiative);
      expect(result.valid).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it('should warn when description is empty', () => {
      const initiative = {
        id: TEST_INIT_ID,
        slug: TEST_SLUG,
        title: TEST_TITLE,
        description: '',
        status: 'draft',
        created: TEST_CREATED,
        phases: [{ id: 1, title: 'Phase 1', status: 'pending' }],
      };
      const result = validateInitiativeCompleteness(initiative);
      expect(result.valid).toBe(true); // Still valid, just warning
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('description'))).toBe(true);
    });

    it('should warn when description is not provided', () => {
      const initiative = {
        id: TEST_INIT_ID,
        slug: TEST_SLUG,
        title: TEST_TITLE,
        status: 'draft',
        created: TEST_CREATED,
        phases: [{ id: 1, title: 'Phase 1', status: 'pending' }],
      };
      const result = validateInitiativeCompleteness(initiative);
      expect(result.warnings.some((w) => w.includes('description'))).toBe(true);
    });

    it('should warn when phases array is empty', () => {
      const initiative = {
        id: TEST_INIT_ID,
        slug: TEST_SLUG,
        title: TEST_TITLE,
        description: TEST_COMPLETE_DESC,
        status: 'draft',
        created: TEST_CREATED,
        phases: [],
      };
      const result = validateInitiativeCompleteness(initiative);
      expect(result.warnings.some((w) => w.includes('phases'))).toBe(true);
    });

    it('should warn when phases is not provided', () => {
      const initiative = {
        id: TEST_INIT_ID,
        slug: TEST_SLUG,
        title: TEST_TITLE,
        description: TEST_COMPLETE_DESC,
        status: 'draft',
        created: TEST_CREATED,
      };
      const result = validateInitiativeCompleteness(initiative);
      expect(result.warnings.some((w) => w.includes('phases'))).toBe(true);
    });

    it('should warn when success_metrics is empty', () => {
      const initiative = {
        id: TEST_INIT_ID,
        slug: TEST_SLUG,
        title: TEST_TITLE,
        description: TEST_COMPLETE_DESC,
        status: 'draft',
        created: TEST_CREATED,
        phases: [{ id: 1, title: 'Phase 1', status: 'pending' }],
        success_metrics: [],
      };
      const result = validateInitiativeCompleteness(initiative);
      expect(result.warnings.some((w) => w.includes('success_metrics'))).toBe(true);
    });

    it('should collect multiple warnings', () => {
      const initiative = {
        id: TEST_INIT_ID,
        slug: TEST_SLUG,
        title: TEST_TITLE,
        status: 'draft',
        created: TEST_CREATED,
        // Missing description, phases, and success_metrics
      };
      const result = validateInitiativeCompleteness(initiative);
      expect(result.warnings.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('checkInitiativePhases', () => {
    it('should return valid when initiative has phases', () => {
      const initiative = {
        id: TEST_INIT_ID,
        phases: [
          { id: 1, title: 'Phase 1', status: 'pending' },
          { id: 2, title: 'Phase 2', status: 'pending' },
        ],
      };
      const result = checkInitiativePhases(initiative);
      expect(result.hasPhases).toBe(true);
      expect(result.warning).toBeNull();
    });

    it('should return warning when initiative has no phases', () => {
      const initiative = {
        id: TEST_INIT_ID,
        phases: [],
      };
      const result = checkInitiativePhases(initiative);
      expect(result.hasPhases).toBe(false);
      expect(result.warning).not.toBeNull();
      expect(result.warning).toContain(TEST_INIT_ID);
    });

    it('should return warning when phases is undefined', () => {
      const initiative = {
        id: TEST_INIT_ID,
      };
      const result = checkInitiativePhases(initiative);
      expect(result.hasPhases).toBe(false);
      expect(result.warning).not.toBeNull();
    });

    it('should return null initiative ID in warning when ID is missing', () => {
      const initiative = {};
      const result = checkInitiativePhases(initiative);
      expect(result.hasPhases).toBe(false);
      expect(result.warning).not.toBeNull();
    });
  });

  describe('shouldProgressInitiativeStatus', () => {
    it('should return true when draft initiative has first WU claimed', () => {
      const initiative = {
        id: TEST_INIT_ID,
        status: 'draft',
      };
      const wus = [{ id: TEST_WU_ID, status: 'in_progress', initiative: TEST_INIT_ID }];
      const result = shouldProgressInitiativeStatus(initiative, wus);
      expect(result.shouldProgress).toBe(true);
      expect(result.newStatus).toBe('in_progress');
    });

    it('should return false when initiative is already in_progress', () => {
      const initiative = {
        id: TEST_INIT_ID,
        status: 'in_progress',
      };
      const wus = [{ id: TEST_WU_ID, status: 'in_progress', initiative: TEST_INIT_ID }];
      const result = shouldProgressInitiativeStatus(initiative, wus);
      expect(result.shouldProgress).toBe(false);
    });

    it('should return false when no WUs are in_progress', () => {
      const initiative = {
        id: TEST_INIT_ID,
        status: 'draft',
      };
      const wus = [{ id: TEST_WU_ID, status: 'ready', initiative: TEST_INIT_ID }];
      const result = shouldProgressInitiativeStatus(initiative, wus);
      expect(result.shouldProgress).toBe(false);
    });

    it('should return false when initiative is done', () => {
      const initiative = {
        id: TEST_INIT_ID,
        status: 'done',
      };
      const wus = [{ id: TEST_WU_ID, status: 'in_progress', initiative: TEST_INIT_ID }];
      const result = shouldProgressInitiativeStatus(initiative, wus);
      expect(result.shouldProgress).toBe(false);
    });

    it('should return false when initiative is archived', () => {
      const initiative = {
        id: TEST_INIT_ID,
        status: 'archived',
      };
      const wus = [{ id: TEST_WU_ID, status: 'in_progress', initiative: TEST_INIT_ID }];
      const result = shouldProgressInitiativeStatus(initiative, wus);
      expect(result.shouldProgress).toBe(false);
    });

    it('should only count WUs belonging to this initiative', () => {
      const initiative = {
        id: TEST_INIT_ID,
        status: 'draft',
      };
      const wus = [
        { id: TEST_WU_ID, status: 'in_progress', initiative: TEST_INIT_ID_2 }, // Different initiative
        { id: TEST_WU_ID_2, status: 'ready', initiative: TEST_INIT_ID },
      ];
      const result = shouldProgressInitiativeStatus(initiative, wus);
      expect(result.shouldProgress).toBe(false);
    });

    it('should progress from open to in_progress when first WU claimed', () => {
      const initiative = {
        id: TEST_INIT_ID,
        status: 'open',
      };
      const wus = [{ id: TEST_WU_ID, status: 'in_progress', initiative: TEST_INIT_ID }];
      const result = shouldProgressInitiativeStatus(initiative, wus);
      expect(result.shouldProgress).toBe(true);
      expect(result.newStatus).toBe('in_progress');
    });
  });

  describe('findIncompleteInitiatives', () => {
    it('should return empty array when all initiatives are complete', () => {
      const initiatives = [
        {
          id: TEST_INIT_ID,
          description: 'Complete description',
          phases: [{ id: 1, title: 'Phase 1' }],
          success_metrics: ['Metric 1'],
        },
        {
          id: TEST_INIT_ID_2,
          description: 'Another description',
          phases: [{ id: 1, title: 'Phase 1' }],
          success_metrics: ['Metric 2'],
        },
      ];
      const result = findIncompleteInitiatives(initiatives);
      expect(result).toEqual([]);
    });

    it('should return incomplete initiatives with their warnings', () => {
      const initiatives = [
        {
          id: TEST_INIT_ID,
          description: 'Complete description',
          phases: [{ id: 1, title: 'Phase 1' }],
          success_metrics: ['Metric 1'],
        },
        {
          id: TEST_INIT_ID_2,
          description: '', // Empty description
          phases: [], // No phases
          success_metrics: [],
        },
      ];
      const result = findIncompleteInitiatives(initiatives);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(TEST_INIT_ID_2);
      expect(result[0].warnings.length).toBeGreaterThan(0);
    });

    it('should handle multiple incomplete initiatives', () => {
      const initiatives = [
        {
          id: TEST_INIT_ID,
          description: '',
          phases: [],
        },
        {
          id: TEST_INIT_ID_2,
          // Missing all fields
        },
      ];
      const result = findIncompleteInitiatives(initiatives);
      expect(result.length).toBe(2);
      expect(result.map((r) => r.id)).toContain(TEST_INIT_ID);
      expect(result.map((r) => r.id)).toContain(TEST_INIT_ID_2);
    });

    it('should return empty array for empty input', () => {
      const result = findIncompleteInitiatives([]);
      expect(result).toEqual([]);
    });

    it('should include all warnings for each incomplete initiative', () => {
      const initiatives = [
        {
          id: TEST_INIT_ID,
          // Missing description, phases, and success_metrics
        },
      ];
      const result = findIncompleteInitiatives(initiatives);
      expect(result.length).toBe(1);
      expect(result[0].warnings.length).toBeGreaterThanOrEqual(2);
      expect(result[0].warnings.some((w) => w.includes('description'))).toBe(true);
      expect(result[0].warnings.some((w) => w.includes('phases'))).toBe(true);
    });
  });

  describe('WU-1540: PROTECTED_WU_STATUSES and PROGRESSABLE_WU_STATUSES constants', () => {
    it('PROTECTED_WU_STATUSES should include blocked status', () => {
      expect(PROTECTED_WU_STATUSES).toContain(WU_STATUS.BLOCKED);
    });

    it('PROTECTED_WU_STATUSES should include in_progress status', () => {
      expect(PROTECTED_WU_STATUSES).toContain(WU_STATUS.IN_PROGRESS);
    });

    it('PROGRESSABLE_WU_STATUSES should include in_progress status', () => {
      expect(PROGRESSABLE_WU_STATUSES).toContain(WU_STATUS.IN_PROGRESS);
    });

    it('PROGRESSABLE_WU_STATUSES should NOT include blocked status', () => {
      expect(PROGRESSABLE_WU_STATUSES).not.toContain(WU_STATUS.BLOCKED);
    });

    it('PROTECTED_WU_STATUSES and PROGRESSABLE_WU_STATUSES should be distinct arrays', () => {
      expect(PROTECTED_WU_STATUSES).not.toEqual(PROGRESSABLE_WU_STATUSES);
    });
  });

  describe('WU-1540: blocked WUs should not advance initiative status', () => {
    it('should NOT progress when only blocked WUs exist', () => {
      const initiative = {
        id: TEST_INIT_ID,
        status: 'draft',
      };
      const wus = [{ id: TEST_WU_ID, status: 'blocked', initiative: TEST_INIT_ID }];
      const result = shouldProgressInitiativeStatus(initiative, wus);
      expect(result.shouldProgress).toBe(false);
      expect(result.newStatus).toBeNull();
    });

    it('should progress when in_progress WUs exist alongside blocked WUs', () => {
      const initiative = {
        id: TEST_INIT_ID,
        status: 'draft',
      };
      const wus = [
        { id: TEST_WU_ID, status: 'blocked', initiative: TEST_INIT_ID },
        { id: TEST_WU_ID_2, status: 'in_progress', initiative: TEST_INIT_ID },
      ];
      const result = shouldProgressInitiativeStatus(initiative, wus);
      expect(result.shouldProgress).toBe(true);
      expect(result.newStatus).toBe('in_progress');
    });

    it('should NOT progress from open when all WUs are blocked', () => {
      const initiative = {
        id: TEST_INIT_ID,
        status: 'open',
      };
      const wus = [
        { id: TEST_WU_ID, status: 'blocked', initiative: TEST_INIT_ID },
        { id: TEST_WU_ID_2, status: 'blocked', initiative: TEST_INIT_ID },
      ];
      const result = shouldProgressInitiativeStatus(initiative, wus);
      expect(result.shouldProgress).toBe(false);
      expect(result.newStatus).toBeNull();
    });
  });
});

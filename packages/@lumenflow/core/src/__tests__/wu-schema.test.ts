/**
 * Tests for WU schema defaults and auto-repair transformations
 *
 * WU-1337: Add robust defaults and auto-repair in schema
 *
 * Tests validate:
 * - Default values for optional fields (priority, status, type)
 * - Auto-conversion of notes array to string
 * - Date normalization for completed_at and claimed_at
 * - Default test structure
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  WUSchema,
  validateWU,
  validateReadyWU,
  BaseWUSchema,
  ReadyWUSchema,
  PLACEHOLDER_SENTINEL,
} from '../wu-schema.js';

describe('wu-schema defaults', () => {
  describe('priority defaults', () => {
    it('should default missing priority to P2', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        status: 'ready',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
      };

      const result = validateWU(data);
      assert.ok(result.success, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
      expect(result.data.priority).toBe('P2');
    });

    it('should preserve explicit priority value', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        status: 'ready',
        priority: 'P1',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
      };

      const result = validateWU(data);
      expect(result.success).toBeTruthy();
      expect(result.data.priority).toBe('P1');
    });
  });

  describe('status defaults', () => {
    it('should default missing status to ready', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
      };

      const result = validateWU(data);
      assert.ok(result.success, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
      expect(result.data.status).toBe('ready');
    });

    it('should preserve explicit status value', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        status: 'in_progress',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
      };

      const result = validateWU(data);
      expect(result.success).toBeTruthy();
      expect(result.data.status).toBe('in_progress');
    });
  });

  describe('type defaults', () => {
    it('should default missing type to feature', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        status: 'ready',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
      };

      const result = validateWU(data);
      assert.ok(result.success, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
      expect(result.data.type).toBe('feature');
    });

    it('should preserve explicit type value', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'bug',
        status: 'ready',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
      };

      const result = validateWU(data);
      expect(result.success).toBeTruthy();
      expect(result.data.type).toBe('bug');
    });
  });

  describe('tests defaults', () => {
    it('should default missing tests to { manual: [] }', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        status: 'ready',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
      };

      const result = validateWU(data);
      assert.ok(result.success, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
      expect(result.data.tests).toEqual({ manual: [], unit: [], integration: [], e2e: [] });
    });

    it('should preserve explicit tests value', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        status: 'ready',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
        tests: {
          unit: ['tools/lib/__tests__/wu-schema.test.js'],
          manual: ['Run pnpm gates'],
        },
      };

      const result = validateWU(data);
      expect(result.success).toBeTruthy();
      assert.deepEqual(result.data.tests, {
        unit: ['tools/lib/__tests__/wu-schema.test.js'],
        manual: ['Run pnpm gates'],
      });
    });
  });

  describe('code_paths defaults', () => {
    it('should default missing code_paths to empty array', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        status: 'ready',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
      };

      const result = validateWU(data);
      assert.ok(result.success, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
      expect(result.data.code_paths).toEqual([]);
    });
  });

  describe('artifacts defaults', () => {
    it('should default missing artifacts to empty array', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        status: 'ready',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
      };

      const result = validateWU(data);
      assert.ok(result.success, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
      expect(result.data.artifacts).toEqual([]);
    });

    it('should preserve explicit artifacts value', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        status: 'ready',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
        artifacts: ['.beacon/stamps/WU-1337.done'],
      };

      const result = validateWU(data);
      expect(result.success).toBeTruthy();
      expect(result.data.artifacts).toEqual(['.beacon/stamps/WU-1337.done']);
    });
  });

  describe('dependencies defaults', () => {
    it('should default missing dependencies to empty array', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        status: 'ready',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
      };

      const result = validateWU(data);
      assert.ok(result.success, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
      expect(result.data.dependencies).toEqual([]);
    });
  });

  describe('risks defaults', () => {
    it('should default missing risks to empty array', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        status: 'ready',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
      };

      const result = validateWU(data);
      assert.ok(result.success, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
      expect(result.data.risks).toEqual([]);
    });
  });

  describe('notes defaults', () => {
    it('should default missing notes to empty string', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        status: 'ready',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
      };

      const result = validateWU(data);
      assert.ok(result.success, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
      expect(result.data.notes).toBe('');
    });
  });

  describe('requires_review defaults', () => {
    it('should default missing requires_review to false', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        status: 'ready',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
      };

      const result = validateWU(data);
      assert.ok(result.success, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
      expect(result.data.requires_review).toBe(false);
    });
  });
});

describe('wu-schema auto-repair transformations', () => {
  describe('notes array to string conversion', () => {
    it('should convert notes array to newline-joined string', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        status: 'ready',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
        notes: ['First note', 'Second note', 'Third note'],
      };

      const result = validateWU(data);
      assert.ok(result.success, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
      expect(result.data.notes).toBe('First note\nSecond note\nThird note');
    });

    it('should filter empty strings when converting notes array', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        status: 'ready',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
        notes: ['First note', '', 'Second note'],
      };

      const result = validateWU(data);
      assert.ok(result.success, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
      expect(result.data.notes).toBe('First note\nSecond note');
    });

    it('should preserve string notes as-is', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        status: 'ready',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
        notes: 'This is a single note',
      };

      const result = validateWU(data);
      expect(result.success).toBeTruthy();
      expect(result.data.notes).toBe('This is a single note');
    });
  });

  describe('completed_at date normalization', () => {
    it('should normalize ISO date to ISO datetime format', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        status: 'done',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
        completed_at: '2025-11-29',
      };

      const result = validateWU(data);
      assert.ok(result.success, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
      expect(result.data.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should preserve valid ISO datetime format', () => {
      const validDateTime = '2025-11-29T14:30:00.000Z';
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        status: 'done',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
        completed_at: validDateTime,
      };

      const result = validateWU(data);
      expect(result.success).toBeTruthy();
      expect(result.data.completed_at).toBe(validDateTime);
    });

    it('should handle Unix timestamp format', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        status: 'done',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
        completed_at: '1732896000000', // Unix timestamp in ms
      };

      const result = validateWU(data);
      assert.ok(result.success, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
      expect(result.data.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should return undefined for missing completed_at', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        status: 'ready',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
      };

      const result = validateWU(data);
      expect(result.success).toBeTruthy();
      expect(result.data.completed_at).toBe(undefined);
    });
  });

  describe('claimed_at date normalization', () => {
    it('should normalize ISO date to ISO datetime format', () => {
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        status: 'in_progress',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
        claimed_at: '2025-11-29',
      };

      const result = validateWU(data);
      assert.ok(result.success, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
      expect(result.data.claimed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should preserve valid ISO datetime format', () => {
      const validDateTime = '2025-11-29T14:30:00.000Z';
      const data = {
        id: 'WU-1337',
        title: 'Test WU',
        lane: 'Operations',
        type: 'feature',
        status: 'in_progress',
        priority: 'P2',
        created: '2025-11-29',
        description: 'A valid description that is at least fifty characters long for validation',
        acceptance: ['Criterion 1'],
        code_paths: [],
        claimed_at: validDateTime,
      };

      const result = validateWU(data);
      expect(result.success).toBeTruthy();
      expect(result.data.claimed_at).toBe(validDateTime);
    });
  });
});

// =============================================================================
// WU-1539: validateReadyWU() tests (BaseWUSchema / structural validation)
// =============================================================================

describe('validateReadyWU (WU-1539)', () => {
  /** Helper to create valid base WU data */
  const createValidWU = (overrides = {}) => ({
    id: 'WU-1539',
    title: 'Test WU for validation',
    lane: 'Operations: Tooling',
    type: 'tooling',
    status: 'ready',
    priority: 'P1',
    created: '2025-12-10',
    description:
      'A valid description that is at least fifty characters long for validation purposes.',
    acceptance: ['Criterion 1', 'Criterion 2'],
    code_paths: ['tools/lib/wu-schema.js'],
    ...overrides,
  });

  describe('placeholder acceptance', () => {
    it('should accept description with PLACEHOLDER_SENTINEL marker', () => {
      const data = createValidWU({
        description: `${PLACEHOLDER_SENTINEL} This is placeholder content that is long enough to pass.`,
      });

      const result = validateReadyWU(data);
      assert.ok(result.success, `Validation should pass: ${JSON.stringify(result.error?.issues)}`);
    });

    it('should accept acceptance criteria with PLACEHOLDER_SENTINEL marker', () => {
      const data = createValidWU({
        acceptance: [`${PLACEHOLDER_SENTINEL} Define acceptance criteria`, 'Other criterion'],
      });

      const result = validateReadyWU(data);
      assert.ok(result.success, `Validation should pass: ${JSON.stringify(result.error?.issues)}`);
    });

    it('should accept nested acceptance object with PLACEHOLDER_SENTINEL marker', () => {
      const data = createValidWU({
        acceptance: {
          functional: [`${PLACEHOLDER_SENTINEL} Define functional criteria`],
          technical: ['Tech criterion'],
        },
      });

      const result = validateReadyWU(data);
      assert.ok(result.success, `Validation should pass: ${JSON.stringify(result.error?.issues)}`);
    });
  });

  describe('structural validation (rejects invalid structure)', () => {
    it('should reject invalid WU ID format', () => {
      const data = createValidWU({ id: 'INVALID-123' });

      const result = validateReadyWU(data);
      expect(result.success, 'Should fail validation').toBeFalsy();
      assert.ok(
        result.error.issues.some((i) => i.path.includes('id')),
        'Error should mention id field'
      );
    });

    it('should reject missing title', () => {
      const data = createValidWU({ title: '' });

      const result = validateReadyWU(data);
      expect(result.success, 'Should fail validation').toBeFalsy();
      assert.ok(
        result.error.issues.some((i) => i.path.includes('title')),
        'Error should mention title field'
      );
    });

    it('should reject invalid status value', () => {
      const data = createValidWU({ status: 'invalid_status' });

      const result = validateReadyWU(data);
      expect(result.success, 'Should fail validation').toBeFalsy();
      assert.ok(
        result.error.issues.some((i) => i.path.includes('status')),
        'Error should mention status field'
      );
    });

    it('should reject invalid type value', () => {
      const data = createValidWU({ type: 'invalid_type' });

      const result = validateReadyWU(data);
      expect(result.success, 'Should fail validation').toBeFalsy();
      assert.ok(
        result.error.issues.some((i) => i.path.includes('type')),
        'Error should mention type field'
      );
    });

    it('should reject invalid created date format', () => {
      const data = createValidWU({ created: '2025/12/10' }); // wrong format

      const result = validateReadyWU(data);
      expect(result.success, 'Should fail validation').toBeFalsy();
      assert.ok(
        result.error.issues.some((i) => i.path.includes('created')),
        'Error should mention created field'
      );
    });

    it('should reject description shorter than 50 characters', () => {
      const data = createValidWU({ description: 'Too short description.' });

      const result = validateReadyWU(data);
      expect(result.success, 'Should fail validation').toBeFalsy();
      assert.ok(
        result.error.issues.some(
          (i) => i.path.includes('description') && i.message.includes('50 characters')
        ),
        'Error should mention description length requirement'
      );
    });

    it('should reject empty acceptance array', () => {
      const data = createValidWU({ acceptance: [] });

      const result = validateReadyWU(data);
      expect(result.success, 'Should fail validation').toBeFalsy();
      assert.ok(
        result.error.issues.some((i) => i.path.includes('acceptance')),
        'Error should mention acceptance field'
      );
    });

    it('should reject acceptance as string instead of array', () => {
      const data = createValidWU({ acceptance: 'This should be an array' });

      const result = validateReadyWU(data);
      expect(result.success, 'Should fail validation').toBeFalsy();
    });

    it('should reject invalid blocks array format', () => {
      const data = createValidWU({ blocks: ['INVALID-FORMAT'] });

      const result = validateReadyWU(data);
      expect(result.success, 'Should fail validation').toBeFalsy();
      assert.ok(
        result.error.issues.some((i) => i.path.join('.').includes('blocks')),
        'Error should mention blocks field'
      );
    });

    it('should reject invalid tests structure (string instead of object)', () => {
      const data = createValidWU({ tests: 'should be an object' });

      const result = validateReadyWU(data);
      expect(result.success, 'Should fail validation').toBeFalsy();
    });
  });

  describe('validateWU strict mode (rejects placeholders)', () => {
    it('should reject description with PLACEHOLDER_SENTINEL marker', () => {
      const data = createValidWU({
        description: `${PLACEHOLDER_SENTINEL} This is placeholder content that is long enough to pass.`,
      });

      const result = validateWU(data);
      expect(result.success, 'Strict validation should fail for placeholders').toBeFalsy();
      assert.ok(
        result.error.issues.some(
          (i) => i.path.includes('description') && i.message.includes(PLACEHOLDER_SENTINEL)
        ),
        'Error should mention placeholder marker'
      );
    });

    it('should reject acceptance criteria with PLACEHOLDER_SENTINEL marker', () => {
      const data = createValidWU({
        acceptance: [`${PLACEHOLDER_SENTINEL} Define criteria`, 'Valid criterion'],
      });

      const result = validateWU(data);
      expect(result.success, 'Strict validation should fail for placeholders').toBeFalsy();
      assert.ok(
        result.error.issues.some((i) => i.message.includes(PLACEHOLDER_SENTINEL)),
        'Error should mention placeholder marker'
      );
    });
  });

  describe('schema exports', () => {
    it('should export BaseWUSchema', () => {
      assert.ok(BaseWUSchema, 'BaseWUSchema should be exported');
      assert.ok(typeof BaseWUSchema.safeParse === 'function', 'Should be a Zod schema');
    });

    it('should export ReadyWUSchema as alias for BaseWUSchema', () => {
      assert.ok(ReadyWUSchema, 'ReadyWUSchema should be exported');
      assert.strictEqual(
        ReadyWUSchema,
        BaseWUSchema,
        'ReadyWUSchema should be alias for BaseWUSchema'
      );
    });

    it('should export WUSchema (strict)', () => {
      assert.ok(WUSchema, 'WUSchema should be exported');
      assert.ok(typeof WUSchema.safeParse === 'function', 'Should be a Zod schema');
    });
  });
});

// =============================================================================
// WU-1998: Exposure Field Schema Validation
// =============================================================================

describe('wu-schema exposure field (WU-1998)', () => {
  /** Helper to create valid base WU data */
  const createValidWU = (overrides = {}) => ({
    id: 'WU-1998',
    title: 'Test WU with exposure field',
    lane: 'Operations: Tooling',
    type: 'feature',
    status: 'ready',
    priority: 'P1',
    created: '2025-12-25',
    description:
      'A valid description that is at least fifty characters long for validation purposes.',
    acceptance: ['Criterion 1', 'Criterion 2'],
    code_paths: ['tools/lib/wu-schema.js'],
    ...overrides,
  });

  describe('exposure field values', () => {
    it('should accept "ui" as valid exposure value', () => {
      const data = createValidWU({ exposure: 'ui' });
      const result = validateWU(data);
      assert.ok(result.success, `Validation should pass: ${JSON.stringify(result.error?.issues)}`);
      expect(result.data.exposure).toBe('ui');
    });

    it('should accept "api" as valid exposure value', () => {
      const data = createValidWU({ exposure: 'api' });
      const result = validateWU(data);
      assert.ok(result.success, `Validation should pass: ${JSON.stringify(result.error?.issues)}`);
      expect(result.data.exposure).toBe('api');
    });

    it('should accept "backend-only" as valid exposure value', () => {
      const data = createValidWU({ exposure: 'backend-only' });
      const result = validateWU(data);
      assert.ok(result.success, `Validation should pass: ${JSON.stringify(result.error?.issues)}`);
      expect(result.data.exposure).toBe('backend-only');
    });

    it('should accept "documentation" as valid exposure value', () => {
      const data = createValidWU({ exposure: 'documentation' });
      const result = validateWU(data);
      assert.ok(result.success, `Validation should pass: ${JSON.stringify(result.error?.issues)}`);
      expect(result.data.exposure).toBe('documentation');
    });

    it('should reject invalid exposure values', () => {
      const data = createValidWU({ exposure: 'invalid-value' });
      const result = validateWU(data);
      expect(result.success, 'Validation should fail for invalid exposure').toBeFalsy();
      assert.ok(
        result.error.issues.some((i) => i.path.includes('exposure')),
        'Error should mention exposure field'
      );
    });

    it('should allow missing exposure during transition period (optional)', () => {
      const data = createValidWU();
      // exposure is not set
      const result = validateWU(data);
      assert.ok(
        result.success,
        `Missing exposure should be valid during transition: ${JSON.stringify(result.error?.issues)}`
      );
    });
  });

  describe('user_journey field', () => {
    it('should accept user_journey as a string', () => {
      const data = createValidWU({
        exposure: 'ui',
        user_journey: 'User clicks button to submit the form and sees confirmation',
      });
      const result = validateWU(data);
      assert.ok(result.success, `Validation should pass: ${JSON.stringify(result.error?.issues)}`);
      assert.equal(
        result.data.user_journey,
        'User clicks button to submit the form and sees confirmation'
      );
    });

    it('should allow missing user_journey (optional)', () => {
      const data = createValidWU({ exposure: 'ui' });
      const result = validateWU(data);
      assert.ok(result.success, 'Missing user_journey should be valid');
    });
  });

  describe('ui_pairing_wus field', () => {
    it('should accept ui_pairing_wus as array of WU IDs', () => {
      const data = createValidWU({
        exposure: 'api',
        ui_pairing_wus: ['WU-1234', 'WU-5678'],
      });
      const result = validateWU(data);
      assert.ok(result.success, `Validation should pass: ${JSON.stringify(result.error?.issues)}`);
      expect(result.data.ui_pairing_wus).toEqual(['WU-1234', 'WU-5678']);
    });

    it('should allow empty ui_pairing_wus array', () => {
      const data = createValidWU({
        exposure: 'api',
        ui_pairing_wus: [],
      });
      const result = validateWU(data);
      assert.ok(result.success, 'Empty ui_pairing_wus should be valid');
    });

    it('should allow missing ui_pairing_wus (optional)', () => {
      const data = createValidWU({ exposure: 'api' });
      const result = validateWU(data);
      assert.ok(result.success, 'Missing ui_pairing_wus should be valid');
    });

    it('should reject ui_pairing_wus with invalid WU ID format', () => {
      const data = createValidWU({
        exposure: 'api',
        ui_pairing_wus: ['INVALID-123'],
      });
      const result = validateWU(data);
      expect(result.success, 'Invalid WU ID format should fail').toBeFalsy();
      assert.ok(
        result.error.issues.some((i) => i.path.join('.').includes('ui_pairing_wus')),
        'Error should mention ui_pairing_wus field'
      );
    });
  });

  describe('navigation_path field (WU-2022)', () => {
    it('should accept navigation_path for UI exposure', () => {
      const data = createValidWU({
        exposure: 'ui',
        navigation_path: '/dashboard',
      });
      const result = validateWU(data);
      assert.ok(result.success, `Should accept navigation_path: ${JSON.stringify(result.error?.issues)}`);
      expect(result.data.navigation_path).toBe('/dashboard');
    });

    it('should allow missing navigation_path (optional)', () => {
      const data = createValidWU({ exposure: 'ui' });
      const result = validateWU(data);
      assert.ok(result.success, 'Missing navigation_path should be valid');
    });

    it('should accept various route formats', () => {
      const routes = ['/settings', '/space/qpl', '/w/123', '/auth/callback'];
      for (const route of routes) {
        const data = createValidWU({
          exposure: 'ui',
          navigation_path: route,
        });
        const result = validateWU(data);
        assert.ok(result.success, `Should accept route: ${route}`);
      }
    });
  });
});

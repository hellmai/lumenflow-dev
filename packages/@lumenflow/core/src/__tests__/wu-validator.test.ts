/**
 * WU-1025: Tests for wu-validator placeholder detection
 *
 * Tests validate:
 * - validateNoPlaceholders detects [PLACEHOLDER] markers in description
 * - validateNoPlaceholders detects [PLACEHOLDER] markers in acceptance criteria
 * - validateNoPlaceholders handles nested acceptance object format
 * - buildPlaceholderErrorMessage generates actionable error messages
 */

import { describe, it, expect } from 'vitest';
import { validateNoPlaceholders, buildPlaceholderErrorMessage } from '../wu-validator.js';
import { PLACEHOLDER_SENTINEL } from '../wu-schema.js';

describe('validateNoPlaceholders (WU-1025)', () => {
  describe('description validation', () => {
    it('should pass when description has no placeholder', () => {
      const result = validateNoPlaceholders({
        description: 'This is a valid description that explains the work to be done.',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.fieldsWithPlaceholders).toHaveLength(0);
    });

    it('should fail when description contains PLACEHOLDER marker', () => {
      const result = validateNoPlaceholders({
        description: `${PLACEHOLDER_SENTINEL} Describe the work to be done.`,
      });

      expect(result.valid).toBe(false);
      expect(result.fieldsWithPlaceholders).toContain('description');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain(PLACEHOLDER_SENTINEL);
      expect(result.errors[0]).toContain('Description');
    });

    it('should fail when description contains placeholder mid-text', () => {
      const result = validateNoPlaceholders({
        description: `This WU will ${PLACEHOLDER_SENTINEL} implement feature X.`,
      });

      expect(result.valid).toBe(false);
      expect(result.fieldsWithPlaceholders).toContain('description');
    });

    it('should pass when description is undefined', () => {
      const result = validateNoPlaceholders({
        acceptance: ['Valid criterion'],
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('acceptance validation (array format)', () => {
    it('should pass when acceptance has no placeholders', () => {
      const result = validateNoPlaceholders({
        acceptance: ['Feature works as expected', 'Tests pass'],
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when acceptance contains PLACEHOLDER marker', () => {
      const result = validateNoPlaceholders({
        acceptance: [`${PLACEHOLDER_SENTINEL} Define acceptance criteria`, 'Tests pass'],
      });

      expect(result.valid).toBe(false);
      expect(result.fieldsWithPlaceholders).toContain('acceptance');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Acceptance criteria');
    });

    it('should fail when any acceptance item has placeholder', () => {
      const result = validateNoPlaceholders({
        acceptance: [
          'Valid criterion 1',
          'Valid criterion 2',
          `${PLACEHOLDER_SENTINEL} Still need to define this`,
        ],
      });

      expect(result.valid).toBe(false);
      expect(result.fieldsWithPlaceholders).toContain('acceptance');
    });

    it('should pass when acceptance is empty array', () => {
      const result = validateNoPlaceholders({
        acceptance: [],
      });

      expect(result.valid).toBe(true);
    });

    it('should pass when acceptance is undefined', () => {
      const result = validateNoPlaceholders({
        description: 'Valid description',
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('acceptance validation (nested object format)', () => {
    it('should pass when nested acceptance has no placeholders', () => {
      const result = validateNoPlaceholders({
        acceptance: {
          functional: ['User can login', 'User can logout'],
          technical: ['API returns 200', 'Latency < 100ms'],
        },
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when nested acceptance contains PLACEHOLDER marker', () => {
      const result = validateNoPlaceholders({
        acceptance: {
          functional: [`${PLACEHOLDER_SENTINEL} Define functional criteria`],
          technical: ['API returns 200'],
        },
      });

      expect(result.valid).toBe(false);
      expect(result.fieldsWithPlaceholders).toContain('acceptance');
    });

    it('should fail when any nested category has placeholder', () => {
      const result = validateNoPlaceholders({
        acceptance: {
          functional: ['User can login'],
          technical: [`${PLACEHOLDER_SENTINEL} Define tech requirements`],
        },
      });

      expect(result.valid).toBe(false);
      expect(result.fieldsWithPlaceholders).toContain('acceptance');
    });
  });

  describe('multiple field validation', () => {
    it('should report both description and acceptance when both have placeholders', () => {
      const result = validateNoPlaceholders({
        description: `${PLACEHOLDER_SENTINEL} Need to describe this`,
        acceptance: [`${PLACEHOLDER_SENTINEL} Define criteria`],
      });

      expect(result.valid).toBe(false);
      expect(result.fieldsWithPlaceholders).toContain('description');
      expect(result.fieldsWithPlaceholders).toContain('acceptance');
      expect(result.errors).toHaveLength(2);
    });

    it('should pass when neither field has placeholders', () => {
      const result = validateNoPlaceholders({
        description: 'Valid description explaining the work.',
        acceptance: ['Feature works', 'Tests pass'],
      });

      expect(result.valid).toBe(true);
      expect(result.fieldsWithPlaceholders).toHaveLength(0);
    });

    it('should fail when only description has placeholder', () => {
      const result = validateNoPlaceholders({
        description: `${PLACEHOLDER_SENTINEL} TBD`,
        acceptance: ['Valid criterion'],
      });

      expect(result.valid).toBe(false);
      expect(result.fieldsWithPlaceholders).toEqual(['description']);
    });

    it('should fail when only acceptance has placeholder', () => {
      const result = validateNoPlaceholders({
        description: 'Valid description',
        acceptance: [`${PLACEHOLDER_SENTINEL} TBD`],
      });

      expect(result.valid).toBe(false);
      expect(result.fieldsWithPlaceholders).toEqual(['acceptance']);
    });
  });
});

describe('buildPlaceholderErrorMessage (WU-1025)', () => {
  const createResult = (fields: string[]) => ({
    valid: false,
    errors: fields.map((f) => `${f} contains ${PLACEHOLDER_SENTINEL} marker.`),
    fieldsWithPlaceholders: fields,
  });

  describe('wu:create error messages', () => {
    it('should include "Cannot create WU" header', () => {
      const result = createResult(['description']);
      const message = buildPlaceholderErrorMessage('wu:create', result);

      expect(message).toContain('Cannot create WU');
      expect(message).toContain('placeholder markers');
    });

    it('should list fields with placeholders', () => {
      const result = createResult(['description', 'acceptance']);
      const message = buildPlaceholderErrorMessage('wu:create', result);

      expect(message).toContain('description');
      expect(message).toContain('acceptance');
    });

    it('should NOT include edit instructions for wu:create', () => {
      const result = createResult(['description']);
      const message = buildPlaceholderErrorMessage('wu:create', result);

      expect(message).not.toContain('pnpm wu:edit');
    });
  });

  describe('wu:claim error messages', () => {
    it('should include WU ID in header', () => {
      const result = createResult(['description']);
      const message = buildPlaceholderErrorMessage('wu:claim', result, 'WU-1025');

      expect(message).toContain('Cannot claim WU-1025');
    });

    it('should include edit instructions', () => {
      const result = createResult(['description']);
      const message = buildPlaceholderErrorMessage('wu:claim', result, 'WU-1025');

      expect(message).toContain('pnpm wu:edit --id WU-1025');
    });

    it('should include manual edit path hint', () => {
      const result = createResult(['description']);
      const message = buildPlaceholderErrorMessage('wu:claim', result, 'WU-1025');

      expect(message).toContain('docs/04-operations/tasks/wu/WU-1025.yaml');
    });
  });

  describe('error details', () => {
    it('should include placeholder marker in message', () => {
      const result = createResult(['description']);
      const message = buildPlaceholderErrorMessage('wu:create', result);

      expect(message).toContain(PLACEHOLDER_SENTINEL);
    });

    it('should include all error details', () => {
      const result = {
        valid: false,
        errors: ['Error 1: Fix this', 'Error 2: Fix that'],
        fieldsWithPlaceholders: ['field1', 'field2'],
      };
      const message = buildPlaceholderErrorMessage('wu:create', result);

      expect(message).toContain('Error 1');
      expect(message).toContain('Error 2');
    });
  });
});

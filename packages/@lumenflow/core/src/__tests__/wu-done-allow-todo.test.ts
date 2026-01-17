/**
 * Tests for wu:done --allow-todo validation (WU-654)
 *
 * Verifies that notes field validation works for both string and array formats.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Simulates the wu:done validation logic for --allow-todo flag
 * @param {string|string[]|undefined} notes - Notes field from WU YAML
 * @returns {boolean} True if justification is present
 */
function validateAllowTodoJustification(notes) {
  // Handle both string and array formats for notes
  let notesText = '';
  if (typeof notes === 'string') {
    notesText = notes;
  } else if (Array.isArray(notes)) {
    notesText = notes.join('\n');
  }

  return notesText.toLowerCase().includes('todo') || notesText.toLowerCase().includes('allow-todo');
}

describe('wu:done --allow-todo validation', () => {
  describe('String-format notes', () => {
    it('should pass when string notes contain "allow-todo" justification', () => {
      const notes =
        'allow-todo: Pre-existing TODO at route.ts:222 (WU-641 scope) not added by WU-650';
      expect(validateAllowTodoJustification(notes)).toBe(true);
    });

    it('should pass when string notes contain "TODO" (case-insensitive)', () => {
      const notes = 'This WU has TODO comments that are acceptable for X reason';
      expect(validateAllowTodoJustification(notes)).toBe(true);
    });

    it('should fail when string notes have no justification', () => {
      const notes = 'Some notes without any justification';
      expect(validateAllowTodoJustification(notes)).toBe(false);
    });
  });

  describe('Array-format notes', () => {
    it('should pass when array notes contain "allow-todo" in any element', () => {
      const notes = [
        'First note about implementation',
        'allow-todo: Pre-existing TODO at route.ts:222',
        'Third note about approach',
      ];
      expect(validateAllowTodoJustification(notes)).toBe(true);
    });

    it('should pass when array notes contain "TODO" in any element', () => {
      const notes = [
        'Bug location: tools/wu-done.mjs:637-639',
        'Root cause: Assumes notes is string',
        'TODO comments are acceptable here because of X reason',
      ];
      expect(validateAllowTodoJustification(notes)).toBe(true);
    });

    it('should fail when array notes have no justification', () => {
      const notes = ['First note', 'Second note', 'Third note without any justification keywords'];
      expect(validateAllowTodoJustification(notes)).toBe(false);
    });

    it('should handle array with single element containing justification', () => {
      const notes = ['allow-todo: Single note with justification'];
      expect(validateAllowTodoJustification(notes)).toBe(true);
    });

    it('should be case-insensitive for array notes', () => {
      const notes = ['First note', 'ALLOW-TODO: uppercase variant'];
      expect(validateAllowTodoJustification(notes)).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should fail when notes is undefined', () => {
      expect(validateAllowTodoJustification(undefined)).toBe(false);
    });

    it('should fail when notes is null', () => {
      expect(validateAllowTodoJustification(null)).toBe(false);
    });

    it('should fail when notes is empty string', () => {
      expect(validateAllowTodoJustification('')).toBe(false);
    });

    it('should fail when notes is empty array', () => {
      expect(validateAllowTodoJustification([])).toBe(false);
    });

    it('should handle array with empty strings', () => {
      const notes = ['', '', 'allow-todo: justification here'];
      expect(validateAllowTodoJustification(notes)).toBe(true);
    });
  });
});

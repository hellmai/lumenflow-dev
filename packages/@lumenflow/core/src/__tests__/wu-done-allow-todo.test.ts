/**
 * Tests for wu:done --allow-todo validation (WU-654)
 *
 * Verifies that notes field validation works for both string and array formats.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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
      assert.equal(validateAllowTodoJustification(notes), true);
    });

    it('should pass when string notes contain "TODO" (case-insensitive)', () => {
      const notes = 'This WU has TODO comments that are acceptable for X reason';
      assert.equal(validateAllowTodoJustification(notes), true);
    });

    it('should fail when string notes have no justification', () => {
      const notes = 'Some notes without any justification';
      assert.equal(validateAllowTodoJustification(notes), false);
    });
  });

  describe('Array-format notes', () => {
    it('should pass when array notes contain "allow-todo" in any element', () => {
      const notes = [
        'First note about implementation',
        'allow-todo: Pre-existing TODO at route.ts:222',
        'Third note about approach',
      ];
      assert.equal(validateAllowTodoJustification(notes), true);
    });

    it('should pass when array notes contain "TODO" in any element', () => {
      const notes = [
        'Bug location: tools/wu-done.mjs:637-639',
        'Root cause: Assumes notes is string',
        'TODO comments are acceptable here because of X reason',
      ];
      assert.equal(validateAllowTodoJustification(notes), true);
    });

    it('should fail when array notes have no justification', () => {
      const notes = ['First note', 'Second note', 'Third note without any justification keywords'];
      assert.equal(validateAllowTodoJustification(notes), false);
    });

    it('should handle array with single element containing justification', () => {
      const notes = ['allow-todo: Single note with justification'];
      assert.equal(validateAllowTodoJustification(notes), true);
    });

    it('should be case-insensitive for array notes', () => {
      const notes = ['First note', 'ALLOW-TODO: uppercase variant'];
      assert.equal(validateAllowTodoJustification(notes), true);
    });
  });

  describe('Edge cases', () => {
    it('should fail when notes is undefined', () => {
      assert.equal(validateAllowTodoJustification(undefined), false);
    });

    it('should fail when notes is null', () => {
      assert.equal(validateAllowTodoJustification(null), false);
    });

    it('should fail when notes is empty string', () => {
      assert.equal(validateAllowTodoJustification(''), false);
    });

    it('should fail when notes is empty array', () => {
      assert.equal(validateAllowTodoJustification([]), false);
    });

    it('should handle array with empty strings', () => {
      const notes = ['', '', 'allow-todo: justification here'];
      assert.equal(validateAllowTodoJustification(notes), true);
    });
  });
});

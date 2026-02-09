/**
 * @file wu-edit.test.ts
 * Test suite for wu:edit command
 *
 * Tests:
 * - WU-1039: --exposure flag behavior on done WUs
 * - WU-1144: --notes and --acceptance append behavior
 *   - Notes and acceptance append by default (preserve original)
 *   - --replace-notes and --replace-acceptance for explicit overwrite
 */

import { describe, it, expect } from 'vitest';

// Import the functions we're testing from dist (built files)
import {
  validateDoneWUEdits,
  validateExposureValue,
  applyExposureEdit,
  applyEdits,
  mergeStringField,
} from '../dist/wu-edit.js';
import { WU_EXPOSURE_VALUES } from '@lumenflow/core/wu-constants';

describe('wu:edit --exposure on done WUs (WU-1039)', () => {
  describe('validateDoneWUEdits', () => {
    it('should allow --exposure on done WUs', () => {
      const opts = { exposure: 'api' };
      const result = validateDoneWUEdits(opts);

      expect(result.valid).toBe(true);
      expect(result.disallowedEdits).toHaveLength(0);
    });

    it('should allow --initiative on done WUs', () => {
      const opts = { initiative: 'INIT-001' };
      const result = validateDoneWUEdits(opts);

      expect(result.valid).toBe(true);
      expect(result.disallowedEdits).toHaveLength(0);
    });

    it('should allow --phase on done WUs', () => {
      const opts = { phase: '2' };
      const result = validateDoneWUEdits(opts);

      expect(result.valid).toBe(true);
      expect(result.disallowedEdits).toHaveLength(0);
    });

    it('should reject --description on done WUs', () => {
      const opts = { description: 'new description' };
      const result = validateDoneWUEdits(opts);

      expect(result.valid).toBe(false);
      expect(result.disallowedEdits).toContain('--description');
    });

    it('should reject --acceptance on done WUs', () => {
      const opts = { acceptance: ['new criterion'] };
      const result = validateDoneWUEdits(opts);

      expect(result.valid).toBe(false);
      expect(result.disallowedEdits).toContain('--acceptance');
    });

    it('should reject --code-paths on done WUs', () => {
      const opts = { codePaths: ['new/path.ts'] };
      const result = validateDoneWUEdits(opts);

      expect(result.valid).toBe(false);
      expect(result.disallowedEdits).toContain('--code-paths');
    });

    it('should reject --lane on done WUs', () => {
      const opts = { lane: 'New: Lane' };
      const result = validateDoneWUEdits(opts);

      expect(result.valid).toBe(false);
      expect(result.disallowedEdits).toContain('--lane');
    });

    it('should reject --type on done WUs', () => {
      const opts = { type: 'bug' };
      const result = validateDoneWUEdits(opts);

      expect(result.valid).toBe(false);
      expect(result.disallowedEdits).toContain('--type');
    });

    it('should reject --spec-file on done WUs', () => {
      const opts = { specFile: '/path/to/spec.yaml' };
      const result = validateDoneWUEdits(opts);

      expect(result.valid).toBe(false);
      expect(result.disallowedEdits).toContain('--spec-file');
    });
  });

  describe('validateExposureValue', () => {
    it('should accept valid exposure value: ui', () => {
      const result = validateExposureValue('ui');
      expect(result.valid).toBe(true);
    });

    it('should accept valid exposure value: api', () => {
      const result = validateExposureValue('api');
      expect(result.valid).toBe(true);
    });

    it('should accept valid exposure value: backend-only', () => {
      const result = validateExposureValue('backend-only');
      expect(result.valid).toBe(true);
    });

    it('should accept valid exposure value: documentation', () => {
      const result = validateExposureValue('documentation');
      expect(result.valid).toBe(true);
    });

    it('should reject invalid exposure value', () => {
      const result = validateExposureValue('invalid-value');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid exposure value');
      // Should list valid values in error
      expect(result.error).toContain('ui');
      expect(result.error).toContain('api');
    });

    it('should use WU_EXPOSURE_VALUES for validation', () => {
      // Verify all WU_EXPOSURE_VALUES are accepted
      for (const exposure of WU_EXPOSURE_VALUES) {
        const result = validateExposureValue(exposure);
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('applyExposureEdit', () => {
    it('should update exposure field on WU object', () => {
      const wu = { id: 'WU-1038', exposure: 'backend-only', status: 'done' };
      const result = applyExposureEdit(wu, 'api');

      expect(result.exposure).toBe('api');
      expect(result.id).toBe('WU-1038');
      expect(result.status).toBe('done');
    });

    it('should not mutate original WU object', () => {
      const wu = { id: 'WU-1038', exposure: 'backend-only', status: 'done' };
      const result = applyExposureEdit(wu, 'api');

      expect(wu.exposure).toBe('backend-only');
      expect(result.exposure).toBe('api');
    });
  });
});

/**
 * WU-1073: Test --risks replace/append behavior
 * WU-1225: Updated to append by default (consistent with other array fields)
 */
describe('wu:edit --risks behavior (WU-1073)', () => {
  // WU-1225: risks now append by default (changed from WU-1073's replace-by-default)
  it('should append existing risks by default (WU-1225)', () => {
    const wu = {
      id: 'WU-1073',
      risks: ['Original risk'],
    };
    const opts = { risks: ['New risk'] };
    const result = applyEdits(wu, opts);

    expect(result.risks).toEqual(['Original risk', 'New risk']);
  });

  it('should append risks when --append is set', () => {
    const wu = {
      id: 'WU-1073',
      risks: ['Original risk'],
    };
    const opts = { risks: ['Additional risk'], append: true };
    const result = applyEdits(wu, opts);

    expect(result.risks).toEqual(['Original risk', 'Additional risk']);
  });

  // WU-1225: risks now append by default (changed from WU-1073's replace-by-default)
  it('should split comma-separated risks and append by default (WU-1225)', () => {
    const wu = {
      id: 'WU-1073',
      risks: ['Original risk'],
    };
    const opts = { risks: ['New risk 1, New risk 2'] };
    const result = applyEdits(wu, opts);

    expect(result.risks).toEqual(['Original risk', 'New risk 1', 'New risk 2']);
  });

  it('should replace risks when --replace-risks is set (WU-1225)', () => {
    const wu = {
      id: 'WU-1073',
      risks: ['Original risk'],
    };
    const opts = { risks: ['New risk 1', 'New risk 2'], replaceRisks: true };
    const result = applyEdits(wu, opts);

    expect(result.risks).toEqual(['New risk 1', 'New risk 2']);
  });
});

/**
 * WU-1144: Test --notes and --acceptance append/replace behavior
 *
 * Bug: --notes and --acceptance overwrite instead of append
 * Fix: These flags should append by default, with explicit --replace-* flags for overwrite
 */
describe('wu:edit --notes and --acceptance append behavior (WU-1144)', () => {
  describe('mergeStringField', () => {
    it('should append new text to existing notes by default', () => {
      const existing = 'Original notes here.';
      const newValue = 'Additional notes.';
      const result = mergeStringField(existing, newValue, false);

      expect(result).toBe('Original notes here.\n\nAdditional notes.');
    });

    it('should replace existing notes when shouldReplace is true', () => {
      const existing = 'Original notes here.';
      const newValue = 'Replacement notes.';
      const result = mergeStringField(existing, newValue, true);

      expect(result).toBe('Replacement notes.');
    });

    it('should set notes when no existing notes', () => {
      const existing = '';
      const newValue = 'New notes.';
      const result = mergeStringField(existing, newValue, false);

      expect(result).toBe('New notes.');
    });

    it('should handle undefined existing notes', () => {
      const existing = undefined;
      const newValue = 'New notes.';
      const result = mergeStringField(existing, newValue, false);

      expect(result).toBe('New notes.');
    });
  });

  describe('applyEdits --notes behavior', () => {
    it('should append to existing notes by default (preserves original)', () => {
      const wu = {
        id: 'WU-1144',
        notes: 'Original notes.',
        acceptance: [],
      };
      const opts = { notes: 'Additional info.' };
      const result = applyEdits(wu, opts);

      expect(result.notes).toBe('Original notes.\n\nAdditional info.');
    });

    it('should replace notes when --replace-notes is set', () => {
      const wu = {
        id: 'WU-1144',
        notes: 'Original notes.',
        acceptance: [],
      };
      const opts = { notes: 'Replacement notes.', replaceNotes: true };
      const result = applyEdits(wu, opts);

      expect(result.notes).toBe('Replacement notes.');
    });

    it('should set notes when no existing notes', () => {
      const wu = {
        id: 'WU-1144',
        notes: '',
        acceptance: [],
      };
      const opts = { notes: 'New notes.' };
      const result = applyEdits(wu, opts);

      expect(result.notes).toBe('New notes.');
    });
  });

  describe('applyEdits --acceptance behavior', () => {
    it('should append to existing acceptance criteria by default', () => {
      const wu = {
        id: 'WU-1144',
        notes: '',
        acceptance: ['Existing criterion 1', 'Existing criterion 2'],
      };
      const opts = { acceptance: ['New criterion 3'] };
      const result = applyEdits(wu, opts);

      expect(result.acceptance).toEqual([
        'Existing criterion 1',
        'Existing criterion 2',
        'New criterion 3',
      ]);
    });

    it('should replace acceptance criteria when --replace-acceptance is set', () => {
      const wu = {
        id: 'WU-1144',
        notes: '',
        acceptance: ['Existing criterion 1', 'Existing criterion 2'],
      };
      const opts = {
        acceptance: ['Replacement criterion'],
        replaceAcceptance: true,
      };
      const result = applyEdits(wu, opts);

      expect(result.acceptance).toEqual(['Replacement criterion']);
    });

    it('should set acceptance when no existing criteria', () => {
      const wu = {
        id: 'WU-1144',
        notes: '',
        acceptance: [],
      };
      const opts = { acceptance: ['First criterion'] };
      const result = applyEdits(wu, opts);

      expect(result.acceptance).toEqual(['First criterion']);
    });

    it('should append multiple acceptance criteria at once', () => {
      const wu = {
        id: 'WU-1144',
        notes: '',
        acceptance: ['Existing'],
      };
      const opts = { acceptance: ['New 1', 'New 2'] };
      const result = applyEdits(wu, opts);

      expect(result.acceptance).toEqual(['Existing', 'New 1', 'New 2']);
    });
  });

  describe('backward compatibility with --append flag', () => {
    it('--append should have no effect on notes (already appends by default)', () => {
      const wu = {
        id: 'WU-1144',
        notes: 'Original.',
        acceptance: [],
      };
      const opts = { notes: 'Additional.', append: true };
      const result = applyEdits(wu, opts);

      expect(result.notes).toBe('Original.\n\nAdditional.');
    });

    it('--append should have no effect on acceptance (already appends by default)', () => {
      const wu = {
        id: 'WU-1144',
        notes: '',
        acceptance: ['Existing'],
      };
      const opts = { acceptance: ['New'], append: true };
      const result = applyEdits(wu, opts);

      expect(result.acceptance).toEqual(['Existing', 'New']);
    });
  });
});

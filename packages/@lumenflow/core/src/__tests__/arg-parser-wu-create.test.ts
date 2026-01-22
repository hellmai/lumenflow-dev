/**
 * Tests for WU_CREATE_OPTIONS in arg-parser.ts
 *
 * WU-1062: External plan storage and no-main-write mode
 *
 * Tests the new --plan and --direct flags for wu:create.
 */

import { describe, it, expect } from 'vitest';
import { WU_OPTIONS, WU_CREATE_OPTIONS } from '../arg-parser.js';

describe('WU_CREATE_OPTIONS', () => {
  it('should include --plan flag', () => {
    expect(WU_CREATE_OPTIONS.plan).toBeDefined();
    expect(WU_CREATE_OPTIONS.plan.flags).toBe('--plan');
    expect(WU_CREATE_OPTIONS.plan.description).toContain('plan');
  });

  it('should include --direct flag', () => {
    expect(WU_CREATE_OPTIONS.direct).toBeDefined();
    expect(WU_CREATE_OPTIONS.direct.flags).toBe('--direct');
    expect(WU_CREATE_OPTIONS.direct.description).toContain('main');
  });

  describe('--plan flag', () => {
    it('should be a boolean flag', () => {
      expect(WU_CREATE_OPTIONS.plan.flags).not.toContain('<');
    });
  });

  describe('--direct flag', () => {
    it('should be a boolean flag', () => {
      expect(WU_CREATE_OPTIONS.direct.flags).not.toContain('<');
    });

    it('should have description mentioning legacy behavior', () => {
      expect(WU_CREATE_OPTIONS.direct.description.toLowerCase()).toMatch(/legacy|direct|main/);
    });
  });
});

describe('WU_OPTIONS backwards compatibility', () => {
  it('should still have all existing options', () => {
    // Existing options should still be present
    expect(WU_OPTIONS.id).toBeDefined();
    expect(WU_OPTIONS.lane).toBeDefined();
    expect(WU_OPTIONS.title).toBeDefined();
    expect(WU_OPTIONS.description).toBeDefined();
    expect(WU_OPTIONS.acceptance).toBeDefined();
    expect(WU_OPTIONS.codePaths).toBeDefined();
    expect(WU_OPTIONS.specRefs).toBeDefined();
  });
});

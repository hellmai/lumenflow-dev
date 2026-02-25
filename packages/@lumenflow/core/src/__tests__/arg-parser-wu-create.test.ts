// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tests for WU_CREATE_OPTIONS in arg-parser.ts
 *
 * WU-1062: External plan storage
 *
 * Tests the --plan flag for wu:create.
 */

import { describe, it, expect } from 'vitest';
import { WU_OPTIONS, WU_CREATE_OPTIONS } from '../arg-parser.js';

describe('WU_CREATE_OPTIONS', () => {
  it('should include --plan flag', () => {
    expect(WU_CREATE_OPTIONS.plan).toBeDefined();
    expect(WU_CREATE_OPTIONS.plan.flags).toBe('--plan');
    expect(WU_CREATE_OPTIONS.plan.description).toContain('plan');
  });

  it('should include sizing estimate flags', () => {
    expect(WU_CREATE_OPTIONS.estimatedFiles.flags).toBe('--estimated-files <count>');
    expect(WU_CREATE_OPTIONS.estimatedToolCalls.flags).toBe('--estimated-tool-calls <count>');
    expect(WU_CREATE_OPTIONS.sizingStrategy.flags).toBe('--sizing-strategy <strategy>');
    expect(WU_CREATE_OPTIONS.sizingExceptionType.flags).toBe('--sizing-exception-type <type>');
    expect(WU_CREATE_OPTIONS.sizingExceptionReason.flags).toBe('--sizing-exception-reason <text>');
  });

  describe('--plan flag', () => {
    it('should be a boolean flag', () => {
      expect(WU_CREATE_OPTIONS.plan.flags).not.toContain('<');
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

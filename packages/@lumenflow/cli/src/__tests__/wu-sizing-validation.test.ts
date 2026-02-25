// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-sizing-validation.test.ts
 * @description Tests for WU sizing contract enforcement (WU-2141)
 *
 * Acceptance criteria:
 * - sizing_estimate metadata contract supported without breaking historical WUs
 * - wu:create emits advisory warning when oversize estimate lacks exception metadata
 * - wu:brief emits advisory warning and supports --strict-sizing blocking mode
 * - Unit tests cover warning/no-warning/strict/backward-compatible behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  type SizingEstimate,
  validateSizingEstimate,
  checkSizingAdvisory,
  SIZING_THRESHOLDS,
  SIZING_STRATEGIES,
  SIZING_EXCEPTION_TYPES,
} from '../wu-sizing-validation.js';

describe('wu-sizing-validation (WU-2141)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── AC1: sizing_estimate metadata contract ───

  describe('sizing_estimate metadata contract', () => {
    it('should accept a valid sizing_estimate with all fields', () => {
      const estimate: SizingEstimate = {
        estimated_files: 5,
        estimated_tool_calls: 30,
        strategy: 'single-session',
      };

      const result = validateSizingEstimate(estimate);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept sizing_estimate with exception metadata', () => {
      const estimate: SizingEstimate = {
        estimated_files: 50,
        estimated_tool_calls: 120,
        strategy: 'checkpoint-resume',
        exception_type: 'docs-only',
        exception_reason: 'Documentation WU touching many markdown files',
      };

      const result = validateSizingEstimate(estimate);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should reject negative estimated_files', () => {
      const estimate: SizingEstimate = {
        estimated_files: -1,
        estimated_tool_calls: 30,
        strategy: 'single-session',
      };

      const result = validateSizingEstimate(estimate);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject negative estimated_tool_calls', () => {
      const estimate: SizingEstimate = {
        estimated_files: 5,
        estimated_tool_calls: -10,
        strategy: 'single-session',
      };

      const result = validateSizingEstimate(estimate);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject invalid strategy values', () => {
      const estimate = {
        estimated_files: 5,
        estimated_tool_calls: 30,
        strategy: 'invalid-strategy',
      };

      const result = validateSizingEstimate(estimate as unknown as SizingEstimate);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should accept all valid strategy values', () => {
      for (const strategy of SIZING_STRATEGIES) {
        const estimate: SizingEstimate = {
          estimated_files: 5,
          estimated_tool_calls: 30,
          strategy,
        };

        const result = validateSizingEstimate(estimate);
        expect(result.valid).toBe(true);
      }
    });

    it('should accept all valid exception_type values', () => {
      for (const exceptionType of SIZING_EXCEPTION_TYPES) {
        const estimate: SizingEstimate = {
          estimated_files: 50,
          estimated_tool_calls: 120,
          strategy: 'checkpoint-resume',
          exception_type: exceptionType,
          exception_reason: 'Justified override reason',
        };

        const result = validateSizingEstimate(estimate);
        expect(result.valid).toBe(true);
      }
    });

    it('should reject exception_type without exception_reason', () => {
      const estimate: SizingEstimate = {
        estimated_files: 50,
        estimated_tool_calls: 120,
        strategy: 'checkpoint-resume',
        exception_type: 'docs-only',
      };

      const result = validateSizingEstimate(estimate);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('exception_reason')]),
      );
    });

    it('should return valid for undefined (backward compatibility)', () => {
      const result = validateSizingEstimate(undefined);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  // ─── AC2: wu:create advisory warning for oversize estimates ───

  describe('checkSizingAdvisory', () => {
    it('should return no warnings when estimate is within simple thresholds', () => {
      const estimate: SizingEstimate = {
        estimated_files: 10,
        estimated_tool_calls: 30,
        strategy: 'single-session',
      };

      const result = checkSizingAdvisory(estimate);
      expect(result.warnings).toEqual([]);
      expect(result.oversize).toBe(false);
    });

    it('should warn when estimated_files exceeds simple threshold', () => {
      const estimate: SizingEstimate = {
        estimated_files: 25,
        estimated_tool_calls: 30,
        strategy: 'single-session',
      };

      const result = checkSizingAdvisory(estimate);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.oversize).toBe(true);
      expect(result.warnings[0]).toContain('estimated_files');
    });

    it('should warn when estimated_tool_calls exceeds simple threshold', () => {
      const estimate: SizingEstimate = {
        estimated_files: 10,
        estimated_tool_calls: 60,
        strategy: 'single-session',
      };

      const result = checkSizingAdvisory(estimate);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.oversize).toBe(true);
      expect(result.warnings[0]).toContain('estimated_tool_calls');
    });

    it('should not warn when oversize estimate has exception metadata', () => {
      const estimate: SizingEstimate = {
        estimated_files: 50,
        estimated_tool_calls: 120,
        strategy: 'checkpoint-resume',
        exception_type: 'docs-only',
        exception_reason: 'All markdown files, low complexity',
      };

      const result = checkSizingAdvisory(estimate);
      expect(result.warnings).toEqual([]);
      expect(result.oversize).toBe(false);
    });

    it('should warn when oversize with no exception metadata', () => {
      const estimate: SizingEstimate = {
        estimated_files: 50,
        estimated_tool_calls: 120,
        strategy: 'checkpoint-resume',
      };

      const result = checkSizingAdvisory(estimate);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.oversize).toBe(true);
    });

    it('should return no warnings when sizing_estimate is undefined (backward compat)', () => {
      const result = checkSizingAdvisory(undefined);
      expect(result.warnings).toEqual([]);
      expect(result.oversize).toBe(false);
    });

    it('should handle oversized thresholds (100+ files, 200+ tool calls)', () => {
      const estimate: SizingEstimate = {
        estimated_files: 150,
        estimated_tool_calls: 250,
        strategy: 'decomposition',
      };

      const result = checkSizingAdvisory(estimate);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.oversize).toBe(true);
      // Should mention MUST split
      expect(result.warnings.some((w) => w.includes('split'))).toBe(true);
    });

    it('should respect docs-only threshold relaxation for docs exception type', () => {
      const estimate: SizingEstimate = {
        estimated_files: 35,
        estimated_tool_calls: 40,
        strategy: 'single-session',
        exception_type: 'docs-only',
        exception_reason: 'All markdown documentation files',
      };

      const result = checkSizingAdvisory(estimate);
      expect(result.warnings).toEqual([]);
      expect(result.oversize).toBe(false);
    });

    it('should respect shallow-multi-file threshold relaxation', () => {
      const estimate: SizingEstimate = {
        estimated_files: 45,
        estimated_tool_calls: 40,
        strategy: 'single-session',
        exception_type: 'shallow-multi-file',
        exception_reason: 'Uniform import path rename across 45 files',
      };

      const result = checkSizingAdvisory(estimate);
      expect(result.warnings).toEqual([]);
      expect(result.oversize).toBe(false);
    });
  });

  // ─── Export sizing thresholds ───

  describe('SIZING_THRESHOLDS', () => {
    it('should export expected threshold structure', () => {
      expect(SIZING_THRESHOLDS.SIMPLE.files).toBe(20);
      expect(SIZING_THRESHOLDS.SIMPLE.tool_calls).toBe(50);
      expect(SIZING_THRESHOLDS.MEDIUM.files).toBe(50);
      expect(SIZING_THRESHOLDS.MEDIUM.tool_calls).toBe(100);
      expect(SIZING_THRESHOLDS.OVERSIZED.files).toBe(100);
      expect(SIZING_THRESHOLDS.OVERSIZED.tool_calls).toBe(200);
    });
  });
});

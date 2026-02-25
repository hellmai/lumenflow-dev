// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-brief-sizing.test.ts
 * @description Tests for wu:brief sizing advisory and --strict-sizing (WU-2141)
 *
 * Verifies that wu:brief emits advisory warnings and supports
 * --strict-sizing blocking mode.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  checkBriefSizing,
  type BriefSizingInput,
  type BriefSizingResult,
} from '../wu-brief-sizing.js';

describe('wu:brief sizing checks (WU-2141)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Advisory mode (default) ───

  describe('advisory mode (no --strict-sizing)', () => {
    it('should pass when no sizing_estimate exists (backward compat)', () => {
      const input: BriefSizingInput = {
        wuId: 'WU-100',
        logPrefix: '[wu:brief]',
        strictSizing: false,
      };

      const result: BriefSizingResult = checkBriefSizing(input);
      expect(result.pass).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should pass with advisory warning when oversize without exception', () => {
      const input: BriefSizingInput = {
        wuId: 'WU-100',
        logPrefix: '[wu:brief]',
        strictSizing: false,
        sizingEstimate: {
          estimated_files: 30,
          estimated_tool_calls: 80,
          strategy: 'checkpoint-resume',
        },
      };

      const result: BriefSizingResult = checkBriefSizing(input);
      expect(result.pass).toBe(true); // advisory = always pass
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('should pass with no warning when within thresholds', () => {
      const input: BriefSizingInput = {
        wuId: 'WU-100',
        logPrefix: '[wu:brief]',
        strictSizing: false,
        sizingEstimate: {
          estimated_files: 10,
          estimated_tool_calls: 30,
          strategy: 'single-session',
        },
      };

      const result: BriefSizingResult = checkBriefSizing(input);
      expect(result.pass).toBe(true);
      expect(result.warnings).toEqual([]);
    });
  });

  // ─── Strict mode (--strict-sizing) ───

  describe('strict mode (--strict-sizing)', () => {
    it('should pass when no sizing_estimate exists (backward compat)', () => {
      const input: BriefSizingInput = {
        wuId: 'WU-100',
        logPrefix: '[wu:brief]',
        strictSizing: true,
      };

      // Strict mode without sizing_estimate: BLOCK (metadata missing)
      const result: BriefSizingResult = checkBriefSizing(input);
      expect(result.pass).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('sizing_estimate');
    });

    it('should block when oversize without exception', () => {
      const input: BriefSizingInput = {
        wuId: 'WU-100',
        logPrefix: '[wu:brief]',
        strictSizing: true,
        sizingEstimate: {
          estimated_files: 30,
          estimated_tool_calls: 80,
          strategy: 'checkpoint-resume',
        },
      };

      const result: BriefSizingResult = checkBriefSizing(input);
      expect(result.pass).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should pass when oversize with valid exception', () => {
      const input: BriefSizingInput = {
        wuId: 'WU-100',
        logPrefix: '[wu:brief]',
        strictSizing: true,
        sizingEstimate: {
          estimated_files: 30,
          estimated_tool_calls: 80,
          strategy: 'checkpoint-resume',
          exception_type: 'docs-only',
          exception_reason: 'All markdown documentation files',
        },
      };

      const result: BriefSizingResult = checkBriefSizing(input);
      expect(result.pass).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should pass when within thresholds', () => {
      const input: BriefSizingInput = {
        wuId: 'WU-100',
        logPrefix: '[wu:brief]',
        strictSizing: true,
        sizingEstimate: {
          estimated_files: 10,
          estimated_tool_calls: 30,
          strategy: 'single-session',
        },
      };

      const result: BriefSizingResult = checkBriefSizing(input);
      expect(result.pass).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });
});

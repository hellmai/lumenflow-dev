/**
 * Tests for wu:create field validation aggregation
 *
 * WU-1302: Verify that required field errors are aggregated and shown all at once,
 * rather than discovered iteratively (one at a time).
 */

import { describe, it, expect } from 'vitest';
import { validateCreateSpec } from '../dist/wu-create.js';

describe('wu:create validation aggregation (WU-1302)', () => {
  const minimalArgs = {
    id: 'WU-9999',
    lane: 'Framework: CLI',
    title: 'Test WU',
    priority: 'P2',
    type: 'feature',
  };

  describe('aggregates all missing required fields', () => {
    it('shows all missing fields when opts is empty', () => {
      const result = validateCreateSpec({
        ...minimalArgs,
        opts: {},
      });

      expect(result.valid).toBe(false);
      // WU-1302: Should list ALL missing required fields at once
      expect(result.errors.length).toBeGreaterThan(1);
    });

    it('lists missing --description in errors', () => {
      const result = validateCreateSpec({
        ...minimalArgs,
        opts: {},
      });

      expect(result.errors.some((err) => err.includes('--description'))).toBe(true);
    });

    it('lists missing --acceptance in errors', () => {
      const result = validateCreateSpec({
        ...minimalArgs,
        opts: {},
      });

      expect(result.errors.some((err) => err.includes('--acceptance'))).toBe(true);
    });

    it('lists missing --exposure in errors', () => {
      const result = validateCreateSpec({
        ...minimalArgs,
        opts: {},
      });

      expect(result.errors.some((err) => err.includes('--exposure'))).toBe(true);
    });

    it('lists missing --code-paths in errors for non-docs WUs', () => {
      const result = validateCreateSpec({
        ...minimalArgs,
        opts: {},
      });

      expect(result.errors.some((err) => err.includes('--code-paths'))).toBe(true);
    });

    it('does not require test intent when --code-paths is missing', () => {
      const result = validateCreateSpec({
        ...minimalArgs,
        opts: {},
      });

      expect(result.errors.some((err) => err.includes('At least one test entry'))).toBe(false);
    });

    it('requires minimum test intent when code_paths are provided for non-docs WUs', () => {
      const result = validateCreateSpec({
        ...minimalArgs,
        opts: {
          description: 'A valid description for aggregate validation behavior checks.',
          acceptance: ['A valid acceptance criterion.'],
          exposure: 'backend-only',
          codePaths: ['packages/@lumenflow/core/src/wu-rules-engine.ts'],
          specRefs: ['lumenflow://plans/WU-9999-plan.md'],
        },
      });

      expect(result.errors.some((err) => err.includes('At least one test entry'))).toBe(true);
    });

    it('lists missing --spec-refs in errors for feature WUs', () => {
      const result = validateCreateSpec({
        ...minimalArgs,
        type: 'feature',
        opts: {},
      });

      expect(result.errors.some((err) => err.includes('--spec-refs'))).toBe(true);
    });
  });

  describe('aggregation ensures single-pass validation', () => {
    it('returns at least 4 errors when everything is missing for feature WU', () => {
      // For a feature WU with no options, we expect:
      // 1. --description
      // 2. --acceptance
      // 3. --exposure
      // 4. --code-paths
      // 5. --spec-refs
      const result = validateCreateSpec({
        ...minimalArgs,
        type: 'feature',
        opts: {},
      });

      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    });

    it('returns fewer errors for documentation WUs (no code/test paths required)', () => {
      const featureResult = validateCreateSpec({
        ...minimalArgs,
        type: 'feature',
        opts: {},
      });

      const docsResult = validateCreateSpec({
        ...minimalArgs,
        type: 'documentation',
        opts: {},
      });

      // Documentation WUs should have fewer required fields
      expect(docsResult.errors.length).toBeLessThan(featureResult.errors.length);
    });

    it('error messages are actionable (mention flag names)', () => {
      const result = validateCreateSpec({
        ...minimalArgs,
        opts: {},
      });

      // All error messages should reference the CLI flag
      for (const error of result.errors) {
        expect(error).toMatch(/--\w+/);
      }
    });
  });
});

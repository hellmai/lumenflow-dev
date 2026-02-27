// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2243: initiative:create --phase and --success-metric flags must populate
 * the phases and success_metrics arrays in the created YAML.
 *
 * The bug: createInitiativeYamlInWorktree() correctly writes phases and
 * success_metrics to the YAML, but the completeness validation object
 * hardcodes empty arrays, causing false "missing recommended fields" warnings.
 *
 * Tests:
 * 1. createInitiativeYamlInWorktree writes phases from --phase flags
 * 2. createInitiativeYamlInWorktree writes success_metrics from --success-metric flags
 * 3. The completeness check in main() uses actual values (not hardcoded empty)
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC_PATH = path.join(__dirname, '..', 'src', 'initiative-create.ts');

describe('WU-2243: initiative:create --phase and --success-metric flags', () => {
  describe('YAML generation includes phases from --phase flag', () => {
    it('createInitiativeYamlInWorktree writes phases array when initPhase is provided', () => {
      // Read the source and verify the function builds phases from options.initPhase
      const content = fs.readFileSync(SRC_PATH, 'utf-8');

      // The function should map initPhase strings to phase objects with id, title, status
      expect(content).toContain('options.initPhase');
      expect(content).toContain("status: 'pending'");
    });

    it('createInitiativeYamlInWorktree writes success_metrics when successMetric is provided', () => {
      const content = fs.readFileSync(SRC_PATH, 'utf-8');

      // The function should assign successMetric array to success_metrics
      expect(content).toContain('options.successMetric');
    });
  });

  describe('completeness validation uses actual flag values (not hardcoded empty)', () => {
    it('completeness check object uses variables for phases (not empty array literal)', () => {
      const content = fs.readFileSync(SRC_PATH, 'utf-8');

      // Find the initContent object used for validateInitiativeCompleteness
      // It should NOT have hardcoded empty arrays for phases and success_metrics
      // after the YAML has already been written with the real values.
      //
      // The bug pattern is:
      //   const initContent = { ..., phases: [], success_metrics: [] };
      //   validateInitiativeCompleteness(initContent);
      //
      // The fix should use the actual computed values, not empty arrays.
      // We look for the completeness validation block and verify it does NOT
      // have hardcoded phases: [] and success_metrics: [].

      // Extract the block between "WU-1211" comment and validateInitiativeCompleteness call
      const completenessBlock = extractCompletenessBlock(content);
      expect(completenessBlock).toBeTruthy();

      // The phases field in the completeness object should NOT be a literal empty array
      // It should reference a variable (e.g., the phases computed from args)
      expect(completenessBlock).not.toMatch(/phases:\s*\[\s*\]/);
    });

    it('completeness check object uses variables for success_metrics (not empty array literal)', () => {
      const content = fs.readFileSync(SRC_PATH, 'utf-8');

      const completenessBlock = extractCompletenessBlock(content);
      expect(completenessBlock).toBeTruthy();

      // success_metrics should NOT be a literal empty array
      expect(completenessBlock).not.toMatch(/success_metrics:\s*\[\s*\]/);
    });
  });
});

/**
 * Extract the block of code that builds the initContent for completeness validation.
 * This is the section between the "WU-1211" comment and the validateInitiativeCompleteness call.
 */
function extractCompletenessBlock(source: string): string | null {
  // Find the validateInitiativeCompleteness call and the object literal preceding it
  const pattern =
    /const\s+initContent\s*=\s*\{[^}]*phases[^}]*success_metrics[^}]*\};\s*const\s+completenessResult/s;
  const match = source.match(pattern);
  if (match) return match[0];

  // Fallback: find any object with phases AND success_metrics near validateInitiativeCompleteness
  const fallbackPattern =
    /(?:const\s+initContent|const\s+completenessInput)[^;]*phases[^;]*success_metrics[^;]*;/s;
  const fallbackMatch = source.match(fallbackPattern);
  return fallbackMatch ? fallbackMatch[0] : null;
}

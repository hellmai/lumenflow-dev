// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file init-lane-validation.test.ts
 * Test: lane validation utility for lifecycle boundary checks.
 *
 * WU-1748: Validation moved from init-time to lane lifecycle commands.
 *
 * When workspace.yaml software_delivery defines lanes with "Parent: Sublane" format,
 * the parent name must exist in .lumenflow.lane-inference.yaml.
 * Invalid parents (e.g., "Foundation: Core" when "Foundation" is not a parent
 * in the inference hierarchy) should generate warnings at init time,
 * not silently pass through to fail at wu:create time.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { scaffoldProject } from '../init.js';
import { validateLaneConfigAgainstInference } from '../init-lane-validation.js';

describe('lane validation utilities (WU-1748 boundary shift)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-lane-validation-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('validateLaneConfigAgainstInference', () => {
    it('should return no warnings when all lane parents exist in inference hierarchy', () => {
      // Arrange: Config lanes use parents that exist in inference
      const configLanes = [
        { name: 'Framework: Core', wip_limit: 1, code_paths: ['src/core/**'] },
        { name: 'Content: Documentation', wip_limit: 1, code_paths: ['docs/**'] },
      ];
      const inferenceParents = ['Framework', 'Content', 'Operations'];

      // Act
      const result = validateLaneConfigAgainstInference(configLanes, inferenceParents);

      // Assert
      expect(result.warnings).toHaveLength(0);
      expect(result.invalidLanes).toHaveLength(0);
    });

    it('should return warnings when lane parent does not exist in inference hierarchy', () => {
      // Arrange: "Foundation" is NOT a valid parent in inference
      const configLanes = [
        { name: 'Foundation: Core', wip_limit: 1, code_paths: ['src/core/**'] },
        { name: 'Framework: CLI', wip_limit: 1, code_paths: ['src/cli/**'] },
      ];
      const inferenceParents = ['Framework', 'Content', 'Operations'];

      // Act
      const result = validateLaneConfigAgainstInference(configLanes, inferenceParents);

      // Assert
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.invalidLanes).toContain('Foundation: Core');
    });

    it('should list valid parent names in warning message', () => {
      // Arrange
      const configLanes = [{ name: 'Foundation: Core', wip_limit: 1, code_paths: ['src/core/**'] }];
      const inferenceParents = ['Framework', 'Content', 'Operations'];

      // Act
      const result = validateLaneConfigAgainstInference(configLanes, inferenceParents);

      // Assert: Warning message should include valid parents for guidance
      const warningText = result.warnings.join(' ');
      expect(warningText).toContain('Framework');
      expect(warningText).toContain('Content');
      expect(warningText).toContain('Operations');
    });

    it('should identify multiple invalid lane parents', () => {
      // Arrange
      const configLanes = [
        { name: 'Foundation: Core', wip_limit: 1, code_paths: ['src/core/**'] },
        { name: 'Platform: API', wip_limit: 1, code_paths: ['src/api/**'] },
        { name: 'Framework: CLI', wip_limit: 1, code_paths: ['src/cli/**'] },
      ];
      const inferenceParents = ['Framework', 'Content'];

      // Act
      const result = validateLaneConfigAgainstInference(configLanes, inferenceParents);

      // Assert
      expect(result.invalidLanes).toHaveLength(2);
      expect(result.invalidLanes).toContain('Foundation: Core');
      expect(result.invalidLanes).toContain('Platform: API');
    });

    it('should handle lanes without colon separator gracefully', () => {
      // Arrange: A lane name without "Parent: Sublane" format
      const configLanes = [{ name: 'Documentation', wip_limit: 1, code_paths: ['docs/**'] }];
      const inferenceParents = ['Framework', 'Content'];

      // Act
      const result = validateLaneConfigAgainstInference(configLanes, inferenceParents);

      // Assert: Should not crash, and should warn about non-standard format
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should be case-sensitive for parent name matching', () => {
      // Arrange: "framework" (lowercase) is NOT the same as "Framework"
      const configLanes = [{ name: 'framework: Core', wip_limit: 1, code_paths: ['src/core/**'] }];
      const inferenceParents = ['Framework', 'Content'];

      // Act
      const result = validateLaneConfigAgainstInference(configLanes, inferenceParents);

      // Assert: Should be invalid because case doesn't match
      expect(result.invalidLanes).toContain('framework: Core');
    });

    it('should return empty result for empty lane definitions', () => {
      // Arrange
      const configLanes: Array<{ name: string; wip_limit: number; code_paths: string[] }> = [];
      const inferenceParents = ['Framework', 'Content'];

      // Act
      const result = validateLaneConfigAgainstInference(configLanes, inferenceParents);

      // Assert
      expect(result.warnings).toHaveLength(0);
      expect(result.invalidLanes).toHaveLength(0);
    });
  });

  describe('scaffoldProject integration', () => {
    it('does not run lane parent validation during init', async () => {
      // Act: scaffold once (creates lifecycle status, not lane artifacts)
      const result = await scaffoldProject(tempDir, { force: true, full: true });

      // Assert: init should not emit lane-parent validation warnings
      const laneWarnings = (result.warnings ?? []).filter(
        (w) => w.includes('lane parent') || w.includes('invalid parent'),
      );
      expect(laneWarnings).toHaveLength(0);
    });
  });
});

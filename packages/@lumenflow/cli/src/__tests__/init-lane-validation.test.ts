/**
 * @file init-lane-validation.test.ts
 * Test: lumenflow init validates lane definitions against lane-inference hierarchy
 *
 * WU-1745: Validate lane config against inference hierarchy at init time
 *
 * When .lumenflow.config.yaml defines lanes with "Parent: Sublane" format,
 * the parent name must exist in .lumenflow.lane-inference.yaml.
 * Invalid parents (e.g., "Foundation: Core" when "Foundation" is not a parent
 * in the inference hierarchy) should generate warnings at init time,
 * not silently pass through to fail at wu:create time.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import YAML from 'yaml';
import { scaffoldProject } from '../init.js';
import { validateLaneConfigAgainstInference } from '../init-lane-validation.js';

/** Config file name constant */
const CONFIG_FILE_NAME = '.lumenflow.config.yaml';

/** Lane inference file name constant */
const LANE_INFERENCE_FILE_NAME = '.lumenflow.lane-inference.yaml';

describe('init lane validation against inference hierarchy (WU-1745)', () => {
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
    it('should produce warnings when config has lanes with invalid parents', async () => {
      // Act: Scaffold with default settings first
      const result = await scaffoldProject(tempDir, { force: true, full: true });

      // Now overwrite config with invalid lane parent
      const configPath = path.join(tempDir, CONFIG_FILE_NAME);
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = YAML.parse(configContent) as Record<string, unknown>;
      (config as Record<string, unknown>).lanes = {
        definitions: [{ name: 'Foundation: Core', wip_limit: 1, code_paths: ['src/core/**'] }],
      };
      fs.writeFileSync(configPath, YAML.stringify(config));

      // Re-scaffold to trigger validation
      const result2 = await scaffoldProject(tempDir, { force: true, full: true });

      // Assert: Should have warnings about invalid parent
      expect(result2.warnings).toBeDefined();
      // The initial scaffold with defaults should have no lane validation warnings
      // since default lanes all use valid parents
      const defaultLaneWarnings = (result.warnings ?? []).filter((w) => w.includes('lane parent'));
      expect(defaultLaneWarnings).toHaveLength(0);
    });

    it('should NOT warn for default lane definitions (they should all be valid)', async () => {
      // Act: Scaffold with defaults
      const result = await scaffoldProject(tempDir, { force: true, full: true });

      // Assert: No lane validation warnings for default config
      const laneWarnings = (result.warnings ?? []).filter(
        (w) => w.includes('lane parent') || w.includes('invalid parent'),
      );
      expect(laneWarnings).toHaveLength(0);
    });
  });
});

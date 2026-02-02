/**
 * @file onboarding-smoke-test.test.ts
 * Tests for onboarding smoke-test gate (WU-1315)
 *
 * This gate verifies the lumenflow init + wu:create flows work correctly
 * by running them in an isolated temp directory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Import the smoke-test module
import {
  runOnboardingSmokeTest,
  validateInitScripts,
  validateLaneInferenceFormat,
} from '../onboarding-smoke-test.js';

describe('onboarding smoke-test gate (WU-1315)', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-smoke-test-'));
  });

  afterEach(() => {
    // Clean up temporary directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('runOnboardingSmokeTest', () => {
    it('should return success when all validations pass', async () => {
      // This is an integration test - it runs the full smoke test
      const result = await runOnboardingSmokeTest({ tempDir });

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should clean up temp directory after test', async () => {
      // Run with a specific temp dir
      const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-smoke-cleanup-'));

      await runOnboardingSmokeTest({ tempDir: testTempDir, cleanup: true });

      // Temp dir should be cleaned up
      expect(fs.existsSync(testTempDir)).toBe(false);
    });

    it('should preserve temp directory when cleanup is false', async () => {
      const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-smoke-preserve-'));

      try {
        await runOnboardingSmokeTest({ tempDir: testTempDir, cleanup: false });

        // Temp dir should still exist
        expect(fs.existsSync(testTempDir)).toBe(true);
      } finally {
        // Manual cleanup
        if (fs.existsSync(testTempDir)) {
          fs.rmSync(testTempDir, { recursive: true, force: true });
        }
      }
    });

    it('should report errors when validation fails', async () => {
      // Create a directory without proper package.json scripts (init doesn't create them by default without --full)
      const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-smoke-invalid-'));

      try {
        // Create an empty package.json (missing required scripts)
        fs.writeFileSync(
          path.join(testDir, 'package.json'),
          JSON.stringify({ name: 'test', scripts: {} }, null, 2),
        );

        // Run smoke test - should skip scaffolding and validate existing state
        const result = validateInitScripts({ projectDir: testDir });

        expect(result.valid).toBe(false);
        expect(result.missingScripts.length).toBeGreaterThan(0);
      } finally {
        if (fs.existsSync(testDir)) {
          fs.rmSync(testDir, { recursive: true, force: true });
        }
      }
    });
  });

  describe('validateInitScripts', () => {
    it('should pass when all required scripts are present', () => {
      // Create package.json with required scripts
      const packageJson = {
        name: 'test-project',
        scripts: {
          'wu:claim': 'wu-claim',
          'wu:done': 'wu-done',
          'wu:create': 'wu-create',
          gates: 'gates',
        },
      };
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      const result = validateInitScripts({ projectDir: tempDir });

      expect(result.valid).toBe(true);
      expect(result.missingScripts).toHaveLength(0);
    });

    it('should fail when required scripts are missing', () => {
      // Create package.json without LumenFlow scripts
      const packageJson = {
        name: 'test-project',
        scripts: {
          test: 'vitest',
        },
      };
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      const result = validateInitScripts({ projectDir: tempDir });

      expect(result.valid).toBe(false);
      expect(result.missingScripts).toContain('wu:claim');
      expect(result.missingScripts).toContain('wu:done');
      expect(result.missingScripts).toContain('gates');
    });

    it('should fail when package.json does not exist', () => {
      const result = validateInitScripts({ projectDir: tempDir });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('package.json');
    });

    it('should verify scripts use standalone binary format', () => {
      // Scripts should be 'wu-claim' not 'pnpm exec lumenflow wu:claim'
      const packageJson = {
        name: 'test-project',
        scripts: {
          'wu:claim': 'pnpm exec lumenflow wu:claim', // Wrong format
          'wu:done': 'wu-done',
          'wu:create': 'wu-create',
          gates: 'gates',
        },
      };
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      const result = validateInitScripts({ projectDir: tempDir });

      expect(result.valid).toBe(false);
      expect(result.invalidScripts).toContain('wu:claim');
    });
  });

  describe('validateLaneInferenceFormat', () => {
    it('should pass when lane-inference.yaml has correct hierarchical format', () => {
      // Create lane-inference.yaml with correct format
      const laneInference = `# Lane Inference Configuration
Framework:
  Core:
    description: 'Core library'
    code_paths:
      - 'packages/core/**'
    keywords:
      - 'core'

Content:
  Documentation:
    description: 'Documentation'
    code_paths:
      - 'docs/**'
    keywords:
      - 'docs'
`;
      fs.writeFileSync(path.join(tempDir, '.lumenflow.lane-inference.yaml'), laneInference);

      const result = validateLaneInferenceFormat({ projectDir: tempDir });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when lane-inference.yaml uses flat lanes array', () => {
      // Create lane-inference.yaml with old flat format
      const laneInference = `# Lane Inference Configuration
lanes:
  - name: Framework
    code_paths:
      - 'packages/**'
`;
      fs.writeFileSync(path.join(tempDir, '.lumenflow.lane-inference.yaml'), laneInference);

      const result = validateLaneInferenceFormat({ projectDir: tempDir });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('lanes'))).toBe(true);
    });

    it('should fail when lane-inference.yaml does not exist', () => {
      const result = validateLaneInferenceFormat({ projectDir: tempDir });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('.lumenflow.lane-inference.yaml');
    });

    it('should validate parent lane names are capitalized', () => {
      const laneInference = `# Lane Inference Configuration
framework:  # Should be 'Framework'
  core:
    description: 'Core library'
    code_paths:
      - 'packages/core/**'
`;
      fs.writeFileSync(path.join(tempDir, '.lumenflow.lane-inference.yaml'), laneInference);

      const result = validateLaneInferenceFormat({ projectDir: tempDir });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('capitalized'))).toBe(true);
    });

    it('should validate sub-lanes have required fields', () => {
      const laneInference = `# Lane Inference Configuration
Framework:
  Core:
    # Missing description and code_paths
    keywords:
      - 'core'
`;
      fs.writeFileSync(path.join(tempDir, '.lumenflow.lane-inference.yaml'), laneInference);

      const result = validateLaneInferenceFormat({ projectDir: tempDir });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('description') || e.includes('code_paths'))).toBe(
        true,
      );
    });
  });

  describe('wu:create with requireRemote=false', () => {
    it('should run smoke test with requireRemote=false config', async () => {
      const result = await runOnboardingSmokeTest({
        tempDir,
        skipWuCreate: false,
      });

      // The test should have validated wu:create works without a remote
      expect(result.wuCreateValidation).toBeDefined();
      expect(result.wuCreateValidation?.success).toBe(true);
    });
  });
});

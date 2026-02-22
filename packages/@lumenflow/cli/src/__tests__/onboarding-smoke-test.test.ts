// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

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
import YAML from 'yaml';

// Import the smoke-test module
import {
  runOnboardingSmokeTest,
  validateInitScripts,
  validateLaneInferenceFormat,
} from '../onboarding-smoke-test.js';
import { connectWorkspaceToCloud } from '../onboard.js';

/** Constants for test files to avoid duplicate string literals */
const PACKAGE_JSON_FILE = 'package.json';
const LANE_INFERENCE_FILE = '.lumenflow.lane-inference.yaml';
const WORKSPACE_FILE = 'workspace.yaml';
const TEST_PROJECT_NAME = 'test-project';
const TEST_CLOUD_ENDPOINT = 'https://control-plane.example';
const TEST_ORG_ID = 'org-test';
const TEST_PROJECT_ID = 'project-test';
const TEST_TOKEN_ENV = 'LUMENFLOW_CONTROL_PLANE_TOKEN';
const TEST_TOKEN_VALUE = 'token-value';
const TEST_POLICY_MODE = 'tighten-only';
const TEST_SYNC_INTERVAL = 30;
const WORKSPACE_FIXTURE = `id: workspace-test
name: Workspace Test
packs: []
lanes: []
security:
  allowed_scopes: []
  network_default: off
  deny_overlays: []
software_delivery: {}
memory_namespace: workspace-test
event_namespace: workspace-test
`;

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
          path.join(testDir, PACKAGE_JSON_FILE),
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
        name: TEST_PROJECT_NAME,
        scripts: {
          'wu:claim': 'wu-claim',
          'wu:done': 'wu-done',
          'wu:create': 'wu-create',
          gates: 'gates',
        },
      };
      fs.writeFileSync(path.join(tempDir, PACKAGE_JSON_FILE), JSON.stringify(packageJson, null, 2));

      const result = validateInitScripts({ projectDir: tempDir });

      expect(result.valid).toBe(true);
      expect(result.missingScripts).toHaveLength(0);
    });

    it('should fail when required scripts are missing', () => {
      // Create package.json without LumenFlow scripts
      const packageJson = {
        name: TEST_PROJECT_NAME,
        scripts: {
          test: 'vitest',
        },
      };
      fs.writeFileSync(path.join(tempDir, PACKAGE_JSON_FILE), JSON.stringify(packageJson, null, 2));

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
        name: TEST_PROJECT_NAME,
        scripts: {
          'wu:claim': 'pnpm exec lumenflow wu:claim', // Wrong format
          'wu:done': 'wu-done',
          'wu:create': 'wu-create',
          gates: 'gates',
        },
      };
      fs.writeFileSync(path.join(tempDir, PACKAGE_JSON_FILE), JSON.stringify(packageJson, null, 2));

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
      fs.writeFileSync(path.join(tempDir, LANE_INFERENCE_FILE), laneInference);

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
      fs.writeFileSync(path.join(tempDir, LANE_INFERENCE_FILE), laneInference);

      const result = validateLaneInferenceFormat({ projectDir: tempDir });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('lanes'))).toBe(true);
    });

    it('should pass when lane-inference.yaml does not exist but lifecycle is unconfigured', () => {
      const configContent = `software_delivery:
  lanes:
    lifecycle:
      status: unconfigured
`;
      fs.writeFileSync(path.join(tempDir, WORKSPACE_FILE), configContent);

      const result = validateLaneInferenceFormat({ projectDir: tempDir });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.error).toBeUndefined();
    });

    it('should fail when lane-inference.yaml does not exist and lifecycle is locked', () => {
      const configContent = `software_delivery:
  lanes:
    lifecycle:
      status: locked
`;
      fs.writeFileSync(path.join(tempDir, WORKSPACE_FILE), configContent);

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
      fs.writeFileSync(path.join(tempDir, LANE_INFERENCE_FILE), laneInference);

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
      fs.writeFileSync(path.join(tempDir, LANE_INFERENCE_FILE), laneInference);

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

  describe('cloud connect flow (WU-1980)', () => {
    it('writes validated control_plane config to workspace.yaml', async () => {
      const workspacePath = path.join(tempDir, WORKSPACE_FILE);
      fs.writeFileSync(workspacePath, WORKSPACE_FIXTURE);

      const result = await connectWorkspaceToCloud({
        targetDir: tempDir,
        endpoint: TEST_CLOUD_ENDPOINT,
        orgId: TEST_ORG_ID,
        projectId: TEST_PROJECT_ID,
        tokenEnv: TEST_TOKEN_ENV,
        policyMode: TEST_POLICY_MODE,
        syncInterval: TEST_SYNC_INTERVAL,
        env: {
          [TEST_TOKEN_ENV]: TEST_TOKEN_VALUE,
        },
      });

      expect(result.success).toBe(true);
      expect(result.workspacePath).toBe(workspacePath);

      const parsedWorkspace = YAML.parse(fs.readFileSync(workspacePath, 'utf-8')) as {
        control_plane?: Record<string, unknown>;
      };

      expect(parsedWorkspace.control_plane).toMatchObject({
        endpoint: TEST_CLOUD_ENDPOINT,
        org_id: TEST_ORG_ID,
        project_id: TEST_PROJECT_ID,
        sync_interval: TEST_SYNC_INTERVAL,
        policy_mode: TEST_POLICY_MODE,
        auth: {
          token_env: TEST_TOKEN_ENV,
        },
      });
    });

    it('returns actionable error for invalid endpoint', async () => {
      fs.writeFileSync(path.join(tempDir, WORKSPACE_FILE), WORKSPACE_FIXTURE);

      const result = await connectWorkspaceToCloud({
        targetDir: tempDir,
        endpoint: 'not-a-url',
        orgId: TEST_ORG_ID,
        projectId: TEST_PROJECT_ID,
        tokenEnv: TEST_TOKEN_ENV,
        policyMode: TEST_POLICY_MODE,
        syncInterval: TEST_SYNC_INTERVAL,
        env: {
          [TEST_TOKEN_ENV]: TEST_TOKEN_VALUE,
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('endpoint');
      expect(result.error).toContain('valid URL');
    });

    it('returns actionable error when token env is missing', async () => {
      fs.writeFileSync(path.join(tempDir, WORKSPACE_FILE), WORKSPACE_FIXTURE);

      const result = await connectWorkspaceToCloud({
        targetDir: tempDir,
        endpoint: TEST_CLOUD_ENDPOINT,
        orgId: TEST_ORG_ID,
        projectId: TEST_PROJECT_ID,
        tokenEnv: TEST_TOKEN_ENV,
        policyMode: TEST_POLICY_MODE,
        syncInterval: TEST_SYNC_INTERVAL,
        env: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain(TEST_TOKEN_ENV);
      expect(result.error).toContain('Export');
    });
  });
});

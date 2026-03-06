// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tests for lane-inference error messages
 *
 * Lane inference now reads workspace.yaml lane definitions directly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inferSubLane, getSubLanesForParent } from '../lane-inference.js';

// Test constants to avoid duplicate strings
const CONFIG_FILENAME = 'workspace.yaml';
const TEST_CODE_PATH = 'packages/core/src/index.ts';
const TEST_WU_DESCRIPTION = 'Test WU';
const EXPECTED_TO_THROW = 'Should have thrown an error';

describe('lane-inference error messages', () => {
  let testBaseDir: string;

  beforeEach(() => {
    // Create a unique test directory for each test
    testBaseDir = join(
      tmpdir(),
      // eslint-disable-next-line sonarjs/pseudo-random -- Test isolation needs unique temp dirs
      `lane-inference-error-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testBaseDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(testBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('missing workspace.yaml', () => {
    it('throws error with clear message when config file is missing', () => {
      const missingConfigPath = join(testBaseDir, CONFIG_FILENAME);

      // Ensure file doesn't exist
      expect(existsSync(missingConfigPath)).toBe(false);

      expect(() =>
        inferSubLane([TEST_CODE_PATH], TEST_WU_DESCRIPTION, missingConfigPath),
      ).toThrow();
    });

    it('error message includes the file name that is missing', () => {
      const missingConfigPath = join(testBaseDir, CONFIG_FILENAME);

      try {
        inferSubLane([TEST_CODE_PATH], TEST_WU_DESCRIPTION, missingConfigPath);
        expect.fail(EXPECTED_TO_THROW);
      } catch (error) {
        expect((error as Error).message).toContain(CONFIG_FILENAME);
      }
    });

    it('error message includes fix suggestion with lane:setup command', () => {
      const missingConfigPath = join(testBaseDir, CONFIG_FILENAME);

      try {
        inferSubLane([TEST_CODE_PATH], TEST_WU_DESCRIPTION, missingConfigPath);
        expect.fail(EXPECTED_TO_THROW);
      } catch (error) {
        expect((error as Error).message).toContain('lane:setup');
      }
    });

    it('error message points to workspace lane definitions', () => {
      const missingConfigPath = join(testBaseDir, CONFIG_FILENAME);

      try {
        inferSubLane([TEST_CODE_PATH], TEST_WU_DESCRIPTION, missingConfigPath);
        expect.fail(EXPECTED_TO_THROW);
      } catch (error) {
        expect((error as Error).message).toContain('workspace');
        expect((error as Error).message).toContain('lanes.definitions');
      }
    });
  });

  describe('getSubLanesForParent', () => {
    it('returns empty array (graceful degradation) when config is missing', () => {
      const missingConfigPath = join(testBaseDir, CONFIG_FILENAME);

      expect(getSubLanesForParent('Framework', missingConfigPath)).toEqual([]);
    });

    it('reads sub-lanes from workspace.yaml definitions', () => {
      const configPath = join(testBaseDir, CONFIG_FILENAME);
      writeFileSync(
        configPath,
        `software_delivery:
  lanes:
    definitions:
      - name: "Framework: Core"
        wip_limit: 1
        code_paths:
          - "packages/core/**"
      - name: "Framework: CLI"
        wip_limit: 1
        code_paths:
          - "packages/cli/**"
`,
      );

      expect(getSubLanesForParent('Framework', configPath)).toEqual(['Core', 'CLI']);
    });
  });
});

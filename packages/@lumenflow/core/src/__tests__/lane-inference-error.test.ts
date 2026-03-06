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
const TEST_ZERO_SIGNAL_PATH = 'no/such/path.txt';
const TEST_ZERO_SIGNAL_DESCRIPTION = 'totally unrelated text';
const TEST_FALLBACK_PARENT = 'Operations';
const TEST_CORE_LANE = 'Framework: Core';
const TEST_DOCS_LANE = 'Content: Docs';
const TEST_CORE_MATCH_PATH = 'packages/core/src/lane-inference.ts';
const TEST_DOCS_MATCH_PATH = 'docs/reference/index.md';
const WORKSPACE_WITH_LANES = `software_delivery:
  lanes:
    definitions:
      - name: "${TEST_CORE_LANE}"
        wip_limit: 1
        code_paths:
          - "packages/core/**"
      - name: "${TEST_DOCS_LANE}"
        wip_limit: 1
        code_paths:
          - "docs/**"
`;

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

  describe('zero-signal fallback', () => {
    it('returns the stable fallback parent instead of the first configured lane', () => {
      const configPath = join(testBaseDir, CONFIG_FILENAME);
      writeFileSync(configPath, WORKSPACE_WITH_LANES);

      const result = inferSubLane(
        [TEST_ZERO_SIGNAL_PATH],
        TEST_ZERO_SIGNAL_DESCRIPTION,
        configPath,
      );

      expect(result).toEqual({
        lane: TEST_FALLBACK_PARENT,
        confidence: 0,
      });
    });

    it('still returns a strong path-driven match when confidence is positive', () => {
      const configPath = join(testBaseDir, CONFIG_FILENAME);
      writeFileSync(configPath, WORKSPACE_WITH_LANES);

      const result = inferSubLane(
        [TEST_CORE_MATCH_PATH],
        'Fix lane inference fallback',
        configPath,
      );

      expect(result).toEqual({
        lane: TEST_CORE_LANE,
        confidence: 10,
      });
    });

    it('supports non-framework positive matches without falling back', () => {
      const configPath = join(testBaseDir, CONFIG_FILENAME);
      writeFileSync(configPath, WORKSPACE_WITH_LANES);

      const result = inferSubLane([TEST_DOCS_MATCH_PATH], 'Update docs page', configPath);

      expect(result.lane).toBe(TEST_DOCS_LANE);
      expect(result.confidence).toBeGreaterThan(0);
    });
  });
});

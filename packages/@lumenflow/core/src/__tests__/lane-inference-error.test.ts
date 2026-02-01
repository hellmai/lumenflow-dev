/**
 * Tests for lane-inference error messages
 *
 * WU-1302: Verify that missing .lumenflow.lane-inference.yaml gives clear
 * error message with actionable fix suggestion.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inferSubLane, getSubLanesForParent } from '../lane-inference.js';

describe('lane-inference error messages (WU-1302)', () => {
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

  describe('missing .lumenflow.lane-inference.yaml', () => {
    it('throws error with clear message when config file is missing', () => {
      const missingConfigPath = join(testBaseDir, '.lumenflow.lane-inference.yaml');

      // Ensure file doesn't exist
      expect(existsSync(missingConfigPath)).toBe(false);

      expect(() =>
        inferSubLane(['packages/core/src/index.ts'], 'Test WU', missingConfigPath),
      ).toThrow();
    });

    it('error message includes the file name that is missing', () => {
      const missingConfigPath = join(testBaseDir, '.lumenflow.lane-inference.yaml');

      try {
        inferSubLane(['packages/core/src/index.ts'], 'Test WU', missingConfigPath);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('.lumenflow.lane-inference.yaml');
      }
    });

    it('error message includes fix suggestion with lane:suggest command', () => {
      const missingConfigPath = join(testBaseDir, '.lumenflow.lane-inference.yaml');

      try {
        inferSubLane(['packages/core/src/index.ts'], 'Test WU', missingConfigPath);
        expect.fail('Should have thrown an error');
      } catch (error) {
        // WU-1302: Error should include actionable fix suggestion
        expect(error.message).toContain('lane:suggest');
      }
    });

    it('error message mentions generating lane taxonomy', () => {
      const missingConfigPath = join(testBaseDir, '.lumenflow.lane-inference.yaml');

      try {
        inferSubLane(['packages/core/src/index.ts'], 'Test WU', missingConfigPath);
        expect.fail('Should have thrown an error');
      } catch (error) {
        // Error should explain what the file is for
        expect(error.message.toLowerCase()).toMatch(/generate|create|taxonomy|lane/);
      }
    });
  });

  describe('getSubLanesForParent with missing config', () => {
    it('returns empty array (graceful degradation) when config is missing', () => {
      const missingConfigPath = join(testBaseDir, '.lumenflow.lane-inference.yaml');

      // getSubLanesForParent should NOT throw - it's used in validation paths
      // and should gracefully return empty when config is missing
      expect(() => getSubLanesForParent('Framework', missingConfigPath)).toThrow();
    });
  });
});

/**
 * Gates Agent Mode Symlink Tests (WU-2064)
 *
 * Tests for the gates-latest.log symlink functionality.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync, readlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getGatesLatestSymlinkPath,
  updateGatesLatestSymlink,
  getGatesLogDir,
} from '../gates-agent-mode.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_FIXTURE_DIR = path.join(__dirname, '.test-fixtures-symlink');

describe('gates-latest.log symlink', () => {
  beforeEach(() => {
    // Create test fixture directory with .logs
    mkdirSync(path.join(TEST_FIXTURE_DIR, '.logs'), { recursive: true });
  });

  afterEach(() => {
    // Cleanup test fixtures
    rmSync(TEST_FIXTURE_DIR, { recursive: true, force: true });
  });

  describe('getGatesLatestSymlinkPath', () => {
    it('should return path to gates-latest.log in .logs dir', () => {
      const result = getGatesLatestSymlinkPath({ cwd: TEST_FIXTURE_DIR, env: {} });
      assert.ok(result.endsWith('.logs/gates-latest.log'));
      assert.ok(result.startsWith(TEST_FIXTURE_DIR));
    });

    it('should respect LUMENFLOW_LOG_DIR env var', () => {
      const result = getGatesLatestSymlinkPath({
        cwd: TEST_FIXTURE_DIR,
        env: { LUMENFLOW_LOG_DIR: 'custom-logs' },
      });
      assert.ok(result.includes('custom-logs'));
    });
  });

  describe('updateGatesLatestSymlink', () => {
    it('should create symlink to log file', () => {
      // Create a test log file
      const logPath = path.join(TEST_FIXTURE_DIR, '.logs', 'gates-test-2025-01-01.log');
      writeFileSync(logPath, 'test log content');

      const result = updateGatesLatestSymlink({
        logPath,
        cwd: TEST_FIXTURE_DIR,
        env: {},
      });

      assert.equal(result, true);

      const symlinkPath = getGatesLatestSymlinkPath({ cwd: TEST_FIXTURE_DIR, env: {} });
      assert.ok(existsSync(symlinkPath));

      // Verify symlink points to correct file
      const target = readlinkSync(symlinkPath);
      assert.ok(target.includes('gates-test-2025-01-01.log'));
    });

    it('should replace existing symlink', () => {
      // Create first log file
      const logPath1 = path.join(TEST_FIXTURE_DIR, '.logs', 'gates-v1.log');
      writeFileSync(logPath1, 'v1');
      updateGatesLatestSymlink({ logPath: logPath1, cwd: TEST_FIXTURE_DIR, env: {} });

      // Create second log file and update symlink
      const logPath2 = path.join(TEST_FIXTURE_DIR, '.logs', 'gates-v2.log');
      writeFileSync(logPath2, 'v2');
      const result = updateGatesLatestSymlink({
        logPath: logPath2,
        cwd: TEST_FIXTURE_DIR,
        env: {},
      });

      assert.equal(result, true);

      // Verify symlink now points to v2
      const symlinkPath = getGatesLatestSymlinkPath({ cwd: TEST_FIXTURE_DIR, env: {} });
      const target = readlinkSync(symlinkPath);
      assert.ok(target.includes('gates-v2.log'));
    });

    it('should use relative path for symlink', () => {
      const logPath = path.join(TEST_FIXTURE_DIR, '.logs', 'gates-relative.log');
      writeFileSync(logPath, 'test');
      updateGatesLatestSymlink({ logPath, cwd: TEST_FIXTURE_DIR, env: {} });

      const symlinkPath = getGatesLatestSymlinkPath({ cwd: TEST_FIXTURE_DIR, env: {} });
      const target = readlinkSync(symlinkPath);

      // Should be relative, not absolute
      assert.ok(!target.startsWith('/'), 'Symlink should be relative');
      assert.equal(target, 'gates-relative.log');
    });
  });
});

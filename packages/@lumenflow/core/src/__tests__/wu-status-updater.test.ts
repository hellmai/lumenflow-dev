/**
 * @file wu-status-updater.test.mjs
 * Unit tests for status.md update utilities
 *
 * WU-1275: Tests error throwing behavior (replace silent failures)
 * TDD: These tests are written FIRST and should FAIL until implementation
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { updateStatusRemoveInProgress, addToStatusCompleted } from '../wu-status-updater.mjs';
import { WUError, ErrorCodes } from '../error-handler.mjs';

describe('wu-status-updater', () => {
  let testDir;
  let statusPath;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'wu-status-updater-test-'));
    statusPath = join(testDir, 'status.md');
  });

  afterEach(() => {
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  // Valid status.md content (default section headings from STATUS_SECTIONS)
  const VALID_STATUS_CONTENT = `## In Progress

- [WU-100 — Test task](wu/WU-100.yaml)

## Completed

- [WU-050 — Old task](wu/WU-050.yaml) — 2025-01-01
`;

  describe('updateStatusRemoveInProgress', () => {
    it('throws FILE_NOT_FOUND when status.md is missing', () => {
      // No file created - should throw
      assert.throws(
        () => updateStatusRemoveInProgress(statusPath, 'WU-100'),
        (err) => {
          assert.ok(err instanceof WUError, 'Should throw WUError');
          assert.equal(err.code, ErrorCodes.FILE_NOT_FOUND);
          assert.ok(err.message.includes(statusPath), 'Message should include path');
          return true;
        }
      );
    });

    it('throws SECTION_NOT_FOUND when In Progress section is missing', () => {
      // Create status.md without In Progress section (only Completed)
      const contentWithoutInProgress = `## Completed

- [WU-050 — Old task](wu/WU-050.yaml) — 2025-01-01
`;
      writeFileSync(statusPath, contentWithoutInProgress, 'utf8');

      assert.throws(
        () => updateStatusRemoveInProgress(statusPath, 'WU-100'),
        (err) => {
          assert.ok(err instanceof WUError, 'Should throw WUError');
          assert.equal(err.code, ErrorCodes.SECTION_NOT_FOUND);
          assert.ok(err.message.includes('In Progress'), 'Message should mention section');
          return true;
        }
      );
    });

    it('succeeds when file and section exist', () => {
      writeFileSync(statusPath, VALID_STATUS_CONTENT, 'utf8');

      // Should not throw
      assert.doesNotThrow(() => updateStatusRemoveInProgress(statusPath, 'WU-100'));
    });

    it('is idempotent - no error when WU not in section', () => {
      writeFileSync(statusPath, VALID_STATUS_CONTENT, 'utf8');

      // WU-999 is not in the file - should succeed silently (idempotent)
      assert.doesNotThrow(() => updateStatusRemoveInProgress(statusPath, 'WU-999'));
    });
  });

  describe('addToStatusCompleted', () => {
    it('throws FILE_NOT_FOUND when status.md is missing', () => {
      // No file created - should throw
      assert.throws(
        () => addToStatusCompleted(statusPath, 'WU-100', 'Test task'),
        (err) => {
          assert.ok(err instanceof WUError, 'Should throw WUError');
          assert.equal(err.code, ErrorCodes.FILE_NOT_FOUND);
          assert.ok(err.message.includes(statusPath), 'Message should include path');
          return true;
        }
      );
    });

    it('succeeds when file exists', () => {
      writeFileSync(statusPath, VALID_STATUS_CONTENT, 'utf8');

      // Should not throw
      assert.doesNotThrow(() => addToStatusCompleted(statusPath, 'WU-200', 'New task'));
    });

    it('is idempotent - no error when WU already in Completed', () => {
      writeFileSync(statusPath, VALID_STATUS_CONTENT, 'utf8');

      // Add once
      addToStatusCompleted(statusPath, 'WU-200', 'New task');

      // Add again - should succeed silently (idempotent)
      assert.doesNotThrow(() => addToStatusCompleted(statusPath, 'WU-200', 'New task'));
    });
  });
});

/**
 * @file wu-status-updater.test.ts
 * Unit tests for status.md update utilities
 *
 * WU-1275: Tests error throwing behavior (replace silent failures)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { updateStatusRemoveInProgress, addToStatusCompleted } from '../wu-status-updater.js';
import { WUError, ErrorCodes } from '../error-handler.js';

describe('wu-status-updater', () => {
  let testDir: string;
  let statusPath: string;

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
      try {
        updateStatusRemoveInProgress(statusPath, 'WU-100');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err instanceof WUError).toBe(true);
        expect(err.code).toBe(ErrorCodes.FILE_NOT_FOUND);
        expect(err.message.includes(statusPath)).toBe(true);
      }
    });

    it('throws SECTION_NOT_FOUND when In Progress section is missing', () => {
      // Create status.md without In Progress section (only Completed)
      const contentWithoutInProgress = `## Completed

- [WU-050 — Old task](wu/WU-050.yaml) — 2025-01-01
`;
      writeFileSync(statusPath, contentWithoutInProgress, 'utf8');

      try {
        updateStatusRemoveInProgress(statusPath, 'WU-100');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err instanceof WUError).toBe(true);
        expect(err.code).toBe(ErrorCodes.SECTION_NOT_FOUND);
        expect(err.message.includes('In Progress')).toBe(true);
      }
    });

    it('succeeds when file and section exist', () => {
      writeFileSync(statusPath, VALID_STATUS_CONTENT, 'utf8');

      // Should not throw
      expect(() => updateStatusRemoveInProgress(statusPath, 'WU-100')).not.toThrow();
    });

    it('is idempotent - no error when WU not in section', () => {
      writeFileSync(statusPath, VALID_STATUS_CONTENT, 'utf8');

      // WU-999 is not in the file - should succeed silently (idempotent)
      expect(() => updateStatusRemoveInProgress(statusPath, 'WU-999')).not.toThrow();
    });
  });

  describe('addToStatusCompleted', () => {
    it('throws FILE_NOT_FOUND when status.md is missing', () => {
      // No file created - should throw
      try {
        addToStatusCompleted(statusPath, 'WU-100', 'Test task');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err instanceof WUError).toBe(true);
        expect(err.code).toBe(ErrorCodes.FILE_NOT_FOUND);
        expect(err.message.includes(statusPath)).toBe(true);
      }
    });

    it('succeeds when file exists', () => {
      writeFileSync(statusPath, VALID_STATUS_CONTENT, 'utf8');

      // Should not throw
      expect(() => addToStatusCompleted(statusPath, 'WU-200', 'New task')).not.toThrow();
    });

    it('is idempotent - no error when WU already in Completed', () => {
      writeFileSync(statusPath, VALID_STATUS_CONTENT, 'utf8');

      // Add once
      addToStatusCompleted(statusPath, 'WU-200', 'New task');

      // Add again - should succeed silently (idempotent)
      expect(() => addToStatusCompleted(statusPath, 'WU-200', 'New task')).not.toThrow();
    });
  });
});

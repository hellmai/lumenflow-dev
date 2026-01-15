/**
 * @file wu-backlog-updater.test.mjs
 * Unit tests for backlog.md update utilities
 *
 * WU-1275: Tests error throwing behavior (replace silent failures)
 * TDD: These tests are written FIRST and should FAIL until implementation
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { moveWUToDoneBacklog } from '../wu-backlog-updater.js';
import { WUError, ErrorCodes } from '../error-handler.js';

describe('wu-backlog-updater', () => {
  let testDir;
  let backlogPath;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'wu-backlog-updater-test-'));
    backlogPath = join(testDir, 'backlog.md');
  });

  afterEach(() => {
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  // Valid backlog.md content (default BACKLOG_SECTIONS headings)
  const VALID_BACKLOG_CONTENT = `## 🚀 Ready (pull from here)

- [ ] [WU-100 — Test task](docs/04-operations/tasks/wu/WU-100.yaml)

## 🔧 In progress

- [ ] [WU-200 — Another task](docs/04-operations/tasks/wu/WU-200.yaml)

## ⛔ Blocked

## ✅ Done

- [x] [WU-050 — Old task](docs/04-operations/tasks/wu/WU-050.yaml) — 2025-01-01
`;

  describe('moveWUToDoneBacklog', () => {
    it('throws FILE_NOT_FOUND when backlog.md is missing', () => {
      // No file created - should throw
      assert.throws(
        () => moveWUToDoneBacklog(backlogPath, 'WU-100', 'Test task'),
        (err) => {
          assert.ok(err instanceof WUError, 'Should throw WUError');
          assert.equal(err.code, ErrorCodes.FILE_NOT_FOUND);
          assert.ok(err.message.includes(backlogPath), 'Message should include path');
          return true;
        }
      );
    });

    it('throws SECTION_NOT_FOUND when section is missing (not swallowed)', () => {
      // Create backlog without Done section
      const contentWithoutDone = `## 🚀 Ready (pull from here)

- [ ] [WU-100 — Test task](docs/04-operations/tasks/wu/WU-100.yaml)

## 🔧 In progress
`;
      writeFileSync(backlogPath, contentWithoutDone, 'utf8');

      assert.throws(
        () => moveWUToDoneBacklog(backlogPath, 'WU-100', 'Test task'),
        (err) => {
          assert.ok(err instanceof WUError, 'Should throw WUError');
          assert.equal(err.code, ErrorCodes.SECTION_NOT_FOUND);
          return true;
        }
      );
    });

    it('succeeds when WU in Ready section', () => {
      writeFileSync(backlogPath, VALID_BACKLOG_CONTENT, 'utf8');

      // Should not throw
      assert.doesNotThrow(() => moveWUToDoneBacklog(backlogPath, 'WU-100', 'Test task'));

      // Verify move happened - WU-100 should now be in Done section
      const content = readFileSync(backlogPath, 'utf8');
      // Find Done section and verify WU-100 is there
      const doneMatch = content.match(/## ✅ Done[\s\S]*/);
      assert.ok(doneMatch, 'Done section should exist');
      assert.ok(doneMatch[0].includes('WU-100'), 'WU-100 should be in Done section');
    });

    it('succeeds when WU in In Progress section', () => {
      writeFileSync(backlogPath, VALID_BACKLOG_CONTENT, 'utf8');

      // Should not throw
      assert.doesNotThrow(() => moveWUToDoneBacklog(backlogPath, 'WU-200', 'Another task'));

      // Verify move happened
      const content = readFileSync(backlogPath, 'utf8');
      assert.ok(
        content.includes('WU-200') && content.includes('Done'),
        'WU should be in Done section'
      );
    });

    it('is idempotent - no error when WU already in Done', () => {
      writeFileSync(backlogPath, VALID_BACKLOG_CONTENT, 'utf8');

      // Move it first
      moveWUToDoneBacklog(backlogPath, 'WU-100', 'Test task');

      // Move again - should succeed silently (idempotent)
      assert.doesNotThrow(() => moveWUToDoneBacklog(backlogPath, 'WU-100', 'Test task'));
    });

    it('handles WU not in any section gracefully (logs, does not throw)', () => {
      writeFileSync(backlogPath, VALID_BACKLOG_CONTENT, 'utf8');

      // WU-999 is not in the file at all
      // This should NOT throw (idempotent behavior), just log
      assert.doesNotThrow(() => moveWUToDoneBacklog(backlogPath, 'WU-999', 'Unknown task'));
    });

    it('cleans up duplicate entries after race condition (WU-1444)', () => {
      // Setup: WU exists in BOTH In Progress AND Done (simulating race condition after rebase)
      const contentWithRaceCondition = `## 🚀 Ready (pull from here)

## 🔧 In progress

- [WU-RACE — Race task](docs/04-operations/tasks/wu/WU-RACE.yaml)

## ⛔ Blocked

## ✅ Done

- [x] [WU-RACE — Race task](docs/04-operations/tasks/wu/WU-RACE.yaml) (2025-12-05)
`;
      writeFileSync(backlogPath, contentWithRaceCondition, 'utf8');

      // Move to Done (idempotent - already there, but should clean up In Progress duplicate)
      moveWUToDoneBacklog(backlogPath, 'WU-RACE', 'Race task');

      // Verify: WU-RACE should only be in Done section, not In Progress
      const content = readFileSync(backlogPath, 'utf8');

      // Check In Progress section does NOT contain WU-RACE
      const inProgressMatch = content.match(/## 🔧 In progress([\s\S]*?)(?=## ⛔ Blocked|$)/);
      const inProgressSection = inProgressMatch?.[1] || '';
      assert.ok(
        !inProgressSection.includes('WU-RACE'),
        'WU-RACE should be removed from In Progress after cleanup'
      );

      // Check Done section DOES contain WU-RACE
      const doneMatch = content.match(/## ✅ Done([\s\S]*?)$/);
      const doneSection = doneMatch?.[1] || '';
      assert.ok(doneSection.includes('WU-RACE'), 'WU-RACE should remain in Done section');

      // Verify WU-RACE appears exactly once in the file
      const lines = content.split('\n');
      const matchingLines = lines.filter((line) => line.includes('WU-RACE'));
      assert.strictEqual(
        matchingLines.length,
        1,
        'WU-RACE should appear exactly once after race condition cleanup'
      );
    });

    it('cleans up duplicates from Ready and In Progress when moving to Done (WU-1444)', () => {
      // Setup: WU exists in Ready, In Progress, AND Done (extreme race condition)
      const contentWithMultipleDuplicates = `## 🚀 Ready (pull from here)

- [ ] [WU-MULTI — Multi duplicate](docs/04-operations/tasks/wu/WU-MULTI.yaml)

## 🔧 In progress

- [WU-MULTI — Multi duplicate](docs/04-operations/tasks/wu/WU-MULTI.yaml)

## ⛔ Blocked

## ✅ Done

- [x] [WU-MULTI — Multi duplicate](docs/04-operations/tasks/wu/WU-MULTI.yaml) (2025-12-05)
`;
      writeFileSync(backlogPath, contentWithMultipleDuplicates, 'utf8');

      // Move to Done should clean up ALL other sections
      moveWUToDoneBacklog(backlogPath, 'WU-MULTI', 'Multi duplicate');

      const content = readFileSync(backlogPath, 'utf8');

      // Check Ready section does NOT contain WU-MULTI
      const readyMatch = content.match(/## 🚀 Ready.*?\n([\s\S]*?)(?=## 🔧 In progress|$)/);
      const readySection = readyMatch?.[1] || '';
      assert.ok(
        !readySection.includes('WU-MULTI'),
        'WU-MULTI should be removed from Ready after cleanup'
      );

      // Check In Progress section does NOT contain WU-MULTI
      const inProgressMatch = content.match(/## 🔧 In progress([\s\S]*?)(?=## ⛔ Blocked|$)/);
      const inProgressSection = inProgressMatch?.[1] || '';
      assert.ok(
        !inProgressSection.includes('WU-MULTI'),
        'WU-MULTI should be removed from In Progress after cleanup'
      );

      // Verify WU-MULTI appears exactly once
      const lines = content.split('\n');
      const matchingLines = lines.filter((line) => line.includes('WU-MULTI'));
      assert.strictEqual(
        matchingLines.length,
        1,
        'WU-MULTI should appear exactly once after cleanup'
      );
    });
  });
});

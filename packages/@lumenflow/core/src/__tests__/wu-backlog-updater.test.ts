/**
 * @file wu-backlog-updater.test.ts
 * Unit tests for backlog.md update utilities
 *
 * WU-1275: Tests error throwing behavior (replace silent failures)
 *
 * NOTE: These are integration tests that require a full project context
 * (WUStateStore, .lumenflow.config.yaml). Skipped when running in standalone OS repo.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { moveWUToDoneBacklog } from '../wu-backlog-updater.js';
import { ErrorCodes } from '../error-handler.js';

// Check if running in a project with config files
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '../../..');
const hasConfig = existsSync(join(projectRoot, '.lumenflow.config.yaml'));

// Skip integration tests if no project config - these require WUStateStore context
describe.skipIf(!hasConfig)('wu-backlog-updater', () => {
  let testDir: string;
  let backlogPath: string;

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
      try {
        moveWUToDoneBacklog(backlogPath, 'WU-100', 'Test task');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.code).toBe(ErrorCodes.FILE_NOT_FOUND);
        expect(err.message).toContain(backlogPath);
      }
    });

    it('throws SECTION_NOT_FOUND when section is missing (not swallowed)', () => {
      const contentWithoutDone = `## 🚀 Ready (pull from here)

- [ ] [WU-100 — Test task](docs/04-operations/tasks/wu/WU-100.yaml)

## 🔧 In progress
`;
      writeFileSync(backlogPath, contentWithoutDone, 'utf8');

      try {
        moveWUToDoneBacklog(backlogPath, 'WU-100', 'Test task');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.code).toBe(ErrorCodes.SECTION_NOT_FOUND);
      }
    });

    it('succeeds when WU in Ready section', () => {
      writeFileSync(backlogPath, VALID_BACKLOG_CONTENT, 'utf8');
      expect(() => moveWUToDoneBacklog(backlogPath, 'WU-100', 'Test task')).not.toThrow();

      const content = readFileSync(backlogPath, 'utf8');
      const doneMatch = content.match(/## ✅ Done[\s\S]*/);
      expect(doneMatch).toBeTruthy();
      expect(doneMatch![0].includes('WU-100')).toBe(true);
    });

    it('succeeds when WU in In Progress section', () => {
      writeFileSync(backlogPath, VALID_BACKLOG_CONTENT, 'utf8');
      expect(() => moveWUToDoneBacklog(backlogPath, 'WU-200', 'Another task')).not.toThrow();

      const content = readFileSync(backlogPath, 'utf8');
      expect(content.includes('WU-200') && content.includes('Done')).toBe(true);
    });

    it('is idempotent - no error when WU already in Done', () => {
      writeFileSync(backlogPath, VALID_BACKLOG_CONTENT, 'utf8');
      moveWUToDoneBacklog(backlogPath, 'WU-100', 'Test task');
      expect(() => moveWUToDoneBacklog(backlogPath, 'WU-100', 'Test task')).not.toThrow();
    });

    it('handles WU not in any section gracefully (logs, does not throw)', () => {
      writeFileSync(backlogPath, VALID_BACKLOG_CONTENT, 'utf8');
      expect(() => moveWUToDoneBacklog(backlogPath, 'WU-999', 'Unknown task')).not.toThrow();
    });

    it('cleans up duplicate entries after race condition (WU-1444)', () => {
      const contentWithRaceCondition = `## 🚀 Ready (pull from here)

## 🔧 In progress

- [WU-RACE — Race task](docs/04-operations/tasks/wu/WU-RACE.yaml)

## ⛔ Blocked

## ✅ Done

- [x] [WU-RACE — Race task](docs/04-operations/tasks/wu/WU-RACE.yaml) (2025-12-05)
`;
      writeFileSync(backlogPath, contentWithRaceCondition, 'utf8');
      moveWUToDoneBacklog(backlogPath, 'WU-RACE', 'Race task');

      const content = readFileSync(backlogPath, 'utf8');
      const inProgressMatch = content.match(/## 🔧 In progress([\s\S]*?)(?=## ⛔ Blocked|$)/);
      const inProgressSection = inProgressMatch?.[1] || '';
      expect(inProgressSection.includes('WU-RACE')).toBe(false);

      const doneMatch = content.match(/## ✅ Done([\s\S]*?)$/);
      const doneSection = doneMatch?.[1] || '';
      expect(doneSection.includes('WU-RACE')).toBe(true);

      const lines = content.split('\n');
      const matchingLines = lines.filter((line) => line.includes('WU-RACE'));
      expect(matchingLines.length).toBe(1);
    });

    it('cleans up duplicates from Ready and In Progress when moving to Done (WU-1444)', () => {
      const contentWithMultipleDuplicates = `## 🚀 Ready (pull from here)

- [ ] [WU-MULTI — Multi duplicate](docs/04-operations/tasks/wu/WU-MULTI.yaml)

## 🔧 In progress

- [WU-MULTI — Multi duplicate](docs/04-operations/tasks/wu/WU-MULTI.yaml)

## ⛔ Blocked

## ✅ Done

- [x] [WU-MULTI — Multi duplicate](docs/04-operations/tasks/wu/WU-MULTI.yaml) (2025-12-05)
`;
      writeFileSync(backlogPath, contentWithMultipleDuplicates, 'utf8');
      moveWUToDoneBacklog(backlogPath, 'WU-MULTI', 'Multi duplicate');

      const content = readFileSync(backlogPath, 'utf8');
      const readyMatch = content.match(/## 🚀 Ready.*?\n([\s\S]*?)(?=## 🔧 In progress|$)/);
      const readySection = readyMatch?.[1] || '';
      expect(readySection.includes('WU-MULTI')).toBe(false);

      const inProgressMatch = content.match(/## 🔧 In progress([\s\S]*?)(?=## ⛔ Blocked|$)/);
      const inProgressSection = inProgressMatch?.[1] || '';
      expect(inProgressSection.includes('WU-MULTI')).toBe(false);

      const lines = content.split('\n');
      const matchingLines = lines.filter((line) => line.includes('WU-MULTI'));
      expect(matchingLines.length).toBe(1);
    });
  });
});

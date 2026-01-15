/**
 * @file wu-backlog-manager.test.mjs
 * Unit tests for BacklogManager class
 *
 * Tests backlog parsing, item movement between sections,
 * and save operations with frontmatter preservation.
 *
 * Refactored in WU-1244: Use shared fixtures
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BacklogManager } from '../wu-backlog-manager.mjs';
import { TEST_WU_IDS } from '../../__fixtures__/wu-fixtures.mjs';
import { BACKLOG_BULLET_FORMAT } from '../wu-constants.mjs';

// Test WU IDs - use fixtures for consistent naming
const WU_IDS = {
  READY_1: `${TEST_WU_IDS.VALID.replace('TEST-', '')}100`,
  READY_2: `${TEST_WU_IDS.VALID.replace('TEST-', '')}101`,
  IN_PROGRESS: `${TEST_WU_IDS.VALID.replace('TEST-', '')}200`,
  BLOCKED: `${TEST_WU_IDS.VALID.replace('TEST-', '')}300`,
  DONE: `${TEST_WU_IDS.VALID.replace('TEST-', '')}400`,
};

describe('BacklogManager', () => {
  let testDir;
  let backlogPath;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'backlog-manager-test-'));
    backlogPath = join(testDir, 'backlog.md');
  });

  afterEach(() => {
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should load and parse backlog.md with frontmatter', () => {
      const content = `---
headings:
  ready: '## 🚀 Ready (pull from here)'
  in_progress: '## 🔧 In progress'
  blocked: '## ⛔ Blocked'
  done: '## ✅ Done'
---

## 🚀 Ready (pull from here)

- [ ] [${WU_IDS.READY_1} — Test task](docs/04-operations/tasks/wu/${WU_IDS.READY_1}.yaml)

## 🔧 In progress

(No items currently in progress)

## ⛔ Blocked

## ✅ Done
`;
      writeFileSync(backlogPath, content, 'utf8');

      const manager = new BacklogManager(backlogPath);

      assert.ok(manager, 'BacklogManager instance should be created');
    });

    it('should handle backlog.md without frontmatter', () => {
      const content = `## 🚀 Ready

- [ ] [${WU_IDS.READY_1} — Test task](docs/04-operations/tasks/wu/${WU_IDS.READY_1}.yaml)

## 🔧 In progress

## ⛔ Blocked

## ✅ Done
`;
      writeFileSync(backlogPath, content, 'utf8');

      const manager = new BacklogManager(backlogPath);

      assert.ok(manager, 'BacklogManager should handle files without frontmatter');
    });

    it('should throw error if file does not exist', () => {
      const nonexistentPath = join(testDir, 'nonexistent.md');

      assert.throws(
        () => new BacklogManager(nonexistentPath),
        /File not found/,
        'Should throw error for nonexistent file'
      );
    });
  });

  describe('moveItem', () => {
    beforeEach(() => {
      const content = `---
headings:
  ready: '## 🚀 Ready (pull from here)'
  in_progress: '## 🔧 In progress'
  blocked: '## ⛔ Blocked'
  done: '## ✅ Done'
---

## 🚀 Ready (pull from here)

- [ ] [${WU_IDS.READY_1} — Ready task](docs/04-operations/tasks/wu/${WU_IDS.READY_1}.yaml)
- [ ] [${WU_IDS.READY_2} — Another ready task](docs/04-operations/tasks/wu/${WU_IDS.READY_2}.yaml)

## 🔧 In progress

- [${WU_IDS.IN_PROGRESS} — In progress task](docs/04-operations/tasks/wu/${WU_IDS.IN_PROGRESS}.yaml)

## ⛔ Blocked

- [ ] [${WU_IDS.BLOCKED} — Blocked task](docs/04-operations/tasks/wu/${WU_IDS.BLOCKED}.yaml) — Waiting for API

## ✅ Done

- [x] [${WU_IDS.DONE} — Completed task](docs/04-operations/tasks/wu/${WU_IDS.DONE}.yaml) (2025-11-20)
`;
      writeFileSync(backlogPath, content, 'utf8');
    });

    it('should move item from Ready to In Progress', () => {
      const manager = new BacklogManager(backlogPath);

      manager.moveItem(WU_IDS.READY_1, '## 🚀 Ready (pull from here)', '## 🔧 In progress', {
        title: 'Ready task',
        format: BACKLOG_BULLET_FORMAT.PROGRESS, // Format: '- [WU-ID — Title](link)'
      });

      manager.save();

      const result = readFileSync(backlogPath, 'utf8');
      assert.ok(
        !result.includes(`## 🚀 Ready (pull from here)\n\n- [ ] [${WU_IDS.READY_1}`),
        `${WU_IDS.READY_1} should be removed from Ready`
      );
      assert.ok(
        result.includes(`## 🔧 In progress\n\n- [${WU_IDS.READY_1} — Ready task]`),
        `${WU_IDS.READY_1} should be added to In Progress`
      );
    });

    it('should move item from In Progress to Blocked with reason', () => {
      const manager = new BacklogManager(backlogPath);

      manager.moveItem(WU_IDS.IN_PROGRESS, '## 🔧 In progress', '## ⛔ Blocked', {
        title: 'In progress task',
        format: BACKLOG_BULLET_FORMAT.BLOCKED, // Format with reason: '- [ ] [WU-ID — Title](link) — Reason'
        reason: 'Waiting for dependency',
      });

      manager.save();

      const result = readFileSync(backlogPath, 'utf8');
      assert.ok(
        !result.includes(`## 🔧 In progress\n\n- [${WU_IDS.IN_PROGRESS}`),
        `${WU_IDS.IN_PROGRESS} should be removed from In Progress`
      );
      assert.ok(
        result.includes(`## ⛔ Blocked\n\n- [ ] [${WU_IDS.IN_PROGRESS} — In progress task]`),
        `${WU_IDS.IN_PROGRESS} should be added to Blocked`
      );
      assert.ok(result.includes('— Waiting for dependency'), 'Reason should be included');
    });

    it('should move item from Blocked to In Progress (unblocking)', () => {
      const manager = new BacklogManager(backlogPath);

      manager.moveItem(WU_IDS.BLOCKED, '## ⛔ Blocked', '## 🔧 In progress', {
        title: 'Blocked task',
        format: BACKLOG_BULLET_FORMAT.PROGRESS,
      });

      manager.save();

      const result = readFileSync(backlogPath, 'utf8');
      assert.ok(
        !result.includes(`## ⛔ Blocked\n\n- [ ] [${WU_IDS.BLOCKED}`),
        `${WU_IDS.BLOCKED} should be removed from Blocked`
      );
      assert.ok(
        result.includes('## 🔧 In progress') && result.includes(`[${WU_IDS.BLOCKED}`),
        `${WU_IDS.BLOCKED} should be in In Progress`
      );
    });

    it('should move item from In Progress to Done with completion date', () => {
      const manager = new BacklogManager(backlogPath);

      manager.moveItem(WU_IDS.IN_PROGRESS, '## 🔧 In progress', '## ✅ Done', {
        title: 'In progress task',
        format: BACKLOG_BULLET_FORMAT.DONE, // Format: '- [x] [WU-ID — Title](link) (YYYY-MM-DD)'
        completionDate: '2025-11-21',
      });

      manager.save();

      const result = readFileSync(backlogPath, 'utf8');
      assert.ok(
        !result.includes(`## 🔧 In progress\n\n- [${WU_IDS.IN_PROGRESS}`),
        `${WU_IDS.IN_PROGRESS} should be removed from In Progress`
      );
      assert.ok(
        result.includes(`## ✅ Done\n\n- [x] [${WU_IDS.IN_PROGRESS}`),
        `${WU_IDS.IN_PROGRESS} should be added to Done`
      );
      assert.ok(result.includes('(2025-11-21)'), 'Completion date should be included');
    });

    it('should handle "No items currently in progress" placeholder removal', () => {
      const contentWithPlaceholder = `---
headings:
  ready: '## 🚀 Ready'
  in_progress: '## 🔧 In progress'
---

## 🚀 Ready

- [ ] [${WU_IDS.READY_1} — Test](docs/04-operations/tasks/wu/${WU_IDS.READY_1}.yaml)

## 🔧 In progress

(No items currently in progress)
`;
      writeFileSync(backlogPath, contentWithPlaceholder, 'utf8');

      const manager = new BacklogManager(backlogPath);

      manager.moveItem(WU_IDS.READY_1, '## 🚀 Ready', '## 🔧 In progress', {
        title: 'Test',
        format: BACKLOG_BULLET_FORMAT.PROGRESS,
      });

      manager.save();

      const result = readFileSync(backlogPath, 'utf8');
      assert.ok(
        !result.includes('(No items currently in progress)'),
        'Placeholder should be removed'
      );
      assert.ok(
        result.includes(`## 🔧 In progress\n\n- [${WU_IDS.READY_1}`),
        `${WU_IDS.READY_1} should be added`
      );
    });

    it('should be idempotent (skip if item already in target section)', () => {
      const manager = new BacklogManager(backlogPath);

      // Try to move from In Progress to In Progress (no-op)
      manager.moveItem(WU_IDS.IN_PROGRESS, '## 🔧 In progress', '## 🔧 In progress', {
        title: 'In progress task',
        format: BACKLOG_BULLET_FORMAT.PROGRESS,
      });

      manager.save();

      const result = readFileSync(backlogPath, 'utf8');
      // Count lines containing the WU ID (each entry is on one line)
      const lines = result.split('\n');
      const matchingLines = lines.filter((line) => line.includes(WU_IDS.IN_PROGRESS));
      assert.strictEqual(
        matchingLines.length,
        1,
        `${WU_IDS.IN_PROGRESS} should appear on exactly one line (idempotent)`
      );
    });

    it('should clean up duplicate when item is in both source AND target sections (WU-1452)', () => {
      // Setup: WU exists in BOTH Ready AND In Progress (simulating partial claim bug)
      const duplicateWuId = 'WU-DUPLICATE-TEST';
      const contentWithDuplicate = `---
headings:
  ready: '## 🚀 Ready (pull from here)'
  in_progress: '## 🔧 In progress'
  blocked: '## ⛔ Blocked'
  done: '## ✅ Done'
---

## 🚀 Ready (pull from here)

- [ ] [${duplicateWuId} — Duplicate task](docs/04-operations/tasks/wu/${duplicateWuId}.yaml)
- [ ] [${WU_IDS.READY_2} — Another ready task](docs/04-operations/tasks/wu/${WU_IDS.READY_2}.yaml)

## 🔧 In progress

- [${duplicateWuId} — Duplicate task](docs/04-operations/tasks/wu/${duplicateWuId}.yaml)

## ⛔ Blocked

## ✅ Done
`;
      writeFileSync(backlogPath, contentWithDuplicate, 'utf8');

      const manager = new BacklogManager(backlogPath);

      // Move from Ready to In Progress (item already in target)
      manager.moveItem(duplicateWuId, '## 🚀 Ready (pull from here)', '## 🔧 In progress', {
        title: 'Duplicate task',
        format: BACKLOG_BULLET_FORMAT.PROGRESS,
      });

      manager.save();

      const result = readFileSync(backlogPath, 'utf8');
      const lines = result.split('\n');

      // Split content (skip frontmatter) into sections by headings
      const contentWithoutFrontmatter = result.split('---')[2] || result;

      // Verify: Should NOT be in Ready section anymore
      const readySectionMatch = contentWithoutFrontmatter.match(
        /## 🚀 Ready.*?\n([\s\S]*?)(?=## 🔧 In progress|$)/
      );
      const readySection = readySectionMatch?.[1] || '';
      assert.ok(
        !readySection.includes(duplicateWuId),
        `${duplicateWuId} should be removed from Ready section (duplicate cleanup)`
      );

      // Verify: Should appear exactly once in the entire file (outside frontmatter)
      const matchingLines = lines.filter(
        (line) => line.includes(duplicateWuId) && !line.startsWith('  ')
      );
      assert.strictEqual(
        matchingLines.length,
        1,
        `${duplicateWuId} should appear exactly once after duplicate cleanup`
      );

      // Verify: The single occurrence should be in In Progress
      const inProgressSectionMatch = contentWithoutFrontmatter.match(
        /## 🔧 In progress\n([\s\S]*?)(?=## ⛔ Blocked|$)/
      );
      const inProgressSection = inProgressSectionMatch?.[1] || '';
      assert.ok(
        inProgressSection.includes(duplicateWuId),
        `${duplicateWuId} should be in In Progress section`
      );
    });

    it('should preserve frontmatter after move', () => {
      const manager = new BacklogManager(backlogPath);

      manager.moveItem(WU_IDS.READY_1, '## 🚀 Ready (pull from here)', '## 🔧 In progress', {
        title: 'Ready task',
        format: BACKLOG_BULLET_FORMAT.PROGRESS,
      });

      manager.save();

      const result = readFileSync(backlogPath, 'utf8');
      assert.ok(result.startsWith('---\n'), 'Frontmatter should be preserved');
      assert.ok(result.includes('headings:'), 'Frontmatter content should be intact');
    });

    it('should throw error if source section not found', () => {
      const manager = new BacklogManager(backlogPath);

      assert.throws(
        () =>
          manager.moveItem(WU_IDS.READY_1, '## Nonexistent Section', '## 🔧 In progress', {
            title: 'Test',
            format: BACKLOG_BULLET_FORMAT.PROGRESS,
          }),
        /Source section not found/,
        'Should throw error for nonexistent source section'
      );
    });

    it('should throw error if target section not found', () => {
      const manager = new BacklogManager(backlogPath);

      assert.throws(
        () =>
          manager.moveItem(
            WU_IDS.READY_1,
            '## 🚀 Ready (pull from here)',
            '## Nonexistent Section',
            {
              title: 'Test',
              format: BACKLOG_BULLET_FORMAT.PROGRESS,
            }
          ),
        /Target section not found/,
        'Should throw error for nonexistent target section'
      );
    });
  });

  describe('removeFromAllSectionsExcept (WU-1444)', () => {
    beforeEach(() => {
      // Setup: WU exists in multiple sections (simulating race condition after rebase)
      const contentWithDuplicates = `---
headings:
  ready: '## 🚀 Ready (pull from here)'
  in_progress: '## 🔧 In progress'
  blocked: '## ⛔ Blocked'
  done: '## ✅ Done'
---

## 🚀 Ready (pull from here)

- [ ] [WU-RACE-TEST — Race condition WU](docs/04-operations/tasks/wu/WU-RACE-TEST.yaml)
- [ ] [${WU_IDS.READY_2} — Another ready task](docs/04-operations/tasks/wu/${WU_IDS.READY_2}.yaml)

## 🔧 In progress

- [WU-RACE-TEST — Race condition WU](docs/04-operations/tasks/wu/WU-RACE-TEST.yaml)

## ⛔ Blocked

## ✅ Done

- [x] [WU-RACE-TEST — Race condition WU](docs/04-operations/tasks/wu/WU-RACE-TEST.yaml) (2025-12-05)
`;
      writeFileSync(backlogPath, contentWithDuplicates, 'utf8');
    });

    it('should remove WU from all sections except the specified one', () => {
      const manager = new BacklogManager(backlogPath);

      // Remove from all sections except Done (cleanup after race condition)
      manager.removeFromAllSectionsExcept('WU-RACE-TEST', '## ✅ Done');

      manager.save();

      const result = readFileSync(backlogPath, 'utf8');
      const lines = result.split('\n');

      // Should NOT be in Ready section
      const readyMatch = result.match(/## 🚀 Ready.*?\n([\s\S]*?)(?=## 🔧 In progress|$)/);
      const readySection = readyMatch?.[1] || '';
      assert.ok(
        !readySection.includes('WU-RACE-TEST'),
        'WU-RACE-TEST should be removed from Ready section'
      );

      // Should NOT be in In Progress section
      const inProgressMatch = result.match(/## 🔧 In progress\n([\s\S]*?)(?=## ⛔ Blocked|$)/);
      const inProgressSection = inProgressMatch?.[1] || '';
      assert.ok(
        !inProgressSection.includes('WU-RACE-TEST'),
        'WU-RACE-TEST should be removed from In Progress section'
      );

      // SHOULD still be in Done section
      const doneMatch = result.match(/## ✅ Done\n([\s\S]*?)$/);
      const doneSection = doneMatch?.[1] || '';
      assert.ok(
        doneSection.includes('WU-RACE-TEST'),
        'WU-RACE-TEST should remain in Done section'
      );

      // Should appear exactly once in the file (in Done only)
      const matchingLines = lines.filter(
        (line) => line.includes('WU-RACE-TEST') && !line.startsWith('  ')
      );
      assert.strictEqual(
        matchingLines.length,
        1,
        'WU-RACE-TEST should appear exactly once after cleanup'
      );
    });

    it('should be safe to call even if WU only exists in the except section', () => {
      // Setup: WU only in Done (no duplicates)
      const contentNoDuplicates = `---
headings:
  ready: '## 🚀 Ready (pull from here)'
  in_progress: '## 🔧 In progress'
  blocked: '## ⛔ Blocked'
  done: '## ✅ Done'
---

## 🚀 Ready (pull from here)

## 🔧 In progress

## ⛔ Blocked

## ✅ Done

- [x] [WU-ONLY-DONE — Only in done](docs/04-operations/tasks/wu/WU-ONLY-DONE.yaml) (2025-12-05)
`;
      writeFileSync(backlogPath, contentNoDuplicates, 'utf8');

      const manager = new BacklogManager(backlogPath);

      // Should not throw - safe no-op
      manager.removeFromAllSectionsExcept('WU-ONLY-DONE', '## ✅ Done');

      manager.save();

      const result = readFileSync(backlogPath, 'utf8');
      assert.ok(
        result.includes('WU-ONLY-DONE'),
        'WU-ONLY-DONE should still exist in Done section'
      );
    });

    it('should handle WU not in any section (safe no-op)', () => {
      const manager = new BacklogManager(backlogPath);

      // Should not throw for WU that doesn't exist
      manager.removeFromAllSectionsExcept('WU-NONEXISTENT', '## ✅ Done');

      manager.save();

      // File should be unchanged (except formatting)
      const result = readFileSync(backlogPath, 'utf8');
      assert.ok(result.includes('WU-RACE-TEST'), 'Other WUs should be unaffected');
    });
  });

  describe('save', () => {
    it('should write changes back to file with preserved formatting', () => {
      const content = `---
headings:
  ready: '## 🚀 Ready'
  in_progress: '## 🔧 In progress'
---

## 🚀 Ready

- [ ] [${WU_IDS.READY_1} — Test](docs/04-operations/tasks/wu/${WU_IDS.READY_1}.yaml)

## 🔧 In progress

(No items currently in progress)
`;
      writeFileSync(backlogPath, content, 'utf8');

      const manager = new BacklogManager(backlogPath);

      manager.moveItem(WU_IDS.READY_1, '## 🚀 Ready', '## 🔧 In progress', {
        title: 'Test',
        format: BACKLOG_BULLET_FORMAT.PROGRESS,
      });

      manager.save();

      const result = readFileSync(backlogPath, 'utf8');
      assert.ok(result.includes('## 🚀 Ready'), 'Section headers should be preserved');
      assert.ok(result.includes('## 🔧 In progress'), 'Section headers should be preserved');
    });
  });
});

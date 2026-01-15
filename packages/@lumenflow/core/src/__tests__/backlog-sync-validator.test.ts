/**
 * Tests for Backlog Sync Validator (WU-672, WU-1065, WU-1137, WU-1303, WU-1334)
 *
 * WU-1334: Fix false positives when WU IDs appear in prose text
 * - Prose mentions (e.g., "Execution Order: WU-1320 → WU-1321") should NOT be extracted
 * - Only list items, checkboxes, and markdown links should be extracted
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { validateBacklogSync, fixBacklogDuplicates } from '../backlog-sync-validator.js';

const TEST_DIR = '.test-backlog-validator';
const TEST_BACKLOG = path.join(TEST_DIR, 'backlog.md');

describe('backlog-sync-validator (WU-1334: prose vs list items)', () => {
  beforeEach(() => {
    // Create test directory
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('WU ID extraction patterns', () => {
    it('should NOT extract WU IDs from prose text (execution order)', () => {
      const backlog = `---
sections:
  ready:
    heading: "## 🚀 Ready (pull from here)"
  in_progress:
    heading: "## 🔧 In progress"
  blocked:
    heading: "## ⛔ Blocked"
  done:
    heading: "## ✅ Done"
---

# Backlog

## 🚀 Ready (pull from here)

**Execution Order:** WU-1320 → (WU-1321, WU-1322 in parallel) → WU-1323

## ✅ Done
`;

      writeFileSync(TEST_BACKLOG, backlog);
      const result = validateBacklogSync(TEST_BACKLOG);

      // Should not extract WU-1320, WU-1321, WU-1322, WU-1323 from prose
      expect(result.stats.ready).toBe(0);
      expect(result.stats.done).toBe(0);
    });

    it('should NOT extract WU IDs from prose text (dependency mentions)', () => {
      const backlog = `---
sections:
  ready:
    heading: "## 🚀 Ready (pull from here)"
  in_progress:
    heading: "## 🔧 In progress"
  blocked:
    heading: "## ⛔ Blocked"
  done:
    heading: "## ✅ Done"
---

# Backlog

## 🚀 Ready (pull from here)

This implements WU-1234's design from the architecture review.

## ✅ Done
`;

      writeFileSync(TEST_BACKLOG, backlog);
      const result = validateBacklogSync(TEST_BACKLOG);

      // Should not extract WU-1234 from prose
      expect(result.stats.ready).toBe(0);
    });

    it('should extract WU IDs from bullet list items', () => {
      const backlog = `---
sections:
  ready:
    heading: "## 🚀 Ready (pull from here)"
  in_progress:
    heading: "## 🔧 In progress"
  blocked:
    heading: "## ⛔ Blocked"
  done:
    heading: "## ✅ Done"
---

# Backlog

## 🚀 Ready (pull from here)

- WU-1234 - Feature title
- WU-5678 — Another feature

## ✅ Done
`;

      writeFileSync(TEST_BACKLOG, backlog);
      const result = validateBacklogSync(TEST_BACKLOG);

      expect(result.stats.ready).toBe(2);
    });

    it('should extract WU IDs from checkbox list items', () => {
      const backlog = `---
sections:
  ready:
    heading: "## 🚀 Ready (pull from here)"
  in_progress:
    heading: "## 🔧 In progress"
  blocked:
    heading: "## ⛔ Blocked"
  done:
    heading: "## ✅ Done"
---

# Backlog

## 🚀 Ready (pull from here)

- [ ] WU-1234 - Unchecked task
- [x] WU-5678 - Checked task

## ✅ Done
`;

      writeFileSync(TEST_BACKLOG, backlog);
      const result = validateBacklogSync(TEST_BACKLOG);

      expect(result.stats.ready).toBe(2);
    });

    it('should extract WU IDs from markdown links', () => {
      const backlog = `---
sections:
  ready:
    heading: "## 🚀 Ready (pull from here)"
  in_progress:
    heading: "## 🔧 In progress"
  blocked:
    heading: "## ⛔ Blocked"
  done:
    heading: "## ✅ Done"
---

# Backlog

## 🚀 Ready (pull from here)

- [WU-1234 — Feature title](wu/WU-1234.yaml) **P1**
- [WU-5678 - Another feature](wu/WU-5678.yaml)

## ✅ Done
`;

      writeFileSync(TEST_BACKLOG, backlog);
      const result = validateBacklogSync(TEST_BACKLOG);

      expect(result.stats.ready).toBe(2);
    });

    it('should extract WU IDs from asterisk list items', () => {
      const backlog = `---
sections:
  ready:
    heading: "## 🚀 Ready (pull from here)"
  in_progress:
    heading: "## 🔧 In progress"
  blocked:
    heading: "## ⛔ Blocked"
  done:
    heading: "## ✅ Done"
---

# Backlog

## 🚀 Ready (pull from here)

* WU-1234 - Feature title
* WU-5678 — Another feature

## ✅ Done
`;

      writeFileSync(TEST_BACKLOG, backlog);
      const result = validateBacklogSync(TEST_BACKLOG);

      expect(result.stats.ready).toBe(2);
    });

    it('should NOT extract WU IDs from prose in middle of paragraph', () => {
      const backlog = `---
sections:
  ready:
    heading: "## 🚀 Ready (pull from here)"
  in_progress:
    heading: "## 🔧 In progress"
  blocked:
    heading: "## ⛔ Blocked"
  done:
    heading: "## ✅ Done"
---

# Backlog

## 🚀 Ready (pull from here)

See WU-1234 for context and WU-5678 for implementation.

This work builds on WU-9999's foundation.

## ✅ Done
`;

      writeFileSync(TEST_BACKLOG, backlog);
      const result = validateBacklogSync(TEST_BACKLOG);

      expect(result.stats.ready).toBe(0);
    });

    it('should handle mixed prose and list items correctly', () => {
      const backlog = `---
sections:
  ready:
    heading: "## 🚀 Ready (pull from here)"
  in_progress:
    heading: "## 🔧 In progress"
  blocked:
    heading: "## ⛔ Blocked"
  done:
    heading: "## ✅ Done"
---

# Backlog

## 🚀 Ready (pull from here)

**Execution Order:** WU-1000 → WU-1001 → WU-1002

- [WU-1234 — Feature title](wu/WU-1234.yaml) **P1**
- [WU-5678 - Another feature](wu/WU-5678.yaml)

This implements WU-9999's design.

## ✅ Done

- WU-1111 — Completed work
`;

      writeFileSync(TEST_BACKLOG, backlog);
      const result = validateBacklogSync(TEST_BACKLOG);

      // Should only extract list items, not prose mentions
      expect(result.stats.ready).toBe(2);
      expect(result.stats.done).toBe(1);
    });
  });

  describe('duplicate detection with correct extraction', () => {
    it('should detect duplicates between Done and Ready (list items only)', () => {
      const backlog = `---
sections:
  ready:
    heading: "## 🚀 Ready (pull from here)"
  in_progress:
    heading: "## 🔧 In progress"
  blocked:
    heading: "## ⛔ Blocked"
  done:
    heading: "## ✅ Done"
---

# Backlog

## 🚀 Ready (pull from here)

**Note:** See WU-1234 in Done section below.

- [WU-1234 — Feature title](wu/WU-1234.yaml)

## ✅ Done

- [WU-1234 — Feature title](wu/WU-1234.yaml)
`;

      writeFileSync(TEST_BACKLOG, backlog);
      const result = validateBacklogSync(TEST_BACKLOG);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('WU-1234');
      expect(result.errors[0]).toContain('Done and Ready');
    });

    it('should NOT report false duplicates from prose mentions', () => {
      const backlog = `---
sections:
  ready:
    heading: "## 🚀 Ready (pull from here)"
  in_progress:
    heading: "## 🔧 In progress"
  blocked:
    heading: "## ⛔ Blocked"
  done:
    heading: "## ✅ Done"
---

# Backlog

## 🚀 Ready (pull from here)

**Execution Order:** WU-1234 → WU-5678

- [WU-1234 — Feature title](wu/WU-1234.yaml)

## ✅ Done

**Note:** This work references WU-1234 for context.

- [WU-5678 — Completed work](wu/WU-5678.yaml)
`;

      writeFileSync(TEST_BACKLOG, backlog);
      const result = validateBacklogSync(TEST_BACKLOG);

      // Should be valid - prose mentions should not trigger duplicates
      expect(result.valid).toBe(true);
      expect(result.stats.ready).toBe(1);
      expect(result.stats.done).toBe(1);
      expect(result.stats.duplicates).toBe(0);
    });
  });

  describe('fixBacklogDuplicates with correct extraction', () => {
    it('should fix Done+Ready duplicates (list items only)', () => {
      const backlog = `---
sections:
  ready:
    heading: "## 🚀 Ready (pull from here)"
  in_progress:
    heading: "## 🔧 In progress"
  blocked:
    heading: "## ⛔ Blocked"
  done:
    heading: "## ✅ Done"
---

# Backlog

## 🚀 Ready (pull from here)

- [WU-1234 — Feature title](wu/WU-1234.yaml)

## ✅ Done

- [WU-1234 — Feature title](wu/WU-1234.yaml)
`;

      writeFileSync(TEST_BACKLOG, backlog);
      const result = fixBacklogDuplicates(TEST_BACKLOG, { dryRun: false });

      expect(result.fixed).toBe(true);
      expect(result.removed.length).toBe(1);
      expect(result.removed[0].wu).toBe('WU-1234');
      expect(result.removed[0].section).toBe('ready');

      // Verify backlog is now clean
      const validation = validateBacklogSync(TEST_BACKLOG);
      expect(validation.valid).toBe(true);
    });

    it('should fix Done+InProgress duplicates (list items only)', () => {
      const backlog = `---
sections:
  ready:
    heading: "## 🚀 Ready (pull from here)"
  in_progress:
    heading: "## 🔧 In progress"
  blocked:
    heading: "## ⛔ Blocked"
  done:
    heading: "## ✅ Done"
---

# Backlog

## 🔧 In progress

- [WU-1234 — Feature title](wu/WU-1234.yaml)

## ✅ Done

- [WU-1234 — Feature title](wu/WU-1234.yaml)
`;

      writeFileSync(TEST_BACKLOG, backlog);
      const result = fixBacklogDuplicates(TEST_BACKLOG, { dryRun: false });

      expect(result.fixed).toBe(true);
      expect(result.removed.length).toBe(1);
      expect(result.removed[0].wu).toBe('WU-1234');
      expect(result.removed[0].section).toBe('in_progress');
    });

    it('should handle Ready+InProgress duplicates (reported but not auto-fixed)', () => {
      const backlog = `---
sections:
  ready:
    heading: "## 🚀 Ready (pull from here)"
  in_progress:
    heading: "## 🔧 In progress"
  blocked:
    heading: "## ⛔ Blocked"
  done:
    heading: "## ✅ Done"
---

# Backlog

## 🚀 Ready (pull from here)

- [WU-1234 — Feature title](wu/WU-1234.yaml)

## 🔧 In progress

- [WU-1234 — Feature title](wu/WU-1234.yaml)
`;

      writeFileSync(TEST_BACKLOG, backlog);

      // Validation should report it as a warning
      const validation = validateBacklogSync(TEST_BACKLOG);
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain('Ready and In Progress');

      // fixBacklogDuplicates should NOT fix Ready+InProgress
      // (This is normal during wu:claim)
      const result = fixBacklogDuplicates(TEST_BACKLOG, { dryRun: false });
      expect(result.removed.length).toBe(0);
    });

    it('should NOT remove prose mentions when fixing duplicates', () => {
      const backlog = `---
sections:
  ready:
    heading: "## 🚀 Ready (pull from here)"
  in_progress:
    heading: "## 🔧 In progress"
  blocked:
    heading: "## ⛔ Blocked"
  done:
    heading: "## ✅ Done"
---

# Backlog

## 🚀 Ready (pull from here)

**Execution Order:** WU-1234 → WU-5678

- [WU-1234 — Feature title](wu/WU-1234.yaml)

## ✅ Done

**Note:** This references WU-1234 and WU-5678.

- [WU-1234 — Feature title](wu/WU-1234.yaml)
- [WU-5678 — Another feature](wu/WU-5678.yaml)
`;

      writeFileSync(TEST_BACKLOG, backlog);
      const result = fixBacklogDuplicates(TEST_BACKLOG, { dryRun: false });

      expect(result.fixed).toBe(true);
      expect(result.removed.length).toBe(1);
      expect(result.removed[0].wu).toBe('WU-1234');

      // Read the fixed backlog and verify prose is intact
      const fixed = readFileSync(TEST_BACKLOG, 'utf8');

      // Prose mentions should still be present
      expect(fixed).toContain('**Execution Order:** WU-1234 → WU-5678');
      expect(fixed).toContain('**Note:** This references WU-1234 and WU-5678.');

      // But only one list item for WU-1234 (in Done)
      const wu1234Matches = fixed.match(/^[-*]\s*\[.*WU-1234/gm);
      expect(wu1234Matches).toHaveLength(1);
    });
  });

  describe('dry-run mode', () => {
    it('should preview changes without modifying file', () => {
      const backlog = `---
sections:
  ready:
    heading: "## 🚀 Ready (pull from here)"
  in_progress:
    heading: "## 🔧 In progress"
  blocked:
    heading: "## ⛔ Blocked"
  done:
    heading: "## ✅ Done"
---

# Backlog

## 🚀 Ready (pull from here)

- [WU-1234 — Feature title](wu/WU-1234.yaml)

## ✅ Done

- [WU-1234 — Feature title](wu/WU-1234.yaml)
`;

      writeFileSync(TEST_BACKLOG, backlog);
      const originalContent = backlog;

      const result = fixBacklogDuplicates(TEST_BACKLOG, { dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.removed.length).toBe(1);
      expect(result.removed[0].wu).toBe('WU-1234');

      // File should not be modified
      const currentContent = readFileSync(TEST_BACKLOG, 'utf8');
      expect(currentContent).toBe(originalContent);
    });
  });
});

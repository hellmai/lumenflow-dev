/**
 * Tests for Backlog Invariants (WU-1506)
 *
 * TDD: Tests written FIRST before implementation.
 *
 * This module tests the single entrypoint repairBacklogInvariants() that:
 * 1. Validates backlog content for duplicate WUs across sections
 * 2. Repairs duplicates by keeping WUs in their authoritative section
 * 3. Returns repair results for callers to log/handle
 * 4. Throws BacklogRepairError if repair fails
 *
 * Design principles tested:
 * - Idempotent: second call is no-op
 * - Atomic: validates in memory before writing
 * - Pure lib: no console.log/telemetry inside, returns data
 * - Backwards compatible: existing API unchanged
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

// Import the module under test (will fail initially - TDD RED phase)
import {
  repairBacklogInvariants,
  validateBacklogFromContent,
  BacklogRepairError,
} from '../backlog-invariants.mjs';

const TEST_DIR = '.test-backlog-invariants';
const TEST_BACKLOG = path.join(TEST_DIR, 'backlog.md');

// Shared frontmatter template for all tests
const FRONTMATTER = `---
sections:
  ready:
    heading: "## 🚀 Ready (pull from here)"
  in_progress:
    heading: "## 🔧 In progress"
  blocked:
    heading: "## ⛔ Blocked"
  done:
    heading: "## ✅ Done"
---`;

describe('backlog-invariants (WU-1506)', () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('validateBacklogFromContent (pure function, no I/O)', () => {
    it('should return valid=true for clean backlog (no duplicates)', () => {
      const content = `${FRONTMATTER}

# Backlog

## 🚀 Ready (pull from here)

- [WU-100 — Feature A](wu/WU-100.yaml)

## 🔧 In progress

- [WU-200 — Feature B](wu/WU-200.yaml)

## ✅ Done

- [WU-300 — Feature C](wu/WU-300.yaml)
`;

      const result = validateBacklogFromContent(content);

      expect(result.valid).toBe(true);
      expect(result.duplicates).toHaveLength(0);
    });

    it('should detect Done+Ready duplicates', () => {
      const content = `${FRONTMATTER}

# Backlog

## 🚀 Ready (pull from here)

- [WU-100 — Feature A](wu/WU-100.yaml)

## ✅ Done

- [WU-100 — Feature A](wu/WU-100.yaml)
`;

      const result = validateBacklogFromContent(content);

      expect(result.valid).toBe(false);
      expect(result.duplicates).toHaveLength(1);
      expect(result.duplicates[0].wuId).toBe('WU-100');
      expect(result.duplicates[0].sections).toContain('ready');
      expect(result.duplicates[0].sections).toContain('done');
      expect(result.duplicates[0].authoritative).toBe('done');
    });

    it('should detect Done+InProgress duplicates', () => {
      const content = `${FRONTMATTER}

# Backlog

## 🔧 In progress

- [WU-100 — Feature A](wu/WU-100.yaml)

## ✅ Done

- [WU-100 — Feature A](wu/WU-100.yaml)
`;

      const result = validateBacklogFromContent(content);

      expect(result.valid).toBe(false);
      expect(result.duplicates).toHaveLength(1);
      expect(result.duplicates[0].wuId).toBe('WU-100');
      expect(result.duplicates[0].sections).toContain('in_progress');
      expect(result.duplicates[0].sections).toContain('done');
      expect(result.duplicates[0].authoritative).toBe('done');
    });

    it('should detect multiple duplicates in a single pass', () => {
      const content = `${FRONTMATTER}

# Backlog

## 🚀 Ready (pull from here)

- [WU-100 — Feature A](wu/WU-100.yaml)
- [WU-200 — Feature B](wu/WU-200.yaml)

## 🔧 In progress

- [WU-300 — Feature C](wu/WU-300.yaml)

## ✅ Done

- [WU-100 — Feature A](wu/WU-100.yaml)
- [WU-200 — Feature B](wu/WU-200.yaml)
- [WU-300 — Feature C](wu/WU-300.yaml)
`;

      const result = validateBacklogFromContent(content);

      expect(result.valid).toBe(false);
      expect(result.duplicates).toHaveLength(3);
    });

    it('should NOT flag Ready+InProgress as needing repair (normal during claim)', () => {
      const content = `${FRONTMATTER}

# Backlog

## 🚀 Ready (pull from here)

- [WU-100 — Feature A](wu/WU-100.yaml)

## 🔧 In progress

- [WU-100 — Feature A](wu/WU-100.yaml)

## ✅ Done
`;

      const result = validateBacklogFromContent(content);

      // Ready+InProgress is a warning, not a repair target
      // Only Done+{Ready,InProgress} needs repair
      expect(result.duplicates.filter((d) => d.authoritative === 'done')).toHaveLength(0);
    });
  });

  describe('repairBacklogInvariants (single entrypoint)', () => {
    it('should repair Done+Ready duplicate (AC#13)', () => {
      const backlog = `${FRONTMATTER}

# Backlog

## 🚀 Ready (pull from here)

- [WU-100 — Feature A](wu/WU-100.yaml)

## ✅ Done

- [WU-100 — Feature A](wu/WU-100.yaml)
`;

      writeFileSync(TEST_BACKLOG, backlog);

      const result = repairBacklogInvariants(TEST_BACKLOG);

      expect(result.repaired).toBe(true);
      expect(result.count).toBe(1);
      expect(result.repairs).toContainEqual({
        wuId: 'WU-100',
        removedFrom: 'ready',
        keptIn: 'done',
      });

      // Verify file was updated
      const updated = readFileSync(TEST_BACKLOG, 'utf8');
      const readyMatches = updated.match(/^- \[WU-100/gm);
      expect(readyMatches).toHaveLength(1); // Only in Done
    });

    it('should repair Done+InProgress duplicate (AC#14)', () => {
      const backlog = `${FRONTMATTER}

# Backlog

## 🔧 In progress

- [WU-100 — Feature A](wu/WU-100.yaml)

## ✅ Done

- [WU-100 — Feature A](wu/WU-100.yaml)
`;

      writeFileSync(TEST_BACKLOG, backlog);

      const result = repairBacklogInvariants(TEST_BACKLOG);

      expect(result.repaired).toBe(true);
      expect(result.count).toBe(1);
      expect(result.repairs).toContainEqual({
        wuId: 'WU-100',
        removedFrom: 'in_progress',
        keptIn: 'done',
      });
    });

    it('should be idempotent - second call is no-op (AC#15)', () => {
      const backlog = `${FRONTMATTER}

# Backlog

## 🚀 Ready (pull from here)

- [WU-100 — Feature A](wu/WU-100.yaml)

## ✅ Done

- [WU-100 — Feature A](wu/WU-100.yaml)
`;

      writeFileSync(TEST_BACKLOG, backlog);

      // First repair
      const firstResult = repairBacklogInvariants(TEST_BACKLOG);
      expect(firstResult.repaired).toBe(true);
      expect(firstResult.count).toBe(1);

      // Second repair should be no-op
      const secondResult = repairBacklogInvariants(TEST_BACKLOG);
      expect(secondResult.repaired).toBe(false);
      expect(secondResult.count).toBe(0);
    });

    it('should return { repaired: false, count: 0 } for clean backlog', () => {
      const backlog = `${FRONTMATTER}

# Backlog

## 🚀 Ready (pull from here)

- [WU-100 — Feature A](wu/WU-100.yaml)

## ✅ Done

- [WU-200 — Feature B](wu/WU-200.yaml)
`;

      writeFileSync(TEST_BACKLOG, backlog);

      const result = repairBacklogInvariants(TEST_BACKLOG);

      expect(result.repaired).toBe(false);
      expect(result.count).toBe(0);
      expect(result.repairs).toHaveLength(0);
    });

    it('should repair multiple duplicates in a single call', () => {
      const backlog = `${FRONTMATTER}

# Backlog

## 🚀 Ready (pull from here)

- [WU-100 — Feature A](wu/WU-100.yaml)
- [WU-200 — Feature B](wu/WU-200.yaml)

## 🔧 In progress

- [WU-300 — Feature C](wu/WU-300.yaml)

## ✅ Done

- [WU-100 — Feature A](wu/WU-100.yaml)
- [WU-200 — Feature B](wu/WU-200.yaml)
- [WU-300 — Feature C](wu/WU-300.yaml)
`;

      writeFileSync(TEST_BACKLOG, backlog);

      const result = repairBacklogInvariants(TEST_BACKLOG);

      expect(result.repaired).toBe(true);
      expect(result.count).toBe(3);
    });

    it('should throw BacklogRepairError for unfixable corruption (AC#16)', () => {
      // Simulate unfixable corruption by providing a path to a non-existent file
      // or a file with malformed content that cannot be parsed
      const invalidPath = path.join(TEST_DIR, 'nonexistent.md');

      expect(() => repairBacklogInvariants(invalidPath)).toThrow(BacklogRepairError);
    });

    it('should validate in memory before writing (atomic)', () => {
      const backlog = `${FRONTMATTER}

# Backlog

## 🚀 Ready (pull from here)

- [WU-100 — Feature A](wu/WU-100.yaml)

## ✅ Done

- [WU-100 — Feature A](wu/WU-100.yaml)
`;

      writeFileSync(TEST_BACKLOG, backlog);

      const result = repairBacklogInvariants(TEST_BACKLOG);

      // Should validate the repaired content BEFORE writing
      expect(result.repaired).toBe(true);

      // After repair, validateBacklogFromContent should return valid
      const updatedContent = readFileSync(TEST_BACKLOG, 'utf8');
      const validation = validateBacklogFromContent(updatedContent);
      expect(validation.valid).toBe(true);
    });
  });

  describe('BacklogRepairError', () => {
    it('should have correct error code', () => {
      const error = new BacklogRepairError('Test error', { details: 'test' });

      expect(error.name).toBe('BacklogRepairError');
      expect(error.code).toBe('BACKLOG_REPAIR_FAILED');
      expect(error.details).toEqual({ details: 'test' });
    });

    it('should extend Error with proper prototype chain', () => {
      const error = new BacklogRepairError('Test error');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(BacklogRepairError);
    });
  });

  describe('fixBacklogDuplicates returnContent option (backwards compatibility)', () => {
    // This tests the updated fixBacklogDuplicates with returnContent option
    // Import from backlog-sync-validator (existing location)
    it('should return content without writing when returnContent=true', async () => {
      // Dynamically import to test updated function
      const { fixBacklogDuplicates } = await import('../backlog-sync-validator.mjs');

      const backlog = `${FRONTMATTER}

# Backlog

## 🚀 Ready (pull from here)

- [WU-100 — Feature A](wu/WU-100.yaml)

## ✅ Done

- [WU-100 — Feature A](wu/WU-100.yaml)
`;

      writeFileSync(TEST_BACKLOG, backlog);
      const originalContent = backlog;

      const result = fixBacklogDuplicates(TEST_BACKLOG, { returnContent: true });

      // Should return the fixed content
      expect(result.content).toBeDefined();
      // WU-100 should still be in Done section but not duplicated in Ready
      const wu100Matches = result.content.match(/^- \[WU-100/gm);
      expect(wu100Matches).toHaveLength(1); // Only one entry (in Done)

      // File should NOT be modified when returnContent=true
      const currentContent = readFileSync(TEST_BACKLOG, 'utf8');
      expect(currentContent).toBe(originalContent);
    });

    it('should maintain backwards compatibility - default writes to file', async () => {
      const { fixBacklogDuplicates } = await import('../backlog-sync-validator.mjs');

      const backlog = `${FRONTMATTER}

# Backlog

## 🚀 Ready (pull from here)

- [WU-100 — Feature A](wu/WU-100.yaml)

## ✅ Done

- [WU-100 — Feature A](wu/WU-100.yaml)
`;

      writeFileSync(TEST_BACKLOG, backlog);

      const result = fixBacklogDuplicates(TEST_BACKLOG, { dryRun: false });

      // Default behaviour should write to file
      expect(result.fixed).toBe(true);

      // File should be modified
      const updatedContent = readFileSync(TEST_BACKLOG, 'utf8');
      expect(updatedContent).not.toBe(backlog);
    });
  });
});

/**
 * Tests for WU Transaction - Atomic write operations
 *
 * WU-1369: Validates the transactional pattern for wu:done
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  WUTransaction,
  createTransactionSnapshot,
  restoreFromSnapshot,
} from '../wu-transaction.js';

// Test constants - mock paths for unit tests (no actual I/O)
const TEST_DIR = path.join(os.tmpdir(), 'wu-transaction-test');
const MOCK_PATH_ROOT = path.join(os.tmpdir(), 'mock');
const MOCK_FILE = path.join(MOCK_PATH_ROOT, 'file.txt');
const MOCK_FILE_1 = path.join(MOCK_PATH_ROOT, 'file1.txt');
const MOCK_FILE_2 = path.join(MOCK_PATH_ROOT, 'file2.txt');
const MOCK_NEW_FILE = path.join(MOCK_PATH_ROOT, 'new', 'file.txt');

describe('WUTransaction', () => {
  beforeEach(() => {
    // Create clean test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    // Cleanup
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe('constructor', () => {
    it('should create transaction with WU ID', () => {
      const tx = new WUTransaction('WU-123');
      expect(tx.wuId).toBe('WU-123');
      expect(tx.committed).toBe(false);
      expect(tx.aborted).toBe(false);
      expect(tx.size).toBe(0);
    });
  });

  describe('addWrite', () => {
    it('should collect pending writes', () => {
      const tx = new WUTransaction('WU-123');
      tx.addWrite(MOCK_FILE, 'content', 'test file');
      expect(tx.size).toBe(1);

      const writes = tx.getPendingWrites();
      expect(writes).toHaveLength(1);
      expect(writes[0].path).toBe(MOCK_FILE);
      expect(writes[0].content).toBe('content');
      expect(writes[0].description).toBe('test file');
    });

    it('should allow multiple writes', () => {
      const tx = new WUTransaction('WU-123');
      tx.addWrite(MOCK_FILE_1, 'content1', 'file 1');
      tx.addWrite(MOCK_FILE_2, 'content2', 'file 2');
      expect(tx.size).toBe(2);
    });

    it('should throw if transaction already committed', () => {
      const tx = new WUTransaction('WU-123');
      tx.addWrite(path.join(TEST_DIR, 'file.txt'), 'content', 'test');
      tx.commit();

      expect(() => tx.addWrite(MOCK_NEW_FILE, 'content', 'new')).toThrow('committed');
    });

    it('should throw if transaction already aborted', () => {
      const tx = new WUTransaction('WU-123');
      tx.addWrite(MOCK_FILE, 'content', 'test');
      tx.abort();

      expect(() => tx.addWrite(MOCK_NEW_FILE, 'content', 'new')).toThrow('aborted');
    });
  });

  describe('validate', () => {
    it('should return invalid if no pending writes', () => {
      const tx = new WUTransaction('WU-123');
      const result = tx.validate();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No pending writes in transaction');
    });

    it('should return valid with pending writes', () => {
      const tx = new WUTransaction('WU-123');
      tx.addWrite(path.join(TEST_DIR, 'file.txt'), 'content', 'test');
      const result = tx.validate();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect undefined content', () => {
      const tx = new WUTransaction('WU-123');
      tx.addWrite(MOCK_FILE, undefined, 'test');
      const result = tx.validate();
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('undefined');
    });
  });

  describe('commit', () => {
    it('should write all files atomically', () => {
      const file1 = path.join(TEST_DIR, 'file1.txt');
      const file2 = path.join(TEST_DIR, 'file2.txt');

      const tx = new WUTransaction('WU-123');
      tx.addWrite(file1, 'content1', 'file 1');
      tx.addWrite(file2, 'content2', 'file 2');

      // Before commit - no files exist
      expect(existsSync(file1)).toBe(false);
      expect(existsSync(file2)).toBe(false);

      // Commit
      const result = tx.commit();

      // After commit - all files exist
      expect(result.success).toBe(true);
      expect(result.written).toContain(file1);
      expect(result.written).toContain(file2);
      expect(existsSync(file1)).toBe(true);
      expect(existsSync(file2)).toBe(true);
      expect(readFileSync(file1, 'utf8')).toBe('content1');
      expect(readFileSync(file2, 'utf8')).toBe('content2');
    });

    it('should create parent directories', () => {
      const file = path.join(TEST_DIR, 'sub', 'dir', 'file.txt');
      const tx = new WUTransaction('WU-123');
      tx.addWrite(file, 'content', 'nested file');

      const result = tx.commit();

      expect(result.success).toBe(true);
      expect(existsSync(file)).toBe(true);
    });

    it('should clear pending writes after commit', () => {
      const tx = new WUTransaction('WU-123');
      tx.addWrite(path.join(TEST_DIR, 'file.txt'), 'content', 'test');
      tx.commit();

      expect(tx.size).toBe(0);
      expect(tx.committed).toBe(true);
    });

    it('should throw if already committed', () => {
      const tx = new WUTransaction('WU-123');
      tx.addWrite(path.join(TEST_DIR, 'file.txt'), 'content', 'test');
      tx.commit();

      expect(() => tx.commit()).toThrow('already committed');
    });

    it('should throw if aborted', () => {
      const tx = new WUTransaction('WU-123');
      tx.addWrite(MOCK_FILE, 'content', 'test');
      tx.abort();

      expect(() => tx.commit()).toThrow('aborted');
    });
  });

  describe('abort', () => {
    it('should discard pending writes without writing files', () => {
      const file = path.join(TEST_DIR, 'file.txt');
      const tx = new WUTransaction('WU-123');
      tx.addWrite(file, 'content', 'test');

      // Before abort - file doesn't exist, pending writes exist
      expect(existsSync(file)).toBe(false);
      expect(tx.size).toBe(1);

      // Abort
      tx.abort();

      // After abort - file still doesn't exist, pending writes cleared
      expect(existsSync(file)).toBe(false);
      expect(tx.size).toBe(0);
      expect(tx.aborted).toBe(true);
    });

    it('should be safe to call on already-committed transaction', () => {
      const tx = new WUTransaction('WU-123');
      tx.addWrite(path.join(TEST_DIR, 'file.txt'), 'content', 'test');
      tx.commit();

      // Should not throw, just warn
      expect(() => tx.abort()).not.toThrow();
    });
  });

  describe('getState', () => {
    it('should return transaction state', () => {
      const tx = new WUTransaction('WU-123');
      tx.addWrite(MOCK_FILE, 'content', 'test');

      const state = tx.getState();
      expect(state.wuId).toBe('WU-123');
      expect(state.committed).toBe(false);
      expect(state.aborted).toBe(false);
      expect(state.pendingCount).toBe(1);
      expect(state.files).toContain(MOCK_FILE);
    });
  });
});

describe('createTransactionSnapshot', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('should capture existing file contents', () => {
    const file = path.join(TEST_DIR, 'file.txt');
    writeFileSync(file, 'original content');

    const snapshot = createTransactionSnapshot([file]);
    expect(snapshot.get(file)).toBe('original content');
  });

  it('should capture null for non-existent files', () => {
    const file = path.join(TEST_DIR, 'nonexistent.txt');
    const snapshot = createTransactionSnapshot([file]);
    expect(snapshot.get(file)).toBeNull();
  });
});

describe('restoreFromSnapshot', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('should restore original content', () => {
    const file = path.join(TEST_DIR, 'file.txt');
    writeFileSync(file, 'original content');

    const snapshot = createTransactionSnapshot([file]);

    // Modify file
    writeFileSync(file, 'modified content');
    expect(readFileSync(file, 'utf8')).toBe('modified content');

    // Restore
    const result = restoreFromSnapshot(snapshot);
    expect(result.restored).toContain(file);
    expect(readFileSync(file, 'utf8')).toBe('original content');
  });

  it('should delete file that was created after snapshot', () => {
    const file = path.join(TEST_DIR, 'new-file.txt');

    // Snapshot captures that file didn't exist
    const snapshot = createTransactionSnapshot([file]);
    expect(snapshot.get(file)).toBeNull();

    // Create file
    writeFileSync(file, 'new content');
    expect(existsSync(file)).toBe(true);

    // Restore should delete the file
    const result = restoreFromSnapshot(snapshot);
    expect(result.restored).toContain(file);
    expect(existsSync(file)).toBe(false);
  });
});

describe('Atomic Behavior Integration', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('should not write any files if validation fails before commit', () => {
    const file1 = path.join(TEST_DIR, 'file1.txt');
    const file2 = path.join(TEST_DIR, 'file2.txt');

    const tx = new WUTransaction('WU-123');
    tx.addWrite(file1, 'content1', 'file 1');
    tx.addWrite(file2, undefined, 'file 2'); // Invalid content

    // Validate shows failure
    const validation = tx.validate();
    expect(validation.valid).toBe(false);

    // Abort transaction
    tx.abort();

    // No files should exist
    expect(existsSync(file1)).toBe(false);
    expect(existsSync(file2)).toBe(false);
  });

  it('should support full transaction workflow', () => {
    const wuPath = path.join(TEST_DIR, 'WU-123.yaml');
    const statusPath = path.join(TEST_DIR, 'status.md');
    const backlogPath = path.join(TEST_DIR, 'backlog.md');
    const stampPath = path.join(TEST_DIR, 'WU-123.done');

    // Create initial files
    writeFileSync(statusPath, '## In Progress\n- WU-123\n## Completed\n');
    writeFileSync(backlogPath, '## Ready\n## In Progress\n- WU-123\n## Done\n');

    const tx = new WUTransaction('WU-123');

    // Add all writes
    tx.addWrite(wuPath, 'id: WU-123\nstatus: done\n', 'WU YAML');
    tx.addWrite(statusPath, '## In Progress\n## Completed\n- WU-123\n', 'status.md');
    tx.addWrite(backlogPath, '## Ready\n## In Progress\n## Done\n- WU-123\n', 'backlog.md');
    tx.addWrite(stampPath, 'WU WU-123 — Test\nCompleted: 2025-01-01\n', 'stamp');

    // Validate
    const validation = tx.validate();
    expect(validation.valid).toBe(true);

    // Commit
    const result = tx.commit();
    expect(result.success).toBe(true);
    expect(result.written).toHaveLength(4);

    // All files exist and have correct content
    expect(readFileSync(wuPath, 'utf8')).toContain('status: done');
    expect(readFileSync(statusPath, 'utf8')).toContain('Completed');
    expect(existsSync(stampPath)).toBe(true);
  });
});

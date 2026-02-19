/**
 * Memory Checkpoint Core Tests (WU-1909)
 *
 * Tests for createCheckpoint core logic.
 *
 * Key behavioral requirements:
 * - createCheckpoint writes ONLY to memory store (appendNode), NOT wu-events.jsonl
 * - State-store propagation is the caller's responsibility (SRP)
 * - ensureMemoryDir uses shared fs-utils module
 *
 * @see {@link packages/@lumenflow/memory/src/mem-checkpoint-core.ts} - Implementation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createCheckpoint } from '../src/mem-checkpoint-core.js';

describe('mem-checkpoint-core (WU-1909)', () => {
  let testDir: string;
  let memoryDir: string;
  let stateDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mem-checkpoint-test-'));
    memoryDir = path.join(testDir, '.lumenflow', 'memory');
    stateDir = path.join(testDir, '.lumenflow', 'state');
    await fs.mkdir(memoryDir, { recursive: true });
    await fs.mkdir(stateDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('createCheckpoint', () => {
    it('should create a checkpoint node in memory store', async () => {
      const result = await createCheckpoint(testDir, {
        note: 'Test checkpoint',
        wuId: 'WU-1909',
      });

      expect(result.success).toBe(true);
      expect(result.checkpoint).toBeDefined();
      expect(result.checkpoint.type).toBe('checkpoint');
      expect(result.checkpoint.content).toContain('Test checkpoint');
      expect(result.checkpoint.wu_id).toBe('WU-1909');
    });

    it('should write checkpoint to memory.jsonl (appendNode)', async () => {
      await createCheckpoint(testDir, {
        note: 'Memory store test',
        wuId: 'WU-1909',
      });

      const memoryFile = path.join(memoryDir, 'memory.jsonl');
      const content = await fs.readFile(memoryFile, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(1);

      const node = JSON.parse(lines[0]);
      expect(node.type).toBe('checkpoint');
      expect(node.content).toContain('Memory store test');
    });

    it('should NOT write to wu-events.jsonl (WU-1909 fix)', async () => {
      // Create a wu-events.jsonl to ensure it is not modified
      const eventsFile = path.join(stateDir, 'wu-events.jsonl');
      await fs.writeFile(eventsFile, '', 'utf-8');
      const statBefore = await fs.stat(eventsFile);

      await createCheckpoint(testDir, {
        note: 'Should not write to events',
        wuId: 'WU-1909',
      });

      // Verify wu-events.jsonl was NOT modified
      const content = await fs.readFile(eventsFile, 'utf-8');
      expect(content).toBe('');

      const statAfter = await fs.stat(eventsFile);
      expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
    });

    it('should NOT import or reference WUStateStore', async () => {
      // This is a static analysis check - ensure createCheckpoint source
      // does not import WUStateStore (SRP enforcement)
      const sourceFile = path.join(
        path.dirname(path.dirname(new URL(import.meta.url).pathname)),
        'src',
        'mem-checkpoint-core.ts',
      );
      const source = await fs.readFile(sourceFile, 'utf-8');
      expect(source).not.toContain('WUStateStore');
      expect(source).not.toContain('wu-state-store');
    });

    it('should throw when note is missing', async () => {
      await expect(
        createCheckpoint(testDir, {
          note: null as unknown as string,
        }),
      ).rejects.toThrow('note is required');
    });

    it('should throw when note is empty', async () => {
      await expect(
        createCheckpoint(testDir, {
          note: '',
        }),
      ).rejects.toThrow('note cannot be empty');
    });

    it('should throw on invalid WU ID', async () => {
      await expect(
        createCheckpoint(testDir, {
          note: 'test',
          wuId: 'invalid',
        }),
      ).rejects.toThrow('Invalid WU ID');
    });

    it('should include metadata when provided', async () => {
      const result = await createCheckpoint(testDir, {
        note: 'Metadata test',
        progress: 'TDD passing',
        nextSteps: 'Add integration tests',
        trigger: 'pre-compact',
      });

      expect(result.checkpoint.metadata).toEqual({
        progress: 'TDD passing',
        nextSteps: 'Add integration tests',
        trigger: 'pre-compact',
      });
    });

    it('should include session_id when provided', async () => {
      const sessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const result = await createCheckpoint(testDir, {
        note: 'Session test',
        sessionId,
      });

      expect(result.checkpoint.session_id).toBe(sessionId);
    });

    it('should generate unique IDs for different checkpoints', async () => {
      const result1 = await createCheckpoint(testDir, { note: 'First' });
      const result2 = await createCheckpoint(testDir, { note: 'Second' });

      expect(result1.checkpoint.id).not.toBe(result2.checkpoint.id);
    });
  });
});

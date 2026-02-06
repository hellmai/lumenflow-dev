/**
 * Memory Layer Integration Tests (WU-1363)
 *
 * Integration tests for memory layer operations:
 * - AC3: mem:checkpoint, mem:signal, mem:inbox
 *
 * These tests validate the memory layer's ability to:
 * - Create checkpoints for context preservation
 * - Send and receive signals for agent coordination
 * - Filter and query signals from inbox
 *
 * TDD: Tests written BEFORE implementation verification.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCheckpoint, createSignal, loadSignals, markSignalsAsRead } from '@lumenflow/memory';
import {
  generateEnforcementHooks,
  generateAutoCheckpointScript,
  type EnforcementConfig,
} from '../hooks/enforcement-generator.js';
import {
  checkAutoCheckpointWarning,
  cleanupHookCounters,
} from '../hooks/auto-checkpoint-utils.js';

// Test constants
const TEST_WU_ID = 'WU-9910';
const TEST_LANE = 'Framework: CLI';
// Session ID must be a valid UUID
const TEST_SESSION_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

/**
 * Helper to create minimal memory directory structure
 */
function createMemoryProject(baseDir: string): void {
  const dirs = ['.lumenflow/memory', '.lumenflow/state'];

  for (const dir of dirs) {
    mkdirSync(join(baseDir, dir), { recursive: true });
  }

  // Create minimal config
  const configContent = `
version: 1
memory:
  enabled: true
  decay:
    enabled: false
`;
  writeFileSync(join(baseDir, '.lumenflow.config.yaml'), configContent);
}

describe('Memory Layer Integration Tests (WU-1363)', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `memory-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
    originalCwd = process.cwd();
    createMemoryProject(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('AC3: Integration tests for memory checkpoint, signal, inbox', () => {
    describe('mem:checkpoint functionality', () => {
      it('should create a checkpoint node with correct structure', async () => {
        // Arrange
        process.chdir(tempDir);
        const note = 'Checkpoint before gates';

        // Act
        const result = await createCheckpoint(tempDir, {
          note,
          wuId: TEST_WU_ID,
          sessionId: TEST_SESSION_ID,
        });

        // Assert
        expect(result.success).toBe(true);
        expect(result.checkpoint).toBeDefined();
        expect(result.checkpoint.id).toMatch(/^mem-/);
        expect(result.checkpoint.type).toBe('checkpoint');
        expect(result.checkpoint.content).toContain(note);
        expect(result.checkpoint.wu_id).toBe(TEST_WU_ID);
        expect(result.checkpoint.session_id).toBe(TEST_SESSION_ID);
      });

      it('should include progress and nextSteps in metadata', async () => {
        // Arrange
        process.chdir(tempDir);
        const progress = 'Completed AC1 and AC2';
        const nextSteps = 'Run gates and complete wu:done';

        // Act
        const result = await createCheckpoint(tempDir, {
          note: 'Progress checkpoint',
          wuId: TEST_WU_ID,
          progress,
          nextSteps,
        });

        // Assert
        expect(result.checkpoint.metadata).toBeDefined();
        expect(result.checkpoint.metadata?.progress).toBe(progress);
        expect(result.checkpoint.metadata?.nextSteps).toBe(nextSteps);
      });

      it('should persist checkpoint to memory store', async () => {
        // Arrange
        process.chdir(tempDir);

        // Act
        await createCheckpoint(tempDir, {
          note: 'Persisted checkpoint',
          wuId: TEST_WU_ID,
        });

        // Assert - Check memory file exists (memory store uses memory.jsonl)
        const memoryFile = join(tempDir, '.lumenflow/memory/memory.jsonl');
        expect(existsSync(memoryFile)).toBe(true);

        const content = readFileSync(memoryFile, 'utf-8');
        expect(content).toContain('Persisted checkpoint');
      });

      it('should validate note is required', async () => {
        // Arrange
        process.chdir(tempDir);

        // Act & Assert
        await expect(
          createCheckpoint(tempDir, {
            note: '',
            wuId: TEST_WU_ID,
          }),
        ).rejects.toThrow(/empty/i);
      });

      it('should validate WU ID format if provided', async () => {
        // Arrange
        process.chdir(tempDir);

        // Act & Assert
        await expect(
          createCheckpoint(tempDir, {
            note: 'Test checkpoint',
            wuId: 'INVALID-ID',
          }),
        ).rejects.toThrow(/WU/i);
      });
    });

    describe('mem:signal functionality', () => {
      it('should create a signal with correct structure', async () => {
        // Arrange
        process.chdir(tempDir);
        const message = 'Starting implementation';

        // Act
        const result = await createSignal(tempDir, {
          message,
          wuId: TEST_WU_ID,
          lane: TEST_LANE,
        });

        // Assert
        expect(result.success).toBe(true);
        expect(result.signal).toBeDefined();
        expect(result.signal.id).toMatch(/^sig-/);
        expect(result.signal.message).toBe(message);
        expect(result.signal.wu_id).toBe(TEST_WU_ID);
        expect(result.signal.lane).toBe(TEST_LANE);
        expect(result.signal.read).toBe(false);
      });

      it('should persist signal to signals.jsonl', async () => {
        // Arrange
        process.chdir(tempDir);

        // Act
        await createSignal(tempDir, {
          message: 'Persisted signal',
          wuId: TEST_WU_ID,
        });

        // Assert
        const signalsFile = join(tempDir, '.lumenflow/memory/signals.jsonl');
        expect(existsSync(signalsFile)).toBe(true);

        const content = readFileSync(signalsFile, 'utf-8');
        expect(content).toContain('Persisted signal');
      });

      it('should validate message is required', async () => {
        // Arrange
        process.chdir(tempDir);

        // Act & Assert
        await expect(
          createSignal(tempDir, {
            message: '',
            wuId: TEST_WU_ID,
          }),
        ).rejects.toThrow(/required/i);
      });

      it('should validate WU ID format if provided', async () => {
        // Arrange
        process.chdir(tempDir);

        // Act & Assert
        await expect(
          createSignal(tempDir, {
            message: 'Test signal',
            wuId: 'INVALID-123',
          }),
        ).rejects.toThrow(/WU/i);
      });
    });

    describe('mem:inbox functionality', () => {
      it('should load all signals', async () => {
        // Arrange
        process.chdir(tempDir);
        await createSignal(tempDir, { message: 'Signal 1', wuId: TEST_WU_ID });
        await createSignal(tempDir, { message: 'Signal 2', wuId: TEST_WU_ID });
        await createSignal(tempDir, { message: 'Signal 3', wuId: 'WU-9999' });

        // Act
        const signals = await loadSignals(tempDir);

        // Assert
        expect(signals).toHaveLength(3);
      });

      it('should filter signals by WU ID', async () => {
        // Arrange
        process.chdir(tempDir);
        await createSignal(tempDir, { message: 'Signal 1', wuId: TEST_WU_ID });
        await createSignal(tempDir, { message: 'Signal 2', wuId: TEST_WU_ID });
        await createSignal(tempDir, { message: 'Other WU', wuId: 'WU-9999' });

        // Act
        const signals = await loadSignals(tempDir, { wuId: TEST_WU_ID });

        // Assert
        expect(signals).toHaveLength(2);
        signals.forEach((sig) => expect(sig.wu_id).toBe(TEST_WU_ID));
      });

      it('should filter signals by lane', async () => {
        // Arrange
        process.chdir(tempDir);
        await createSignal(tempDir, { message: 'CLI signal', lane: TEST_LANE });
        await createSignal(tempDir, { message: 'Other lane', lane: 'Framework: Core' });

        // Act
        const signals = await loadSignals(tempDir, { lane: TEST_LANE });

        // Assert
        expect(signals).toHaveLength(1);
        expect(signals[0].lane).toBe(TEST_LANE);
      });

      it('should filter unread signals only', async () => {
        // Arrange
        process.chdir(tempDir);
        const result1 = await createSignal(tempDir, { message: 'Unread signal' });
        await createSignal(tempDir, { message: 'Another unread' });

        // Mark first as read
        await markSignalsAsRead(tempDir, [result1.signal.id]);

        // Act
        const signals = await loadSignals(tempDir, { unreadOnly: true });

        // Assert
        expect(signals).toHaveLength(1);
        expect(signals[0].message).toBe('Another unread');
      });

      it('should filter signals since a specific time', async () => {
        // Arrange
        process.chdir(tempDir);
        const beforeTime = new Date();

        // Wait a bit to ensure time difference
        await new Promise((resolve) => setTimeout(resolve, 50));
        await createSignal(tempDir, { message: 'Recent signal' });

        // Act
        const signals = await loadSignals(tempDir, { since: beforeTime });

        // Assert
        expect(signals).toHaveLength(1);
        expect(signals[0].message).toBe('Recent signal');
      });

      it('should return empty array when no signals exist', async () => {
        // Arrange
        process.chdir(tempDir);

        // Act
        const signals = await loadSignals(tempDir);

        // Assert
        expect(signals).toHaveLength(0);
      });
    });

    describe('mark signals as read', () => {
      it('should mark signals as read', async () => {
        // Arrange
        process.chdir(tempDir);
        const result1 = await createSignal(tempDir, { message: 'Signal 1' });
        const result2 = await createSignal(tempDir, { message: 'Signal 2' });

        // Act
        const markResult = await markSignalsAsRead(tempDir, [result1.signal.id, result2.signal.id]);

        // Assert
        expect(markResult.markedCount).toBe(2);

        // Verify signals are now read
        const allSignals = await loadSignals(tempDir);
        expect(allSignals.every((sig) => sig.read)).toBe(true);
      });

      it('should not count already-read signals', async () => {
        // Arrange
        process.chdir(tempDir);
        const result = await createSignal(tempDir, { message: 'Signal 1' });

        // Mark as read first time
        await markSignalsAsRead(tempDir, [result.signal.id]);

        // Act - Try to mark again
        const secondMarkResult = await markSignalsAsRead(tempDir, [result.signal.id]);

        // Assert
        expect(secondMarkResult.markedCount).toBe(0);
      });
    });

    describe('WU-1471: Auto-checkpoint enforcement hooks', () => {
      describe('AC1: generateEnforcementHooks generates PostToolUse and SubagentStop hooks', () => {
        it('should generate postToolUse hook when auto_checkpoint enabled and hooks=true', () => {
          const config: EnforcementConfig = {
            block_outside_worktree: false,
            require_wu_for_edits: false,
            warn_on_stop_without_wu_done: false,
            auto_checkpoint: { enabled: true, interval_tool_calls: 30 },
          };

          const hooks = generateEnforcementHooks(config);

          // Should have postToolUse with auto-checkpoint
          expect(hooks.postToolUse).toBeDefined();
          expect(hooks.postToolUse).toHaveLength(1);
          expect(hooks.postToolUse?.[0].hooks[0].command).toContain('auto-checkpoint.sh');
        });

        it('should generate subagentStop hook when auto_checkpoint enabled', () => {
          const config: EnforcementConfig = {
            block_outside_worktree: false,
            require_wu_for_edits: false,
            warn_on_stop_without_wu_done: false,
            auto_checkpoint: { enabled: true, interval_tool_calls: 30 },
          };

          const hooks = generateEnforcementHooks(config);

          // Should have subagentStop with auto-checkpoint
          expect(hooks.subagentStop).toBeDefined();
          expect(hooks.subagentStop).toHaveLength(1);
          expect(hooks.subagentStop?.[0].hooks[0].command).toContain('auto-checkpoint.sh');
        });

        it('should NOT generate auto-checkpoint hooks when auto_checkpoint disabled', () => {
          const config: EnforcementConfig = {
            block_outside_worktree: true,
            require_wu_for_edits: false,
            warn_on_stop_without_wu_done: false,
            auto_checkpoint: { enabled: false, interval_tool_calls: 30 },
          };

          const hooks = generateEnforcementHooks(config);

          expect(hooks.postToolUse).toBeUndefined();
          expect(hooks.subagentStop).toBeUndefined();
        });

        it('should NOT generate auto-checkpoint hooks when auto_checkpoint not provided', () => {
          const config: EnforcementConfig = {
            block_outside_worktree: false,
            require_wu_for_edits: false,
            warn_on_stop_without_wu_done: false,
          };

          const hooks = generateEnforcementHooks(config);

          // preToolUse should be absent (no write/edit hooks requested either)
          expect(hooks.postToolUse).toBeUndefined();
          expect(hooks.subagentStop).toBeUndefined();
        });
      });

      describe('AC2: auto-checkpoint script branches on hook_event_name', () => {
        it('should generate a bash script', () => {
          const script = generateAutoCheckpointScript(30);

          expect(script).toContain('#!/bin/bash');
        });

        it('should reference hook_event_name for branching', () => {
          const script = generateAutoCheckpointScript(30);

          expect(script).toContain('hook_event_name');
        });

        it('should use defensive subshell for backgrounding', () => {
          const script = generateAutoCheckpointScript(30);

          // Should background checkpoint writes
          expect(script).toContain('&');
        });

        it('should embed the interval_tool_calls value', () => {
          const script = generateAutoCheckpointScript(50);

          expect(script).toContain('50');
        });

        it('should reference hook-counters directory', () => {
          const script = generateAutoCheckpointScript(30);

          expect(script).toContain('hook-counters');
        });
      });

      describe('AC4: cleanupHookCounters removes counter file for completed WU', () => {
        it('should remove counter file when it exists', () => {
          // Arrange
          const countersDir = join(tempDir, '.lumenflow/state/hook-counters');
          mkdirSync(countersDir, { recursive: true });
          const counterFile = join(countersDir, `${TEST_WU_ID}.json`);
          writeFileSync(counterFile, JSON.stringify({ count: 15 }));

          // Act
          cleanupHookCounters(tempDir, TEST_WU_ID);

          // Assert
          expect(existsSync(counterFile)).toBe(false);
        });

        it('should not throw when counter file does not exist', () => {
          // Act & Assert - should not throw
          expect(() => cleanupHookCounters(tempDir, TEST_WU_ID)).not.toThrow();
        });

        it('should not throw when counters directory does not exist', () => {
          // Use a clean temp dir without hook-counters
          const cleanDir = join(tmpdir(), `clean-${Date.now()}`);
          mkdirSync(cleanDir, { recursive: true });

          // Act & Assert - should not throw
          expect(() => cleanupHookCounters(cleanDir, TEST_WU_ID)).not.toThrow();

          // Cleanup
          rmSync(cleanDir, { recursive: true, force: true });
        });
      });

      describe('AC5: checkAutoCheckpointWarning when hooks disabled but policy enabled', () => {
        it('should return warning when auto_checkpoint enabled but hooks master switch disabled', () => {
          const result = checkAutoCheckpointWarning({
            hooksEnabled: false,
            autoCheckpointEnabled: true,
          });

          expect(result.warning).toBe(true);
          expect(result.message).toContain('advisory');
        });

        it('should return no warning when both hooks and auto_checkpoint enabled', () => {
          const result = checkAutoCheckpointWarning({
            hooksEnabled: true,
            autoCheckpointEnabled: true,
          });

          expect(result.warning).toBe(false);
        });

        it('should return no warning when auto_checkpoint disabled', () => {
          const result = checkAutoCheckpointWarning({
            hooksEnabled: false,
            autoCheckpointEnabled: false,
          });

          expect(result.warning).toBe(false);
        });
      });
    });

    describe('complete memory workflow', () => {
      it('should support full checkpoint and signal workflow', async () => {
        // This test validates the complete memory workflow:
        // 1. Create initial checkpoint
        // 2. Send progress signals
        // 3. Check inbox for signals
        // 4. Mark signals as read
        // 5. Create final checkpoint

        // Arrange
        process.chdir(tempDir);

        // Step 1: Initial checkpoint
        const initialCheckpoint = await createCheckpoint(tempDir, {
          note: 'Starting work on WU',
          wuId: TEST_WU_ID,
          sessionId: TEST_SESSION_ID,
        });
        expect(initialCheckpoint.success).toBe(true);

        // Step 2: Send progress signals
        await createSignal(tempDir, {
          message: 'AC1 complete',
          wuId: TEST_WU_ID,
          lane: TEST_LANE,
        });
        await createSignal(tempDir, {
          message: 'AC2 in progress',
          wuId: TEST_WU_ID,
          lane: TEST_LANE,
        });

        // Step 3: Check inbox
        const inbox = await loadSignals(tempDir, { wuId: TEST_WU_ID, unreadOnly: true });
        expect(inbox).toHaveLength(2);

        // Step 4: Mark as read
        const signalIds = inbox.map((sig) => sig.id);
        await markSignalsAsRead(tempDir, signalIds);

        const unreadAfter = await loadSignals(tempDir, { unreadOnly: true });
        expect(unreadAfter).toHaveLength(0);

        // Step 5: Final checkpoint
        const finalCheckpoint = await createCheckpoint(tempDir, {
          note: 'Work complete, ready for wu:done',
          wuId: TEST_WU_ID,
          sessionId: TEST_SESSION_ID,
          progress: 'All acceptance criteria met',
          nextSteps: 'Run pnpm wu:done --id ' + TEST_WU_ID,
        });
        expect(finalCheckpoint.success).toBe(true);

        // Verify memory store has all data (memory store uses memory.jsonl)
        const memoryFile = join(tempDir, '.lumenflow/memory/memory.jsonl');
        expect(existsSync(memoryFile)).toBe(true);
      });
    });
  });
});

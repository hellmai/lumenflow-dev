/**
 * Memory Layer Integration Tests (WU-1363, WU-1474)
 *
 * Integration tests for memory layer operations:
 * - AC3: mem:checkpoint, mem:signal, mem:inbox
 * - WU-1474: Decay policy activation in completion lifecycle
 *
 * These tests validate the memory layer's ability to:
 * - Create checkpoints for context preservation
 * - Send and receive signals for agent coordination
 * - Filter and query signals from inbox
 * - Invoke decay archival during wu:done when configured (WU-1474)
 *
 * TDD: Tests written BEFORE implementation verification.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCheckpoint, createSignal, loadSignals, markSignalsAsRead } from '@lumenflow/memory';
import {
  generateEnforcementHooks,
  generateAutoCheckpointScript,
  generatePreCompactCheckpointScript,
  generateSessionStartRecoveryScript,
  surfaceUnreadSignals,
  markCompletedWUSignalsAsRead,
  type EnforcementConfig,
} from '../hooks/enforcement-generator.js';
import { checkAutoCheckpointWarning, cleanupHookCounters } from '../hooks/auto-checkpoint-utils.js';
// WU-1474: Import decay config schema and wu-done decay runner
import { MemoryDecayConfigSchema, type MemoryDecayConfig } from '@lumenflow/core/config-schema';
import { runDecayOnDone } from '../wu-done-decay.js';

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

          // Should have postToolUse with auto-checkpoint + WU-1502 dirty-main
          expect(hooks.postToolUse).toBeDefined();
          expect(hooks.postToolUse).toHaveLength(2);
          expect(hooks.postToolUse?.[0].hooks[0].command).toContain('auto-checkpoint.sh');
          expect(hooks.postToolUse?.[1].matcher).toBe('Bash');
          expect(hooks.postToolUse?.[1].hooks[0].command).toContain('warn-dirty-main.sh');
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

          // WU-1502: postToolUse always contains dirty-main hook, but NOT auto-checkpoint
          expect(hooks.postToolUse).toBeDefined();
          expect(hooks.postToolUse).toHaveLength(1);
          expect(hooks.postToolUse?.[0].matcher).toBe('Bash');
          expect(hooks.postToolUse?.[0].hooks[0].command).toContain('warn-dirty-main.sh');
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
          // WU-1502: postToolUse always contains dirty-main hook, but NOT auto-checkpoint
          expect(hooks.postToolUse).toBeDefined();
          expect(hooks.postToolUse).toHaveLength(1);
          expect(hooks.postToolUse?.[0].matcher).toBe('Bash');
          expect(hooks.postToolUse?.[0].hooks[0].command).toContain('warn-dirty-main.sh');
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

    describe('WU-1473: CLI wiring for orchestrator recovery and signal consumption', () => {
      describe('AC1: Non-worktree orchestrator recovery in enforcement hooks', () => {
        it('should generate session-start recovery hook that handles non-worktree context', () => {
          const config: EnforcementConfig = {
            block_outside_worktree: false,
            require_wu_for_edits: false,
            warn_on_stop_without_wu_done: false,
          };

          const hooks = generateEnforcementHooks(config);

          // Session-start hooks should always be generated (WU-1394)
          expect(hooks.sessionStart).toBeDefined();
          expect(hooks.sessionStart!.length).toBeGreaterThan(0);

          // Should include non-worktree recovery matcher
          // The session-start recovery should work for non-worktree orchestrators too
          const matchers = hooks.sessionStart!.map((h) => h.matcher);
          expect(matchers).toContain('compact');
          expect(matchers).toContain('resume');
          expect(matchers).toContain('clear');
        });

        it('should generate pre-compact hook that works without worktree WU context', () => {
          const config: EnforcementConfig = {
            block_outside_worktree: false,
            require_wu_for_edits: false,
            warn_on_stop_without_wu_done: false,
          };

          const hooks = generateEnforcementHooks(config);

          // Pre-compact should always be generated
          expect(hooks.preCompact).toBeDefined();
          expect(hooks.preCompact!.length).toBeGreaterThan(0);

          // The generated pre-compact script should handle missing WU_ID gracefully
          const script = generatePreCompactCheckpointScript();
          // Should check for WU_ID and exit gracefully if missing
          expect(script).toContain('WU_ID');
          // Should include orchestrator inbox check for non-worktree recovery
          expect(script).toContain('mem:inbox');
        });

        it('should generate session-start script that surfaces orchestrator signals without worktree', () => {
          const script = generateSessionStartRecoveryScript();

          // Should handle recovery files (existing behavior)
          expect(script).toContain('recovery-pending');
          // Should include unread signal summary for orchestrator context
          expect(script).toContain('mem:inbox');
        });
      });

      describe('AC2: Claim surfaces unread signal summary', () => {
        it('should surface unread signals on claim via surfaceUnreadSignals', async () => {
          // Arrange
          process.chdir(tempDir);
          // Create some unread signals from other agents
          await createSignal(tempDir, {
            message: 'WU-9999 completed: feature X landed',
            wuId: 'WU-9999',
            lane: TEST_LANE,
          });
          await createSignal(tempDir, {
            message: 'Blocking issue on WU-8888',
            wuId: 'WU-8888',
          });

          // Act
          const result = await surfaceUnreadSignals(tempDir);

          // Assert
          expect(result.count).toBe(2);
          expect(result.signals).toHaveLength(2);
          expect(result.signals[0].message).toContain('WU-9999');
        });

        it('should return empty result when no unread signals exist', async () => {
          process.chdir(tempDir);

          const result = await surfaceUnreadSignals(tempDir);

          expect(result.count).toBe(0);
          expect(result.signals).toHaveLength(0);
        });

        it('should not throw when memory layer is unavailable (fail-open)', async () => {
          // Use a non-existent directory
          const badDir = join(tempDir, 'does-not-exist');

          const result = await surfaceUnreadSignals(badDir);

          expect(result.count).toBe(0);
          expect(result.signals).toHaveLength(0);
        });
      });

      describe('AC3: wu:done marks completed-WU signals as read', () => {
        it('should mark signals for completed WU as read using receipts', async () => {
          // Arrange
          process.chdir(tempDir);
          const completedWuId = 'WU-7777';
          // Create signals for the WU being completed
          await createSignal(tempDir, {
            message: 'AC1 done on WU-7777',
            wuId: completedWuId,
          });
          await createSignal(tempDir, {
            message: 'AC2 done on WU-7777',
            wuId: completedWuId,
          });
          // Create a signal for a different WU (should NOT be marked)
          await createSignal(tempDir, {
            message: 'Different WU signal',
            wuId: 'WU-5555',
          });

          // Act
          const result = await markCompletedWUSignalsAsRead(tempDir, completedWuId);

          // Assert
          expect(result.markedCount).toBe(2);

          // Verify only the completed WU's signals were marked
          const unreadForCompleted = await loadSignals(tempDir, {
            wuId: completedWuId,
            unreadOnly: true,
          });
          expect(unreadForCompleted).toHaveLength(0);

          const unreadForOther = await loadSignals(tempDir, {
            wuId: 'WU-5555',
            unreadOnly: true,
          });
          expect(unreadForOther).toHaveLength(1);
        });

        it('should return zero count when no signals exist for the WU', async () => {
          process.chdir(tempDir);

          const result = await markCompletedWUSignalsAsRead(tempDir, 'WU-0000');

          expect(result.markedCount).toBe(0);
        });

        it('should not throw on memory layer errors (fail-open)', async () => {
          const badDir = join(tempDir, 'does-not-exist');

          const result = await markCompletedWUSignalsAsRead(badDir, 'WU-0000');

          expect(result.markedCount).toBe(0);
        });
      });

      describe('AC4: CLI integrations remain fail-open', () => {
        it('surfaceUnreadSignals never throws, returns empty on error', async () => {
          // Pass invalid baseDir - should not throw
          await expect(surfaceUnreadSignals('/nonexistent/path')).resolves.toEqual({
            count: 0,
            signals: [],
          });
        });

        it('markCompletedWUSignalsAsRead never throws, returns zero on error', async () => {
          // Pass invalid baseDir - should not throw
          await expect(
            markCompletedWUSignalsAsRead('/nonexistent/path', 'WU-9999'),
          ).resolves.toEqual({ markedCount: 0 });
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

  describe('WU-1474: Decay policy activation in completion lifecycle', () => {
    describe('AC1: Config schema supports memory.decay fields', () => {
      it('should parse memory.decay with all fields', () => {
        const config = MemoryDecayConfigSchema.parse({
          enabled: true,
          threshold: 0.2,
          half_life_days: 14,
          trigger: 'on_done',
        });

        expect(config.enabled).toBe(true);
        expect(config.threshold).toBe(0.2);
        expect(config.half_life_days).toBe(14);
        expect(config.trigger).toBe('on_done');
      });

      it('should apply sensible defaults when fields are omitted', () => {
        const config = MemoryDecayConfigSchema.parse({});

        expect(config.enabled).toBe(false);
        expect(config.threshold).toBe(0.1);
        expect(config.half_life_days).toBe(30);
        expect(config.trigger).toBe('on_done');
      });

      it('should reject invalid trigger values', () => {
        expect(() =>
          MemoryDecayConfigSchema.parse({
            trigger: 'invalid_trigger',
          }),
        ).toThrow();
      });

      it('should reject negative threshold', () => {
        expect(() =>
          MemoryDecayConfigSchema.parse({
            threshold: -0.5,
          }),
        ).toThrow();
      });

      it('should reject threshold above 1', () => {
        expect(() =>
          MemoryDecayConfigSchema.parse({
            threshold: 1.5,
          }),
        ).toThrow();
      });

      it('should reject non-positive half_life_days', () => {
        expect(() =>
          MemoryDecayConfigSchema.parse({
            half_life_days: 0,
          }),
        ).toThrow();
      });
    });

    describe('AC2: wu:done invokes decay archival when enabled with trigger=on_done', () => {
      it('should invoke archiveByDecay when decay.enabled=true and trigger=on_done', async () => {
        // Arrange: create memory dir with an old node
        process.chdir(tempDir);
        const memoryDir = join(tempDir, '.lumenflow/memory');
        mkdirSync(memoryDir, { recursive: true });

        // Create old memory node (90+ days old)
        const ninetyDaysAgo = Date.now() - 91 * 24 * 60 * 60 * 1000;
        const oldNode = {
          id: 'mem-st01',
          type: 'checkpoint',
          lifecycle: 'wu',
          content: 'Old stale content',
          created_at: new Date(ninetyDaysAgo).toISOString(),
        };
        writeFileSync(join(memoryDir, 'memory.jsonl'), JSON.stringify(oldNode) + '\n');

        const decayConfig: MemoryDecayConfig = {
          enabled: true,
          threshold: 0.1,
          half_life_days: 30,
          trigger: 'on_done',
        };

        // Act
        const result = await runDecayOnDone(tempDir, decayConfig);

        // Assert: decay was invoked and archived the stale node
        expect(result.ran).toBe(true);
        expect(result.archivedCount).toBeGreaterThan(0);
      });

      it('should use fail-open behavior - never throw on archival errors', async () => {
        // Arrange: write corrupted content to memory file to trigger a parse error
        process.chdir(tempDir);
        const memoryDir = join(tempDir, '.lumenflow/memory');
        mkdirSync(memoryDir, { recursive: true });
        writeFileSync(join(memoryDir, 'memory.jsonl'), 'NOT VALID JSON\n');

        const decayConfig: MemoryDecayConfig = {
          enabled: true,
          threshold: 0.1,
          half_life_days: 30,
          trigger: 'on_done',
        };

        // Act: should NOT throw even with corrupted memory file
        const result = await runDecayOnDone(tempDir, decayConfig);

        // Assert: fail-open - ran=false, error captured
        expect(result.ran).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should pass threshold and half_life_days from config to archiveByDecay', async () => {
        // Arrange: create memory dir with a node at 2 half-lives (custom)
        process.chdir(tempDir);
        const memoryDir = join(tempDir, '.lumenflow/memory');
        mkdirSync(memoryDir, { recursive: true });

        // Node is 15 days old, with half_life_days=5 it should be archived
        // Score: exp(-15/5) = exp(-3) ~ 0.050 which is below threshold 0.1
        const fifteenDaysAgo = Date.now() - 15 * 24 * 60 * 60 * 1000;
        const node = {
          id: 'mem-cu01',
          type: 'checkpoint',
          lifecycle: 'wu',
          content: 'Custom decay test',
          created_at: new Date(fifteenDaysAgo).toISOString(),
        };
        writeFileSync(join(memoryDir, 'memory.jsonl'), JSON.stringify(node) + '\n');

        const decayConfig: MemoryDecayConfig = {
          enabled: true,
          threshold: 0.1,
          half_life_days: 5,
          trigger: 'on_done',
        };

        // Act
        const result = await runDecayOnDone(tempDir, decayConfig);

        // Assert: node should be archived with custom half-life
        expect(result.ran).toBe(true);
        expect(result.archivedCount).toBe(1);
      });
    });

    describe('AC3: When decay is disabled, existing wu:done behavior is unchanged', () => {
      it('should not invoke archival when decay.enabled=false', async () => {
        const decayConfig: MemoryDecayConfig = {
          enabled: false,
          threshold: 0.1,
          half_life_days: 30,
          trigger: 'on_done',
        };

        const result = await runDecayOnDone(tempDir, decayConfig);

        expect(result.ran).toBe(false);
        expect(result.skippedReason).toBe('disabled');
      });

      it('should not invoke archival when trigger is not on_done', async () => {
        const decayConfig: MemoryDecayConfig = {
          enabled: true,
          threshold: 0.1,
          half_life_days: 30,
          trigger: 'manual',
        };

        const result = await runDecayOnDone(tempDir, decayConfig);

        expect(result.ran).toBe(false);
        expect(result.skippedReason).toBe('trigger_mismatch');
      });

      it('should not invoke archival when decay config is undefined', async () => {
        const result = await runDecayOnDone(tempDir, undefined);

        expect(result.ran).toBe(false);
        expect(result.skippedReason).toBe('no_config');
      });
    });

    describe('AC4: Manual cleanup command remains available with preview', () => {
      it('should support dry-run mode via archiveByDecay', async () => {
        // This tests that the existing archiveByDecay dry-run still works
        // The mem-cleanup CLI already calls archiveByDecay; we verify the
        // underlying function supports preview behavior.
        const { archiveByDecay } = await import('@lumenflow/memory/decay/archival');

        process.chdir(tempDir);
        const memoryDir = join(tempDir, '.lumenflow/memory');
        mkdirSync(memoryDir, { recursive: true });

        const ninetyDaysAgo = Date.now() - 91 * 24 * 60 * 60 * 1000;
        const node = {
          id: 'mem-pv01',
          type: 'checkpoint',
          lifecycle: 'wu',
          content: 'Preview test content',
          created_at: new Date(ninetyDaysAgo).toISOString(),
        };
        writeFileSync(join(memoryDir, 'memory.jsonl'), JSON.stringify(node) + '\n');

        // Act: dry-run should NOT modify the file
        const result = await archiveByDecay(join(tempDir, '.lumenflow/memory'), {
          threshold: 0.1,
          dryRun: true,
        });

        // Assert: preview reports what would be archived without mutation
        expect(result.dryRun).toBe(true);
        expect(result.archivedIds).toContain('mem-pv01');

        // Verify file was NOT modified
        const content = readFileSync(join(memoryDir, 'memory.jsonl'), 'utf-8');
        const parsed = JSON.parse(content.trim());
        expect(parsed.metadata?.status).not.toBe('archived');
      });
    });
  });
});

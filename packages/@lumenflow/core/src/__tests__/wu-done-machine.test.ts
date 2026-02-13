/**
 * @file wu-done-machine.test.ts
 * @description Tests for the typed XState v5 wu:done pipeline state machine.
 *
 * WU-1662: Defines transition contracts, snapshot/rehydration semantics,
 * and valid/invalid transition assertions for the wu:done pipeline.
 *
 * Tests cover:
 * - Pipeline states: idle -> validate -> prepare -> gate -> commit -> merge -> push -> cleanup -> done
 * - Failure transitions from each operational state
 * - Recovery transitions from failed states
 * - Snapshot serialization and rehydration
 * - Guard evaluation for gate dedup (WU-1659)
 * - Terminal state (done has no outgoing transitions)
 * - Context typing and event payloads
 */

import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import {
  wuDoneMachine,
  type WuDonePipelineContext,
  type WuDonePipelineEvent,
  WU_DONE_STATES,
  WU_DONE_EVENTS,
} from '../wu-done-machine.js';

/** Test-only worktree path constant (avoids absolute path lint trigger). */
const TEST_WORKTREE = 'worktrees/test-wu-100';

describe('WU-1662: wu:done pipeline state machine', () => {
  describe('Machine definition', () => {
    it('should export a valid XState v5 machine', () => {
      expect(wuDoneMachine).toBeDefined();
      expect(wuDoneMachine.id).toBe('wuDonePipeline');
    });

    it('should start in the idle state', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.IDLE);
      actor.stop();
    });

    it('should export all pipeline state constants', () => {
      expect(WU_DONE_STATES.IDLE).toBe('idle');
      expect(WU_DONE_STATES.VALIDATING).toBe('validating');
      expect(WU_DONE_STATES.PREPARING).toBe('preparing');
      expect(WU_DONE_STATES.GATING).toBe('gating');
      expect(WU_DONE_STATES.COMMITTING).toBe('committing');
      expect(WU_DONE_STATES.MERGING).toBe('merging');
      expect(WU_DONE_STATES.PUSHING).toBe('pushing');
      expect(WU_DONE_STATES.CLEANING_UP).toBe('cleaningUp');
      expect(WU_DONE_STATES.DONE).toBe('done');
      expect(WU_DONE_STATES.FAILED).toBe('failed');
    });

    it('should export all pipeline event constants', () => {
      expect(WU_DONE_EVENTS.START).toBe('wu.done.start');
      expect(WU_DONE_EVENTS.VALIDATION_PASSED).toBe('wu.done.validation.passed');
      expect(WU_DONE_EVENTS.VALIDATION_FAILED).toBe('wu.done.validation.failed');
      expect(WU_DONE_EVENTS.PREPARATION_COMPLETE).toBe('wu.done.preparation.complete');
      expect(WU_DONE_EVENTS.PREPARATION_FAILED).toBe('wu.done.preparation.failed');
      expect(WU_DONE_EVENTS.GATES_PASSED).toBe('wu.done.gates.passed');
      expect(WU_DONE_EVENTS.GATES_FAILED).toBe('wu.done.gates.failed');
      expect(WU_DONE_EVENTS.GATES_SKIPPED).toBe('wu.done.gates.skipped');
      expect(WU_DONE_EVENTS.COMMIT_COMPLETE).toBe('wu.done.commit.complete');
      expect(WU_DONE_EVENTS.COMMIT_FAILED).toBe('wu.done.commit.failed');
      expect(WU_DONE_EVENTS.MERGE_COMPLETE).toBe('wu.done.merge.complete');
      expect(WU_DONE_EVENTS.MERGE_FAILED).toBe('wu.done.merge.failed');
      expect(WU_DONE_EVENTS.PUSH_COMPLETE).toBe('wu.done.push.complete');
      expect(WU_DONE_EVENTS.PUSH_FAILED).toBe('wu.done.push.failed');
      expect(WU_DONE_EVENTS.CLEANUP_COMPLETE).toBe('wu.done.cleanup.complete');
      expect(WU_DONE_EVENTS.CLEANUP_FAILED).toBe('wu.done.cleanup.failed');
      expect(WU_DONE_EVENTS.RETRY).toBe('wu.done.retry');
    });
  });

  describe('Happy path transitions', () => {
    it('should transition from idle to validating on START', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.VALIDATING);
      actor.stop();
    });

    it('should transition from validating to preparing on VALIDATION_PASSED', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.PREPARING);
      actor.stop();
    });

    it('should transition from preparing to gating on PREPARATION_COMPLETE', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });
      actor.send({ type: WU_DONE_EVENTS.PREPARATION_COMPLETE });
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.GATING);
      actor.stop();
    });

    it('should transition from gating to committing on GATES_PASSED', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });
      actor.send({ type: WU_DONE_EVENTS.PREPARATION_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.GATES_PASSED });
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.COMMITTING);
      actor.stop();
    });

    it('should transition from gating to committing on GATES_SKIPPED when prepPassed is true', () => {
      const actor = createActor(wuDoneMachine, {
        input: { wuId: 'WU-100', worktreePath: TEST_WORKTREE, prepPassed: true },
      });
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });
      actor.send({ type: WU_DONE_EVENTS.PREPARATION_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.GATES_SKIPPED });
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.COMMITTING);
      actor.stop();
    });

    it('should transition from committing to merging on COMMIT_COMPLETE', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });
      actor.send({ type: WU_DONE_EVENTS.PREPARATION_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.GATES_PASSED });
      actor.send({ type: WU_DONE_EVENTS.COMMIT_COMPLETE });
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.MERGING);
      actor.stop();
    });

    it('should transition from merging to pushing on MERGE_COMPLETE', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });
      actor.send({ type: WU_DONE_EVENTS.PREPARATION_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.GATES_PASSED });
      actor.send({ type: WU_DONE_EVENTS.COMMIT_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.MERGE_COMPLETE });
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.PUSHING);
      actor.stop();
    });

    it('should transition from pushing to cleaningUp on PUSH_COMPLETE', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });
      actor.send({ type: WU_DONE_EVENTS.PREPARATION_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.GATES_PASSED });
      actor.send({ type: WU_DONE_EVENTS.COMMIT_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.MERGE_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.PUSH_COMPLETE });
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.CLEANING_UP);
      actor.stop();
    });

    it('should transition from cleaningUp to done on CLEANUP_COMPLETE', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });
      actor.send({ type: WU_DONE_EVENTS.PREPARATION_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.GATES_PASSED });
      actor.send({ type: WU_DONE_EVENTS.COMMIT_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.MERGE_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.PUSH_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.CLEANUP_COMPLETE });
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.DONE);
      actor.stop();
    });

    it('should complete the full happy path pipeline', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();

      const events = [
        { type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE },
        { type: WU_DONE_EVENTS.VALIDATION_PASSED },
        { type: WU_DONE_EVENTS.PREPARATION_COMPLETE },
        { type: WU_DONE_EVENTS.GATES_PASSED },
        { type: WU_DONE_EVENTS.COMMIT_COMPLETE },
        { type: WU_DONE_EVENTS.MERGE_COMPLETE },
        { type: WU_DONE_EVENTS.PUSH_COMPLETE },
        { type: WU_DONE_EVENTS.CLEANUP_COMPLETE },
      ] as WuDonePipelineEvent[];

      for (const event of events) {
        actor.send(event);
      }

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe(WU_DONE_STATES.DONE);
      expect(snapshot.status).toBe('done');
      actor.stop();
    });
  });

  describe('Failure transitions', () => {
    it('should transition from validating to failed on VALIDATION_FAILED', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({
        type: WU_DONE_EVENTS.VALIDATION_FAILED,
        error: 'WU YAML invalid',
      });
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.FAILED);
      actor.stop();
    });

    it('should transition from preparing to failed on PREPARATION_FAILED', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });
      actor.send({
        type: WU_DONE_EVENTS.PREPARATION_FAILED,
        error: 'Transaction collection failed',
      });
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.FAILED);
      actor.stop();
    });

    it('should transition from gating to failed on GATES_FAILED', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });
      actor.send({ type: WU_DONE_EVENTS.PREPARATION_COMPLETE });
      actor.send({
        type: WU_DONE_EVENTS.GATES_FAILED,
        error: 'Lint check failed',
      });
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.FAILED);
      actor.stop();
    });

    it('should transition from committing to failed on COMMIT_FAILED', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });
      actor.send({ type: WU_DONE_EVENTS.PREPARATION_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.GATES_PASSED });
      actor.send({ type: WU_DONE_EVENTS.COMMIT_FAILED, error: 'Git commit error' });
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.FAILED);
      actor.stop();
    });

    it('should transition from merging to failed on MERGE_FAILED', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });
      actor.send({ type: WU_DONE_EVENTS.PREPARATION_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.GATES_PASSED });
      actor.send({ type: WU_DONE_EVENTS.COMMIT_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.MERGE_FAILED, error: 'Non-fast-forward' });
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.FAILED);
      actor.stop();
    });

    it('should transition from pushing to failed on PUSH_FAILED', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });
      actor.send({ type: WU_DONE_EVENTS.PREPARATION_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.GATES_PASSED });
      actor.send({ type: WU_DONE_EVENTS.COMMIT_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.MERGE_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.PUSH_FAILED, error: 'Remote rejected' });
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.FAILED);
      actor.stop();
    });

    it('should transition from cleaningUp to failed on CLEANUP_FAILED', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });
      actor.send({ type: WU_DONE_EVENTS.PREPARATION_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.GATES_PASSED });
      actor.send({ type: WU_DONE_EVENTS.COMMIT_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.MERGE_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.PUSH_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.CLEANUP_FAILED, error: 'Worktree removal failed' });
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.FAILED);
      actor.stop();
    });

    it('should record error message in context when a failure occurs', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({
        type: WU_DONE_EVENTS.VALIDATION_FAILED,
        error: 'WU YAML has missing acceptance criteria',
      });

      const snapshot = actor.getSnapshot();
      expect(snapshot.context.error).toBe('WU YAML has missing acceptance criteria');
      expect(snapshot.context.failedAt).toBe(WU_DONE_STATES.VALIDATING);
      actor.stop();
    });

    it('should record the state where failure occurred in failedAt', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });
      actor.send({ type: WU_DONE_EVENTS.PREPARATION_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.GATES_PASSED });
      actor.send({ type: WU_DONE_EVENTS.COMMIT_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.MERGE_FAILED, error: 'Conflicts' });

      const snapshot = actor.getSnapshot();
      expect(snapshot.context.failedAt).toBe(WU_DONE_STATES.MERGING);
      actor.stop();
    });
  });

  describe('Recovery transitions', () => {
    it('should allow RETRY from failed state back to validating', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_FAILED, error: 'Bad YAML' });
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.FAILED);

      actor.send({ type: WU_DONE_EVENTS.RETRY });
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.VALIDATING);
      actor.stop();
    });

    it('should clear error and failedAt on retry', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_FAILED, error: 'Bad YAML' });

      const failedSnapshot = actor.getSnapshot();
      expect(failedSnapshot.context.error).toBe('Bad YAML');

      actor.send({ type: WU_DONE_EVENTS.RETRY });

      const retrySnapshot = actor.getSnapshot();
      expect(retrySnapshot.context.error).toBeNull();
      expect(retrySnapshot.context.failedAt).toBeNull();
      actor.stop();
    });

    it('should increment retryCount on retry', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });

      // Fail and retry twice
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_FAILED, error: 'Error 1' });
      actor.send({ type: WU_DONE_EVENTS.RETRY });
      expect(actor.getSnapshot().context.retryCount).toBe(1);

      actor.send({ type: WU_DONE_EVENTS.VALIDATION_FAILED, error: 'Error 2' });
      actor.send({ type: WU_DONE_EVENTS.RETRY });
      expect(actor.getSnapshot().context.retryCount).toBe(2);
      actor.stop();
    });
  });

  describe('Context management', () => {
    it('should store wuId from START event in context', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-1662', worktreePath: TEST_WORKTREE });

      expect(actor.getSnapshot().context.wuId).toBe('WU-1662');
      actor.stop();
    });

    it('should store worktreePath from START event in context', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({
        type: WU_DONE_EVENTS.START,
        wuId: 'WU-100',
        worktreePath: 'worktrees/ops-wu-100',
      });

      expect(actor.getSnapshot().context.worktreePath).toBe('worktrees/ops-wu-100');
      actor.stop();
    });

    it('should initialize with default context values', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();

      const ctx = actor.getSnapshot().context;
      expect(ctx.wuId).toBeNull();
      expect(ctx.worktreePath).toBeNull();
      expect(ctx.prepPassed).toBe(false);
      expect(ctx.error).toBeNull();
      expect(ctx.failedAt).toBeNull();
      expect(ctx.retryCount).toBe(0);
      actor.stop();
    });

    it('should support input-based context initialization', () => {
      const actor = createActor(wuDoneMachine, {
        input: { wuId: 'WU-999', worktreePath: TEST_WORKTREE, prepPassed: true },
      });
      actor.start();

      const ctx = actor.getSnapshot().context;
      expect(ctx.wuId).toBe('WU-999');
      expect(ctx.worktreePath).toBe(TEST_WORKTREE);
      expect(ctx.prepPassed).toBe(true);
      actor.stop();
    });
  });

  describe('Gate dedup guard (WU-1659)', () => {
    it('should allow GATES_SKIPPED only when prepPassed is true', () => {
      const actor = createActor(wuDoneMachine, {
        input: { wuId: 'WU-100', worktreePath: TEST_WORKTREE, prepPassed: true },
      });
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });
      actor.send({ type: WU_DONE_EVENTS.PREPARATION_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.GATES_SKIPPED });

      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.COMMITTING);
      actor.stop();
    });

    it('should NOT allow GATES_SKIPPED when prepPassed is false', () => {
      const actor = createActor(wuDoneMachine, {
        input: { wuId: 'WU-100', worktreePath: TEST_WORKTREE, prepPassed: false },
      });
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });
      actor.send({ type: WU_DONE_EVENTS.PREPARATION_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.GATES_SKIPPED });

      // Should remain in gating state (event was ignored)
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.GATING);
      actor.stop();
    });
  });

  describe('Terminal state enforcement', () => {
    it('should not accept any events in done state', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();

      // Drive to done
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });
      actor.send({ type: WU_DONE_EVENTS.PREPARATION_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.GATES_PASSED });
      actor.send({ type: WU_DONE_EVENTS.COMMIT_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.MERGE_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.PUSH_COMPLETE });
      actor.send({ type: WU_DONE_EVENTS.CLEANUP_COMPLETE });

      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.DONE);
      expect(actor.getSnapshot().status).toBe('done');

      // Try sending events - should have no effect
      actor.send({ type: WU_DONE_EVENTS.RETRY });
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.DONE);
      actor.stop();
    });

    it('should not accept START event in non-idle states', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.VALIDATING);

      // Sending START again should be ignored
      actor.send({
        type: WU_DONE_EVENTS.START,
        wuId: 'WU-200',
        worktreePath: 'worktrees/test-wu-200',
      });
      expect(actor.getSnapshot().value).toBe(WU_DONE_STATES.VALIDATING);
      expect(actor.getSnapshot().context.wuId).toBe('WU-100');
      actor.stop();
    });
  });

  describe('Snapshot serialization and rehydration', () => {
    it('should produce a serializable snapshot', () => {
      const actor = createActor(wuDoneMachine);
      actor.start();
      actor.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });
      actor.send({ type: WU_DONE_EVENTS.PREPARATION_COMPLETE });

      const snapshot = actor.getSnapshot();
      const serialized = JSON.stringify(snapshot);
      expect(serialized).toBeTruthy();

      const parsed = JSON.parse(serialized);
      expect(parsed.value).toBe(WU_DONE_STATES.GATING);
      expect(parsed.context.wuId).toBe('WU-100');
      actor.stop();
    });

    it('should rehydrate from a persisted snapshot', () => {
      // Create actor and drive to a mid-pipeline state
      const actor1 = createActor(wuDoneMachine);
      actor1.start();
      actor1.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor1.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });
      actor1.send({ type: WU_DONE_EVENTS.PREPARATION_COMPLETE });

      const persistedSnapshot = actor1.getPersistedSnapshot();
      actor1.stop();

      // Rehydrate into a new actor
      const actor2 = createActor(wuDoneMachine, {
        snapshot: persistedSnapshot,
      });
      actor2.start();

      // Should resume from gating state
      expect(actor2.getSnapshot().value).toBe(WU_DONE_STATES.GATING);
      expect(actor2.getSnapshot().context.wuId).toBe('WU-100');
      expect(actor2.getSnapshot().context.worktreePath).toBe(TEST_WORKTREE);

      // Should be able to continue the pipeline
      actor2.send({ type: WU_DONE_EVENTS.GATES_PASSED });
      expect(actor2.getSnapshot().value).toBe(WU_DONE_STATES.COMMITTING);
      actor2.stop();
    });

    it('should rehydrate a failed state and allow retry', () => {
      const actor1 = createActor(wuDoneMachine);
      actor1.start();
      actor1.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor1.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });
      actor1.send({ type: WU_DONE_EVENTS.PREPARATION_COMPLETE });
      actor1.send({ type: WU_DONE_EVENTS.GATES_FAILED, error: 'Lint failed' });

      const persistedSnapshot = actor1.getPersistedSnapshot();
      actor1.stop();

      // Rehydrate
      const actor2 = createActor(wuDoneMachine, {
        snapshot: persistedSnapshot,
      });
      actor2.start();

      expect(actor2.getSnapshot().value).toBe(WU_DONE_STATES.FAILED);
      expect(actor2.getSnapshot().context.error).toBe('Lint failed');
      expect(actor2.getSnapshot().context.failedAt).toBe(WU_DONE_STATES.GATING);

      // Retry should work from rehydrated state
      actor2.send({ type: WU_DONE_EVENTS.RETRY });
      expect(actor2.getSnapshot().value).toBe(WU_DONE_STATES.VALIDATING);
      actor2.stop();
    });

    it('should preserve retryCount across serialization/rehydration cycles', () => {
      const actor1 = createActor(wuDoneMachine);
      actor1.start();
      actor1.send({ type: WU_DONE_EVENTS.START, wuId: 'WU-100', worktreePath: TEST_WORKTREE });
      actor1.send({ type: WU_DONE_EVENTS.VALIDATION_FAILED, error: 'err' });
      actor1.send({ type: WU_DONE_EVENTS.RETRY });
      actor1.send({ type: WU_DONE_EVENTS.VALIDATION_FAILED, error: 'err2' });

      const persistedSnapshot = actor1.getPersistedSnapshot();
      actor1.stop();

      const actor2 = createActor(wuDoneMachine, {
        snapshot: persistedSnapshot,
      });
      actor2.start();

      expect(actor2.getSnapshot().context.retryCount).toBe(1);
      actor2.stop();
    });
  });

  describe('Type exports', () => {
    it('should export WuDonePipelineContext type', () => {
      // This is a compile-time check - if the type is wrong, TypeScript will error
      const ctx: WuDonePipelineContext = {
        wuId: 'WU-100',
        worktreePath: TEST_WORKTREE,
        prepPassed: false,
        error: null,
        failedAt: null,
        retryCount: 0,
      };
      expect(ctx.wuId).toBe('WU-100');
    });

    it('should export WuDonePipelineEvent type', () => {
      const startEvent: WuDonePipelineEvent = {
        type: 'wu.done.start',
        wuId: 'WU-100',
        worktreePath: TEST_WORKTREE,
      };
      expect(startEvent.type).toBe('wu.done.start');
    });
  });
});

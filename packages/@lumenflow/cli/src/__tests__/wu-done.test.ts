import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { ensureCleanWorktree } from '../wu-done-check.js';
import { computeBranchOnlyFallback, getYamlStatusForDisplay } from '../wu-done.js';
import {
  resolveWuDonePreCommitGateDecision,
  WU_DONE_PRE_COMMIT_GATE_DECISION_REASONS,
} from '@lumenflow/core/gates-agent-mode';
import * as gitAdapter from '@lumenflow/core/git-adapter';
import * as errorHandler from '@lumenflow/core/error-handler';
import { validateInputs } from '@lumenflow/core/wu-done-inputs';
import { WU_STATUS } from '@lumenflow/core/wu-constants';
import { getShortestPaths, getSimplePaths, toDirectedGraph } from '@xstate/graph';
import {
  wuDoneMachine,
  WU_DONE_STATES,
  WU_DONE_EVENTS,
  type WuDonePipelineEvent,
} from '@lumenflow/core/wu-done-machine';

// Mock dependencies
vi.mock('@lumenflow/core/git-adapter');
vi.mock('@lumenflow/core/error-handler');

describe('wu-done', () => {
  describe('WU-1630: post-merge dirty-main remediation removal', () => {
    it('does not retain post-merge dirty-state cleanup flow in main execution path', async () => {
      const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
      expect(source).not.toContain('const postMergeStatus = await gitMain.getStatus()');
      expect(source).not.toContain('const postLifecycleStatus = await gitMain.getStatus()');
    });
  });

  describe('WU-1634: mode-execution failure messaging', () => {
    it('surfaces root error context and retry guidance before exiting', async () => {
      const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
      expect(source).toContain('Mode execution failed:');
      expect(source).toContain(
        'Next step: resolve the reported error and retry: pnpm wu:done --id ${id}',
      );
    });
  });

  describe('WU-1659: pre-flight gate deduplication', () => {
    it('reuses step-0 gates and skips duplicate full-suite pre-flight run', () => {
      const decision = resolveWuDonePreCommitGateDecision({
        skipGates: false,
        fullGatesRanInCurrentRun: true,
        skippedByCheckpoint: false,
      });

      expect(decision.runPreCommitFullSuite).toBe(false);
      expect(decision.reason).toBe(WU_DONE_PRE_COMMIT_GATE_DECISION_REASONS.REUSE_STEP_ZERO);
    });

    it('reuses checkpoint attestation when gates were skipped by valid checkpoint', () => {
      const decision = resolveWuDonePreCommitGateDecision({
        skipGates: false,
        fullGatesRanInCurrentRun: false,
        skippedByCheckpoint: true,
        checkpointId: 'ckpt-1234',
      });

      expect(decision.runPreCommitFullSuite).toBe(false);
      expect(decision.reason).toBe(WU_DONE_PRE_COMMIT_GATE_DECISION_REASONS.REUSE_CHECKPOINT);
      expect(decision.message).toContain('ckpt-1234');
    });

    it('wu-done uses the gate dedup policy before pre-flight hook validation', async () => {
      const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
      expect(source).toContain('resolveWuDonePreCommitGateDecision');
      expect(source).toContain('preCommitGateDecision.runPreCommitFullSuite');
    });
  });

  describe('WU-1574: strict status display helper', () => {
    it('returns canonical status when YAML status is valid', () => {
      expect(getYamlStatusForDisplay(WU_STATUS.DONE)).toBe(WU_STATUS.DONE);
    });

    it('returns unknown when YAML status is invalid', () => {
      expect(getYamlStatusForDisplay(undefined)).toBe('unknown');
      expect(getYamlStatusForDisplay('bad-status')).toBe('unknown');
    });
  });

  // WU-1494: Verify --pr-draft is accepted by wu:done arg parser
  describe('--pr-draft parser/help parity (WU-1494)', () => {
    let originalArgv: string[];
    let originalExit: typeof process.exit;

    beforeEach(() => {
      originalArgv = process.argv;
      originalExit = process.exit;
      process.exit = vi.fn() as never;
    });

    afterEach(() => {
      process.argv = originalArgv;
      process.exit = originalExit;
    });

    it('should accept --pr-draft with --create-pr via validateInputs', () => {
      const argv = ['node', 'wu-done.js', '--id', 'WU-100', '--create-pr', '--pr-draft'];

      const { args, id } = validateInputs(argv);

      expect(id).toBe('WU-100');
      expect(args.createPr).toBe(true);
      expect(args.prDraft).toBe(true);
    });

    it('should accept --create-pr without --pr-draft via validateInputs', () => {
      const argv = ['node', 'wu-done.js', '--id', 'WU-200', '--create-pr'];

      const { args, id } = validateInputs(argv);

      expect(id).toBe('WU-200');
      expect(args.createPr).toBe(true);
      expect(args.prDraft).toBeUndefined();
    });
  });

  describe('ensureCleanWorktree', () => {
    let mockGit: any;

    beforeEach(() => {
      vi.resetAllMocks();
      mockGit = {
        getStatus: vi.fn(),
      };
      vi.mocked(gitAdapter.createGitForPath).mockReturnValue(mockGit);
    });

    it('should pass if worktree is clean', async () => {
      mockGit.getStatus.mockResolvedValue(''); // Clean status

      await ensureCleanWorktree('/path/to/worktree');

      expect(mockGit.getStatus).toHaveBeenCalled();
      expect(errorHandler.die).not.toHaveBeenCalled();
    });

    it('should die if worktree has uncommitted changes', async () => {
      mockGit.getStatus.mockResolvedValue('M  file.ts\n?? new-file.ts'); // Dirty status

      await ensureCleanWorktree('/path/to/worktree');

      expect(mockGit.getStatus).toHaveBeenCalled();
      expect(errorHandler.die).toHaveBeenCalledWith(
        expect.stringContaining('Worktree has uncommitted changes'),
      );
    });

    it('should use the correct worktree path', async () => {
      mockGit.getStatus.mockResolvedValue('');

      await ensureCleanWorktree('/custom/worktree/path');

      expect(gitAdapter.createGitForPath).toHaveBeenCalledWith('/custom/worktree/path');
    });
  });

  describe('WU-1663: XState pipeline actor integration', () => {
    it('wu-done.ts imports the XState pipeline machine from core', async () => {
      const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
      expect(source).toContain('wuDoneMachine');
      expect(source).toContain('createActor');
    });

    it('wu-done.ts creates a pipeline actor and sends START event', async () => {
      const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
      expect(source).toContain('pipelineActor');
      expect(source).toContain('WU_DONE_EVENTS.START');
    });

    it('wu-done.ts sends VALIDATION_PASSED after pre-flight checks succeed', async () => {
      const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
      expect(source).toContain('WU_DONE_EVENTS.VALIDATION_PASSED');
    });

    it('wu-done.ts sends GATES_PASSED or GATES_SKIPPED after gates', async () => {
      const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
      expect(source).toContain('WU_DONE_EVENTS.GATES_PASSED');
      expect(source).toContain('WU_DONE_EVENTS.GATES_SKIPPED');
    });

    it('wu-done.ts sends CLEANUP_COMPLETE at the end of main()', async () => {
      const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
      expect(source).toContain('WU_DONE_EVENTS.CLEANUP_COMPLETE');
    });

    it('wu-done.ts sends failure events when steps fail', async () => {
      const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
      expect(source).toContain('WU_DONE_EVENTS.VALIDATION_FAILED');
      expect(source).toContain('WU_DONE_EVENTS.GATES_FAILED');
    });

    it('wu-done.ts passes prepPassed to pipeline actor input for gate dedup', async () => {
      const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
      // The pipeline actor should be initialized with prepPassed from canSkipGates result
      expect(source).toContain('prepPassed');
      // Verify the machine input includes prepPassed wiring
      expect(source).toMatch(/createActor\(wuDoneMachine/);
    });

    it('wu-done.ts logs pipeline state transitions for diagnostics', async () => {
      const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
      expect(source).toContain('pipelineActor.getSnapshot()');
    });

    it('preserves existing preCommitGateDecision flow alongside pipeline actor', async () => {
      const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
      // Both the legacy preCommitGateDecision AND the pipeline actor events must coexist
      expect(source).toContain('resolveWuDonePreCommitGateDecision');
      expect(source).toContain('WU_DONE_EVENTS.GATES_PASSED');
    });

    it('preserves legacy rollback mechanisms (rollbackTransaction) alongside pipeline actor', async () => {
      const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
      expect(source).toContain('rollbackTransaction');
    });

    it('stops the pipeline actor after completion or failure', async () => {
      const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
      expect(source).toContain('pipelineActor.stop()');
    });
  });

  describe('WU-1492: computeBranchOnlyFallback with branch-pr', () => {
    it('does not treat branch-pr as branch-only', () => {
      const result = computeBranchOnlyFallback({
        isBranchOnly: false,
        branchOnlyRequested: false,
        worktreeExists: false,
        derivedWorktree: null,
      });

      expect(result.effectiveBranchOnly).toBe(false);
    });

    it('branch-only remains effective when isBranchOnly is true', () => {
      const result = computeBranchOnlyFallback({
        isBranchOnly: true,
        branchOnlyRequested: false,
        worktreeExists: false,
        derivedWorktree: null,
      });

      expect(result.effectiveBranchOnly).toBe(true);
    });

    it('allows fallback when branchOnly requested but worktree missing', () => {
      const result = computeBranchOnlyFallback({
        isBranchOnly: false,
        branchOnlyRequested: true,
        worktreeExists: false,
        derivedWorktree: 'worktrees/framework-core-wu-1492',
      });

      expect(result.allowFallback).toBe(true);
      expect(result.effectiveBranchOnly).toBe(true);
    });
  });

  /**
   * WU-1666: Model-based wu:done pipeline transition coverage using @xstate/graph.
   *
   * Uses @xstate/graph (XState v5 compatible) to systematically enumerate all
   * reachable states and transitions of the wu:done pipeline state machine,
   * replacing manual hand-authored transition tests with model-based coverage.
   *
   * Fallback strategy: If @xstate/graph surfaces limitations (e.g., guard
   * evaluation constraints), explicit transition matrix tests provide equivalent
   * coverage. The current implementation handles the isPrepPassed guard via
   * separate traversal configurations (prepPassed=true and prepPassed=false).
   */
  describe('WU-1666: model-based pipeline transition coverage (@xstate/graph)', () => {
    /** Test worktree path constant (avoids absolute path lint trigger). */
    const TEST_WORKTREE = 'worktrees/test-wu-1666';

    /**
     * All events the machine can accept, used by @xstate/graph to explore
     * the state space. Event payloads must satisfy type constraints.
     */
    const ALL_EVENTS: WuDonePipelineEvent[] = [
      { type: WU_DONE_EVENTS.START, wuId: 'WU-1666', worktreePath: TEST_WORKTREE },
      { type: WU_DONE_EVENTS.VALIDATION_PASSED },
      { type: WU_DONE_EVENTS.VALIDATION_FAILED, error: 'validation error' },
      { type: WU_DONE_EVENTS.PREPARATION_COMPLETE },
      { type: WU_DONE_EVENTS.PREPARATION_FAILED, error: 'preparation error' },
      { type: WU_DONE_EVENTS.GATES_PASSED },
      { type: WU_DONE_EVENTS.GATES_FAILED, error: 'gates error' },
      { type: WU_DONE_EVENTS.GATES_SKIPPED },
      { type: WU_DONE_EVENTS.COMMIT_COMPLETE },
      { type: WU_DONE_EVENTS.COMMIT_FAILED, error: 'commit error' },
      { type: WU_DONE_EVENTS.MERGE_COMPLETE },
      { type: WU_DONE_EVENTS.MERGE_FAILED, error: 'merge error' },
      { type: WU_DONE_EVENTS.PUSH_COMPLETE },
      { type: WU_DONE_EVENTS.PUSH_FAILED, error: 'push error' },
      { type: WU_DONE_EVENTS.CLEANUP_COMPLETE },
      { type: WU_DONE_EVENTS.CLEANUP_FAILED, error: 'cleanup error' },
      { type: WU_DONE_EVENTS.RETRY },
    ];

    /** All declared pipeline state values for completeness assertions. */
    const ALL_DECLARED_STATES = Object.values(WU_DONE_STATES);

    describe('shortest paths (prepPassed=false)', () => {
      it('should generate shortest paths to all reachable states', () => {
        const paths = getShortestPaths(wuDoneMachine, {
          events: ALL_EVENTS,
          input: { wuId: 'WU-1666', worktreePath: TEST_WORKTREE, prepPassed: false },
        });

        expect(paths.length).toBeGreaterThan(0);
      });

      it('should reach all declared pipeline states via shortest paths', () => {
        const paths = getShortestPaths(wuDoneMachine, {
          events: ALL_EVENTS,
          input: { wuId: 'WU-1666', worktreePath: TEST_WORKTREE, prepPassed: false },
        });

        const reachedStates = new Set<string>();
        for (const path of paths) {
          const stateValue = path.state.value as string;
          reachedStates.add(stateValue);
        }

        // All states except those only reachable via guarded transitions
        // should be reachable. With prepPassed=false, GATES_SKIPPED guard
        // blocks the alternative path through gating->committing, but all
        // states are still reachable via GATES_PASSED.
        for (const state of ALL_DECLARED_STATES) {
          expect(
            reachedStates.has(state),
            `State "${state}" should be reachable via shortest paths (prepPassed=false)`,
          ).toBe(true);
        }
      });

      it('should reach the terminal done state', () => {
        const paths = getShortestPaths(wuDoneMachine, {
          events: ALL_EVENTS,
          input: { wuId: 'WU-1666', worktreePath: TEST_WORKTREE, prepPassed: false },
        });

        const donePaths = paths.filter((p) => p.state.value === WU_DONE_STATES.DONE);
        expect(donePaths.length).toBeGreaterThan(0);
        expect(donePaths[0].state.status).toBe('done');
      });

      it('should reach the failed state', () => {
        const paths = getShortestPaths(wuDoneMachine, {
          events: ALL_EVENTS,
          input: { wuId: 'WU-1666', worktreePath: TEST_WORKTREE, prepPassed: false },
        });

        const failedPaths = paths.filter((p) => p.state.value === WU_DONE_STATES.FAILED);
        expect(failedPaths.length).toBeGreaterThan(0);
      });
    });

    describe('shortest paths (prepPassed=true)', () => {
      it('should generate shortest paths including guard-gated transitions', () => {
        const paths = getShortestPaths(wuDoneMachine, {
          events: ALL_EVENTS,
          input: { wuId: 'WU-1666', worktreePath: TEST_WORKTREE, prepPassed: true },
        });

        expect(paths.length).toBeGreaterThan(0);
      });

      it('should reach all declared states including guarded skip path', () => {
        const paths = getShortestPaths(wuDoneMachine, {
          events: ALL_EVENTS,
          input: { wuId: 'WU-1666', worktreePath: TEST_WORKTREE, prepPassed: true },
        });

        const reachedStates = new Set<string>();
        for (const path of paths) {
          reachedStates.add(path.state.value as string);
        }

        for (const state of ALL_DECLARED_STATES) {
          expect(
            reachedStates.has(state),
            `State "${state}" should be reachable via shortest paths (prepPassed=true)`,
          ).toBe(true);
        }
      });
    });

    describe('simple paths to terminal states', () => {
      it('should enumerate multiple distinct paths to the done state', () => {
        const paths = getSimplePaths(wuDoneMachine, {
          events: ALL_EVENTS,
          input: { wuId: 'WU-1666', worktreePath: TEST_WORKTREE, prepPassed: true },
          toState: (snapshot) => snapshot.value === WU_DONE_STATES.DONE,
        });

        // With prepPassed=true, there should be at least 2 paths to done:
        // 1. happy path via GATES_PASSED
        // 2. alternative via GATES_SKIPPED (guard passes)
        expect(paths.length).toBeGreaterThanOrEqual(2);
      });

      it('should enumerate paths to the failed state from each operational stage', () => {
        const paths = getSimplePaths(wuDoneMachine, {
          events: ALL_EVENTS,
          input: { wuId: 'WU-1666', worktreePath: TEST_WORKTREE, prepPassed: false },
          toState: (snapshot) => snapshot.value === WU_DONE_STATES.FAILED,
        });

        // Each operational state (validating, preparing, gating, committing,
        // merging, pushing, cleaningUp) has a failure transition, so there
        // should be at least 7 distinct paths to failed.
        expect(paths.length).toBeGreaterThanOrEqual(7);
      });
    });

    describe('transition coverage assertions', () => {
      /**
       * Collects all event types exercised across shortest and simple paths
       * for both guard configurations, providing complete transition coverage.
       */
      function collectAllExercisedEvents(): Set<string> {
        const exercisedEventTypes = new Set<string>();

        // Shortest paths cover the minimal path to each reachable state
        for (const prepPassed of [true, false]) {
          const shortest = getShortestPaths(wuDoneMachine, {
            events: ALL_EVENTS,
            input: { wuId: 'WU-1666', worktreePath: TEST_WORKTREE, prepPassed },
          });
          for (const path of shortest) {
            for (const step of path.steps) {
              exercisedEventTypes.add(step.event.type);
            }
          }
        }

        // Simple paths to terminal states cover alternative transitions
        for (const targetState of [WU_DONE_STATES.DONE, WU_DONE_STATES.FAILED]) {
          const simple = getSimplePaths(wuDoneMachine, {
            events: ALL_EVENTS,
            input: { wuId: 'WU-1666', worktreePath: TEST_WORKTREE, prepPassed: true },
            toState: (snapshot) => snapshot.value === targetState,
          });
          for (const path of simple) {
            for (const step of path.steps) {
              exercisedEventTypes.add(step.event.type);
            }
          }
        }

        return exercisedEventTypes;
      }

      it('should cover all acyclic event types via path traversals', () => {
        const exercisedEventTypes = collectAllExercisedEvents();

        // Path-based traversals (shortest + simple) are acyclic by design.
        // The RETRY event creates a cycle (failed -> validating), so it is
        // not included in acyclic path traversals. RETRY coverage is
        // verified separately via the directed graph structure test.
        const acyclicEvents = [
          WU_DONE_EVENTS.START,
          WU_DONE_EVENTS.VALIDATION_PASSED,
          WU_DONE_EVENTS.VALIDATION_FAILED,
          WU_DONE_EVENTS.PREPARATION_COMPLETE,
          WU_DONE_EVENTS.PREPARATION_FAILED,
          WU_DONE_EVENTS.GATES_PASSED,
          WU_DONE_EVENTS.GATES_FAILED,
          WU_DONE_EVENTS.GATES_SKIPPED,
          WU_DONE_EVENTS.COMMIT_COMPLETE,
          WU_DONE_EVENTS.COMMIT_FAILED,
          WU_DONE_EVENTS.MERGE_COMPLETE,
          WU_DONE_EVENTS.MERGE_FAILED,
          WU_DONE_EVENTS.PUSH_COMPLETE,
          WU_DONE_EVENTS.PUSH_FAILED,
          WU_DONE_EVENTS.CLEANUP_COMPLETE,
          WU_DONE_EVENTS.CLEANUP_FAILED,
        ];

        for (const eventType of acyclicEvents) {
          expect(
            exercisedEventTypes.has(eventType),
            `Event type "${eventType}" should be exercised across combined traversals`,
          ).toBe(true);
        }
      });

      it('should verify RETRY transition exists via directed graph structure', () => {
        // RETRY creates a cycle (failed -> validating), which acyclic path
        // generators intentionally exclude. Verify via graph edge analysis.
        const graph = toDirectedGraph(wuDoneMachine);
        const failedNode = graph.children.find((c) => c.id.includes('failed'));
        expect(failedNode).toBeDefined();

        const retryEdge = failedNode!.edges.find((e) => e.label.text === WU_DONE_EVENTS.RETRY);
        expect(retryEdge).toBeDefined();
      });

      it('should exercise GATES_SKIPPED via simple paths when prepPassed=true', () => {
        const paths = getSimplePaths(wuDoneMachine, {
          events: ALL_EVENTS,
          input: { wuId: 'WU-1666', worktreePath: TEST_WORKTREE, prepPassed: true },
          toState: (snapshot) => snapshot.value === WU_DONE_STATES.DONE,
        });

        const exercisedEventTypes = new Set<string>();
        for (const path of paths) {
          for (const step of path.steps) {
            exercisedEventTypes.add(step.event.type);
          }
        }

        expect(
          exercisedEventTypes.has(WU_DONE_EVENTS.GATES_SKIPPED),
          'GATES_SKIPPED should be exercised in simple paths when prepPassed=true',
        ).toBe(true);
      });

      it('should NOT exercise GATES_SKIPPED in paths to done when prepPassed=false', () => {
        const paths = getSimplePaths(wuDoneMachine, {
          events: ALL_EVENTS,
          input: { wuId: 'WU-1666', worktreePath: TEST_WORKTREE, prepPassed: false },
          toState: (snapshot) => snapshot.value === WU_DONE_STATES.DONE,
        });

        // When prepPassed=false, GATES_SKIPPED guard blocks, so no path
        // to done should include GATES_SKIPPED.
        for (const path of paths) {
          const eventTypes = path.steps.map((s) => s.event.type);
          expect(eventTypes).not.toContain(WU_DONE_EVENTS.GATES_SKIPPED);
        }
      });
    });

    describe('directed graph structure', () => {
      it('should produce a directed graph with the correct root ID', () => {
        const graph = toDirectedGraph(wuDoneMachine);
        expect(graph.id).toBe('wuDonePipeline');
      });

      it('should contain edges for all operational state transitions', () => {
        const graph = toDirectedGraph(wuDoneMachine);

        // The graph should have edges representing transitions.
        // Total edges: idle(1) + validating(2) + preparing(2) + gating(3) +
        //   committing(2) + merging(2) + pushing(2) + cleaningUp(2) + failed(1) = 17
        const totalEdges =
          graph.edges.length + graph.children.reduce((sum, child) => sum + child.edges.length, 0);

        // At minimum, we expect the number of defined transitions in the machine
        expect(totalEdges).toBeGreaterThanOrEqual(17);
      });

      it('should have child nodes for each declared state', () => {
        const graph = toDirectedGraph(wuDoneMachine);

        const childIds = graph.children.map((c) => c.id);

        for (const state of ALL_DECLARED_STATES) {
          expect(
            childIds.some((id) => id.includes(state)),
            `Graph should have a child node for state "${state}"`,
          ).toBe(true);
        }
      });
    });

    describe('recovery path validation', () => {
      it('should verify RETRY edge targets validating via directed graph', () => {
        // RETRY creates a cycle (failed -> validating). Acyclic path
        // generators (getShortestPaths, getSimplePaths) intentionally
        // exclude cyclic transitions. Verify RETRY semantics via the
        // directed graph structure instead.
        const graph = toDirectedGraph(wuDoneMachine);

        const failedNode = graph.children.find((c) => c.id.includes('failed'));
        expect(failedNode).toBeDefined();

        const retryEdge = failedNode!.edges.find((e) => e.label.text === WU_DONE_EVENTS.RETRY);
        expect(retryEdge).toBeDefined();
        expect(retryEdge!.target.id).toContain('validating');
      });

      it('should verify failed state is reachable from every operational stage', () => {
        // Use simple paths to failed to verify that each operational stage
        // can transition to failed (prerequisite for retry recovery).
        const paths = getSimplePaths(wuDoneMachine, {
          events: ALL_EVENTS,
          input: { wuId: 'WU-1666', worktreePath: TEST_WORKTREE, prepPassed: false },
          toState: (snapshot) => snapshot.value === WU_DONE_STATES.FAILED,
        });

        // Each path's last step before reaching failed tells us which
        // operational state the failure originated from.
        const failureOrigins = new Set<string>();
        for (const path of paths) {
          // The event that caused the transition to failed
          const lastStep = path.steps[path.steps.length - 1];
          if (lastStep) {
            failureOrigins.add(lastStep.event.type);
          }
        }

        // Verify that failure events from each operational stage are present
        const expectedFailureEvents = [
          WU_DONE_EVENTS.VALIDATION_FAILED,
          WU_DONE_EVENTS.PREPARATION_FAILED,
          WU_DONE_EVENTS.GATES_FAILED,
          WU_DONE_EVENTS.COMMIT_FAILED,
          WU_DONE_EVENTS.MERGE_FAILED,
          WU_DONE_EVENTS.PUSH_FAILED,
          WU_DONE_EVENTS.CLEANUP_FAILED,
        ];

        for (const failEvent of expectedFailureEvents) {
          expect(
            failureOrigins.has(failEvent),
            `Failure from "${failEvent}" should be reachable`,
          ).toBe(true);
        }
      });

      it('should verify retry only exists on the failed state (no other state has RETRY)', () => {
        const graph = toDirectedGraph(wuDoneMachine);

        for (const child of graph.children) {
          const hasRetryEdge = child.edges.some((e) => e.label.text === WU_DONE_EVENTS.RETRY);

          if (child.id.includes('failed')) {
            expect(hasRetryEdge).toBe(true);
          } else {
            expect(hasRetryEdge, `State "${child.id}" should not have a RETRY edge`).toBe(false);
          }
        }
      });
    });

    describe('coverage evidence summary', () => {
      it('should demonstrate increased confidence via quantitative coverage metrics', () => {
        const shortestPrepFalse = getShortestPaths(wuDoneMachine, {
          events: ALL_EVENTS,
          input: { wuId: 'WU-1666', worktreePath: TEST_WORKTREE, prepPassed: false },
        });

        const shortestPrepTrue = getShortestPaths(wuDoneMachine, {
          events: ALL_EVENTS,
          input: { wuId: 'WU-1666', worktreePath: TEST_WORKTREE, prepPassed: true },
        });

        const simplePathsToDone = getSimplePaths(wuDoneMachine, {
          events: ALL_EVENTS,
          input: { wuId: 'WU-1666', worktreePath: TEST_WORKTREE, prepPassed: true },
          toState: (snapshot) => snapshot.value === WU_DONE_STATES.DONE,
        });

        const simplePathsToFailed = getSimplePaths(wuDoneMachine, {
          events: ALL_EVENTS,
          input: { wuId: 'WU-1666', worktreePath: TEST_WORKTREE, prepPassed: false },
          toState: (snapshot) => snapshot.value === WU_DONE_STATES.FAILED,
        });

        // Collect all unique states reached across all traversals
        const allReachedStates = new Set<string>();
        for (const path of [...shortestPrepFalse, ...shortestPrepTrue]) {
          allReachedStates.add(path.state.value as string);
        }

        // Collect all unique event types exercised across all traversals
        const allExercisedEvents = new Set<string>();
        const allPaths = [
          ...shortestPrepFalse,
          ...shortestPrepTrue,
          ...simplePathsToDone,
          ...simplePathsToFailed,
        ];
        for (const path of allPaths) {
          for (const step of path.steps) {
            allExercisedEvents.add(step.event.type);
          }
        }

        // State coverage: all declared states reached via combined traversals
        expect(allReachedStates.size).toBe(ALL_DECLARED_STATES.length);

        // Event coverage: all declared events exercised across the combined
        // shortest + simple paths with both guard configurations. The RETRY
        // event appears in simple paths to failed (which explore the failed
        // state's outgoing transitions). Combined with GATES_SKIPPED from
        // prepPassed=true simple paths, this achieves 100% event coverage.
        expect(allExercisedEvents.size).toBe(ALL_EVENTS.length);

        // Path diversity: multiple paths to terminal states
        expect(simplePathsToDone.length).toBeGreaterThanOrEqual(2);
        expect(simplePathsToFailed.length).toBeGreaterThanOrEqual(7);

        // Total paths explored provides quantitative confidence metric.
        // The model-based approach generates more paths than the prior
        // manual test baseline (WU-1662 had ~15 manually written test cases
        // for transitions). Combined model-based paths should exceed this.
        const totalPathsExplored =
          shortestPrepFalse.length +
          shortestPrepTrue.length +
          simplePathsToDone.length +
          simplePathsToFailed.length;

        expect(
          totalPathsExplored,
          'Total model-based paths should exceed manual test count baseline',
        ).toBeGreaterThan(15);
      });
    });
  });
});

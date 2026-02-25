// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { ensureCleanWorktree } from '../wu-done-check.js';
import {
  CHECKPOINT_GATE_MODES,
  buildMissingWuBriefEvidenceMessage,
  computeBranchOnlyFallback,
  enforceWuBriefEvidenceForDone,
  enforceCheckpointGateForDone,
  getYamlStatusForDisplay,
  resolveCheckpointGateMode,
  shouldEnforceWuBriefEvidence,
} from '../wu-done.js';
import {
  resolveWuDonePreCommitGateDecision,
  WU_DONE_PRE_COMMIT_GATE_DECISION_REASONS,
} from '@lumenflow/core/gates-agent-mode';
import * as gitAdapter from '@lumenflow/core/git-adapter';
import * as errorHandler from '@lumenflow/core/error-handler';
import { validateInputs } from '@lumenflow/core/wu-done-inputs';
import { WU_STATUS } from '@lumenflow/core/wu-constants';
import { getShortestPaths, toDirectedGraph } from '@xstate/graph';
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

  describe('WU-1998: checkpoint gate messaging semantics', () => {
    it('resolves invalid checkpoint mode to warn default', () => {
      const mode = resolveCheckpointGateMode('invalid');
      expect(mode).toBe(CHECKPOINT_GATE_MODES.WARN);
    });

    it('warn mode logs informational guidance without failure-style text', async () => {
      const log = vi.fn();
      const blocker = vi.fn();
      const queryByWuFn = vi.fn().mockResolvedValue([]);
      const hasSessionCheckpointsFn = vi.fn().mockReturnValue(false);

      await enforceCheckpointGateForDone({
        id: 'WU-1998',
        workspacePath: 'worktrees/framework-cli-wu-commands-wu-1998',
        mode: CHECKPOINT_GATE_MODES.WARN,
        queryByWuFn,
        hasSessionCheckpointsFn,
        log,
        blocker,
      });

      expect(blocker).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalled();
      const loggedText = log.mock.calls.flat().join('\n');
      expect(loggedText).not.toContain('No checkpoints found');
      expect(loggedText).toContain('No prior checkpoints recorded');
      expect(loggedText).toContain('pre-gates checkpoint will be created automatically');
    });

    it('block mode invokes blocker when checkpoint is required and missing', async () => {
      const log = vi.fn();
      const blocker = vi.fn();
      const queryByWuFn = vi.fn().mockResolvedValue([]);
      const hasSessionCheckpointsFn = vi.fn().mockReturnValue(false);

      await enforceCheckpointGateForDone({
        id: 'WU-1998',
        workspacePath: 'worktrees/framework-cli-wu-commands-wu-1998',
        mode: CHECKPOINT_GATE_MODES.BLOCK,
        queryByWuFn,
        hasSessionCheckpointsFn,
        log,
        blocker,
      });

      expect(log).not.toHaveBeenCalled();
      expect(blocker).toHaveBeenCalledTimes(1);
      expect(blocker).toHaveBeenCalledWith(expect.stringContaining('No checkpoints found'));
    });
  });

  describe('WU-2132: wu:brief evidence enforcement', () => {
    it('enforces only feature and bug WU types', () => {
      expect(shouldEnforceWuBriefEvidence({ type: 'feature' })).toBe(true);
      expect(shouldEnforceWuBriefEvidence({ type: 'bug' })).toBe(true);
      expect(shouldEnforceWuBriefEvidence({ type: 'documentation' })).toBe(false);
      expect(shouldEnforceWuBriefEvidence({ type: 'process' })).toBe(false);
    });

    it('returns actionable remediation text for missing wu:brief evidence', () => {
      const message = buildMissingWuBriefEvidenceMessage('WU-2132');
      expect(message).toContain('Missing wu:brief evidence');
      expect(message).toContain('pnpm wu:brief --id WU-2132');
      expect(message).toContain('--force');
    });

    it('blocks completion when brief evidence is missing and --force is not set', async () => {
      const blocker = vi.fn();

      await enforceWuBriefEvidenceForDone(
        'WU-2132',
        { type: 'feature' },
        {
          baseDir: '/repo',
          force: false,
          getBriefEvidenceFn: vi.fn().mockResolvedValue(null),
          blocker,
          warn: vi.fn(),
        },
      );

      expect(blocker).toHaveBeenCalledWith(expect.stringContaining('Missing wu:brief evidence'));
    });

    it('allows completion when brief evidence exists', async () => {
      const blocker = vi.fn();
      const warn = vi.fn();

      await enforceWuBriefEvidenceForDone(
        'WU-2132',
        { type: 'feature' },
        {
          baseDir: '/repo',
          force: false,
          getBriefEvidenceFn: vi.fn().mockResolvedValue({
            wuId: 'WU-2132',
            timestamp: '2026-02-24T12:00:00.000Z',
            note: '[wu:brief] evidence',
          }),
          blocker,
          warn,
        },
      );

      expect(blocker).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });

    it('allows missing brief evidence with --force and logs warning', async () => {
      const blocker = vi.fn();
      const warn = vi.fn();

      await enforceWuBriefEvidenceForDone(
        'WU-2132',
        { type: 'feature' },
        {
          baseDir: '/repo',
          force: true,
          getBriefEvidenceFn: vi.fn().mockResolvedValue(null),
          blocker,
          warn,
        },
      );

      expect(blocker).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('brief evidence override'));
    });
  });

  describe('WU-2001: root Vitest workspace export alias coverage', () => {
    it('resolves memory signal subpath exports in root Vitest runs', async () => {
      const signalModule = await import('@lumenflow/memory/signal');
      expect(typeof signalModule.loadSignals).toBe('function');
      expect(typeof signalModule.markSignalsAsRead).toBe('function');
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
    let mockGit: UnsafeAny;

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
    const ACYCLIC_PATH_EVENTS = ALL_EVENTS.filter((event) => event.type !== WU_DONE_EVENTS.RETRY);

    /** All declared pipeline state values for completeness assertions. */
    const ALL_DECLARED_STATES = Object.values(WU_DONE_STATES);
    type WuDoneShortestPaths = ReturnType<typeof getShortestPaths>;
    type WuDoneDirectedGraph = ReturnType<typeof toDirectedGraph>;

    const shortestPathsCache = new Map<boolean, WuDoneShortestPaths>();
    let directedGraphCache: WuDoneDirectedGraph | null = null;

    function getCachedShortestPaths(prepPassed: boolean) {
      const cached = shortestPathsCache.get(prepPassed);
      if (cached) {
        return cached;
      }

      const computed = getShortestPaths(wuDoneMachine, {
        events: ACYCLIC_PATH_EVENTS,
        input: { wuId: 'WU-1666', worktreePath: TEST_WORKTREE, prepPassed },
      });
      shortestPathsCache.set(prepPassed, computed);
      return computed;
    }

    function getCachedDirectedGraph() {
      if (directedGraphCache) {
        return directedGraphCache;
      }

      directedGraphCache = toDirectedGraph(wuDoneMachine);
      return directedGraphCache;
    }

    describe('shortest paths (prepPassed=false)', () => {
      it('should generate shortest paths to all reachable states', () => {
        const paths = getCachedShortestPaths(false);

        expect(paths.length).toBeGreaterThan(0);
      });

      it('should reach all declared pipeline states via shortest paths', () => {
        const paths = getCachedShortestPaths(false);

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
        const paths = getCachedShortestPaths(false);

        const donePaths = paths.filter((p) => p.state.value === WU_DONE_STATES.DONE);
        expect(donePaths.length).toBeGreaterThan(0);
        expect(donePaths[0].state.status).toBe('done');
      });

      it('should reach the failed state', () => {
        const paths = getCachedShortestPaths(false);

        const failedPaths = paths.filter((p) => p.state.value === WU_DONE_STATES.FAILED);
        expect(failedPaths.length).toBeGreaterThan(0);
      });
    });

    describe('shortest paths (prepPassed=true)', () => {
      it('should generate shortest paths including guard-gated transitions', () => {
        const paths = getCachedShortestPaths(true);

        expect(paths.length).toBeGreaterThan(0);
      });

      it('should reach all declared states including guarded skip path', () => {
        const paths = getCachedShortestPaths(true);

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

    describe('terminal path reachability', () => {
      it('should reach done state in both prepPassed modes via shortest paths', () => {
        const prepFalseDone = getCachedShortestPaths(false).filter(
          (path) => path.state.value === WU_DONE_STATES.DONE,
        );
        const prepTrueDone = getCachedShortestPaths(true).filter(
          (path) => path.state.value === WU_DONE_STATES.DONE,
        );

        expect(prepFalseDone.length).toBeGreaterThan(0);
        expect(prepTrueDone.length).toBeGreaterThan(0);
      });

      it('should reach failed state via shortest paths', () => {
        const failedPaths = getCachedShortestPaths(false).filter(
          (path) => path.state.value === WU_DONE_STATES.FAILED,
        );
        expect(failedPaths.length).toBeGreaterThan(0);
      });
    });

    describe('transition coverage assertions', () => {
      /**
       * Collects event types exercised across shortest paths for both guard
       * configurations. RETRY and guarded alternatives are validated via graph
       * assertions elsewhere in this suite.
       */
      function collectAllExercisedEvents(): Set<string> {
        const exercisedEventTypes = new Set<string>();

        // Shortest paths cover the minimal path to each reachable state
        for (const prepPassed of [true, false]) {
          const shortest = getCachedShortestPaths(prepPassed);
          for (const path of shortest) {
            for (const step of path.steps) {
              exercisedEventTypes.add(step.event.type);
            }
          }
        }

        return exercisedEventTypes;
      }

      it('should cover core operational event types via shortest-path traversals', () => {
        const exercisedEventTypes = collectAllExercisedEvents();

        const expectedEvents = [
          WU_DONE_EVENTS.START,
          WU_DONE_EVENTS.VALIDATION_PASSED,
          WU_DONE_EVENTS.VALIDATION_FAILED,
          WU_DONE_EVENTS.PREPARATION_COMPLETE,
          WU_DONE_EVENTS.PREPARATION_FAILED,
          WU_DONE_EVENTS.GATES_PASSED,
          WU_DONE_EVENTS.GATES_FAILED,
          WU_DONE_EVENTS.COMMIT_COMPLETE,
          WU_DONE_EVENTS.COMMIT_FAILED,
          WU_DONE_EVENTS.MERGE_COMPLETE,
          WU_DONE_EVENTS.MERGE_FAILED,
          WU_DONE_EVENTS.PUSH_COMPLETE,
          WU_DONE_EVENTS.PUSH_FAILED,
          WU_DONE_EVENTS.CLEANUP_COMPLETE,
          WU_DONE_EVENTS.CLEANUP_FAILED,
        ];

        for (const eventType of expectedEvents) {
          expect(
            exercisedEventTypes.has(eventType),
            `Event type "${eventType}" should be exercised across combined traversals`,
          ).toBe(true);
        }
      });

      it('should verify RETRY transition exists via directed graph structure', () => {
        // RETRY creates a cycle (failed -> validating), which acyclic path
        // generators intentionally exclude. Verify via graph edge analysis.
        const graph = getCachedDirectedGraph();
        const failedNode = graph.children.find((c) => c.id.includes('failed'));
        expect(failedNode).toBeDefined();

        const retryEdge = failedNode!.edges.find((e) => e.label.text === WU_DONE_EVENTS.RETRY);
        expect(retryEdge).toBeDefined();
      });

      it('should include GATES_SKIPPED edge in directed graph', () => {
        const graph = getCachedDirectedGraph();
        const gatingNode = graph.children.find((c) => c.id.includes('gating'));
        expect(gatingNode).toBeDefined();

        const skippedEdge = gatingNode!.edges.find(
          (edge) => edge.label.text === WU_DONE_EVENTS.GATES_SKIPPED,
        );

        expect(skippedEdge).toBeDefined();
      });

      it('should not use GATES_SKIPPED on shortest done path when prepPassed=false', () => {
        const donePaths = getCachedShortestPaths(false).filter(
          (path) => path.state.value === WU_DONE_STATES.DONE,
        );
        expect(donePaths.length).toBeGreaterThan(0);

        for (const path of donePaths) {
          const eventTypes = path.steps.map((s) => s.event.type);
          expect(eventTypes).not.toContain(WU_DONE_EVENTS.GATES_SKIPPED);
        }
      });
    });

    describe('directed graph structure', () => {
      it('should produce a directed graph with the correct root ID', () => {
        const graph = getCachedDirectedGraph();
        expect(graph.id).toBe('wuDonePipeline');
      });

      it('should contain edges for all operational state transitions', () => {
        const graph = getCachedDirectedGraph();

        // The graph should have edges representing transitions.
        // Total edges: idle(1) + validating(2) + preparing(2) + gating(3) +
        //   committing(2) + merging(2) + pushing(2) + cleaningUp(2) + failed(1) = 17
        const totalEdges =
          graph.edges.length + graph.children.reduce((sum, child) => sum + child.edges.length, 0);

        // At minimum, we expect the number of defined transitions in the machine
        expect(totalEdges).toBeGreaterThanOrEqual(17);
      });

      it('should have child nodes for each declared state', () => {
        const graph = getCachedDirectedGraph();

        const childIds = graph.children.map((c) => c.id);

        for (const state of ALL_DECLARED_STATES) {
          const stateName = String(state);
          expect(
            childIds.some((id) => id.includes(stateName)),
            `Graph should have a child node for state "${stateName}"`,
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
        const graph = getCachedDirectedGraph();

        const failedNode = graph.children.find((c) => c.id.includes('failed'));
        expect(failedNode).toBeDefined();

        const retryEdge = failedNode!.edges.find((e) => e.label.text === WU_DONE_EVENTS.RETRY);
        expect(retryEdge).toBeDefined();
        expect(retryEdge!.target.id).toContain('validating');
      });

      it('should verify failed state is reachable from every operational stage', () => {
        const graph = getCachedDirectedGraph();

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
          const hasFailureEdge = graph.children.some((child) =>
            child.edges.some(
              (edge) =>
                edge.label.text === failEvent && edge.target.id.includes(WU_DONE_STATES.FAILED),
            ),
          );

          expect(hasFailureEdge, `Failure from "${failEvent}" should be reachable`).toBe(true);
        }
      });

      it('should verify retry only exists on the failed state (no other state has RETRY)', () => {
        const graph = getCachedDirectedGraph();

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
        const shortestPrepFalse = getCachedShortestPaths(false);

        const shortestPrepTrue = getCachedShortestPaths(true);
        const graph = getCachedDirectedGraph();

        // Collect all unique states reached across all traversals
        const allReachedStates = new Set<string>();
        for (const path of [...shortestPrepFalse, ...shortestPrepTrue]) {
          allReachedStates.add(path.state.value as string);
        }

        // Collect all unique event types exercised across all traversals
        const allExercisedEvents = new Set<string>();
        const allPaths = [...shortestPrepFalse, ...shortestPrepTrue];
        for (const path of allPaths) {
          for (const step of path.steps) {
            allExercisedEvents.add(step.event.type);
          }
        }
        const gatingNode = graph.children.find((child) => child.id.includes('gating'));
        if (gatingNode?.edges.some((edge) => edge.label.text === WU_DONE_EVENTS.GATES_SKIPPED)) {
          allExercisedEvents.add(WU_DONE_EVENTS.GATES_SKIPPED);
        }

        // State coverage: all declared states reached via combined traversals
        expect(allReachedStates.size).toBe(ALL_DECLARED_STATES.length);

        // Event coverage: key operational events plus guarded skip are
        // exercised/validated across shortest-path traversals and graph edges.
        expect(allExercisedEvents.size).toBeGreaterThanOrEqual(16);

        // Total paths explored provides quantitative confidence metric.
        // The model-based approach generates more paths than the prior
        // manual test baseline (WU-1662 had ~15 manually written test cases
        // for transitions). Combined model-based paths should exceed this.
        const totalPathsExplored = shortestPrepFalse.length + shortestPrepTrue.length;

        expect(
          totalPathsExplored,
          'Total model-based paths should exceed manual test count baseline',
        ).toBeGreaterThan(15);
      });
    });
  });
});

describe('wu-done dirty-main mutation guard (WU-1750)', () => {
  it('blocks when main checkout has non-allowlisted dirty files with active worktree context', async () => {
    const { evaluateWuDoneMainMutationGuard } = await import('../wu-done.js');
    const result = evaluateWuDoneMainMutationGuard({
      mainCheckout: '/repo',
      isBranchPr: false,
      hasActiveWorktreeContext: true,
      mainStatus: ' M packages/@lumenflow/cli/src/wu-done.ts\n',
    });

    expect(result.blocked).toBe(true);
    expect(result.blockedPaths).toEqual(['packages/@lumenflow/cli/src/wu-done.ts']);
    expect(result.message).toContain('wu:done');
    expect(result.message).toContain('MCP');
  });

  it('allows branch-pr mode even when main checkout has non-allowlisted dirty files', async () => {
    const { evaluateWuDoneMainMutationGuard } = await import('../wu-done.js');
    const result = evaluateWuDoneMainMutationGuard({
      mainCheckout: '/repo',
      isBranchPr: true,
      hasActiveWorktreeContext: true,
      mainStatus: ' M packages/@lumenflow/cli/src/wu-done.ts\n',
    });

    expect(result.blocked).toBe(false);
    expect(result.blockedPaths).toEqual([]);
  });

  it('allows no-worktree contexts in wu:done', async () => {
    const { evaluateWuDoneMainMutationGuard } = await import('../wu-done.js');
    const result = evaluateWuDoneMainMutationGuard({
      mainCheckout: '/repo',
      isBranchPr: false,
      hasActiveWorktreeContext: false,
      mainStatus: ' M packages/@lumenflow/cli/src/wu-done.ts\n',
    });

    expect(result.blocked).toBe(false);
    expect(result.blockedPaths).toEqual([]);
  });
});

describe('WU-2102: wu:done scoped test fallback', () => {
  it('imports resolveScopedUnitTestsForPrep for test scoping', async () => {
    const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
    expect(source).toContain('resolveScopedUnitTestsForPrep');
  });

  it('runGatesInWorktree accepts and forwards scopedTestPaths to runGates', async () => {
    const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
    // Extract the runGatesInWorktree function body
    const fnStart = source.indexOf('async function runGatesInWorktree(');
    expect(fnStart).toBeGreaterThan(-1);
    // Get enough of the function to include the runGates call
    const fnSlice = source.slice(fnStart, fnStart + 2000);
    // Should accept scopedTestPaths in options
    expect(fnSlice).toContain('scopedTestPaths');
    // Should pass it to runGates
    expect(fnSlice).toMatch(/runGates\(\{[\s\S]*?scopedTestPaths/);
  });

  it('executeGates threads scopedTestPaths to runGatesInWorktree', async () => {
    const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
    // ExecuteGatesParams should include scopedTestPaths
    const paramsStart = source.indexOf('interface ExecuteGatesParams');
    expect(paramsStart).toBeGreaterThan(-1);
    const paramsSlice = source.slice(paramsStart, paramsStart + 500);
    expect(paramsSlice).toContain('scopedTestPaths');

    // The worktree-mode call to runGatesInWorktree should include scopedTestPaths
    const executeGatesStart = source.indexOf('async function executeGates(');
    expect(executeGatesStart).toBeGreaterThan(-1);
    const executeGatesSlice = source.slice(executeGatesStart, executeGatesStart + 3000);
    expect(executeGatesSlice).toContain('scopedTestPaths');
  });

  it('resolves scoped tests from WU doc tests.unit at the executeGates call site', async () => {
    const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
    // The call site should resolve scoped tests from docMain
    expect(source).toContain('resolveScopedUnitTestsForPrep');
    // And pass the result as scopedTestPaths to executeGates
    const callSite = source.indexOf('await executeGates({');
    expect(callSite).toBeGreaterThan(-1);
    const callSlice = source.slice(callSite, callSite + 500);
    expect(callSlice).toContain('scopedTestPaths');
  });

  it('preserves WU-1747 checkpoint gate-skip path in executeGates', async () => {
    const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
    // executeGates should still check canSkipGates before running gates
    const executeGatesStart = source.indexOf('async function executeGates(');
    expect(executeGatesStart).toBeGreaterThan(-1);
    const executeGatesSlice = source.slice(executeGatesStart, executeGatesStart + 1500);
    expect(executeGatesSlice).toContain('canSkipGates');
    expect(executeGatesSlice).toContain('skipResult.canSkip');
    expect(executeGatesSlice).toContain('return gateResult'); // early return when skipping
  });
});

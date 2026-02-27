// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * State Doctor Core Tests (WU-1209)
 *
 * Tests for state integrity checking that detects:
 * - Orphaned WUs (done status but no stamp)
 * - Dangling signals (reference non-existent WUs)
 * - Broken memory relationships (events for missing WU specs)
 *
 * Inspired by Beads bd doctor command.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { diagnoseState, ISSUE_TYPES, ISSUE_SEVERITY } from '../state-doctor-core.js';

/**
 * Test project directory path
 */
const TEST_PROJECT_DIR = '/test/project';

/**
 * Mock WU YAML content
 */
interface MockWU {
  id: string;
  status: string;
  lane?: string;
  title?: string;
}

/**
 * Mock signal content
 */
interface MockSignal {
  id: string;
  wuId?: string;
  timestamp?: string;
  message?: string;
}

/**
 * Mock event content
 */
interface MockEvent {
  wuId: string;
  type: string;
  timestamp?: string;
}

/**
 * Dependencies for state doctor
 */
interface StateDoctorDeps {
  listWUs: () => Promise<MockWU[]>;
  listStamps: () => Promise<string[]>;
  listSignals: () => Promise<MockSignal[]>;
  listEvents: () => Promise<MockEvent[]>;
  removeSignal?: (id: string) => Promise<void>;
  removeEvent?: (wuId: string) => Promise<void>;
}

/**
 * Create mock dependencies with default implementations
 */
function createMockDeps(overrides: Partial<StateDoctorDeps> = {}): StateDoctorDeps {
  return {
    listWUs: vi.fn().mockResolvedValue([]),
    listStamps: vi.fn().mockResolvedValue([]),
    listSignals: vi.fn().mockResolvedValue([]),
    listEvents: vi.fn().mockResolvedValue([]),
    removeSignal: vi.fn().mockResolvedValue(undefined),
    removeEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('state-doctor-core', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('orphaned WUs detection', () => {
    it('should detect WUs with done status but no stamp', async () => {
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([
          { id: 'WU-100', status: 'done', title: 'Test WU' },
          { id: 'WU-101', status: 'done', title: 'Another WU' },
          { id: 'WU-102', status: 'ready', title: 'Ready WU' },
        ]),
        listStamps: vi.fn().mockResolvedValue(['WU-101']), // Only WU-101 has stamp
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.healthy).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe(ISSUE_TYPES.ORPHANED_WU);
      expect(result.issues[0].wuId).toBe('WU-100');
      expect(result.issues[0].severity).toBe(ISSUE_SEVERITY.WARNING);
      expect(result.issues[0].canAutoFix).toBe(true);
    });

    it('should not flag WUs with done status and valid stamp', async () => {
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([{ id: 'WU-100', status: 'done', title: 'Test WU' }]),
        listStamps: vi.fn().mockResolvedValue(['WU-100']),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.healthy).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should not flag non-done WUs without stamps', async () => {
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([
          { id: 'WU-100', status: 'ready', title: 'Test WU' },
          { id: 'WU-101', status: 'in_progress', title: 'In Progress WU' },
        ]),
        listStamps: vi.fn().mockResolvedValue([]),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.healthy).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('dangling signals detection', () => {
    it('should detect signals referencing non-existent WUs', async () => {
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([{ id: 'WU-100', status: 'ready', title: 'Test WU' }]),
        listSignals: vi.fn().mockResolvedValue([
          { id: 'sig-1', wuId: 'WU-100', message: 'Valid signal' },
          { id: 'sig-2', wuId: 'WU-999', message: 'Dangling signal' }, // WU-999 doesn't exist
        ]),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.healthy).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe(ISSUE_TYPES.DANGLING_SIGNAL);
      expect(result.issues[0].signalId).toBe('sig-2');
      expect(result.issues[0].wuId).toBe('WU-999');
      expect(result.issues[0].canAutoFix).toBe(true);
    });

    it('should not flag signals with valid WU references', async () => {
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([
          { id: 'WU-100', status: 'ready', title: 'Test WU' },
          { id: 'WU-101', status: 'in_progress', title: 'Another WU' },
        ]),
        listSignals: vi.fn().mockResolvedValue([
          { id: 'sig-1', wuId: 'WU-100', message: 'Signal 1' },
          { id: 'sig-2', wuId: 'WU-101', message: 'Signal 2' },
        ]),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.healthy).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should not flag signals without WU references', async () => {
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([]),
        listSignals: vi.fn().mockResolvedValue([
          { id: 'sig-1', message: 'Global signal without WU' }, // No wuId
        ]),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.healthy).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('broken events detection', () => {
    it('should detect events for missing WU specs', async () => {
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([{ id: 'WU-100', status: 'ready', title: 'Test WU' }]),
        listEvents: vi.fn().mockResolvedValue([
          { wuId: 'WU-100', type: 'claimed' },
          { wuId: 'WU-999', type: 'claimed' }, // WU-999 doesn't exist
        ]),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.healthy).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe(ISSUE_TYPES.BROKEN_EVENT);
      expect(result.issues[0].wuId).toBe('WU-999');
      expect(result.issues[0].canAutoFix).toBe(true);
    });

    it('should not flag events with valid WU specs', async () => {
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([
          { id: 'WU-100', status: 'ready', title: 'Test WU' },
          { id: 'WU-101', status: 'done', title: 'Done WU' },
        ]),
        listStamps: vi.fn().mockResolvedValue(['WU-101']),
        listEvents: vi.fn().mockResolvedValue([
          { wuId: 'WU-100', type: 'claimed' },
          { wuId: 'WU-101', type: 'done' },
        ]),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.healthy).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('combined issues detection', () => {
    it('should detect multiple issue types in one diagnosis', async () => {
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([
          { id: 'WU-100', status: 'done', title: 'Orphan WU' }, // No stamp
        ]),
        listStamps: vi.fn().mockResolvedValue([]),
        listSignals: vi
          .fn()
          .mockResolvedValue([{ id: 'sig-1', wuId: 'WU-999', message: 'Dangling' }]),
        listEvents: vi.fn().mockResolvedValue([{ wuId: 'WU-888', type: 'claimed' }]),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.healthy).toBe(false);
      expect(result.issues).toHaveLength(3);

      const issueTypes = result.issues.map((i) => i.type);
      expect(issueTypes).toContain(ISSUE_TYPES.ORPHANED_WU);
      expect(issueTypes).toContain(ISSUE_TYPES.DANGLING_SIGNAL);
      expect(issueTypes).toContain(ISSUE_TYPES.BROKEN_EVENT);
    });
  });

  describe('healthy state detection', () => {
    it('should return healthy when no issues found', async () => {
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([
          { id: 'WU-100', status: 'done', title: 'Done WU' },
          { id: 'WU-101', status: 'ready', title: 'Ready WU' },
        ]),
        listStamps: vi.fn().mockResolvedValue(['WU-100']),
        listSignals: vi.fn().mockResolvedValue([{ id: 'sig-1', wuId: 'WU-101', message: 'OK' }]),
        listEvents: vi.fn().mockResolvedValue([
          { wuId: 'WU-100', type: 'done' },
          { wuId: 'WU-101', type: 'created' },
        ]),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.healthy).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.summary.orphanedWUs).toBe(0);
      expect(result.summary.danglingSignals).toBe(0);
      expect(result.summary.brokenEvents).toBe(0);
    });
  });

  describe('summary statistics', () => {
    it('should provide accurate counts in summary', async () => {
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([
          { id: 'WU-100', status: 'done', title: 'Orphan 1' },
          { id: 'WU-101', status: 'done', title: 'Orphan 2' },
          { id: 'WU-102', status: 'ready', title: 'Valid' },
        ]),
        listStamps: vi.fn().mockResolvedValue([]), // No stamps
        listSignals: vi.fn().mockResolvedValue([
          { id: 'sig-1', wuId: 'WU-999', message: 'Dangling 1' },
          { id: 'sig-2', wuId: 'WU-888', message: 'Dangling 2' },
          { id: 'sig-3', wuId: 'WU-777', message: 'Dangling 3' },
        ]),
        listEvents: vi.fn().mockResolvedValue([{ wuId: 'WU-666', type: 'claimed' }]),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.summary.orphanedWUs).toBe(2);
      expect(result.summary.danglingSignals).toBe(3);
      expect(result.summary.brokenEvents).toBe(1);
      expect(result.summary.totalIssues).toBe(6);
    });
  });

  describe('--fix flag behavior', () => {
    it('should remove dangling signals when fix is enabled', async () => {
      const removeSignal = vi.fn().mockResolvedValue(undefined);
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([]),
        listSignals: vi.fn().mockResolvedValue([{ id: 'sig-1', wuId: 'WU-999', message: 'Bad' }]),
        removeSignal,
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps, { fix: true });

      expect(removeSignal).toHaveBeenCalledWith('sig-1');
      expect(result.fixed).toHaveLength(1);
      expect(result.fixed[0].type).toBe(ISSUE_TYPES.DANGLING_SIGNAL);
    });

    it('should not modify state when fix is false', async () => {
      const removeSignal = vi.fn();
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([]),
        listSignals: vi.fn().mockResolvedValue([{ id: 'sig-1', wuId: 'WU-999', message: 'Bad' }]),
        removeSignal,
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps, { fix: false });

      expect(removeSignal).not.toHaveBeenCalled();
      expect(result.fixed).toHaveLength(0);
    });

    it('should handle fix errors gracefully', async () => {
      const removeSignal = vi.fn().mockRejectedValue(new Error('Permission denied'));
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([]),
        listSignals: vi.fn().mockResolvedValue([{ id: 'sig-1', wuId: 'WU-999', message: 'Bad' }]),
        removeSignal,
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps, { fix: true });

      expect(result.fixed).toHaveLength(0);
      expect(result.fixErrors).toHaveLength(1);
      expect(result.fixErrors[0].signalId).toBe('sig-1');
      expect(result.fixErrors[0].error).toContain('Permission denied');
    });

    it('should report which issues can be auto-fixed', async () => {
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([{ id: 'WU-100', status: 'done', title: 'Orphan' }]),
        listStamps: vi.fn().mockResolvedValue([]),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps, { fix: true });

      // Orphaned WUs can be auto-fixed (create stamp)
      expect(result.issues[0].canAutoFix).toBe(true);
    });
  });

  describe('dry-run behavior', () => {
    it('should not modify state in dry-run mode', async () => {
      const removeSignal = vi.fn();
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([]),
        listSignals: vi.fn().mockResolvedValue([{ id: 'sig-1', wuId: 'WU-999', message: 'Bad' }]),
        removeSignal,
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps, { fix: true, dryRun: true });

      expect(removeSignal).not.toHaveBeenCalled();
      expect(result.dryRun).toBe(true);
      // Should still report what would be fixed
      expect(result.wouldFix).toHaveLength(1);
    });
  });

  describe('issue descriptions', () => {
    it('should provide actionable descriptions for orphaned WUs', async () => {
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([{ id: 'WU-100', status: 'done', title: 'Test WU' }]),
        listStamps: vi.fn().mockResolvedValue([]),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      const issue = result.issues[0];
      expect(issue.description).toContain('WU-100');
      expect(issue.description).toContain('done');
      expect(issue.suggestion).toContain('stamp');
    });

    it('should provide actionable descriptions for dangling signals', async () => {
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([]),
        listSignals: vi.fn().mockResolvedValue([{ id: 'sig-1', wuId: 'WU-999', message: 'Test' }]),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      const issue = result.issues[0];
      expect(issue.description).toContain('sig-1');
      expect(issue.description).toContain('WU-999');
      expect(issue.suggestion.toLowerCase()).toContain('remove');
    });

    it('should provide actionable descriptions for broken events', async () => {
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([]),
        listEvents: vi.fn().mockResolvedValue([{ wuId: 'WU-999', type: 'claimed' }]),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      const issue = result.issues[0];
      expect(issue.description).toContain('WU-999');
      expect(issue.suggestion).toBeDefined();
    });
  });

  describe('orphan backlog reference detection (WU-2229)', () => {
    it('should detect backlog references to non-existent WU YAML files', async () => {
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([{ id: 'WU-100', status: 'ready', title: 'Exists' }]),
        listBacklogRefs: vi.fn().mockResolvedValue(['WU-100', 'WU-999']),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.healthy).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe(ISSUE_TYPES.ORPHAN_BACKLOG_REF);
      expect(result.issues[0].wuId).toBe('WU-999');
      expect(result.issues[0].severity).toBe(ISSUE_SEVERITY.WARNING);
      expect(result.issues[0].canAutoFix).toBe(false);
    });

    it('should not flag when all backlog refs have matching YAML files', async () => {
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([
          { id: 'WU-100', status: 'ready', title: 'A' },
          { id: 'WU-101', status: 'done', title: 'B' },
        ]),
        listStamps: vi.fn().mockResolvedValue(['WU-101']),
        listBacklogRefs: vi.fn().mockResolvedValue(['WU-100', 'WU-101']),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.healthy).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should skip orphan backlog detection when listBacklogRefs is not provided', async () => {
      // Backward compatibility: deps without listBacklogRefs should not break
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([{ id: 'WU-100', status: 'ready', title: 'A' }]),
        // No listBacklogRefs provided
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.healthy).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should include orphan backlog refs in summary count', async () => {
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([{ id: 'WU-100', status: 'ready', title: 'A' }]),
        listBacklogRefs: vi.fn().mockResolvedValue(['WU-100', 'WU-888', 'WU-999']),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.summary.orphanBacklogRefs).toBe(2);
      expect(result.summary.totalIssues).toBe(2);
    });
  });

  describe('status mismatch detection (WU-1420)', () => {
    it('should detect when YAML status is ready but state store says in_progress', async () => {
      // WU YAML says 'ready' but events show it was claimed (in_progress) without release
      const deps = createMockDeps({
        listWUs: vi
          .fn()
          .mockResolvedValue([
            { id: 'WU-100', status: 'ready', lane: 'Framework: Core', title: 'Test WU' },
          ]),
        listEvents: vi
          .fn()
          .mockResolvedValue([
            { wuId: 'WU-100', type: 'claim', lane: 'Framework: Core', title: 'Test WU' },
          ]),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.healthy).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe(ISSUE_TYPES.STATUS_MISMATCH);
      expect(result.issues[0].wuId).toBe('WU-100');
      expect(result.issues[0].severity).toBe(ISSUE_SEVERITY.WARNING);
      expect(result.issues[0].canAutoFix).toBe(true);
      expect(result.issues[0].description).toContain('ready');
      expect(result.issues[0].description).toContain('in_progress');
    });

    it('should detect when YAML status is in_progress but state store says ready', async () => {
      // WU YAML says 'in_progress' but events show it was released
      const deps = createMockDeps({
        listWUs: vi
          .fn()
          .mockResolvedValue([
            { id: 'WU-100', status: 'in_progress', lane: 'Framework: Core', title: 'Test WU' },
          ]),
        listEvents: vi.fn().mockResolvedValue([
          { wuId: 'WU-100', type: 'claim', lane: 'Framework: Core', title: 'Test WU' },
          { wuId: 'WU-100', type: 'release', reason: 'Orphan cleanup' },
        ]),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.healthy).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe(ISSUE_TYPES.STATUS_MISMATCH);
      expect(result.issues[0].wuId).toBe('WU-100');
      expect(result.issues[0].description).toContain('in_progress');
      expect(result.issues[0].description).toContain('ready');
      expect(result.issues[0].canAutoFix).toBe(false);
    });

    it('should detect when YAML status is in_progress but state store says done', async () => {
      // WU YAML says 'in_progress' but events show complete
      const deps = createMockDeps({
        listWUs: vi
          .fn()
          .mockResolvedValue([
            { id: 'WU-100', status: 'in_progress', lane: 'Framework: Core', title: 'Test WU' },
          ]),
        listStamps: vi.fn().mockResolvedValue(['WU-100']),
        listEvents: vi.fn().mockResolvedValue([
          { wuId: 'WU-100', type: 'claim', lane: 'Framework: Core', title: 'Test WU' },
          { wuId: 'WU-100', type: 'complete' },
        ]),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.healthy).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe(ISSUE_TYPES.STATUS_MISMATCH);
      expect(result.issues[0].wuId).toBe('WU-100');
      expect(result.issues[0].description).toContain('in_progress');
      expect(result.issues[0].description).toContain('done');
      expect(result.issues[0].canAutoFix).toBe(false);
    });

    it('should skip mismatch detection for superseded YAML status', async () => {
      // Event store has no superseded transition, so this comparison is non-representable.
      const deps = createMockDeps({
        listWUs: vi
          .fn()
          .mockResolvedValue([
            { id: 'WU-100', status: 'superseded', lane: 'Framework: Core', title: 'Legacy WU' },
          ]),
        listEvents: vi.fn().mockResolvedValue([
          { wuId: 'WU-100', type: 'claim', lane: 'Framework: Core', title: 'Legacy WU' },
          { wuId: 'WU-100', type: 'release', reason: 'superseded by WU-2000' },
        ]),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.healthy).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should not flag when YAML status matches state store derived status', async () => {
      // Consistent: WU claimed, YAML says in_progress, events say in_progress
      const deps = createMockDeps({
        listWUs: vi
          .fn()
          .mockResolvedValue([
            { id: 'WU-100', status: 'in_progress', lane: 'Framework: Core', title: 'Test WU' },
          ]),
        listEvents: vi
          .fn()
          .mockResolvedValue([
            { wuId: 'WU-100', type: 'claim', lane: 'Framework: Core', title: 'Test WU' },
          ]),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.healthy).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should not flag WUs with no events (not in state store)', async () => {
      // WU exists in YAML but has no events - this is fine for ready WUs
      const deps = createMockDeps({
        listWUs: vi
          .fn()
          .mockResolvedValue([
            { id: 'WU-100', status: 'ready', lane: 'Framework: Core', title: 'Test WU' },
          ]),
        listEvents: vi.fn().mockResolvedValue([]),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.healthy).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should include status mismatch count in summary', async () => {
      const deps = createMockDeps({
        listWUs: vi.fn().mockResolvedValue([
          { id: 'WU-100', status: 'ready', lane: 'Framework: Core', title: 'Test WU 1' },
          { id: 'WU-101', status: 'ready', lane: 'Framework: Core', title: 'Test WU 2' },
        ]),
        listEvents: vi.fn().mockResolvedValue([
          { wuId: 'WU-100', type: 'claim', lane: 'Framework: Core', title: 'Test WU 1' },
          { wuId: 'WU-101', type: 'claim', lane: 'Framework: Core', title: 'Test WU 2' },
        ]),
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps);

      expect(result.summary.statusMismatches).toBe(2);
      expect(result.summary.totalIssues).toBe(2);
    });
  });

  describe('status mismatch --fix behavior (WU-1420)', () => {
    it('should emit release event when YAML=ready but state=in_progress', async () => {
      const emitEvent = vi.fn().mockResolvedValue(undefined);
      const deps = createMockDeps({
        listWUs: vi
          .fn()
          .mockResolvedValue([
            { id: 'WU-100', status: 'ready', lane: 'Framework: Core', title: 'Test WU' },
          ]),
        listEvents: vi
          .fn()
          .mockResolvedValue([
            { wuId: 'WU-100', type: 'claim', lane: 'Framework: Core', title: 'Test WU' },
          ]),
        emitEvent,
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps, { fix: true });

      expect(emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          wuId: 'WU-100',
          type: 'release',
          reason: expect.stringContaining('state:doctor'),
        }),
      );
      expect(result.fixed).toHaveLength(1);
      expect(result.fixed[0].type).toBe(ISSUE_TYPES.STATUS_MISMATCH);
    });

    it('should emit complete event when YAML=done but state=in_progress', async () => {
      const emitEvent = vi.fn().mockResolvedValue(undefined);
      const deps = createMockDeps({
        listWUs: vi
          .fn()
          .mockResolvedValue([
            { id: 'WU-100', status: 'done', lane: 'Framework: Core', title: 'Test WU' },
          ]),
        listStamps: vi.fn().mockResolvedValue(['WU-100']),
        listEvents: vi
          .fn()
          .mockResolvedValue([
            { wuId: 'WU-100', type: 'claim', lane: 'Framework: Core', title: 'Test WU' },
          ]),
        emitEvent,
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps, { fix: true });

      expect(emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          wuId: 'WU-100',
          type: 'complete',
        }),
      );
      expect(result.fixed).toHaveLength(1);
      expect(result.fixed[0].type).toBe(ISSUE_TYPES.STATUS_MISMATCH);
    });

    it('should not fix status mismatch in dry-run mode', async () => {
      const emitEvent = vi.fn();
      const deps = createMockDeps({
        listWUs: vi
          .fn()
          .mockResolvedValue([
            { id: 'WU-100', status: 'ready', lane: 'Framework: Core', title: 'Test WU' },
          ]),
        listEvents: vi
          .fn()
          .mockResolvedValue([
            { wuId: 'WU-100', type: 'claim', lane: 'Framework: Core', title: 'Test WU' },
          ]),
        emitEvent,
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps, { fix: true, dryRun: true });

      expect(emitEvent).not.toHaveBeenCalled();
      expect(result.wouldFix).toHaveLength(1);
      expect(result.wouldFix?.[0].type).toBe(ISSUE_TYPES.STATUS_MISMATCH);
    });

    it('should handle fix errors gracefully for status mismatch', async () => {
      const emitEvent = vi.fn().mockRejectedValue(new Error('Write failed'));
      const deps = createMockDeps({
        listWUs: vi
          .fn()
          .mockResolvedValue([
            { id: 'WU-100', status: 'ready', lane: 'Framework: Core', title: 'Test WU' },
          ]),
        listEvents: vi
          .fn()
          .mockResolvedValue([
            { wuId: 'WU-100', type: 'claim', lane: 'Framework: Core', title: 'Test WU' },
          ]),
        emitEvent,
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps, { fix: true });

      expect(result.fixed).toHaveLength(0);
      expect(result.fixErrors).toHaveLength(1);
      expect(result.fixErrors[0].wuId).toBe('WU-100');
      expect(result.fixErrors[0].error).toContain('Write failed');
    });

    it('should not attempt auto-fix for unsupported status transitions', async () => {
      const emitEvent = vi.fn();
      const deps = createMockDeps({
        listWUs: vi
          .fn()
          .mockResolvedValue([
            { id: 'WU-100', status: 'in_progress', lane: 'Framework: Core', title: 'Test WU' },
          ]),
        listEvents: vi.fn().mockResolvedValue([
          { wuId: 'WU-100', type: 'claim', lane: 'Framework: Core', title: 'Test WU' },
          { wuId: 'WU-100', type: 'release', reason: 'manual recovery' },
        ]),
        emitEvent,
      });

      const result = await diagnoseState(TEST_PROJECT_DIR, deps, { fix: true });

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe(ISSUE_TYPES.STATUS_MISMATCH);
      expect(result.issues[0].canAutoFix).toBe(false);
      expect(emitEvent).not.toHaveBeenCalled();
      expect(result.fixed).toHaveLength(0);
      expect(result.fixErrors).toHaveLength(0);
    });
  });
});

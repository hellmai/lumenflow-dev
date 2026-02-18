import { describe, expect, it } from 'vitest';
import type { DashboardEvent } from '../src/lib/dashboard-types';
import type { TaskSummary } from '../src/lib/workspace-types';

/* ------------------------------------------------------------------
 * AC1: All tasks listed with status grouping
 * AC3: Lane WIP counts displayed
 *
 * These tests cover the pure data functions that derive workspace
 * overview data from EventStore replay events.
 * ------------------------------------------------------------------ */

const TASK_A_ID = 'task-alpha';
const TASK_B_ID = 'task-beta';
const TASK_C_ID = 'task-gamma';

const LANE_CORE = 'lane-core';
const LANE_CLI = 'lane-cli';

const FIXTURE_EVENTS: DashboardEvent[] = [
  // Task A: created -> claimed -> completed (done)
  {
    id: 'evt-a1',
    kind: 'task_created',
    timestamp: '2026-02-18T10:00:00.000Z',
    taskId: TASK_A_ID,
    data: { lane_id: LANE_CORE, title: 'Alpha Task' },
  },
  {
    id: 'evt-a2',
    kind: 'task_claimed',
    timestamp: '2026-02-18T10:01:00.000Z',
    taskId: TASK_A_ID,
    data: { by: 'agent-1', session_id: 'sess-1' },
  },
  {
    id: 'evt-a3',
    kind: 'task_completed',
    timestamp: '2026-02-18T10:05:00.000Z',
    taskId: TASK_A_ID,
    data: {},
  },
  // Task B: created -> claimed (active)
  {
    id: 'evt-b1',
    kind: 'task_created',
    timestamp: '2026-02-18T11:00:00.000Z',
    taskId: TASK_B_ID,
    data: { lane_id: LANE_CORE, title: 'Beta Task' },
  },
  {
    id: 'evt-b2',
    kind: 'task_claimed',
    timestamp: '2026-02-18T11:01:00.000Z',
    taskId: TASK_B_ID,
    data: { by: 'agent-2', session_id: 'sess-2' },
  },
  // Task C: created -> claimed -> blocked
  {
    id: 'evt-c1',
    kind: 'task_created',
    timestamp: '2026-02-18T12:00:00.000Z',
    taskId: TASK_C_ID,
    data: { lane_id: LANE_CLI, title: 'Gamma Task' },
  },
  {
    id: 'evt-c2',
    kind: 'task_claimed',
    timestamp: '2026-02-18T12:01:00.000Z',
    taskId: TASK_C_ID,
    data: { by: 'agent-3', session_id: 'sess-3' },
  },
  {
    id: 'evt-c3',
    kind: 'task_blocked',
    timestamp: '2026-02-18T12:02:00.000Z',
    taskId: TASK_C_ID,
    data: { reason: 'dependency' },
  },
];

describe('deriveAllTaskSummaries', () => {
  it('derives task summaries from replay events grouped by taskId', async () => {
    const { deriveAllTaskSummaries } = await import('../src/lib/workspace-data');

    const summaries = deriveAllTaskSummaries(FIXTURE_EVENTS);

    expect(summaries).toHaveLength(3);

    const alpha = summaries.find((s) => s.taskId === TASK_A_ID);
    expect(alpha).toBeDefined();
    expect(alpha!.status).toBe('done');
    expect(alpha!.laneId).toBe(LANE_CORE);
    expect(alpha!.title).toBe('Alpha Task');

    const beta = summaries.find((s) => s.taskId === TASK_B_ID);
    expect(beta).toBeDefined();
    expect(beta!.status).toBe('active');

    const gamma = summaries.find((s) => s.taskId === TASK_C_ID);
    expect(gamma).toBeDefined();
    expect(gamma!.status).toBe('blocked');
  });

  it('returns empty array for empty events', async () => {
    const { deriveAllTaskSummaries } = await import('../src/lib/workspace-data');

    const summaries = deriveAllTaskSummaries([]);
    expect(summaries).toHaveLength(0);
  });

  it('extracts last event timestamp for each task', async () => {
    const { deriveAllTaskSummaries } = await import('../src/lib/workspace-data');

    const summaries = deriveAllTaskSummaries(FIXTURE_EVENTS);

    const alpha = summaries.find((s) => s.taskId === TASK_A_ID);
    expect(alpha!.lastEventTimestamp).toBe('2026-02-18T10:05:00.000Z');

    const gamma = summaries.find((s) => s.taskId === TASK_C_ID);
    expect(gamma!.lastEventTimestamp).toBe('2026-02-18T12:02:00.000Z');
  });

  it('uses fallback lane and title when task_created event has no lane_id or title', async () => {
    const { deriveAllTaskSummaries } = await import('../src/lib/workspace-data');

    const events: DashboardEvent[] = [
      {
        id: 'evt-1',
        kind: 'task_created',
        timestamp: '2026-02-18T10:00:00.000Z',
        taskId: 'task-no-meta',
        data: {},
      },
    ];

    const summaries = deriveAllTaskSummaries(events);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].laneId).toBe('unknown');
    expect(summaries[0].title).toBe('task-no-meta');
  });
});

describe('groupTasksByStatus', () => {
  it('groups tasks into status groups with correct labels', async () => {
    const { deriveAllTaskSummaries, groupTasksByStatus } =
      await import('../src/lib/workspace-data');

    const summaries = deriveAllTaskSummaries(FIXTURE_EVENTS);
    const groups = groupTasksByStatus(summaries);

    // Should have groups for active, blocked, and done (with tasks)
    const activeGroup = groups.find((g) => g.status === 'active');
    expect(activeGroup).toBeDefined();
    expect(activeGroup!.label).toBe('Active');
    expect(activeGroup!.tasks).toHaveLength(1);

    const blockedGroup = groups.find((g) => g.status === 'blocked');
    expect(blockedGroup).toBeDefined();
    expect(blockedGroup!.label).toBe('Blocked');
    expect(blockedGroup!.tasks).toHaveLength(1);

    const doneGroup = groups.find((g) => g.status === 'done');
    expect(doneGroup).toBeDefined();
    expect(doneGroup!.label).toBe('Done');
    expect(doneGroup!.tasks).toHaveLength(1);
  });

  it('includes all status groups even when empty', async () => {
    const { groupTasksByStatus } = await import('../src/lib/workspace-data');

    const groups = groupTasksByStatus([]);

    // All 5 status groups should exist
    expect(groups).toHaveLength(5);
    expect(groups.every((g) => g.tasks.length === 0)).toBe(true);
  });
});

describe('computeLaneWipCounts', () => {
  it('computes WIP counts per lane for active, blocked, and waiting tasks', async () => {
    const { deriveAllTaskSummaries, computeLaneWipCounts } =
      await import('../src/lib/workspace-data');

    const summaries = deriveAllTaskSummaries(FIXTURE_EVENTS);
    const wip = computeLaneWipCounts(summaries);

    const coreEntry = wip.find((w) => w.laneId === LANE_CORE);
    expect(coreEntry).toBeDefined();
    expect(coreEntry!.activeCount).toBe(1);
    expect(coreEntry!.blockedCount).toBe(0);
    expect(coreEntry!.totalInProgress).toBe(1);

    const cliEntry = wip.find((w) => w.laneId === LANE_CLI);
    expect(cliEntry).toBeDefined();
    expect(cliEntry!.blockedCount).toBe(1);
    expect(cliEntry!.totalInProgress).toBe(1);
  });

  it('excludes done and ready tasks from WIP counts', async () => {
    const { computeLaneWipCounts } = await import('../src/lib/workspace-data');

    const summaries: TaskSummary[] = [
      {
        taskId: 'ready-task',
        status: 'ready',
        laneId: 'lane-x',
        title: 'Ready',
        lastEventTimestamp: '2026-02-18T10:00:00.000Z',
      },
      {
        taskId: 'done-task',
        status: 'done',
        laneId: 'lane-x',
        title: 'Done',
        lastEventTimestamp: '2026-02-18T10:00:00.000Z',
      },
    ];

    const wip = computeLaneWipCounts(summaries);
    expect(wip).toHaveLength(0);
  });

  it('returns empty array for no tasks', async () => {
    const { computeLaneWipCounts } = await import('../src/lib/workspace-data');

    const wip = computeLaneWipCounts([]);
    expect(wip).toHaveLength(0);
  });
});

describe('buildWorkspaceOverview', () => {
  it('assembles complete workspace overview data', async () => {
    const { buildWorkspaceOverview } = await import('../src/lib/workspace-data');

    const overview = buildWorkspaceOverview(FIXTURE_EVENTS);

    expect(overview.totalCount).toBe(3);
    expect(overview.tasks).toHaveLength(3);
    expect(overview.statusGroups).toHaveLength(5);
    expect(overview.laneWipEntries.length).toBeGreaterThan(0);

    // Status counts
    expect(overview.statusCounts.active).toBe(1);
    expect(overview.statusCounts.blocked).toBe(1);
    expect(overview.statusCounts.done).toBe(1);
    expect(overview.statusCounts.ready).toBe(0);
    expect(overview.statusCounts.waiting).toBe(0);
  });
});

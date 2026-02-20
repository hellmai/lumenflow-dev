// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TaskSummary, StatusGroup, LaneWipEntry } from '../src/lib/workspace-types';

/* ------------------------------------------------------------------
 * AC1: All tasks listed with status grouping
 * AC2: Click navigates to task detail
 * AC3: Lane WIP counts displayed
 * ------------------------------------------------------------------ */

const FIXTURE_TASKS: TaskSummary[] = [
  {
    taskId: 'task-alpha',
    status: 'active',
    laneId: 'lane-core',
    title: 'Alpha Task',
    lastEventTimestamp: '2026-02-18T10:01:00.000Z',
  },
  {
    taskId: 'task-beta',
    status: 'done',
    laneId: 'lane-core',
    title: 'Beta Task',
    lastEventTimestamp: '2026-02-18T10:05:00.000Z',
  },
  {
    taskId: 'task-gamma',
    status: 'blocked',
    laneId: 'lane-cli',
    title: 'Gamma Task',
    lastEventTimestamp: '2026-02-18T12:02:00.000Z',
  },
];

const FIXTURE_STATUS_GROUPS: StatusGroup[] = [
  { status: 'ready', label: 'Ready', tasks: [] },
  {
    status: 'active',
    label: 'Active',
    tasks: [FIXTURE_TASKS[0]],
  },
  {
    status: 'blocked',
    label: 'Blocked',
    tasks: [FIXTURE_TASKS[2]],
  },
  { status: 'waiting', label: 'Waiting', tasks: [] },
  {
    status: 'done',
    label: 'Done',
    tasks: [FIXTURE_TASKS[1]],
  },
];

const FIXTURE_LANE_WIP: LaneWipEntry[] = [
  { laneId: 'lane-core', activeCount: 1, blockedCount: 0, waitingCount: 0, totalInProgress: 1 },
  { laneId: 'lane-cli', activeCount: 0, blockedCount: 1, waitingCount: 0, totalInProgress: 1 },
];

describe('WorkspaceOverview component', () => {
  it('AC1: renders all tasks grouped by status', async () => {
    const { WorkspaceOverview } = await import('../src/components/workspace-overview');

    render(
      <WorkspaceOverview
        statusGroups={FIXTURE_STATUS_GROUPS}
        laneWipEntries={FIXTURE_LANE_WIP}
        totalCount={3}
        statusCounts={{ ready: 0, active: 1, blocked: 1, waiting: 0, done: 1 }}
      />,
    );

    // Header should exist
    expect(screen.getByTestId('workspace-header')).toBeDefined();

    // Status summary should show counts
    const summary = screen.getByTestId('status-summary');
    expect(within(summary).getByText(/3/)).toBeDefined();

    // Task items should be rendered with data-testid links
    expect(screen.getByTestId('task-link-task-alpha')).toBeDefined();
    expect(screen.getByTestId('task-link-task-beta')).toBeDefined();
    expect(screen.getByTestId('task-link-task-gamma')).toBeDefined();

    // Task titles should be rendered
    expect(screen.getByText('Alpha Task')).toBeDefined();
    expect(screen.getByText('Beta Task')).toBeDefined();
    expect(screen.getByText('Gamma Task')).toBeDefined();
  });

  it('AC2: task items link to task detail page', async () => {
    const { WorkspaceOverview } = await import('../src/components/workspace-overview');

    render(
      <WorkspaceOverview
        statusGroups={FIXTURE_STATUS_GROUPS}
        laneWipEntries={FIXTURE_LANE_WIP}
        totalCount={3}
        statusCounts={{ ready: 0, active: 1, blocked: 1, waiting: 0, done: 1 }}
      />,
    );

    // Each task should have a link to /dashboard/<taskId>
    const alphaLink = screen.getByTestId('task-link-task-alpha');
    expect(alphaLink.getAttribute('href')).toBe('/dashboard/task-alpha');

    const betaLink = screen.getByTestId('task-link-task-beta');
    expect(betaLink.getAttribute('href')).toBe('/dashboard/task-beta');

    const gammaLink = screen.getByTestId('task-link-task-gamma');
    expect(gammaLink.getAttribute('href')).toBe('/dashboard/task-gamma');
  });

  it('AC3: lane WIP counts are displayed', async () => {
    const { WorkspaceOverview } = await import('../src/components/workspace-overview');

    render(
      <WorkspaceOverview
        statusGroups={FIXTURE_STATUS_GROUPS}
        laneWipEntries={FIXTURE_LANE_WIP}
        totalCount={3}
        statusCounts={{ ready: 0, active: 1, blocked: 1, waiting: 0, done: 1 }}
      />,
    );

    // Lane WIP section should exist
    const wipSection = screen.getByTestId('lane-wip-section');
    expect(wipSection).toBeDefined();

    // Lane names should appear within the WIP table
    expect(within(wipSection).getByText('lane-core')).toBeDefined();
    expect(within(wipSection).getByText('lane-cli')).toBeDefined();
  });

  it('renders status summary badges', async () => {
    const { WorkspaceOverview } = await import('../src/components/workspace-overview');

    render(
      <WorkspaceOverview
        statusGroups={FIXTURE_STATUS_GROUPS}
        laneWipEntries={FIXTURE_LANE_WIP}
        totalCount={3}
        statusCounts={{ ready: 0, active: 1, blocked: 1, waiting: 0, done: 1 }}
      />,
    );

    // Status summary section should exist
    const summary = screen.getByTestId('status-summary');
    expect(summary).toBeDefined();
  });

  it('renders empty state when no tasks exist', async () => {
    const { WorkspaceOverview } = await import('../src/components/workspace-overview');

    const emptyGroups: StatusGroup[] = [
      { status: 'ready', label: 'Ready', tasks: [] },
      { status: 'active', label: 'Active', tasks: [] },
      { status: 'blocked', label: 'Blocked', tasks: [] },
      { status: 'waiting', label: 'Waiting', tasks: [] },
      { status: 'done', label: 'Done', tasks: [] },
    ];

    render(
      <WorkspaceOverview
        statusGroups={emptyGroups}
        laneWipEntries={[]}
        totalCount={0}
        statusCounts={{ ready: 0, active: 0, blocked: 0, waiting: 0, done: 0 }}
      />,
    );

    expect(screen.getByTestId('workspace-empty')).toBeDefined();
  });

  it('renders guided onboarding cards when workspace is not connected', async () => {
    const { WorkspaceOverview } = await import('../src/components/workspace-overview');

    const emptyGroups: StatusGroup[] = [
      { status: 'ready', label: 'Ready', tasks: [] },
      { status: 'active', label: 'Active', tasks: [] },
      { status: 'blocked', label: 'Blocked', tasks: [] },
      { status: 'waiting', label: 'Waiting', tasks: [] },
      { status: 'done', label: 'Done', tasks: [] },
    ];

    render(
      <WorkspaceOverview
        statusGroups={emptyGroups}
        laneWipEntries={[]}
        totalCount={0}
        statusCounts={{ ready: 0, active: 0, blocked: 0, waiting: 0, done: 0 }}
        workspaceConnected={false}
      />,
    );

    expect(screen.getByTestId('onboarding-card-workspace')).toBeDefined();
    expect(screen.getByTestId('onboarding-card-pack-install')).toBeDefined();
    expect(screen.getByTestId('onboarding-card-first-task')).toBeDefined();
  });

  it('submits create-task form from header and calls onCreateTask', async () => {
    const { WorkspaceOverview } = await import('../src/components/workspace-overview');

    const onCreateTask = async () => undefined;
    const createTaskSpy = vi.fn(onCreateTask);

    render(
      <WorkspaceOverview
        statusGroups={FIXTURE_STATUS_GROUPS}
        laneWipEntries={FIXTURE_LANE_WIP}
        totalCount={3}
        statusCounts={{ ready: 0, active: 1, blocked: 1, waiting: 0, done: 1 }}
        workspaceConnected={true}
        onCreateTask={createTaskSpy}
      />,
    );

    fireEvent.click(screen.getByTestId('create-task-button'));
    fireEvent.change(screen.getByTestId('create-task-title-input'), {
      target: { value: 'Ship dashboard onboarding flow' },
    });
    fireEvent.change(screen.getByTestId('create-task-description-input'), {
      target: { value: 'Wire active management actions in workspace dashboard' },
    });
    fireEvent.change(screen.getByTestId('create-task-lane-input'), {
      target: { value: 'operations-runtime' },
    });
    fireEvent.change(screen.getByTestId('create-task-priority-select'), {
      target: { value: 'P1' },
    });
    fireEvent.change(screen.getByTestId('create-task-risk-select'), {
      target: { value: 'medium' },
    });
    fireEvent.click(screen.getByTestId('submit-create-task-button'));

    await waitFor(() => {
      expect(createTaskSpy).toHaveBeenCalledTimes(1);
    });
  });
});

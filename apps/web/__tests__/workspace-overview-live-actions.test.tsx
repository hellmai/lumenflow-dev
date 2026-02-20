// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const TASK_ID = 'task-created-1';
const TASK_TITLE = 'Ship onboarding';

const CONNECT_RESPONSE = {
  success: true,
  workspace: {
    workspaceName: 'Demo Workspace',
    workspaceId: 'ws-demo',
    packCount: 1,
    laneCount: 1,
    workspaceRoot: 'workspaces/demo',
  },
};

const INITIAL_EVENTS_RESPONSE = {
  events: [],
  nextCursor: null,
};

const REFRESHED_EVENTS_RESPONSE = {
  events: [
    {
      id: 'evt-task-created',
      kind: 'task_created',
      timestamp: '2026-02-20T20:00:00.000Z',
      task_id: TASK_ID,
      title: TASK_TITLE,
      lane_id: 'operations-runtime',
    },
  ],
  nextCursor: null,
};

describe('WorkspaceOverviewLive management actions', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a task and refreshes overview state', async () => {
    let eventsCallCount = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes('/api/events/all')) {
        eventsCallCount += 1;
        return new Response(
          JSON.stringify(eventsCallCount === 1 ? INITIAL_EVENTS_RESPONSE : REFRESHED_EVENTS_RESPONSE),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/workspace/connect')) {
        return new Response(JSON.stringify(CONNECT_RESPONSE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/tasks') && init?.method === 'POST') {
        return new Response(JSON.stringify({ task: { id: TASK_ID } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'unexpected request' }), { status: 500 });
    });

    vi.stubGlobal('fetch', fetchMock);

    const { WorkspaceOverviewLive } = await import('../src/components/workspace-overview-live');
    render(<WorkspaceOverviewLive />);

    fireEvent.change(screen.getByTestId('workspace-path-input'), {
      target: { value: 'workspaces/demo' },
    });
    fireEvent.click(screen.getByTestId('workspace-connect-button'));

    await waitFor(() => {
      expect(screen.getByTestId('create-task-button')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('create-task-button'));
    fireEvent.change(screen.getByTestId('create-task-title-input'), {
      target: { value: TASK_TITLE },
    });
    fireEvent.change(screen.getByTestId('create-task-description-input'), {
      target: { value: 'Deliver management UI actions' },
    });
    fireEvent.change(screen.getByTestId('create-task-lane-input'), {
      target: { value: 'operations-runtime' },
    });
    fireEvent.click(screen.getByTestId('submit-create-task-button'));

    await waitFor(() => {
      expect(screen.getByTestId(`task-link-${TASK_ID}`)).toBeDefined();
    });

    expect(eventsCallCount).toBeGreaterThanOrEqual(2);
  });
});

/**
 * Pure functions for deriving workspace overview data from EventStore events.
 *
 * These functions transform raw DashboardEvent arrays (from EventStore replay)
 * into structured workspace overview data suitable for rendering.
 */

import {
  EVENT_KIND_TO_STATE,
  TASK_STATES,
  type DashboardEvent,
  type TaskStatus,
} from './dashboard-types';
import {
  STATUS_GROUP_LABELS,
  type LaneWipEntry,
  type StatusGroup,
  type TaskSummary,
  type WorkspaceOverviewData,
} from './workspace-types';

const TASK_CREATED_KIND = 'task_created';
const UNKNOWN_LANE = 'unknown';

function getStatusGroupLabel(status: TaskStatus): string {
  return STATUS_GROUP_LABELS.get(status) ?? status;
}

const STATUS_ORDER: readonly TaskStatus[] = [
  TASK_STATES.READY,
  TASK_STATES.ACTIVE,
  TASK_STATES.BLOCKED,
  TASK_STATES.WAITING,
  TASK_STATES.DONE,
];

const WIP_STATUSES = new Set<TaskStatus>([
  TASK_STATES.ACTIVE,
  TASK_STATES.BLOCKED,
  TASK_STATES.WAITING,
]);

interface TaskAccumulator {
  events: DashboardEvent[];
  laneId: string;
  title: string;
}

function extractLaneId(event: DashboardEvent): string {
  const laneId = event.data.lane_id;
  return typeof laneId === 'string' && laneId.length > 0 ? laneId : UNKNOWN_LANE;
}

function extractTitle(event: DashboardEvent): string {
  const title = event.data.title;
  return typeof title === 'string' && title.length > 0 ? title : event.taskId;
}

function deriveStatusFromEvents(events: readonly DashboardEvent[]): TaskStatus {
  let currentState: TaskStatus = TASK_STATES.READY;

  for (const event of events) {
    const nextState = EVENT_KIND_TO_STATE.get(event.kind);
    if (nextState !== undefined) {
      currentState = nextState;
    }
  }

  return currentState;
}

function getLastTimestamp(events: readonly DashboardEvent[]): string {
  const lastEvent = events.at(-1);
  return lastEvent?.timestamp ?? '';
}

/**
 * Derives task summaries from a flat list of EventStore replay events.
 * Groups events by taskId, then derives status, lane, and title for each task.
 */
export function deriveAllTaskSummaries(events: readonly DashboardEvent[]): TaskSummary[] {
  const accumulators = new Map<string, TaskAccumulator>();

  for (const event of events) {
    const existing = accumulators.get(event.taskId);

    if (existing) {
      existing.events.push(event);
      // Update lane/title from task_created if not already set
      if (event.kind === TASK_CREATED_KIND) {
        existing.laneId = extractLaneId(event);
        existing.title = extractTitle(event);
      }
    } else {
      const isCreated = event.kind === TASK_CREATED_KIND;
      accumulators.set(event.taskId, {
        events: [event],
        laneId: isCreated ? extractLaneId(event) : UNKNOWN_LANE,
        title: isCreated ? extractTitle(event) : event.taskId,
      });
    }
  }

  const summaries: TaskSummary[] = [];

  for (const [taskId, accumulator] of accumulators) {
    summaries.push({
      taskId,
      status: deriveStatusFromEvents(accumulator.events),
      laneId: accumulator.laneId,
      title: accumulator.title,
      lastEventTimestamp: getLastTimestamp(accumulator.events),
    });
  }

  return summaries;
}

/**
 * Groups task summaries by status, producing an ordered list of StatusGroups.
 * All five status groups are always returned (even if empty).
 */
export function groupTasksByStatus(tasks: readonly TaskSummary[]): StatusGroup[] {
  const buckets = new Map<TaskStatus, TaskSummary[]>();

  for (const status of STATUS_ORDER) {
    buckets.set(status, []);
  }

  for (const task of tasks) {
    const bucket = buckets.get(task.status);
    if (bucket) {
      bucket.push(task);
    }
  }

  return STATUS_ORDER.map((status) => ({
    status,
    label: getStatusGroupLabel(status),
    tasks: buckets.get(status) ?? [],
  }));
}

/**
 * Computes lane WIP (work-in-progress) counts.
 * Only counts tasks that are active, blocked, or waiting.
 * Lanes with no WIP tasks are excluded.
 */
export function computeLaneWipCounts(tasks: readonly TaskSummary[]): LaneWipEntry[] {
  const laneCounts = new Map<
    string,
    { activeCount: number; blockedCount: number; waitingCount: number }
  >();

  for (const task of tasks) {
    if (!WIP_STATUSES.has(task.status)) {
      continue;
    }

    const existing = laneCounts.get(task.laneId) ?? {
      activeCount: 0,
      blockedCount: 0,
      waitingCount: 0,
    };

    if (task.status === TASK_STATES.ACTIVE) {
      existing.activeCount += 1;
    } else if (task.status === TASK_STATES.BLOCKED) {
      existing.blockedCount += 1;
    } else if (task.status === TASK_STATES.WAITING) {
      existing.waitingCount += 1;
    }

    laneCounts.set(task.laneId, existing);
  }

  const entries: LaneWipEntry[] = [];

  for (const [laneId, counts] of laneCounts) {
    entries.push({
      laneId,
      activeCount: counts.activeCount,
      blockedCount: counts.blockedCount,
      waitingCount: counts.waitingCount,
      totalInProgress: counts.activeCount + counts.blockedCount + counts.waitingCount,
    });
  }

  return entries;
}

/**
 * Builds the complete workspace overview data from raw EventStore events.
 */
export function buildWorkspaceOverview(events: readonly DashboardEvent[]): WorkspaceOverviewData {
  const tasks = deriveAllTaskSummaries(events);
  const statusGroups = groupTasksByStatus(tasks);
  const laneWipEntries = computeLaneWipCounts(tasks);

  const countMap = new Map<TaskStatus, number>(STATUS_ORDER.map((status) => [status, 0]));

  for (const task of tasks) {
    countMap.set(task.status, (countMap.get(task.status) ?? 0) + 1);
  }

  const statusCounts: Record<TaskStatus, number> = {
    ready: countMap.get(TASK_STATES.READY) ?? 0,
    active: countMap.get(TASK_STATES.ACTIVE) ?? 0,
    blocked: countMap.get(TASK_STATES.BLOCKED) ?? 0,
    waiting: countMap.get(TASK_STATES.WAITING) ?? 0,
    done: countMap.get(TASK_STATES.DONE) ?? 0,
  };

  return {
    tasks,
    statusGroups,
    laneWipEntries,
    totalCount: tasks.length,
    statusCounts,
  };
}

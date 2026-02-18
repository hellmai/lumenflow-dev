/**
 * Types for the workspace overview page.
 *
 * These types represent task summaries derived from EventStore replay,
 * grouped by status for the workspace overview visualization.
 */

import type { TaskStatus } from './dashboard-types';

/** A summary of a single task derived from event replay. */
export interface TaskSummary {
  readonly taskId: string;
  readonly status: TaskStatus;
  readonly laneId: string;
  readonly title: string;
  readonly lastEventTimestamp: string;
}

/** Status group label mapping. */
export const STATUS_GROUP_LABELS = new Map<TaskStatus, string>([
  ['ready', 'Ready'],
  ['active', 'Active'],
  ['blocked', 'Blocked'],
  ['waiting', 'Waiting'],
  ['done', 'Done'],
]);

/** A group of tasks sharing the same status. */
export interface StatusGroup {
  readonly status: TaskStatus;
  readonly label: string;
  readonly tasks: readonly TaskSummary[];
}

/** Lane WIP (work-in-progress) counts. */
export interface LaneWipEntry {
  readonly laneId: string;
  readonly activeCount: number;
  readonly blockedCount: number;
  readonly waitingCount: number;
  readonly totalInProgress: number;
}

/** Top-level workspace overview data. */
export interface WorkspaceOverviewData {
  readonly tasks: readonly TaskSummary[];
  readonly statusGroups: readonly StatusGroup[];
  readonly laneWipEntries: readonly LaneWipEntry[];
  readonly totalCount: number;
  readonly statusCounts: Readonly<Record<TaskStatus, number>>;
}

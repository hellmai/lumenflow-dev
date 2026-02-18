'use client';

import type { TaskStatus } from '../lib/dashboard-types';
import type { LaneWipEntry, StatusGroup, TaskSummary } from '../lib/workspace-types';

const DASHBOARD_PATH_PREFIX = '/dashboard/';
const PAGE_TITLE = 'Workspace Overview';
const LANE_WIP_HEADING = 'Lane WIP';
const EMPTY_STATE_MESSAGE = 'No tasks found. Create a task to get started.';
const TOTAL_TASKS_LABEL = 'tasks';

const STATUS_BADGE_COLORS = new Map<TaskStatus, string>([
  ['ready', 'bg-slate-100 text-slate-600'],
  ['active', 'bg-blue-100 text-blue-700'],
  ['blocked', 'bg-red-100 text-red-700'],
  ['waiting', 'bg-amber-100 text-amber-700'],
  ['done', 'bg-green-100 text-green-700'],
]);

const STATUS_GROUP_HEADER_COLORS = new Map<TaskStatus, string>([
  ['ready', 'border-l-slate-400'],
  ['active', 'border-l-blue-500'],
  ['blocked', 'border-l-red-500'],
  ['waiting', 'border-l-amber-500'],
  ['done', 'border-l-green-500'],
]);

const DEFAULT_BADGE_COLOR = 'bg-slate-100 text-slate-600';
const DEFAULT_HEADER_COLOR = 'border-l-slate-400';

const SECTION_TITLE_CLASS = 'text-sm font-semibold uppercase tracking-wide text-slate-500';

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString();
  } catch {
    return iso;
  }
}

interface TaskItemProps {
  readonly task: TaskSummary;
}

function TaskItem({ task }: TaskItemProps) {
  return (
    <a
      data-testid={`task-link-${task.taskId}`}
      href={`${DASHBOARD_PATH_PREFIX}${task.taskId}`}
      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 transition-colors hover:border-slate-300 hover:bg-slate-50"
    >
      <div className="flex items-center gap-3">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_COLORS.get(task.status) ?? DEFAULT_BADGE_COLOR}`}
        >
          {task.status}
        </span>
        <div>
          <span className="text-sm font-medium text-slate-800">{task.title}</span>
          <span className="ml-2 font-mono text-xs text-slate-400">{task.taskId}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-slate-400">
        <span>{task.laneId}</span>
        <span className="font-mono">{formatTimestamp(task.lastEventTimestamp)}</span>
      </div>
    </a>
  );
}

interface StatusGroupSectionProps {
  readonly group: StatusGroup;
}

function StatusGroupSection({ group }: StatusGroupSectionProps) {
  if (group.tasks.length === 0) {
    return null;
  }

  return (
    <section
      className={`border-l-4 pl-4 ${STATUS_GROUP_HEADER_COLORS.get(group.status) ?? DEFAULT_HEADER_COLOR}`}
    >
      <h3 className="mb-2 text-sm font-semibold text-slate-700">
        {group.label}
        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-400">
          {group.tasks.length}
        </span>
      </h3>
      <div className="space-y-2">
        {group.tasks.map((task) => (
          <TaskItem key={task.taskId} task={task} />
        ))}
      </div>
    </section>
  );
}

interface LaneWipTableProps {
  readonly entries: readonly LaneWipEntry[];
}

function LaneWipTable({ entries }: LaneWipTableProps) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div data-testid="lane-wip-section" className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className={SECTION_TITLE_CLASS}>{LANE_WIP_HEADING}</h2>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
            <th className="px-4 py-2 font-medium">Lane</th>
            <th className="px-4 py-2 font-medium">Active</th>
            <th className="px-4 py-2 font-medium">Blocked</th>
            <th className="px-4 py-2 font-medium">Waiting</th>
            <th className="px-4 py-2 font-medium">Total WIP</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.laneId}
              className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50"
            >
              <td className="px-4 py-2 font-medium text-slate-700">{entry.laneId}</td>
              <td className="px-4 py-2">
                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                  {entry.activeCount}
                </span>
              </td>
              <td className="px-4 py-2">
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                  {entry.blockedCount}
                </span>
              </td>
              <td className="px-4 py-2">
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                  {entry.waitingCount}
                </span>
              </td>
              <td className="px-4 py-2">
                <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-700">
                  {entry.totalInProgress}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface StatusSummaryProps {
  readonly statusCounts: Readonly<Record<TaskStatus, number>>;
  readonly totalCount: number;
}

function StatusSummary({ statusCounts, totalCount }: StatusSummaryProps) {
  return (
    <div data-testid="status-summary" className="flex flex-wrap gap-3">
      <div className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
        {totalCount} {TOTAL_TASKS_LABEL}
      </div>
      {(Object.entries(statusCounts) as [TaskStatus, number][])
        .filter(([, count]) => count > 0)
        .map(([status, count]) => (
          <div
            key={status}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${STATUS_BADGE_COLORS.get(status) ?? DEFAULT_BADGE_COLOR}`}
          >
            {count} {status}
          </div>
        ))}
    </div>
  );
}

export interface WorkspaceOverviewProps {
  readonly statusGroups: readonly StatusGroup[];
  readonly laneWipEntries: readonly LaneWipEntry[];
  readonly totalCount: number;
  readonly statusCounts: Readonly<Record<TaskStatus, number>>;
}

export function WorkspaceOverview({
  statusGroups,
  laneWipEntries,
  totalCount,
  statusCounts,
}: WorkspaceOverviewProps) {
  const hasAnyTasks = totalCount > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      {/* Header */}
      <div data-testid="workspace-header" className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{PAGE_TITLE}</h1>
      </div>

      {/* Status Summary */}
      <StatusSummary statusCounts={statusCounts} totalCount={totalCount} />

      {hasAnyTasks ? (
        <>
          {/* Lane WIP */}
          <LaneWipTable entries={laneWipEntries} />

          {/* Task Groups */}
          <div className="space-y-6">
            {statusGroups.map((group) => (
              <StatusGroupSection key={group.status} group={group} />
            ))}
          </div>
        </>
      ) : (
        <div
          data-testid="workspace-empty"
          className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400"
        >
          {EMPTY_STATE_MESSAGE}
        </div>
      )}
    </div>
  );
}

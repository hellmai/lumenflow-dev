'use client';

import { useState, type FormEvent } from 'react';
import type { TaskStatus } from '../lib/dashboard-types';
import type { LaneWipEntry, StatusGroup, TaskSummary } from '../lib/workspace-types';

const DASHBOARD_PATH_PREFIX = '/dashboard/';
const PAGE_TITLE = 'Workspace Overview';
const LANE_WIP_HEADING = 'Lane WIP';
const EMPTY_STATE_MESSAGE = 'No tasks found. Create a task to get started.';
const TOTAL_TASKS_LABEL = 'tasks';
const CREATE_TASK_BUTTON_LABEL = 'Create Task';
const CREATE_TASK_SUBMIT_LABEL = 'Create';
const CREATE_TASK_SUBMITTING_LABEL = 'Creating...';
const ONBOARDING_HEADING = 'Get started';
const ONBOARDING_WORKSPACE_TITLE = '1. Create Workspace';
const ONBOARDING_WORKSPACE_DESCRIPTION = 'Create or connect a workspace to initialize runtime data.';
const ONBOARDING_PACK_TITLE = '2. Install Domain Pack';
const ONBOARDING_PACK_DESCRIPTION = 'Install a pack from Marketplace to enable domain tools and policies.';
const ONBOARDING_TASK_TITLE = '3. Create First Task';
const ONBOARDING_TASK_DESCRIPTION = 'Create your first task to start agent execution and evidence capture.';
const MINIMUM_TITLE_LENGTH = 3;
const DEFAULT_PRIORITY = 'P1';
const DEFAULT_RISK = 'medium';

type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3';
type TaskRisk = 'low' | 'medium' | 'high' | 'critical';

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

export interface CreateTaskInput {
  readonly title: string;
  readonly description: string;
  readonly laneId: string;
  readonly priority: TaskPriority;
  readonly risk: TaskRisk;
}

function OnboardingCards() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <article
        data-testid="onboarding-card-workspace"
        className="rounded-lg border border-blue-200 bg-blue-50 p-4"
      >
        <h3 className="text-sm font-semibold text-blue-900">{ONBOARDING_WORKSPACE_TITLE}</h3>
        <p className="mt-1 text-xs text-blue-800">{ONBOARDING_WORKSPACE_DESCRIPTION}</p>
      </article>
      <article
        data-testid="onboarding-card-pack-install"
        className="rounded-lg border border-amber-200 bg-amber-50 p-4"
      >
        <h3 className="text-sm font-semibold text-amber-900">{ONBOARDING_PACK_TITLE}</h3>
        <p className="mt-1 text-xs text-amber-800">{ONBOARDING_PACK_DESCRIPTION}</p>
      </article>
      <article
        data-testid="onboarding-card-first-task"
        className="rounded-lg border border-emerald-200 bg-emerald-50 p-4"
      >
        <h3 className="text-sm font-semibold text-emerald-900">{ONBOARDING_TASK_TITLE}</h3>
        <p className="mt-1 text-xs text-emerald-800">{ONBOARDING_TASK_DESCRIPTION}</p>
      </article>
    </div>
  );
}

export interface WorkspaceOverviewProps {
  readonly statusGroups: readonly StatusGroup[];
  readonly laneWipEntries: readonly LaneWipEntry[];
  readonly totalCount: number;
  readonly statusCounts: Readonly<Record<TaskStatus, number>>;
  readonly workspaceConnected?: boolean;
  readonly onCreateTask?: (input: CreateTaskInput) => Promise<void>;
}

export function WorkspaceOverview({
  statusGroups,
  laneWipEntries,
  totalCount,
  statusCounts,
  workspaceConnected = true,
  onCreateTask,
}: WorkspaceOverviewProps) {
  const hasAnyTasks = totalCount > 0;
  const [isCreateTaskFormVisible, setIsCreateTaskFormVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [laneId, setLaneId] = useState('');
  const [priority, setPriority] = useState<TaskPriority>(DEFAULT_PRIORITY);
  const [risk, setRisk] = useState<TaskRisk>(DEFAULT_RISK);
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);
  const [createTaskError, setCreateTaskError] = useState<string | null>(null);

  async function submitCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onCreateTask) {
      return;
    }

    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const trimmedLane = laneId.trim();

    if (trimmedTitle.length < MINIMUM_TITLE_LENGTH) {
      setCreateTaskError(`Title must be at least ${MINIMUM_TITLE_LENGTH} characters`);
      return;
    }
    if (trimmedDescription.length === 0) {
      setCreateTaskError('Description is required');
      return;
    }
    if (trimmedLane.length === 0) {
      setCreateTaskError('Lane is required');
      return;
    }

    setCreateTaskError(null);
    setIsSubmittingTask(true);

    try {
      await onCreateTask({
        title: trimmedTitle,
        description: trimmedDescription,
        laneId: trimmedLane,
        priority,
        risk,
      });
      setIsCreateTaskFormVisible(false);
      setTitle('');
      setDescription('');
      setLaneId('');
      setPriority(DEFAULT_PRIORITY);
      setRisk(DEFAULT_RISK);
    } catch (error) {
      setCreateTaskError(error instanceof Error ? error.message : 'Failed to create task');
    } finally {
      setIsSubmittingTask(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      {/* Header */}
      <div data-testid="workspace-header" className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{PAGE_TITLE}</h1>
        {workspaceConnected && (
          <button
            data-testid="create-task-button"
            type="button"
            onClick={() => {
              setCreateTaskError(null);
              setIsCreateTaskFormVisible((current) => !current);
            }}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
          >
            {CREATE_TASK_BUTTON_LABEL}
          </button>
        )}
      </div>

      {workspaceConnected && isCreateTaskFormVisible && (
        <form
          className="rounded-lg border border-slate-200 bg-white p-4"
          onSubmit={(event) => {
            void submitCreateTask(event);
          }}
        >
          <div className="grid gap-3">
            <input
              data-testid="create-task-title-input"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Task title"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <textarea
              data-testid="create-task-description-input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Task description"
              className="min-h-24 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              data-testid="create-task-lane-input"
              type="text"
              value={laneId}
              onChange={(event) => setLaneId(event.target.value)}
              placeholder="Lane ID"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <div className="grid grid-cols-2 gap-3">
              <select
                data-testid="create-task-priority-select"
                value={priority}
                onChange={(event) => setPriority(event.target.value as TaskPriority)}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="P0">P0</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
              </select>
              <select
                data-testid="create-task-risk-select"
                value={risk}
                onChange={(event) => setRisk(event.target.value as TaskRisk)}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
            </div>
            {createTaskError && <p className="text-xs text-red-600">{createTaskError}</p>}
            <div className="flex justify-end">
              <button
                data-testid="submit-create-task-button"
                type="submit"
                disabled={isSubmittingTask}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
              >
                {isSubmittingTask ? CREATE_TASK_SUBMITTING_LABEL : CREATE_TASK_SUBMIT_LABEL}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Status Summary */}
      <StatusSummary statusCounts={statusCounts} totalCount={totalCount} />

      {!workspaceConnected ? (
        <section className="space-y-3 rounded-lg border border-dashed border-slate-300 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            {ONBOARDING_HEADING}
          </h2>
          <OnboardingCards />
        </section>
      ) : hasAnyTasks ? (
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

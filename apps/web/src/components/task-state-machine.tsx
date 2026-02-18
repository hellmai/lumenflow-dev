'use client';

import { TASK_STATE_ORDER, type TaskStatus } from '../lib/dashboard-types';

interface StateStyle {
  readonly bg: string;
  readonly ring: string;
  readonly text: string;
}

const STATE_LABELS = new Map<TaskStatus, string>([
  ['ready', 'Ready'],
  ['active', 'Active'],
  ['blocked', 'Blocked'],
  ['waiting', 'Waiting'],
  ['done', 'Done'],
]);

const STATE_COLORS = new Map<TaskStatus, StateStyle>([
  ['ready', { bg: 'bg-slate-100', ring: 'ring-slate-300', text: 'text-slate-600' }],
  ['active', { bg: 'bg-blue-100', ring: 'ring-blue-400', text: 'text-blue-700' }],
  ['blocked', { bg: 'bg-red-100', ring: 'ring-red-400', text: 'text-red-700' }],
  ['waiting', { bg: 'bg-amber-100', ring: 'ring-amber-400', text: 'text-amber-700' }],
  ['done', { bg: 'bg-green-100', ring: 'ring-green-400', text: 'text-green-700' }],
]);

const FALLBACK_STYLE: StateStyle = {
  bg: 'bg-slate-100',
  ring: 'ring-slate-300',
  text: 'text-slate-600',
};

/**
 * The canonical order of the happy-path states for visualization.
 * We always show ready -> active -> done as the main path,
 * with blocked and waiting shown as side branches.
 */
const HAPPY_PATH_STATES: readonly TaskStatus[] = ['ready', 'active', 'done'];
const HAPPY_PATH_SET = new Set<TaskStatus>(HAPPY_PATH_STATES);

/** States that appear along the happy path before the current state. */
function computeVisited(currentStatus: TaskStatus): Set<TaskStatus> {
  const visited = new Set<TaskStatus>();
  for (const state of TASK_STATE_ORDER) {
    if (state === currentStatus) {
      break;
    }
    // Only 'ready' and 'active' can be visited in the happy path
    if (HAPPY_PATH_SET.has(state)) {
      visited.add(state);
    }
  }
  // If current is 'done', both 'ready' and 'active' are visited
  if (currentStatus === 'done') {
    visited.add('ready');
    visited.add('active');
  }
  // If current is 'blocked' or 'waiting', 'ready' and 'active' are visited
  if (currentStatus === 'blocked' || currentStatus === 'waiting') {
    visited.add('ready');
    visited.add('active');
  }
  return visited;
}

interface TaskStateMachineProps {
  readonly currentStatus: TaskStatus;
}

export function TaskStateMachine({ currentStatus }: TaskStateMachineProps) {
  const visited = computeVisited(currentStatus);

  return (
    <div data-testid="task-state-machine" className="flex flex-col gap-4">
      {/* Happy path: ready -> active -> done */}
      <div className="flex items-center gap-2">
        {TASK_STATE_ORDER.map((state) => {
          const isCurrent = state === currentStatus;
          const isVisited = visited.has(state);
          const colors = STATE_COLORS.get(state) ?? FALLBACK_STYLE;

          return (
            <div key={state} className="flex items-center gap-2">
              <div
                data-testid={`state-${state}`}
                data-current={isCurrent ? 'true' : 'false'}
                data-visited={isVisited ? 'true' : 'false'}
                className={`
                  relative flex items-center justify-center rounded-lg px-4 py-2
                  text-sm font-medium transition-all duration-300
                  ${colors.bg} ${colors.text}
                  ${isCurrent ? `ring-2 ${colors.ring} shadow-md scale-110` : ''}
                  ${isVisited ? 'opacity-60' : ''}
                  ${!isCurrent && !isVisited ? 'opacity-30' : ''}
                `}
              >
                {isCurrent && (
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-current" />
                  </span>
                )}
                {STATE_LABELS.get(state) ?? state}
              </div>
              {state !== 'done' && (
                <svg
                  className={`h-4 w-4 ${isVisited || isCurrent ? 'text-slate-400' : 'text-slate-200'}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

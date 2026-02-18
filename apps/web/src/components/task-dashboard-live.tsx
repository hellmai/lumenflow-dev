'use client';

import { useTaskEvents } from '../hooks/use-task-events';
import { TaskDashboard } from './task-dashboard';

interface TaskDashboardLiveProps {
  readonly taskId: string;
}

/**
 * Client component that connects to the SSE endpoint and renders
 * the full task dashboard with live-updating data.
 */
export function TaskDashboardLive({ taskId }: TaskDashboardLiveProps) {
  const { state, approvePendingApproval, denyPendingApproval } = useTaskEvents({ taskId });

  return (
    <TaskDashboard
      taskId={state.taskId}
      connectionState={state.connectionState}
      currentStatus={state.currentStatus}
      events={state.events}
      toolReceipts={state.toolReceipts}
      approvalRequests={state.approvalRequests}
      onApprove={approvePendingApproval}
      onDeny={denyPendingApproval}
      evidenceLinks={state.evidenceLinks}
    />
  );
}

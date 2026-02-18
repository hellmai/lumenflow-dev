import { TaskDashboardLive } from '../../../src/components/task-dashboard-live';

const PAGE_METADATA = {
  title: 'Task Dashboard - LumenFlow',
  description: 'Live task lifecycle dashboard with real-time event streaming.',
} as const;

export const metadata = PAGE_METADATA;

interface DashboardPageProps {
  readonly params: Promise<{ taskId: string }>;
}

export default async function DashboardPage(props: DashboardPageProps) {
  const { taskId } = await props.params;

  return (
    <main>
      <TaskDashboardLive taskId={taskId} />
    </main>
  );
}

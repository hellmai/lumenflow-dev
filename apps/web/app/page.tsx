import { WorkspaceOverviewLive } from '../src/components/workspace-overview-live';

const PAGE_METADATA = {
  title: 'Workspace Overview - LumenFlow',
  description: 'View all tasks, lane WIP counts, and task status grouping.',
} as const;

export const metadata = PAGE_METADATA;

export default function HomePage() {
  return (
    <main>
      <WorkspaceOverviewLive />
    </main>
  );
}

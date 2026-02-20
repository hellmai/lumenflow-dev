import { CommunityLandingLive } from '../../src/components/community-landing-live';

const PAGE_METADATA = {
  title: 'Community - LumenFlow',
  description:
    'Explore the LumenFlow pack ecosystem. Get started with packs, browse available domain plugins, and learn how to create your own.',
} as const;

export const metadata = PAGE_METADATA;

export default function CommunityPage() {
  return (
    <main>
      <CommunityLandingLive />
    </main>
  );
}

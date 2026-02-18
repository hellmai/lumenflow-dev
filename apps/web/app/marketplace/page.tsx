import { MarketplaceBrowseLive } from '../../src/components/marketplace-browse-live';

const PAGE_METADATA = {
  title: 'Pack Marketplace - LumenFlow',
  description: 'Browse, search, and install LumenFlow domain packs.',
} as const;

export const metadata = PAGE_METADATA;

export default function MarketplacePage() {
  return (
    <main>
      <MarketplaceBrowseLive />
    </main>
  );
}

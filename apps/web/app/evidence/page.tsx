import { EvidencePageClient } from '../../src/components/evidence-page-client';

const PAGE_METADATA = {
  title: 'Evidence Viewer - LumenFlow',
  description: 'View tool trace timeline with scope and policy audit data.',
} as const;

export const metadata = PAGE_METADATA;

export default function EvidencePage() {
  return (
    <main>
      <EvidencePageClient />
    </main>
  );
}

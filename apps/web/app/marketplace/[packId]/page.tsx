import { MarketplacePackDetailLive } from '../../../src/components/marketplace-pack-detail-live';
import type { RouteContext } from '../../../src/server/api-route-paths';
import { resolveRouteParams } from '../../../src/server/api-route-paths';

interface PackDetailParams {
  readonly packId: string;
}

const PAGE_TITLE_SUFFIX = ' - Pack Marketplace - LumenFlow';

export async function generateMetadata(context: RouteContext<PackDetailParams>) {
  const { packId } = await resolveRouteParams(context);
  return {
    title: `${packId}${PAGE_TITLE_SUFFIX}`,
    description: `View details, tools, policies, and install instructions for the ${packId} pack.`,
  };
}

export default async function PackDetailPage(context: RouteContext<PackDetailParams>) {
  const { packId } = await resolveRouteParams(context);

  return (
    <main>
      <MarketplacePackDetailLive packId={packId} />
    </main>
  );
}

/**
 * LumenFlow Billing - Subscription & Usage Tracking
 *
 * Tracks usage per installation for rate limiting.
 * MVP uses in-memory storage; production should use Supabase.
 */

export interface Subscription {
  active: boolean;
  tier: 'free' | 'team' | 'business' | 'enterprise';
  wusRemaining: number;
  expiresAt: Date | null;
}

export interface UsageStats {
  wusThisMonth: number;
  wusLimit: number;
  percentUsed: number;
}

// Tier configuration
export const TIERS = {
  free: { wusPerMonth: 10, price: 0 },
  team: { wusPerMonth: 100, price: 29 },
  business: { wusPerMonth: 500, price: 99 },
  enterprise: { wusPerMonth: Infinity, price: 'custom' as const },
};

// In-memory usage store (MVP)
// Key: `${installationId}:${year}-${month}`
const usageStore = new Map<string, number>();

// In-memory subscription store (MVP)
// Key: installationId
const subscriptionStore = new Map<number, { tier: Subscription['tier'] }>();

/**
 * Get current month key for usage tracking
 */
function getCurrentMonthKey(installationId: number): string {
  const now = new Date();
  return `${installationId}:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Check subscription status for an installation
 */
export async function checkSubscription(
  installationId: number
): Promise<Subscription> {
  // TODO: In production, query Supabase:
  // const { data } = await supabase
  //   .from('subscriptions')
  //   .select('*')
  //   .eq('installation_id', installationId)
  //   .single();

  const stored = subscriptionStore.get(installationId);
  const tier = stored?.tier || 'free';
  const tierConfig = TIERS[tier];

  const usage = await getUsageStats(installationId);
  const remaining = tierConfig.wusPerMonth - usage.wusThisMonth;

  return {
    active: true,
    tier,
    wusRemaining: Math.max(0, remaining),
    expiresAt: null,
  };
}

/**
 * Set subscription tier for an installation (for testing/admin)
 */
export async function setSubscriptionTier(
  installationId: number,
  tier: Subscription['tier']
): Promise<void> {
  // TODO: In production, upsert to Supabase:
  // await supabase
  //   .from('subscriptions')
  //   .upsert({ installation_id: installationId, tier, updated_at: new Date() });

  subscriptionStore.set(installationId, { tier });
}

/**
 * Increment usage count for an installation
 */
export async function incrementUsage(installationId: number): Promise<void> {
  const key = getCurrentMonthKey(installationId);
  const current = usageStore.get(key) || 0;
  usageStore.set(key, current + 1);

  // TODO: In production, increment in Supabase:
  // await supabase.rpc('increment_usage', {
  //   p_installation_id: installationId,
  //   p_month: getCurrentMonthKey(installationId).split(':')[1],
  // });

  console.log(
    `[billing] Usage incremented for installation ${installationId}: ${current + 1}`
  );
}

/**
 * Get usage statistics for an installation
 */
export async function getUsageStats(installationId: number): Promise<UsageStats> {
  const key = getCurrentMonthKey(installationId);
  const wusThisMonth = usageStore.get(key) || 0;

  // Get tier to determine limit
  const stored = subscriptionStore.get(installationId);
  const tier = stored?.tier || 'free';
  const wusLimit = TIERS[tier].wusPerMonth;

  // TODO: In production, query Supabase:
  // const { data } = await supabase
  //   .from('usage')
  //   .select('count')
  //   .eq('installation_id', installationId)
  //   .eq('month', getCurrentMonthKey(installationId).split(':')[1])
  //   .single();

  return {
    wusThisMonth,
    wusLimit: wusLimit === Infinity ? 999999 : wusLimit,
    percentUsed:
      wusLimit === Infinity ? 0 : Math.round((wusThisMonth / wusLimit) * 100),
  };
}

/**
 * Reset usage for testing purposes
 */
export function resetUsageForTesting(): void {
  usageStore.clear();
  subscriptionStore.clear();
}

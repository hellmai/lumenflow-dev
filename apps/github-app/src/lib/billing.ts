/**
 * LumenFlow Billing - Subscription & Usage Tracking
 * 
 * Options:
 * 1. GitHub Marketplace (they handle billing)
 * 2. Stripe (direct billing)
 * 3. Simple license keys (for enterprise)
 */

interface Subscription {
  active: boolean;
  tier: 'free' | 'team' | 'business' | 'enterprise';
  wusRemaining: number;
  expiresAt: Date | null;
}

// In production: Query your database (Supabase, PlanetScale, etc.)
// For MVP: Use GitHub Marketplace API or simple KV store

const TIERS = {
  free: { wusPerMonth: 10, price: 0 },
  team: { wusPerMonth: 100, price: 29 },
  business: { wusPerMonth: 500, price: 99 },
  enterprise: { wusPerMonth: Infinity, price: 'custom' },
};

export async function checkSubscription(installationId: number): Promise<Subscription> {
  // Option 1: GitHub Marketplace
  // The installation already has billing info from GitHub
  // We just check if they're on a paid plan
  
  // Option 2: Our own database
  // const sub = await db.query('SELECT * FROM subscriptions WHERE installation_id = ?', [installationId]);
  
  // Option 3: Simple KV check (Vercel KV, Upstash Redis)
  // const tier = await kv.get(`subscription:${installationId}`);
  
  // For MVP: Everyone gets free tier
  return {
    active: true,
    tier: 'free',
    wusRemaining: 10,
    expiresAt: null,
  };
}

export async function incrementUsage(installationId: number): Promise<void> {
  // Track WU completion for usage-based billing
  // await db.query('UPDATE subscriptions SET wus_used = wus_used + 1 WHERE installation_id = ?', [installationId]);
}

export async function getUsageStats(installationId: number): Promise<{
  wusThisMonth: number;
  wusLimit: number;
  percentUsed: number;
}> {
  // Return usage for dashboard/API
  return {
    wusThisMonth: 5,
    wusLimit: 10,
    percentUsed: 50,
  };
}

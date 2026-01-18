/**
 * Token Validation Endpoint
 *
 * Validates LumenFlow API tokens and tracks usage for rate limiting.
 * Called by the lumenflow-gates GitHub Action before running gates.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkSubscription, incrementUsage, getUsageStats } from '../src/lib/billing.js';

interface ValidateTokenRequest {
  repo: string;
  run_id: string;
}

interface ValidateTokenResponse {
  valid: boolean;
  tier: 'free' | 'team' | 'business' | 'enterprise';
  remaining: number;
  limit: number;
  error?: string;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Only accept POST
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Extract token from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      valid: false,
      error: 'Missing or invalid Authorization header',
    } as ValidateTokenResponse);
    return;
  }

  const token = authHeader.slice(7); // Remove 'Bearer ' prefix

  try {
    // Parse request body
    const { repo, run_id } = req.body as ValidateTokenRequest;

    if (!repo) {
      res.status(400).json({
        valid: false,
        error: 'Missing repo in request body',
      } as ValidateTokenResponse);
      return;
    }

    // Look up subscription by token
    // For now, we derive installation ID from the token
    // In production: tokens would be stored in Supabase with associated org/installation
    const installationId = await getInstallationIdFromToken(token);

    if (!installationId) {
      res.status(401).json({
        valid: false,
        error: 'Invalid token',
      } as ValidateTokenResponse);
      return;
    }

    // Check subscription and usage
    const subscription = await checkSubscription(installationId);
    const usage = await getUsageStats(installationId);

    const remaining = usage.wusLimit - usage.wusThisMonth;

    if (remaining <= 0 && subscription.tier === 'free') {
      res.status(402).json({
        valid: false,
        tier: subscription.tier,
        remaining: 0,
        limit: usage.wusLimit,
        error: 'Usage limit exceeded. Upgrade at https://lumenflow.dev/pricing',
      } as ValidateTokenResponse);
      return;
    }

    // Increment usage (before gates run)
    await incrementUsage(installationId);

    // Return success
    res.status(200).json({
      valid: true,
      tier: subscription.tier,
      remaining: remaining - 1, // Account for this run
      limit: usage.wusLimit,
    } as ValidateTokenResponse);
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({
      valid: false,
      error: 'Internal server error',
    } as ValidateTokenResponse);
  }
}

/**
 * Look up installation ID from token
 *
 * For MVP: Simple token format is `lf_<installationId>_<secret>`
 * In production: Query Supabase for token -> installation mapping
 */
async function getInstallationIdFromToken(token: string): Promise<number | null> {
  // MVP: Parse token format `lf_<installationId>_<secret>`
  const match = token.match(/^lf_(\d+)_[a-zA-Z0-9]+$/);
  if (match) {
    return parseInt(match[1], 10);
  }

  // TODO: In production, query Supabase:
  // const { data } = await supabase
  //   .from('api_tokens')
  //   .select('installation_id')
  //   .eq('token_hash', hashToken(token))
  //   .single();
  // return data?.installation_id || null;

  return null;
}

/**
 * Health Check Endpoint
 *
 * Used for monitoring and uptime checks.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(
  req: VercelRequest,
  res: VercelResponse
): void {
  res.status(200).json({
    status: 'ok',
    service: 'lumenflow-github-app',
    timestamp: new Date().toISOString(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'dev',
  });
}

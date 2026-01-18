/**
 * Vercel Edge Function - GitHub Webhook Handler
 *
 * This is the main entry point for the GitHub App.
 * Deployed to: https://lumenflow-app.vercel.app/api/webhook
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Webhooks } from '@octokit/webhooks';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { validateWUFromPR } from '../src/lib/wu-validator.js';
import { checkLaneWIP } from '../src/lib/lane-enforcer.js';
import { createStampCommit } from '../src/lib/stamp-creator.js';
import { checkSubscription } from '../src/lib/billing.js';

const webhooks = new Webhooks({
  secret: process.env.GITHUB_WEBHOOK_SECRET!,
});

function getOctokit(installationId: number): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.GITHUB_APP_ID!,
      privateKey: process.env.GITHUB_PRIVATE_KEY!,
      installationId,
    },
  });
}

// =============================================================================
// PR OPENED - Validate WU template, check WIP
// =============================================================================
webhooks.on('pull_request.opened', async ({ payload }) => {
  const { repository, pull_request, installation } = payload;
  if (!installation) return;

  const octokit = getOctokit(installation.id);

  // Check subscription (free tier gets 10 WUs/month)
  const subscription = await checkSubscription(installation.id);
  if (!subscription.active) {
    await octokit.checks.create({
      owner: repository.owner.login,
      repo: repository.name,
      head_sha: pull_request.head.sha,
      name: 'LumenFlow',
      status: 'completed',
      conclusion: 'failure',
      output: {
        title: 'Subscription Required',
        summary: 'Free trial ended. [Upgrade](https://lumenflow.dev/pricing)',
      },
    });
    return;
  }

  // Validate WU template in PR body
  const validation = validateWUFromPR(pull_request.body || '');

  if (!validation.valid) {
    await octokit.checks.create({
      owner: repository.owner.login,
      repo: repository.name,
      head_sha: pull_request.head.sha,
      name: 'LumenFlow: WU Spec',
      status: 'completed',
      conclusion: 'failure',
      output: {
        title: 'Invalid WU Spec',
        summary: validation.errors.join('\n'),
      },
    });
    return;
  }

  // Check lane WIP limit
  const wipCheck = await checkLaneWIP(octokit, repository, validation.wu.lane);

  if (!wipCheck.allowed) {
    await octokit.checks.create({
      owner: repository.owner.login,
      repo: repository.name,
      head_sha: pull_request.head.sha,
      name: 'LumenFlow: Lane WIP',
      status: 'completed',
      conclusion: 'failure',
      output: {
        title: `Lane "${validation.wu.lane}" at WIP limit`,
        summary: `Blocked by PR #${wipCheck.blockingPR}`,
      },
    });
    return;
  }

  // Add lane label
  await octokit.issues.addLabels({
    owner: repository.owner.login,
    repo: repository.name,
    issue_number: pull_request.number,
    labels: [`lane:${validation.wu.lane.toLowerCase().replace(/\s+/g, '-')}`],
  });

  // Success!
  await octokit.checks.create({
    owner: repository.owner.login,
    repo: repository.name,
    head_sha: pull_request.head.sha,
    name: 'LumenFlow: WU Spec',
    status: 'completed',
    conclusion: 'success',
    output: {
      title: `WU-${validation.wu.id}: ${validation.wu.title}`,
      summary: `Lane: ${validation.wu.lane}`,
    },
  });
});

// =============================================================================
// PR MERGED - Create stamp commit
// =============================================================================
webhooks.on('pull_request.closed', async ({ payload }) => {
  const { repository, pull_request, installation } = payload;
  if (!installation) return;
  if (!pull_request.merged) return;

  const octokit = getOctokit(installation.id);
  const validation = validateWUFromPR(pull_request.body || '');
  if (!validation.valid || !validation.wu.id) return;

  await createStampCommit(octokit, repository, validation.wu.id);

  await octokit.issues.createComment({
    owner: repository.owner.login,
    repo: repository.name,
    issue_number: pull_request.number,
    body: `**LumenFlow:** WU-${validation.wu.id} completed.`,
  });
});

// =============================================================================
// Vercel Handler
// =============================================================================
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const signature = req.headers['x-hub-signature-256'] as string || '';
  const id = req.headers['x-github-delivery'] as string || '';
  const event = req.headers['x-github-event'] as string || '';

  try {
    await webhooks.verifyAndReceive({
      id,
      name: event as any,
      signature,
      payload: JSON.stringify(req.body),
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Webhook error:', errorMessage, error);
    res.status(500).json({ error: 'Webhook processing failed', details: errorMessage });
  }
}

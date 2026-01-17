/**
 * LumenFlow GitHub App - Webhook Handler
 *
 * This is the ENTIRE backend. ~200 lines.
 * Deployed to Vercel Edge Functions.
 */

import { Webhooks } from '@octokit/webhooks';
import { validateWUFromPR } from '../lib/wu-validator.js';
import { checkLaneWIP } from '../lib/lane-enforcer.js';
import { createStampCommit } from '../lib/stamp-creator.js';
import { checkSubscription } from '../lib/billing.js';

const webhooks = new Webhooks({
  secret: process.env.GITHUB_WEBHOOK_SECRET!,
});

// =============================================================================
// PR OPENED - Validate WU template, check WIP
// =============================================================================
webhooks.on('pull_request.opened', async ({ payload, octokit }) => {
  const { repository, pull_request, installation } = payload;

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
webhooks.on('pull_request.closed', async ({ payload, octokit }) => {
  const { repository, pull_request } = payload;

  if (!pull_request.merged) return;

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

// Vercel Edge Function Export
export default async function handler(req: Request): Promise<Response> {
  const signature = req.headers.get('x-hub-signature-256') || '';
  const body = await req.text();

  try {
    await webhooks.verifyAndReceive({
      id: req.headers.get('x-github-delivery') || '',
      name: req.headers.get('x-github-event') as any,
      signature,
      payload: body,
    });
    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response('Error', { status: 500 });
  }
}

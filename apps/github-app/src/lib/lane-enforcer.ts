/**
 * Lane Enforcer - WIP limit checking via GitHub labels
 */

import type { Octokit } from '@octokit/rest';

interface WIPCheckResult {
  allowed: boolean;
  blockingPR: number | null;
  currentWIP: number;
}

/**
 * Check if lane has capacity for another PR.
 * Uses GitHub labels as the source of truth.
 * 
 * Label format: lane:core-systems, lane:intelligence, etc.
 */
export async function checkLaneWIP(
  octokit: Octokit,
  repository: { owner: { login: string }; name: string },
  lane: string,
  excludePR?: number
): Promise<WIPCheckResult> {
  const labelName = `lane:${lane.toLowerCase().replace(/\s+/g, '-')}`;
  
  // Find open PRs with this lane label
  const { data: prs } = await octokit.pulls.list({
    owner: repository.owner.login,
    repo: repository.name,
    state: 'open',
  });
  
  const prsInLane = prs.filter(pr => {
    if (excludePR && pr.number === excludePR) return false;
    return pr.labels.some(l => l.name === labelName);
  });
  
  // WIP limit = 1 per lane (configurable via repo settings later)
  const wipLimit = 1;
  
  return {
    allowed: prsInLane.length < wipLimit,
    blockingPR: prsInLane[0]?.number || null,
    currentWIP: prsInLane.length,
  };
}

/**
 * Get all lanes and their current WIP status
 */
export async function getAllLaneStatus(
  octokit: Octokit,
  repository: { owner: { login: string }; name: string }
): Promise<Map<string, { wip: number; prs: number[] }>> {
  const { data: prs } = await octokit.pulls.list({
    owner: repository.owner.login,
    repo: repository.name,
    state: 'open',
  });
  
  const laneStatus = new Map<string, { wip: number; prs: number[] }>();
  
  for (const pr of prs) {
    for (const label of pr.labels) {
      if (label.name?.startsWith('lane:')) {
        const lane = label.name.replace('lane:', '');
        const current = laneStatus.get(lane) || { wip: 0, prs: [] };
        current.wip++;
        current.prs.push(pr.number);
        laneStatus.set(lane, current);
      }
    }
  }
  
  return laneStatus;
}

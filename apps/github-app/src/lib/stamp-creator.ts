/**
 * Stamp Creator - Commit completion stamps to repo
 */

import type { Octokit } from '@octokit/rest';

/**
 * Create a stamp commit on main branch when WU completes.
 * This is the proof-of-work that the WU was done.
 */
export async function createStampCommit(
  octokit: Octokit,
  repository: { owner: { login: string }; name: string; default_branch?: string },
  wuId: string,
): Promise<void> {
  const owner = repository.owner.login;
  const repo = repository.name;
  const branch = repository.default_branch || 'main';
  const path = `.beacon/stamps/WU-${wuId}.done`;

  const timestamp = new Date().toISOString();
  const content = JSON.stringify(
    {
      wuId: `WU-${wuId}`,
      completedAt: timestamp,
      source: 'lumenflow-github-app',
    },
    null,
    2,
  );

  try {
    // Check if stamp already exists
    await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });
    // Stamp exists, skip
    return;
  } catch {
    // Stamp doesn't exist, create it
  }

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message: `chore: stamp WU-${wuId} complete`,
    content: Buffer.from(content).toString('base64'),
    branch,
  });
}

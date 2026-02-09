#!/usr/bin/env node

/**
 * PR mode completion workflow for wu:done
 * Extracted from wu-done.ts (WU-1215 refactoring)
 *
 * PR mode creates a GitHub PR instead of auto-merging to main.
 * Used for:
 * - External agents requiring review (claimed_mode: worktree-pr)
 * - High-risk WUs (requires_review: true in WU YAML)
 * - One-off PR creation (--create-pr flag)
 */

import { execSync } from 'node:child_process';
import { getGitForCwd } from './git-adapter.js';
import { createError, ErrorCodes } from './error-handler.js';
import { LOG_PREFIX, EMOJI, REMOTES, FILE_SYSTEM, STDIO } from './wu-constants.js';
import { createWuPaths } from './wu-paths.js';

/**
 * Canonical completion mode labels used for wu:done telemetry events.
 * Centralized here so all completion workflows share consistent values.
 */
export const WU_DONE_COMPLETION_MODES = Object.freeze({
  WORKTREE: 'worktree',
  BRANCH_ONLY: 'branch-only',
  BRANCH_PR: 'branch-pr',
});

/**
 * @typedef {Object} PRContext
 * @property {string} branch - Lane branch name
 * @property {string} id - WU ID (e.g., "WU-1215")
 * @property {string} title - WU title for PR title
 * @property {Object} doc - WU YAML document
 * @property {boolean} [draft] - Whether to create as draft PR
 */

/**
 * @typedef {Object} PRResult
 * @property {boolean} success - Whether PR creation succeeded
 * @property {string|null} prUrl - URL of created PR (null if gh CLI unavailable)
 * @property {boolean} ghAvailable - Whether gh CLI is available
 */

/**
 * Check if PR mode is enabled for this WU
 *
 * @param {Object} doc - WU YAML document
 * @param {Object} args - CLI arguments
 * @returns {boolean} Whether PR mode is enabled
 */
export function isPRModeEnabled(doc, args) {
  const claimedMode = doc.claimed_mode || 'worktree';
  const requiresReview = doc.requires_review === true;
  return claimedMode === 'worktree-pr' || args.createPR || requiresReview;
}

/**
 * Check if gh CLI is available
 *
 * @returns {boolean} Whether gh CLI is available
 */
export function isGhCliAvailable() {
  try {
    execSync('gh --version', { encoding: 'utf-8', stdio: STDIO.IGNORE });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a GitHub PR for the lane branch
 *
 * @param {PRContext} context - PR context
 * @returns {Promise<PRResult>} PR creation result
 */
export async function createPR(context) {
  const { branch, id, title, doc, draft = false } = context;
  console.log(`\n${LOG_PREFIX.DONE} Creating PR for ${branch}...`);

  // Check if gh CLI is available
  if (!isGhCliAvailable()) {
    printGhCliMissingMessage(branch, id);
    return { success: false, prUrl: null, ghAvailable: false };
  }

  // Push branch to remote
  try {
    await getGitForCwd().push(REMOTES.ORIGIN, branch);
  } catch (e) {
    throw createError(ErrorCodes.GIT_ERROR, `Failed to push branch ${branch}: ${e.message}`, {
      branch,
      operation: 'push',
      originalError: e.message,
    });
  }

  // Build PR body
  const body = buildPRBody(doc, id);
  const prTitle = `${id}: ${title}`;
  const draftFlag = draft ? '--draft' : '';

  // Create PR via gh CLI
  try {
    const prUrl = execSync(
      `gh pr create --title ${JSON.stringify(prTitle)} --body ${JSON.stringify(body)} ${draftFlag} --head ${JSON.stringify(branch)} --base main`,
      { encoding: 'utf-8' },
    ).trim();
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} PR created: ${prUrl}`);
    return { success: true, prUrl, ghAvailable: true };
  } catch (e) {
    throw createError(ErrorCodes.GIT_ERROR, `Failed to create PR: ${e.message}`, {
      branch,
      id,
      operation: 'pr-create',
      originalError: e.message,
    });
  }
}

/**
 * Build the PR body from WU document
 *
 * @param {Object} doc - WU YAML document
 * @param {string} id - WU ID
 * @returns {string} PR body markdown
 */
export function buildPRBody(doc, id) {
  const paths = createWuPaths();
  const wuPath = paths.WU(id);
  const description = doc.description || doc.problem || '';
  const acceptance = doc.acceptance_criteria || doc.acceptance || {};

  let body = `## Summary\n\n${description}\n\n`;

  if (Object.keys(acceptance).length > 0) {
    body += `## Acceptance Criteria\n\n`;
    for (const [key, criteria] of Object.entries(acceptance)) {
      body += `**${key}:**\n`;
      if (Array.isArray(criteria)) {
        for (const item of criteria) {
          body += `- ${item}\n`;
        }
      } else if (typeof criteria === 'object') {
        for (const [subkey, items] of Object.entries(criteria)) {
          body += `- ${subkey}:\n`;
          if (Array.isArray(items)) {
            for (const item of items) {
              body += `  - ${item}\n`;
            }
          }
        }
      }
      body += `\n`;
    }
  }

  body += `\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\n`;
  body += `WU YAML: ${wuPath}`;

  return body;
}

/**
 * Print message when gh CLI is not available
 *
 * @param {string} branch - Lane branch name
 * @param {string} id - WU ID
 */
export function printGhCliMissingMessage(branch, id) {
  console.error();
  console.error('╔═══════════════════════════════════════════════════════════════════╗');
  console.error('║  GH CLI NOT AVAILABLE');
  console.error('╠═══════════════════════════════════════════════════════════════════╣');
  console.error('║  The gh CLI tool is required to create PRs.');
  console.error('║');
  console.error('║  Manual PR creation steps:');
  console.error(`║  1. Push branch: git push origin ${branch}`);
  console.error('║  2. Create PR in GitHub UI');
  console.error(`║  3. After merge, run: pnpm wu:cleanup --id ${id}`);
  console.error('╚═══════════════════════════════════════════════════════════════════╝');
}

/**
 * Print success message with next steps after PR creation
 *
 * @param {string} prUrl - URL of created PR
 * @param {string} id - WU ID
 */
export function printPRCreatedMessage(prUrl, id) {
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║  PR CREATED - NEXT STEPS');
  console.log('╠═══════════════════════════════════════════════════════════════════╣');
  console.log(`║  PR URL: ${prUrl}`);
  console.log('║');
  console.log('║  Next steps:');
  console.log('║  1. Review the PR in GitHub UI');
  console.log('║  2. Merge the PR when ready');
  console.log(`║  3. Run cleanup: pnpm wu:cleanup --id ${id}`);
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
}

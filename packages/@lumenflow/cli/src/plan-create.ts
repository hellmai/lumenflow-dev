#!/usr/bin/env node

/**
 * Plan Create Command (WU-1313)
 *
 * Creates plan files in the repo-native plansDir (not LUMENFLOW_HOME).
 * Plans can be linked to WUs (via spec_refs) or initiatives (via related_plan).
 *
 * Usage:
 *   pnpm plan:create --id WU-1313 --title "Feature plan"
 *   pnpm plan:create --id INIT-001 --title "Initiative plan"
 *
 * Features:
 * - Creates plan in repo directories.plansDir
 * - Supports both WU-XXX and INIT-XXX IDs
 * - Uses micro-worktree isolation for atomic commits
 * - Idempotent: fails if plan already exists (no overwrite)
 *
 * Context: WU-1313 (INIT-013 Plan Tooling)
 */

import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { die } from '@lumenflow/core/error-handler';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { ensureOnMain } from '@lumenflow/core/wu-helpers';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { todayISO } from '@lumenflow/core/date-utils';
import { LOG_PREFIX as CORE_LOG_PREFIX } from '@lumenflow/core/wu-constants';

/** Log prefix for console output */
export const LOG_PREFIX = CORE_LOG_PREFIX.PLAN_CREATE ?? '[plan:create]';

/** Micro-worktree operation name */
const OPERATION_NAME = 'plan-create';

/** LumenFlow URI scheme for plan references */
const PLAN_URI_SCHEME = 'lumenflow://plans/';

/** WU ID pattern */
const WU_ID_PATTERN = /^WU-\d+$/;

/** Initiative ID pattern */
const INIT_ID_PATTERN = /^INIT-[A-Z0-9]+$/i;

/**
 * Validate that the ID is a valid WU or Initiative ID
 *
 * @param id - ID to validate (WU-XXX or INIT-XXX)
 * @throws Error if ID format is invalid
 */
export function validatePlanId(id: string): void {
  if (!id) {
    die(`ID is required\n\nExpected format: WU-XXX or INIT-XXX`);
  }

  const isWU = WU_ID_PATTERN.test(id);
  const isInit = INIT_ID_PATTERN.test(id);

  if (!isWU && !isInit) {
    die(
      `Invalid ID format: "${id}"\n\n` +
        `Expected format:\n` +
        `  - WU ID: WU-<number> (e.g., WU-1313)\n` +
        `  - Initiative ID: INIT-<alphanumeric> (e.g., INIT-001, INIT-TOOLING)`,
    );
  }
}

/**
 * Get the lumenflow:// URI for a plan
 *
 * @param id - WU or Initiative ID
 * @returns lumenflow://plans/{id}-plan.md URI
 */
export function getPlanUri(id: string): string {
  return `${PLAN_URI_SCHEME}${id}-plan.md`;
}

/**
 * Create a plan file in the repo plansDir
 *
 * @param worktreePath - Path to repo root or worktree
 * @param id - WU or Initiative ID
 * @param title - Plan title
 * @returns Path to created file
 * @throws Error if file already exists
 */
export function createPlan(worktreePath: string, id: string, title: string): string {
  const plansDir = join(worktreePath, WU_PATHS.PLANS_DIR());
  const planPath = join(plansDir, `${id}-plan.md`);

  if (existsSync(planPath)) {
    die(
      `Plan file already exists: ${planPath}\n\n` +
        `Options:\n` +
        `  1. Edit the existing plan: pnpm plan:edit --id ${id}\n` +
        `  2. Delete and recreate (not recommended)\n` +
        `  3. Use plan:link to link existing plan to a WU/initiative`,
    );
  }

  // Ensure plans directory exists
  if (!existsSync(plansDir)) {
    mkdirSync(plansDir, { recursive: true });
  }

  const today = todayISO();
  const template = `# ${id} Plan - ${title}

Created: ${today}

## Goal

<!-- What is the primary objective? -->

## Scope

<!-- What is in scope and out of scope? -->

## Approach

<!-- How will you achieve the goal? Key phases or milestones? -->

## Success Criteria

<!-- How will you know when this is complete? Measurable outcomes? -->

## Risks

<!-- What could go wrong? How will you mitigate? -->

## Open Questions

<!-- Unresolved questions or decisions needed -->

## References

- ID: ${id}
- Created: ${today}
`;

  writeFileSync(planPath, template, { encoding: 'utf-8' });
  console.log(`${LOG_PREFIX} Created plan: ${planPath}`);

  return planPath;
}

/**
 * Generate commit message for plan creation
 *
 * @param id - WU or Initiative ID
 * @param title - Plan title
 * @returns Commit message
 */
export function getCommitMessage(id: string, title: string): string {
  const idLower = id.toLowerCase();
  return `docs: create plan for ${idLower} - ${title}`;
}

async function main(): Promise<void> {
  const args = createWUParser({
    name: 'plan-create',
    description: 'Create a new plan file in repo plansDir',
    options: [WU_OPTIONS.id, WU_OPTIONS.title],
    required: ['id', 'title'],
    allowPositionalId: true,
  });

  const id = args.id as string;
  const title = args.title as string;

  // Validate inputs
  validatePlanId(id);

  console.log(`${LOG_PREFIX} Creating plan for ${id}...`);

  // Ensure on main for micro-worktree operations
  await ensureOnMain(getGitForCwd());

  try {
    let createdPlanPath: string = '';

    await withMicroWorktree({
      operation: OPERATION_NAME,
      id,
      logPrefix: LOG_PREFIX,
      pushOnly: true,
      execute: async ({ worktreePath }) => {
        // Create plan file
        createdPlanPath = createPlan(worktreePath, id, title);

        // Get relative path for commit
        const planRelPath = createdPlanPath.replace(worktreePath + '/', '');

        return {
          commitMessage: getCommitMessage(id, title),
          files: [planRelPath],
        };
      },
    });

    const planUri = getPlanUri(id);

    console.log(`\n${LOG_PREFIX} Plan created successfully!`);
    console.log(`\nPlan Details:`);
    console.log(`  ID:      ${id}`);
    console.log(`  Title:   ${title}`);
    console.log(`  URI:     ${planUri}`);
    console.log(`  File:    ${createdPlanPath}`);
    console.log(`\nNext steps:`);
    console.log(`  1. Edit the plan file with your goals and approach`);
    console.log(`  2. Link to WU/initiative: pnpm plan:link --id ${id} --plan ${planUri}`);
    console.log(`  3. When ready, promote: pnpm plan:promote --id ${id}`);
  } catch (error) {
    die(
      `Plan creation failed: ${(error as Error).message}\n\n` +
        `Micro-worktree cleanup was attempted automatically.\n` +
        `If issue persists, check for orphaned branches: git branch | grep tmp/${OPERATION_NAME}`,
    );
  }
}

// Guard main() for testability
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}

// Export for testing
export { main };

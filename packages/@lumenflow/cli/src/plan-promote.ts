#!/usr/bin/env node

/**
 * Plan Promote Command (WU-1313)
 *
 * Promotes a plan from draft to approved status.
 * Validates that required sections are complete before approving.
 *
 * Usage:
 *   pnpm plan:promote --id WU-1313
 *   pnpm plan:promote --id INIT-001 --force  # Skip validation
 *
 * Features:
 * - Validates plan completeness (non-empty required sections)
 * - Adds approved status and timestamp
 * - Uses micro-worktree isolation for atomic commits
 * - Idempotent: no error if already approved
 *
 * Context: WU-1313 (INIT-013 Plan Tooling)
 */

import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { die } from '@lumenflow/core/error-handler';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { ensureOnMain } from '@lumenflow/core/wu-helpers';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { todayISO } from '@lumenflow/core/date-utils';
import { LOG_PREFIX as CORE_LOG_PREFIX } from '@lumenflow/core/wu-constants';

/** Log prefix for console output */
export const LOG_PREFIX = CORE_LOG_PREFIX.PLAN_PROMOTE ?? '[plan:promote]';

/** Micro-worktree operation name */
const OPERATION_NAME = 'plan-promote';

/** WU ID pattern */
const WU_ID_PATTERN = /^WU-\d+$/;

/** Initiative ID pattern */
const INIT_ID_PATTERN = /^INIT-[A-Z0-9]+$/i;

/** Required sections that must have content */
const REQUIRED_SECTIONS = ['Goal', 'Scope', 'Approach'];

/** Status marker patterns */
const STATUS_APPROVED_PATTERN = /^Status:\s*approved/im;

/**
 * Get the path to a plan file from its ID
 *
 * @param id - WU or Initiative ID
 * @returns Path to plan file
 * @throws Error if plan not found
 */
export function getPlanPath(id: string): string {
  const plansDir = WU_PATHS.PLANS_DIR();
  const planPath = join(plansDir, `${id}-plan.md`);

  if (!existsSync(planPath)) {
    die(
      `Plan not found for ${id}\n\n` +
        `Expected path: ${planPath}\n\n` +
        `Create it first with: pnpm plan:create --id ${id} --title "Title"`,
    );
  }

  return planPath;
}

/**
 * Validate that a plan has all required sections with content
 *
 * @param planPath - Path to plan file
 * @returns Validation result with valid flag and errors array
 */
export function validatePlanComplete(planPath: string): { valid: boolean; errors: string[] } {
  if (!existsSync(planPath)) {
    return { valid: false, errors: ['Plan file not found'] };
  }

  const text = readFileSync(planPath, { encoding: 'utf-8' });
  const errors: string[] = [];

  for (const section of REQUIRED_SECTIONS) {
    const sectionHeading = `## ${section}`;
    const headingIndex = text.indexOf(sectionHeading);

    if (headingIndex === -1) {
      errors.push(`Missing required section: ${section}`);
      continue;
    }

    // Find the content between this heading and the next
    const afterHeading = text.substring(headingIndex + sectionHeading.length);
    const nextHeadingIndex = afterHeading.indexOf('\n## ');
    const sectionContent =
      nextHeadingIndex >= 0 ? afterHeading.substring(0, nextHeadingIndex) : afterHeading;

    // Check if content is just whitespace, empty, or only comments
    const trimmedContent = sectionContent
      .split('\n')
      .filter((line) => !line.trim().startsWith('<!--') && line.trim() !== '-->')
      .join('\n')
      .trim();

    if (trimmedContent === '' || trimmedContent.length < 10) {
      errors.push(`${section} section is empty or too short`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Promote a plan to approved status
 *
 * Adds Status: approved and Approved: date after the Created line.
 *
 * @param planPath - Path to plan file
 * @returns True if changes were made, false if already approved
 */
export function promotePlan(planPath: string): boolean {
  if (!existsSync(planPath)) {
    die(`Plan file not found: ${planPath}`);
  }

  const text = readFileSync(planPath, { encoding: 'utf-8' });

  // Check if already approved
  if (STATUS_APPROVED_PATTERN.test(text)) {
    console.log(`${LOG_PREFIX} Plan already approved (idempotent)`);
    return false;
  }

  // Find the Created: line and insert status after it
  // Use specific pattern to avoid backtracking (sonarjs/slow-regex)
  const createdPattern = /^Created:\s*\S.*$/m;
  const createdMatch = createdPattern.exec(text);

  const today = todayISO();
  const statusLines = `Status: approved\nApproved: ${today}`;

  let newText: string;
  if (createdMatch && createdMatch.index !== undefined) {
    // Insert after Created: line
    const insertPos = createdMatch.index + createdMatch[0].length;
    newText = text.substring(0, insertPos) + '\n' + statusLines + text.substring(insertPos);
  } else {
    // No Created: line found, insert after first heading
    const firstHeadingPattern = /^# .+$/m;
    const firstHeadingMatch = firstHeadingPattern.exec(text);
    if (firstHeadingMatch && firstHeadingMatch.index !== undefined) {
      const insertPos = firstHeadingMatch.index + firstHeadingMatch[0].length;
      newText =
        text.substring(0, insertPos) + '\n\n' + statusLines + '\n' + text.substring(insertPos);
    } else {
      // Fallback: prepend to file
      newText = statusLines + '\n\n' + text;
    }
  }

  writeFileSync(planPath, newText, { encoding: 'utf-8' });
  console.log(`${LOG_PREFIX} Plan promoted to approved status`);
  return true;
}

/**
 * Generate commit message for plan promote operation
 *
 * @param id - WU or Initiative ID
 * @returns Commit message
 */
export function getCommitMessage(id: string): string {
  const idLower = id.toLowerCase();
  return `docs: promote ${idLower} plan to approved`;
}

async function main(): Promise<void> {
  const FORCE_OPTION = {
    name: 'force',
    flags: '-f, --force',
    description: 'Skip validation and promote anyway',
  };

  const args = createWUParser({
    name: 'plan-promote',
    description: 'Promote a plan to approved status',
    options: [WU_OPTIONS.id, FORCE_OPTION],
    required: ['id'],
    allowPositionalId: true,
  });

  const id = args.id as string;
  const force = args.force as boolean | undefined;

  // Validate ID format
  if (!WU_ID_PATTERN.test(id) && !INIT_ID_PATTERN.test(id)) {
    die(`Invalid ID format: "${id}"\n\n` + `Expected format: WU-XXX or INIT-XXX`);
  }

  console.log(`${LOG_PREFIX} Promoting plan for ${id}...`);

  // Ensure on main for micro-worktree operations
  await ensureOnMain(getGitForCwd());

  try {
    await withMicroWorktree({
      operation: OPERATION_NAME,
      id,
      logPrefix: LOG_PREFIX,
      pushOnly: true,
      execute: async ({ worktreePath }) => {
        const planRelPath = join(WU_PATHS.PLANS_DIR(), `${id}-plan.md`);
        const planAbsPath = join(worktreePath, planRelPath);

        if (!existsSync(planAbsPath)) {
          die(
            `Plan not found for ${id}\n\n` +
              `Expected path: ${planRelPath}\n\n` +
              `Create it first with: pnpm plan:create --id ${id} --title "Title"`,
          );
        }

        // Validate plan completeness (unless force)
        if (!force) {
          const validation = validatePlanComplete(planAbsPath);
          if (!validation.valid) {
            const errorList = validation.errors.map((e) => `  - ${e}`).join('\n');
            die(
              `Plan validation failed:\n\n${errorList}\n\n` +
                `Fix these issues or use --force to skip validation.`,
            );
          }
          console.log(`${LOG_PREFIX} Plan validation passed`);
        }

        // Promote the plan
        const changed = promotePlan(planAbsPath);

        if (!changed) {
          console.log(`${LOG_PREFIX} No changes needed (already approved)`);
        }

        return {
          commitMessage: getCommitMessage(id),
          files: [planRelPath],
        };
      },
    });

    console.log(`\n${LOG_PREFIX} Plan promoted successfully!`);
    console.log(`\nPromotion Details:`);
    console.log(`  ID:     ${id}`);
    console.log(`  Status: approved`);
  } catch (error) {
    die(
      `Plan promotion failed: ${(error as Error).message}\n\n` +
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

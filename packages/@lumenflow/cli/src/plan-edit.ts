#!/usr/bin/env node

/**
 * Plan Edit Command (WU-1313)
 *
 * Edits existing plan files in the repo-native plansDir.
 * Supports updating or appending to specific sections.
 *
 * Usage:
 *   pnpm plan:edit --id WU-1313 --section Goal --content "New goal content"
 *   pnpm plan:edit --id WU-1313 --section Risks --append "- New risk"
 *
 * Features:
 * - Updates specific sections by name
 * - Supports append mode for list sections (Risks, etc.)
 * - Uses micro-worktree isolation for atomic commits
 * - Validates section exists before editing
 *
 * Context: WU-1313 (INIT-013 Plan Tooling)
 */

import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { die } from '@lumenflow/core/error-handler';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { ensureOnMain } from '@lumenflow/core/wu-helpers';
import {
  withMicroWorktree,
  isRetryExhaustionError as coreIsRetryExhaustionError,
  formatRetryExhaustionError as coreFormatRetryExhaustionError,
} from '@lumenflow/core/micro-worktree';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { LOG_PREFIX as CORE_LOG_PREFIX } from '@lumenflow/core/wu-constants';

/** Log prefix for console output */
export const LOG_PREFIX = CORE_LOG_PREFIX.PLAN_EDIT ?? '[plan:edit]';

/** Micro-worktree operation name */
const OPERATION_NAME = 'plan-edit';

/**
 * WU-1621: operation-level push retry override for plan:edit.
 */
export const PLAN_EDIT_PUSH_RETRY_OVERRIDE = {
  retries: 8,
  min_delay_ms: 300,
  max_delay_ms: 4000,
};

/** WU ID pattern */
const WU_ID_PATTERN = /^WU-\d+$/;

/** Initiative ID pattern */
const INIT_ID_PATTERN = /^INIT-[A-Z0-9]+$/i;

/**
 * Check if an error is a push retry exhaustion error.
 */
export function isRetryExhaustionError(error: Error): boolean {
  return coreIsRetryExhaustionError(error);
}

/**
 * Format retry exhaustion error with actionable command guidance.
 */
export function formatRetryExhaustionError(error: Error, id: string, section: string): string {
  return coreFormatRetryExhaustionError(error, {
    command: `pnpm plan:edit --id ${id} --section "${section}" --content "<text>"`,
  });
}

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
 * Update a section in a plan file
 *
 * Replaces all content between the section heading and the next heading.
 *
 * @param planPath - Path to plan file
 * @param section - Section name (without ##)
 * @param content - New content for the section
 * @returns True if changes were made, false if section not found
 */
export function updatePlanSection(planPath: string, section: string, content: string): boolean {
  if (!existsSync(planPath)) {
    die(`Plan file not found: ${planPath}`);
  }

  const text = readFileSync(planPath, { encoding: 'utf-8' });
  const lines = text.split('\n');

  // Find the section heading
  const sectionHeading = `## ${section}`;
  const headingIndex = lines.findIndex((line) => line.trim() === sectionHeading);

  if (headingIndex === -1) {
    console.log(`${LOG_PREFIX} Section "${section}" not found in plan`);
    return false;
  }

  // Find the next heading (end of this section)
  let nextHeadingIndex = lines.findIndex(
    (line, i) => i > headingIndex && line.trim().startsWith('## '),
  );

  if (nextHeadingIndex === -1) {
    nextHeadingIndex = lines.length;
  }

  // Replace the section content (keep the heading, replace content until next heading)
  const beforeSection = lines.slice(0, headingIndex + 1);
  const afterSection = lines.slice(nextHeadingIndex);
  const newLines = [...beforeSection, '', content, '', ...afterSection];

  writeFileSync(planPath, newLines.join('\n'), { encoding: 'utf-8' });
  console.log(`${LOG_PREFIX} Updated "${section}" section in plan`);
  return true;
}

/**
 * Append content to a section in a plan file
 *
 * Adds content at the end of the section, before the next heading.
 *
 * @param planPath - Path to plan file
 * @param section - Section name (without ##)
 * @param content - Content to append
 * @returns True if changes were made, false if section not found
 */
export function appendToSection(planPath: string, section: string, content: string): boolean {
  if (!existsSync(planPath)) {
    die(`Plan file not found: ${planPath}`);
  }

  const text = readFileSync(planPath, { encoding: 'utf-8' });
  const lines = text.split('\n');

  // Find the section heading
  const sectionHeading = `## ${section}`;
  const headingIndex = lines.findIndex((line) => line.trim() === sectionHeading);

  if (headingIndex === -1) {
    console.log(`${LOG_PREFIX} Section "${section}" not found in plan`);
    return false;
  }

  // Find the next heading (end of this section)
  let nextHeadingIndex = lines.findIndex(
    (line, i) => i > headingIndex && line.trim().startsWith('## '),
  );

  if (nextHeadingIndex === -1) {
    nextHeadingIndex = lines.length;
  }

  // Find the last non-empty line before the next heading
  let insertIndex = nextHeadingIndex;
  for (let i = nextHeadingIndex - 1; i > headingIndex; i--) {
    if (lines[i].trim() !== '') {
      insertIndex = i + 1;
      break;
    }
  }

  // Insert the new content
  lines.splice(insertIndex, 0, content);

  writeFileSync(planPath, lines.join('\n'), { encoding: 'utf-8' });
  console.log(`${LOG_PREFIX} Appended to "${section}" section in plan`);
  return true;
}

/**
 * Generate commit message for plan edit operation
 *
 * @param id - WU or Initiative ID
 * @param section - Section that was edited
 * @returns Commit message
 */
export function getCommitMessage(id: string, section: string): string {
  const idLower = id.toLowerCase();
  return `docs: update ${section} section in ${idLower} plan`;
}

async function main(): Promise<void> {
  const SECTION_OPTION = {
    name: 'section',
    flags: '--section <name>',
    description: 'Section name to edit (Goal, Scope, Approach, etc.)',
  };

  const CONTENT_OPTION = {
    name: 'content',
    flags: '--content <text>',
    description: 'New content for the section',
  };

  const APPEND_OPTION = {
    name: 'append',
    flags: '--append <text>',
    description: 'Content to append to the section (instead of replace)',
  };

  const args = createWUParser({
    name: 'plan-edit',
    description: 'Edit a section in a plan file',
    options: [WU_OPTIONS.id, SECTION_OPTION, CONTENT_OPTION, APPEND_OPTION],
    required: ['id', 'section'],
    allowPositionalId: true,
  });

  const id = args.id as string;
  const section = args.section as string;
  const content = args.content as string | undefined;
  const appendContent = args.append as string | undefined;

  // Validate we have either content or append
  if (!content && !appendContent) {
    die('Either --content or --append is required');
  }

  // Validate ID format
  if (!WU_ID_PATTERN.test(id) && !INIT_ID_PATTERN.test(id)) {
    die(`Invalid ID format: "${id}"\n\n` + `Expected format: WU-XXX or INIT-XXX`);
  }

  console.log(`${LOG_PREFIX} Editing plan for ${id}...`);

  // Ensure on main for micro-worktree operations
  await ensureOnMain(getGitForCwd());

  try {
    await withMicroWorktree({
      operation: OPERATION_NAME,
      id,
      logPrefix: LOG_PREFIX,
      pushOnly: true,
      pushRetryOverride: PLAN_EDIT_PUSH_RETRY_OVERRIDE,
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

        let changed: boolean;
        if (appendContent) {
          changed = appendToSection(planAbsPath, section, appendContent);
        } else if (content) {
          changed = updatePlanSection(planAbsPath, section, content);
        } else {
          // This shouldn't happen due to earlier validation, but satisfy TS
          changed = false;
        }

        if (!changed) {
          console.warn(`${LOG_PREFIX} Section "${section}" not found - no changes made`);
        }

        return {
          commitMessage: getCommitMessage(id, section),
          files: [planRelPath],
        };
      },
    });

    console.log(`\n${LOG_PREFIX} Plan edited successfully!`);
    console.log(`\nEdit Details:`);
    console.log(`  ID:      ${id}`);
    console.log(`  Section: ${section}`);
    console.log(`  Mode:    ${appendContent ? 'append' : 'replace'}`);
  } catch (error) {
    if (error instanceof Error && isRetryExhaustionError(error)) {
      die(formatRetryExhaustionError(error, id, section));
    }
    die(
      `Plan edit failed: ${(error as Error).message}\n\n` +
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

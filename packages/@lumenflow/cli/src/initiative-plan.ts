#!/usr/bin/env node

/**
 * Initiative Plan Command (WU-1105, renamed in WU-1193)
 *
 * Links plan files to initiatives by setting the `related_plan` field
 * in the initiative YAML.
 *
 * Usage:
 *   pnpm initiative:plan --initiative INIT-001 --plan docs/04-operations/plans/my-plan.md
 *   pnpm initiative:plan --initiative INIT-001 --create  # Create new plan template
 *
 * Features:
 * - Validates initiative exists before modifying
 * - Formats plan path as lumenflow:// URI
 * - Idempotent: no error if same plan already linked
 * - Warns if replacing existing plan link
 * - Can create plan templates with --create
 *
 * Context: WU-1105 (INIT-003 Phase 3a), renamed from init:plan in WU-1193
 */

import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { die } from '@lumenflow/core/error-handler';
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { INIT_PATHS } from '@lumenflow/initiatives/paths';
import { INIT_PATTERNS } from '@lumenflow/initiatives/constants';
import { ensureOnMain } from '@lumenflow/core/wu-helpers';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { readInitiative } from '@lumenflow/initiatives/yaml';
import { parseYAML, stringifyYAML } from '@lumenflow/core/wu-yaml';
import { LOG_PREFIX as CORE_LOG_PREFIX } from '@lumenflow/core/wu-constants';
import { WU_PATHS } from '@lumenflow/core/wu-paths';

/** Log prefix for console output */
export const LOG_PREFIX = CORE_LOG_PREFIX.INITIATIVE_PLAN;

/** Micro-worktree operation name */
const OPERATION_NAME = 'initiative-plan';

/** Standard plans directory relative to repo root (WU-1301: uses config-based paths) */
const PLANS_DIR = WU_PATHS.PLANS_DIR();

/** LumenFlow URI scheme for plan references */
const PLAN_URI_SCHEME = 'lumenflow://plans/';

/**
 * Custom option for plan file path
 */
const PLAN_OPTION = {
  name: 'plan',
  flags: '--plan <path>',
  description: 'Path to plan file (markdown)',
};

/**
 * Custom option for creating new plan template
 */
const CREATE_OPTION = {
  name: 'create',
  flags: '--create',
  description: 'Create a new plan template instead of linking existing file',
};

/**
 * Validate Initiative ID format
 * @param id - Initiative ID to validate
 * @throws Error if format is invalid
 */
export function validateInitIdFormat(id: string): void {
  if (!INIT_PATTERNS.INIT_ID.test(id)) {
    die(
      `Invalid Initiative ID format: "${id}"\n\n` +
        `Expected format: INIT-<number> or INIT-NAME (e.g., INIT-001, INIT-TOOLING)`,
    );
  }
}

/**
 * Validate plan file path
 * @param planPath - Path to plan file
 * @throws Error if path is invalid or file doesn't exist
 */
export function validatePlanPath(planPath: string): void {
  if (!planPath.endsWith('.md')) {
    die(`Invalid plan file format: "${planPath}"\n\nPlan files must be markdown (.md)`);
  }

  if (!existsSync(planPath)) {
    die(`Plan file not found: "${planPath}"\n\nUse --create to create a new plan template`);
  }
}

/**
 * Format plan path as lumenflow:// URI
 *
 * Extracts the filename (and any subdirectory within plans/) and creates
 * a standardized URI for the plan reference.
 *
 * @param planPath - Path to plan file (can be relative or absolute)
 * @returns lumenflow://plans/<filename> URI
 */
export function formatPlanUri(planPath: string): string {
  // Try to extract path relative to plans directory
  const plansMarker = '/plans/';
  const plansIndex = planPath.indexOf(plansMarker);

  if (plansIndex !== -1) {
    // Extract everything after /plans/
    const relativePath = planPath.substring(plansIndex + plansMarker.length);
    return `${PLAN_URI_SCHEME}${relativePath}`;
  }

  // Fallback: just use the filename
  const filename = basename(planPath);
  return `${PLAN_URI_SCHEME}${filename}`;
}

/**
 * Check if initiative exists and return the document
 * @param initId - Initiative ID to check
 * @returns Initiative document
 * @throws Error if initiative not found
 */
export function checkInitiativeExists(initId: string): ReturnType<typeof readInitiative> {
  const initPath = INIT_PATHS.INITIATIVE(initId);
  if (!existsSync(initPath)) {
    die(`Initiative not found: ${initId}\n\nFile does not exist: ${initPath}`);
  }
  return readInitiative(initPath, initId);
}

/**
 * Update initiative with plan reference in micro-worktree
 *
 * Uses raw YAML parsing to preserve unknown fields like related_plan
 * that are not in the strict initiative schema.
 *
 * @param worktreePath - Path to micro-worktree
 * @param initId - Initiative ID
 * @param planUri - Plan URI to set
 * @returns True if changes were made, false if already linked
 */
export function updateInitiativeWithPlan(
  worktreePath: string,
  initId: string,
  planUri: string,
): boolean {
  const initRelPath = INIT_PATHS.INITIATIVE(initId);
  const initAbsPath = join(worktreePath, initRelPath);

  // Read raw YAML to preserve unknown fields like related_plan
  // (readInitiative strips them via zod schema validation)
  const rawText = readFileSync(initAbsPath, { encoding: 'utf-8' });
  const doc = parseYAML(rawText) as Record<string, unknown>;

  // Validate ID matches
  if (doc.id !== initId) {
    die(`Initiative YAML id mismatch. Expected ${initId}, found ${doc.id}`);
  }

  // Check for existing plan link
  const existingPlan = doc.related_plan as string | undefined;

  if (existingPlan === planUri) {
    // Already linked to same plan - idempotent
    return false;
  }

  if (existingPlan && existingPlan !== planUri) {
    // Different plan already linked - warn but proceed
    console.warn(`${LOG_PREFIX} Replacing existing related_plan: ${existingPlan} -> ${planUri}`);
  }

  // Update related_plan field
  doc.related_plan = planUri;
  const out = stringifyYAML(doc);
  writeFileSync(initAbsPath, out, { encoding: 'utf-8' });

  console.log(`${LOG_PREFIX} Updated ${initId} with related_plan: ${planUri}`);
  return true;
}

/**
 * Create a plan template file
 *
 * @param worktreePath - Path to repo root or worktree
 * @param initId - Initiative ID
 * @param title - Initiative title
 * @returns Path to created file
 * @throws Error if file already exists
 */
export function createPlanTemplate(worktreePath: string, initId: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30);

  const filename = `${initId}-${slug}.md`;
  const plansDir = join(worktreePath, PLANS_DIR);
  const planPath = join(plansDir, filename);

  if (existsSync(planPath)) {
    die(`Plan file already exists: ${planPath}\n\nUse --plan to link an existing file`);
  }

  // Ensure plans directory exists
  if (!existsSync(plansDir)) {
    mkdirSync(plansDir, { recursive: true });
  }

  const template = `# ${initId} Plan - ${title}

## Goal

<!-- What is the primary objective of this initiative? -->

## Scope

<!-- What is in scope and out of scope? -->

## Approach

<!-- How will you achieve the goal? Key phases or milestones? -->

## Success Criteria

<!-- How will you know when this is complete? Measurable outcomes? -->

## Risks

<!-- What could go wrong? How will you mitigate? -->

## References

- Initiative: ${initId}
- Created: ${new Date().toISOString().split('T')[0]}
`;

  writeFileSync(planPath, template, { encoding: 'utf-8' });
  console.log(`${LOG_PREFIX} Created plan template: ${planPath}`);

  return planPath;
}

/**
 * Generate commit message for plan link operation
 */
export function getCommitMessage(initId: string, planUri: string): string {
  const filename = planUri.replace(PLAN_URI_SCHEME, '');
  return `docs: link plan ${filename} to ${initId.toLowerCase()}`;
}

async function main(): Promise<void> {
  const args = createWUParser({
    name: 'init-plan',
    description: 'Link a plan file to an initiative',
    options: [WU_OPTIONS.initiative, PLAN_OPTION, CREATE_OPTION],
    required: ['initiative'],
    allowPositionalId: false,
  });

  const initId = args.initiative as string;
  const planPath = args.plan as string | undefined;
  const shouldCreate = args.create as boolean | undefined;

  // Validate inputs
  validateInitIdFormat(initId);

  // Check initiative exists first (before any mutations)
  const initDoc = checkInitiativeExists(initId);
  const initTitle = (initDoc as Record<string, unknown>).title as string;

  // Determine plan path and URI
  let targetPlanPath: string;
  let planUri: string;

  if (shouldCreate) {
    // Create mode - will create template and link it
    console.log(`${LOG_PREFIX} Creating plan template for ${initId}...`);

    // Ensure on main for micro-worktree operations
    await ensureOnMain(getGitForCwd());

    try {
      await withMicroWorktree({
        operation: OPERATION_NAME,
        id: initId,
        logPrefix: LOG_PREFIX,
        pushOnly: true,
        execute: async ({ worktreePath }) => {
          // Create plan template
          targetPlanPath = createPlanTemplate(worktreePath, initId, initTitle);
          planUri = formatPlanUri(targetPlanPath);

          // Update initiative with plan link
          updateInitiativeWithPlan(worktreePath, initId, planUri);

          // Return files to commit
          const planRelPath = targetPlanPath.replace(worktreePath + '/', '');
          return {
            commitMessage: getCommitMessage(initId, planUri),
            files: [planRelPath, INIT_PATHS.INITIATIVE(initId)],
          };
        },
      });

      console.log(`\n${LOG_PREFIX} Transaction complete!`);
      console.log(`\nPlan Linked:`);
      console.log(`  Initiative: ${initId}`);
      console.log(`  Plan URI:   ${planUri!}`);
      console.log(`  File:       ${targetPlanPath!}`);
      console.log(`\nNext steps:`);
      console.log(`  1. Edit the plan file with your goals and approach`);
      console.log(`  2. View initiative: pnpm initiative:status ${initId}`);
    } catch (error) {
      die(
        `Transaction failed: ${(error as Error).message}\n\n` +
          `Micro-worktree cleanup was attempted automatically.\n` +
          `If issue persists, check for orphaned branches: git branch | grep tmp/${OPERATION_NAME}`,
      );
    }
  } else if (planPath) {
    // Link existing file mode
    validatePlanPath(planPath);
    planUri = formatPlanUri(planPath);

    console.log(`${LOG_PREFIX} Linking plan to ${initId}...`);

    // Check for idempotent case before micro-worktree
    const existingPlan = (initDoc as Record<string, unknown>).related_plan as string | undefined;
    if (existingPlan === planUri) {
      console.log(`${LOG_PREFIX} Plan already linked (idempotent - no changes needed)`);
      console.log(`\n${LOG_PREFIX} ${initId} already has related_plan: ${planUri}`);
      return;
    }

    // Ensure on main for micro-worktree operations
    await ensureOnMain(getGitForCwd());

    try {
      await withMicroWorktree({
        operation: OPERATION_NAME,
        id: initId,
        logPrefix: LOG_PREFIX,
        pushOnly: true,
        execute: async ({ worktreePath }) => {
          // Update initiative with plan link
          const changed = updateInitiativeWithPlan(worktreePath, initId, planUri);

          if (!changed) {
            console.log(`${LOG_PREFIX} No changes detected (concurrent link operation)`);
          }

          return {
            commitMessage: getCommitMessage(initId, planUri),
            files: [INIT_PATHS.INITIATIVE(initId)],
          };
        },
      });

      console.log(`\n${LOG_PREFIX} Transaction complete!`);
      console.log(`\nPlan Linked:`);
      console.log(`  Initiative: ${initId}`);
      console.log(`  Plan URI:   ${planUri}`);
      console.log(`  File:       ${planPath}`);
      console.log(`\nNext steps:`);
      console.log(`  - View initiative: pnpm initiative:status ${initId}`);
    } catch (error) {
      die(
        `Transaction failed: ${(error as Error).message}\n\n` +
          `Micro-worktree cleanup was attempted automatically.\n` +
          `If issue persists, check for orphaned branches: git branch | grep tmp/${OPERATION_NAME}`,
      );
    }
  } else {
    die(
      'Either --plan or --create is required\n\n' +
        'Usage:\n' +
        '  pnpm init:plan --initiative INIT-001 --plan docs/04-operations/plans/my-plan.md\n' +
        '  pnpm init:plan --initiative INIT-001 --create',
    );
  }
}

// Guard main() for testability - use import.meta.main (WU-1071)
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}

// Export for testing
export { main };

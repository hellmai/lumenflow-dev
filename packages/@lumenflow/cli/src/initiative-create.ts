#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Initiative Create Helper (WU-1247, WU-1439)
 *
 * Race-safe Initiative creation using micro-worktree isolation.
 *
 * Canonical sequence:
 * 1) Validate inputs (id, slug, title)
 * 2) Use micro-worktree to atomically:
 *    a) Create temp branch without switching main checkout
 *    b) Create INIT-{id}.yaml in micro-worktree
 *    c) Commit with "docs: create init-{id} for <title>" message
 *    d) Merge to main with ff-only (retry with rebase if needed)
 *    e) Push to origin/main
 *    f) Cleanup temp branch and micro-worktree
 *
 * Benefits:
 * - Main checkout never modified (no impact on other agents)
 * - Race conditions handled via rebase+retry (up to 3 attempts)
 * - Cleanup guaranteed even on failure
 *
 * Usage:
 *   pnpm initiative:create --id INIT-001 --slug shock-protocol --title "Shock Protocol Implementation"
 *
 * Context: WU-1247 (original implementation), WU-1439 (micro-worktree migration)
 */

import { die } from '@lumenflow/core/error-handler';
import { existsSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stringifyYAML } from '@lumenflow/core/wu-yaml';
import { createWUParser, WU_OPTIONS, INITIATIVE_CREATE_OPTIONS } from '@lumenflow/core/arg-parser';
import { INIT_PATHS } from '@lumenflow/initiatives/paths';
import {
  INIT_PATTERNS,
  INIT_COMMIT_FORMATS,
  INIT_DEFAULTS,
} from '@lumenflow/initiatives/constants';
// WU-1211: Import initiative validation for completeness warnings
import { validateInitiativeCompleteness } from '@lumenflow/initiatives/initiative-validation';
import { ENV_VARS, FILE_SYSTEM } from '@lumenflow/core/wu-constants';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
// WU-1428: Use date-utils for consistent YYYY-MM-DD format (library-first)
import { todayISO } from '@lumenflow/core/date-utils';
import {
  buildInitiativeCreateLaneLifecycleMessage,
  ensureLaneLifecycleForProject,
  type LaneLifecycleClassification,
  LANE_LIFECYCLE_STATUS,
} from './lane-lifecycle-process.js';

/** Log prefix for console output */
const LOG_PREFIX = '[initiative:create]';

/** Micro-worktree operation name */
const OPERATION_NAME = 'initiative-create';

/** Initiative ID prefix */
const INIT_ID_PREFIX = 'INIT-';

/** Pattern to extract numeric part from INIT-NNN.yaml filenames */
const INIT_FILENAME_PATTERN = /^INIT-(\d+)\.yaml$/;

/**
 * Get the next sequential Initiative ID by scanning an initiatives directory.
 *
 * WU-2242: Enables auto-generation of INIT-XXX IDs when --id is omitted.
 * Scans the given directory for INIT-NNN.yaml files and returns INIT-(highest+1).
 * Returns INIT-1 when no initiatives exist or the directory does not exist.
 *
 * @param {string} initiativesDir - Path to the initiatives directory to scan
 * @returns {string} Next sequential Initiative ID (e.g., 'INIT-6')
 */
export function getNextInitiativeId(initiativesDir: string): string {
  if (!existsSync(initiativesDir)) {
    return `${INIT_ID_PREFIX}1`;
  }

  const files = readdirSync(initiativesDir);
  let highest = 0;

  for (const file of files) {
    const match = INIT_FILENAME_PATTERN.exec(file);
    if (match?.[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > highest) {
        highest = num;
      }
    }
  }

  return `${INIT_ID_PREFIX}${highest + 1}`;
}

/**
 * Validate Initiative ID format
 * @param {string} id - Initiative ID to validate
 */
function validateInitIdFormat(id: string) {
  if (!INIT_PATTERNS.INIT_ID.test(id)) {
    die(`Invalid Initiative ID format: "${id}"\n\nExpected format: INIT-<number> (e.g., INIT-001)`);
  }
}

/**
 * Validate slug format (kebab-case)
 * @param {string} slug - Slug to validate
 */
function validateSlugFormat(slug: string) {
  if (!INIT_PATTERNS.SLUG.test(slug)) {
    die(
      `Invalid slug format: "${slug}"\n\n` +
        `Slugs must be kebab-case (lowercase letters, numbers, hyphens only)\n` +
        `Examples: shock-protocol, lumenflow-saas-v2`,
    );
  }
}

/**
 * Check if Initiative already exists
 * @param {string} id - Initiative ID to check
 */
function checkInitiativeExists(id: string) {
  const initPath = INIT_PATHS.INITIATIVE(id);
  if (existsSync(initPath)) {
    die(`Initiative already exists: ${initPath}\n\nChoose a different Initiative ID`);
  }
}

/**
 * Create Initiative YAML file in micro-worktree
 *
 * @param {string} worktreePath - Path to micro-worktree
 * @param {string} id - Initiative ID
 * @param {string} slug - Initiative slug
 * @param {string} title - Initiative title
 * @param {Object} options - Optional fields (priority, owner, targetDate)
 * @returns {string} Relative path to created YAML file
 */
interface CreateInitiativeOptions {
  priority?: string;
  owner?: string;
  targetDate?: string;
  initDescription?: string;
  initPhase?: string[];
  successMetric?: string[];
}

function createInitiativeYamlInWorktree(
  worktreePath: string,
  id: string,
  slug: string,
  title: string,
  options: CreateInitiativeOptions = {},
) {
  const initRelativePath = INIT_PATHS.INITIATIVE(id);
  const initAbsolutePath = join(worktreePath, initRelativePath);
  const initDir = join(worktreePath, INIT_PATHS.INITIATIVES_DIR());

  // Ensure directory exists
  if (!existsSync(initDir)) {
    mkdirSync(initDir, { recursive: true });
  }

  // WU-1428: Use todayISO() for consistent YYYY-MM-DD format (library-first)
  const today = todayISO();

  // WU-1755: Populate description, phases, and success_metrics from CLI flags
  const phases = options.initPhase
    ? (options.initPhase as string[]).map((phaseTitle: string, idx: number) => ({
        id: idx + 1,
        title: phaseTitle,
        status: 'pending',
      }))
    : [];

  const successMetrics = options.successMetric ? (options.successMetric as string[]) : [];

  const initContent = {
    id,
    slug,
    title,
    description: options.initDescription || '',
    status: INIT_DEFAULTS.STATUS,
    priority: options.priority || INIT_DEFAULTS.PRIORITY,
    ...(options.owner && { owner: options.owner }),
    created: today,
    ...(options.targetDate && { target_date: options.targetDate }),
    phases,
    success_metrics: successMetrics,
    labels: [],
  };

  const yamlContent = stringifyYAML(initContent);

  writeFileSync(initAbsolutePath, yamlContent, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  console.log(`${LOG_PREFIX} ✅ Created ${id}.yaml in micro-worktree`);

  return initRelativePath;
}

/**
 * Resolve lane lifecycle classification for initiative:create without mutating
 * workspace.yaml.
 *
 * WU-1751: initiative:create guidance should be read-only.
 */
export function resolveLaneLifecycleForInitiativeCreate(
  projectRoot: string,
): LaneLifecycleClassification {
  return ensureLaneLifecycleForProject(projectRoot, { persist: false });
}

export async function main() {
  const args = createWUParser({
    name: 'initiative-create',
    description: 'Create a new Initiative with micro-worktree isolation (race-safe)',
    options: [
      WU_OPTIONS.id,
      WU_OPTIONS.slug,
      WU_OPTIONS.title,
      WU_OPTIONS.priority,
      WU_OPTIONS.owner,
      WU_OPTIONS.targetDate,
      INITIATIVE_CREATE_OPTIONS.initDescription,
      INITIATIVE_CREATE_OPTIONS.initPhase,
      INITIATIVE_CREATE_OPTIONS.successMetric,
    ],
    required: ['slug', 'title'],
    allowPositionalId: false,
  });

  // WU-2242: Auto-generate Initiative ID when --id is not provided
  let initId: string;
  if (args.id) {
    initId = args.id;
  } else {
    const initiativesDir = INIT_PATHS.INITIATIVES_DIR();
    initId = getNextInitiativeId(initiativesDir);
    console.log(`${LOG_PREFIX} Auto-generated Initiative ID: ${initId}`);
  }

  console.log(`${LOG_PREFIX} Creating Initiative ${initId} (${args.slug})...`);

  // Pre-flight checks (validation only - no main modification)
  validateInitIdFormat(initId);
  validateSlugFormat(args.slug);
  checkInitiativeExists(initId);
  // WU-2244: Removed ensureOnMain() check - micro-worktree isolation
  // handles branch safety, so initiative:create works from any branch.

  // WU-1748: initiative:create does not design lanes.
  // It remains allowed pre-lane-lock but emits deterministic guidance.
  const laneLifecycle = resolveLaneLifecycleForInitiativeCreate(process.cwd());
  if (laneLifecycle.status !== LANE_LIFECYCLE_STATUS.LOCKED) {
    console.log(`\n${buildInitiativeCreateLaneLifecycleMessage(laneLifecycle.status)}\n`);
  }

  // Transaction: micro-worktree isolation (WU-1439)
  // WU-1255: Set LUMENFLOW_WU_TOOL to allow pre-push hook bypass for micro-worktree pushes
  const previousWuTool = process.env[ENV_VARS.WU_TOOL];
  process.env[ENV_VARS.WU_TOOL] = OPERATION_NAME;
  try {
    try {
      await withMicroWorktree({
        operation: OPERATION_NAME,
        id: initId,
        logPrefix: LOG_PREFIX,
        execute: async ({ worktreePath }) => {
          // Create Initiative YAML in micro-worktree
          const initPath = createInitiativeYamlInWorktree(
            worktreePath,
            initId,
            args.slug,
            args.title,
            {
              priority: args.priority,
              owner: args.owner,
              targetDate: args.targetDate,
              initDescription: args.initDescription,
              initPhase: args.initPhase,
              successMetric: args.successMetric,
            },
          );

          // Return commit message and files to commit
          return {
            commitMessage: INIT_COMMIT_FORMATS.CREATE(initId, args.title),
            files: [initPath],
          };
        },
      });

      console.log(`\n${LOG_PREFIX} ✅ Transaction complete!`);
      console.log(`\nInitiative Created:`);
      console.log(`  ID:     ${initId}`);
      console.log(`  Slug:   ${args.slug}`);
      console.log(`  Title:  ${args.title}`);
      console.log(`  Status: ${INIT_DEFAULTS.STATUS}`);
      console.log(`  File:   ${INIT_PATHS.INITIATIVE(initId)}`);

      // WU-1211: Check completeness and emit warnings
      // WU-2243: Use actual flag values (not hardcoded empty arrays) so
      // completeness validation reflects what was written to the YAML.
      const completenessPhases = args.initPhase
        ? (args.initPhase as string[]).map((phaseTitle: string, idx: number) => ({
            id: idx + 1,
            title: phaseTitle,
            status: 'pending',
          }))
        : [];
      const completenessMetrics = args.successMetric ? (args.successMetric as string[]) : [];
      const initContent = {
        id: initId,
        slug: args.slug,
        title: args.title,
        description: args.initDescription || '',
        status: INIT_DEFAULTS.STATUS,
        phases: completenessPhases,
        success_metrics: completenessMetrics,
      };
      const completenessResult = validateInitiativeCompleteness(initContent);
      if (completenessResult.warnings.length > 0) {
        console.log(`\n${LOG_PREFIX} ⚠️  Incomplete initiative - missing recommended fields:`);
        for (const warning of completenessResult.warnings) {
          console.log(`  - ${warning}`);
        }
      }

      console.log(`\nNext steps:`);
      console.log(`  1. Edit ${initId}.yaml to add description, phases, and success_metrics`);
      console.log(`  2. Link WUs to this initiative: pnpm wu:create --initiative ${initId} ...`);
      console.log(`  3. View status: pnpm initiative:status ${initId}`);
    } catch (error) {
      die(
        `Transaction failed: ${error.message}\n\n` +
          `Micro-worktree cleanup was attempted automatically.\n` +
          `If issue persists, check for orphaned branches: git branch | grep tmp/${OPERATION_NAME}`,
      );
    }
  } finally {
    // WU-1255: Restore LUMENFLOW_WU_TOOL to previous value
    if (previousWuTool === undefined) {
      delete process.env[ENV_VARS.WU_TOOL];
    } else {
      process.env[ENV_VARS.WU_TOOL] = previousWuTool;
    }
  }
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}

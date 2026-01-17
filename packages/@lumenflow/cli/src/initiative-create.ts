#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Initiative Create Helper (WU-1247, WU-1439)
 *
 * Race-safe Initiative creation using micro-worktree isolation.
 *
 * Canonical sequence:
 * 1) Validate inputs (id, slug, title)
 * 2) Ensure on main branch
 * 3) Use micro-worktree to atomically:
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

import { getGitForCwd } from '@lumenflow/core/dist/git-adapter.js';
import { die } from '@lumenflow/core/dist/error-handler.js';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/dist/arg-parser.js';
import { INIT_PATHS } from '@lumenflow/initiatives/dist/initiative-paths.js';
import { INIT_PATTERNS, INIT_COMMIT_FORMATS, INIT_DEFAULTS } from '@lumenflow/initiatives/dist/initiative-constants.js';
import { FILE_SYSTEM, YAML_OPTIONS } from '@lumenflow/core/dist/wu-constants.js';
import { ensureOnMain } from '@lumenflow/core/dist/wu-helpers.js';
import { withMicroWorktree } from '@lumenflow/core/dist/micro-worktree.js';
// WU-1428: Use date-utils for consistent YYYY-MM-DD format (library-first)
import { todayISO } from '@lumenflow/core/dist/date-utils.js';

/** Log prefix for console output */
const LOG_PREFIX = '[initiative:create]';

/** Micro-worktree operation name */
const OPERATION_NAME = 'initiative-create';

/**
 * Validate Initiative ID format
 * @param {string} id - Initiative ID to validate
 */
function validateInitIdFormat(id) {
  if (!INIT_PATTERNS.INIT_ID.test(id)) {
    die(`Invalid Initiative ID format: "${id}"\n\nExpected format: INIT-<number> (e.g., INIT-001)`);
  }
}

/**
 * Validate slug format (kebab-case)
 * @param {string} slug - Slug to validate
 */
function validateSlugFormat(slug) {
  if (!INIT_PATTERNS.SLUG.test(slug)) {
    die(
      `Invalid slug format: "${slug}"\n\n` +
        `Slugs must be kebab-case (lowercase letters, numbers, hyphens only)\n` +
        `Examples: shock-protocol, lumenflow-saas-v2`
    );
  }
}

/**
 * Check if Initiative already exists
 * @param {string} id - Initiative ID to check
 */
function checkInitiativeExists(id) {
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
}

function createInitiativeYamlInWorktree(worktreePath: string, id: string, slug: string, title: string, options: CreateInitiativeOptions = {}) {
  const initRelativePath = INIT_PATHS.INITIATIVE(id);
  const initAbsolutePath = join(worktreePath, initRelativePath);
  const initDir = join(worktreePath, INIT_PATHS.INITIATIVES_DIR());

  // Ensure directory exists
  if (!existsSync(initDir)) {
    mkdirSync(initDir, { recursive: true });
  }

  // WU-1428: Use todayISO() for consistent YYYY-MM-DD format (library-first)
  const today = todayISO();

  const initContent = {
    id,
    slug,
    title,
    description: '',
    status: INIT_DEFAULTS.STATUS,
    priority: options.priority || INIT_DEFAULTS.PRIORITY,
    ...(options.owner && { owner: options.owner }),
    created: today,
    ...(options.targetDate && { target_date: options.targetDate }),
    phases: [],
    success_metrics: [],
    labels: [],
  };

  const yamlContent = yaml.dump(initContent, {
    lineWidth: YAML_OPTIONS.LINE_WIDTH,
    quotingType: '"',
    forceQuotes: false,
  });

  writeFileSync(initAbsolutePath, yamlContent, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  console.log(`${LOG_PREFIX} ✅ Created ${id}.yaml in micro-worktree`);

  return initRelativePath;
}

async function main() {
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
    ],
    required: ['id', 'slug', 'title'],
    allowPositionalId: false,
  });

  console.log(`${LOG_PREFIX} Creating Initiative ${args.id} (${args.slug})...`);

  // Pre-flight checks (validation only - no main modification)
  validateInitIdFormat(args.id);
  validateSlugFormat(args.slug);
  checkInitiativeExists(args.id);
  await ensureOnMain(getGitForCwd());

  // Transaction: micro-worktree isolation (WU-1439)
  try {
    await withMicroWorktree({
      operation: OPERATION_NAME,
      id: args.id,
      logPrefix: LOG_PREFIX,
      execute: async ({ worktreePath }) => {
        // Create Initiative YAML in micro-worktree
        const initPath = createInitiativeYamlInWorktree(
          worktreePath,
          args.id,
          args.slug,
          args.title,
          {
            priority: args.priority,
            owner: args.owner,
            targetDate: args.targetDate,
          }
        );

        // Return commit message and files to commit
        return {
          commitMessage: INIT_COMMIT_FORMATS.CREATE(args.id, args.title),
          files: [initPath],
        };
      },
    });

    console.log(`\n${LOG_PREFIX} ✅ Transaction complete!`);
    console.log(`\nInitiative Created:`);
    console.log(`  ID:     ${args.id}`);
    console.log(`  Slug:   ${args.slug}`);
    console.log(`  Title:  ${args.title}`);
    console.log(`  Status: ${INIT_DEFAULTS.STATUS}`);
    console.log(`  File:   ${INIT_PATHS.INITIATIVE(args.id)}`);
    console.log(`\nNext steps:`);
    console.log(`  1. Edit ${args.id}.yaml to add description, phases, and success_metrics`);
    console.log(`  2. Link WUs to this initiative: pnpm wu:create --initiative ${args.id} ...`);
    console.log(`  3. View status: pnpm initiative:status ${args.id}`);
  } catch (error) {
    die(
      `Transaction failed: ${error.message}\n\n` +
        `Micro-worktree cleanup was attempted automatically.\n` +
        `If issue persists, check for orphaned branches: git branch | grep tmp/${OPERATION_NAME}`
    );
  }
}

// Guard main() for testability
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

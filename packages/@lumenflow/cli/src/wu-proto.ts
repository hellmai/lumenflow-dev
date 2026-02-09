#!/usr/bin/env node

/**
 * WU Proto Helper (WU-1359)
 *
 * Convenience command for rapid prototyping that creates a WU with
 * type: prototype and relaxed validation, then immediately claims it.
 *
 * Key differences from wu:create:
 * - type: prototype (not feature)
 * - No --acceptance required
 * - No --exposure required
 * - No --code-paths required
 * - No --test-paths required
 * - No --spec-refs required
 * - Automatically claims the WU after creation
 * - Prints cd command to worktree
 *
 * Usage:
 *   pnpm wu:proto --lane "Framework: CLI" --title "Quick experiment"
 *
 * Context: WU-1359 (enhance init output and add wu:proto command)
 */

import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { die } from '@lumenflow/core/error-handler';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { stringifyYAML } from '@lumenflow/core/wu-yaml';
import { todayISO } from '@lumenflow/core/date-utils';
import { validateLaneFormat } from '@lumenflow/core/lane-checker';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { validateWU } from '@lumenflow/core/wu-schema';
import { COMMIT_FORMATS, FILE_SYSTEM, STRING_LITERALS } from '@lumenflow/core/wu-constants';
import { ensureOnMain } from '@lumenflow/core/wu-helpers';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { generateWuIdWithRetry } from '@lumenflow/core/wu-id-generator';
import { parseBacklogFrontmatter } from '@lumenflow/core/backlog-parser';
import { execFileSync } from 'node:child_process';
import { validateWuProtoCliArgs } from './shared-validators.js';

/** Log prefix for console output */
const LOG_PREFIX = '[wu:proto]';

/** Micro-worktree operation name */
const OPERATION_NAME = 'wu-proto';

/** Default priority for prototype WUs */
const DEFAULT_PRIORITY = 'P3';

/** Prototype WU type */
const PROTOTYPE_TYPE = 'prototype';

/** Options for creating prototype WU */
interface ProtoWUOptions {
  description?: string;
  codePaths?: string[];
  labels?: string[];
  assignedTo?: string;
}

/**
 * Validate prototype WU spec (relaxed validation)
 *
 * Unlike wu:create, this has minimal requirements:
 * - lane is required
 * - title is required
 * - Everything else is optional
 *
 * @param params - Validation parameters
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateProtoSpec({
  id: _id,
  lane,
  title,
  opts: _opts = {},
}: {
  id: string;
  lane: string;
  title: string;
  opts?: ProtoWUOptions;
}): { valid: boolean; errors: string[] } {
  const validation = validateWuProtoCliArgs({
    lane,
    title,
    description: _opts.description,
    codePaths: _opts.codePaths,
    labels: _opts.labels,
    assignedTo: _opts.assignedTo,
  });

  return {
    valid: validation.valid,
    errors: validation.errors,
  };
}

/**
 * Build prototype WU content
 * @returns WU content object for YAML serialization
 */
function buildProtoWUContent({
  id,
  lane,
  title,
  priority,
  created,
  opts,
}: {
  id: string;
  lane: string;
  title: string;
  priority: string;
  created: string;
  opts: ProtoWUOptions;
}): Record<string, unknown> {
  const { description, codePaths, labels, assignedTo } = opts;

  return {
    id,
    title,
    lane,
    type: PROTOTYPE_TYPE,
    status: 'ready',
    priority,
    created,
    description: description || '',
    // Prototype WUs have minimal default acceptance
    acceptance: ['Prototype demonstrates concept'],
    code_paths: codePaths ?? [],
    tests: {
      manual: [],
      unit: [],
      e2e: [],
    },
    artifacts: [WU_PATHS.STAMP(id)],
    dependencies: [],
    risks: [],
    notes: 'Prototype WU - relaxed validation applies',
    requires_review: false,
    ...(labels?.length && { labels }),
    ...(assignedTo && { assigned_to: assignedTo }),
    // WU-1359: Prototype WUs set exposure to backend-only by default
    exposure: 'backend-only',
  };
}

/**
 * Create prototype WU YAML in micro-worktree
 * @returns Relative path to created WU YAML file
 */
function createProtoWUYamlInWorktree(
  worktreePath: string,
  id: string,
  lane: string,
  title: string,
  priority: string,
  opts: ProtoWUOptions,
): string {
  const wuRelativePath = WU_PATHS.WU(id);
  const wuAbsolutePath = join(worktreePath, wuRelativePath);
  const wuDir = join(worktreePath, WU_PATHS.WU_DIR());

  if (!existsSync(wuDir)) {
    mkdirSync(wuDir, { recursive: true });
  }

  const today = todayISO();

  const wuContent = buildProtoWUContent({
    id,
    lane,
    title,
    priority,
    created: today,
    opts,
  });

  // Validate WU structure before writing
  const validationResult = validateWU(wuContent);
  if (!validationResult.success) {
    const errors = validationResult.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join(STRING_LITERALS.NEWLINE);
    die(`${LOG_PREFIX} WU validation failed:\n\n${errors}`);
  }

  const yamlContent = stringifyYAML(validationResult.data, { lineWidth: -1 });
  writeFileSync(wuAbsolutePath, yamlContent, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  console.log(`${LOG_PREFIX} Created ${id}.yaml in micro-worktree`);

  return wuRelativePath;
}

/**
 * Update backlog.md in micro-worktree
 * @returns Relative path to updated backlog file
 */
function updateBacklogInWorktree(
  worktreePath: string,
  id: string,
  lane: string,
  title: string,
): string {
  const backlogRelativePath = WU_PATHS.BACKLOG();
  const backlogAbsolutePath = join(worktreePath, backlogRelativePath);

  if (!existsSync(backlogAbsolutePath)) {
    die(`Backlog not found: ${backlogAbsolutePath}`);
  }

  const { frontmatter, markdown } = parseBacklogFrontmatter(backlogAbsolutePath);

  if (!frontmatter?.sections?.ready?.heading) {
    die('Invalid backlog frontmatter: Missing sections.ready.heading');
  }

  const readyHeading = frontmatter.sections.ready.heading;
  const lines = markdown.split(STRING_LITERALS.NEWLINE);
  const headingIndex = lines.findIndex((line) => line === readyHeading);

  if (headingIndex === -1) {
    die(`Could not find Ready section heading: '${readyHeading}'`);
  }

  const insertionIndex = headingIndex + 2;
  const newEntry = `- [${id} - ${title}](wu/${id}.yaml) - ${lane}`;
  lines.splice(insertionIndex, 0, newEntry);

  const updatedMarkdown = lines.join(STRING_LITERALS.NEWLINE);
  const updatedBacklog = `---\n${stringifyYAML(frontmatter, { lineWidth: -1 })}---\n${updatedMarkdown}`;

  writeFileSync(backlogAbsolutePath, updatedBacklog, {
    encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
  });
  console.log(`${LOG_PREFIX} Updated backlog.md in micro-worktree`);

  return backlogRelativePath;
}

/**
 * Get default assigned_to value from git config user.email
 */
async function getDefaultAssignedTo(): Promise<string> {
  try {
    const email = await getGitForCwd().getConfigValue('user.email');
    return email || '';
  } catch {
    return '';
  }
}

/** Regex to extract worktree path from wu:claim output */
const WORKTREE_PATH_REGEX = /Worktree:\s*(\S+)/;

/**
 * Claim the WU after creation using execFileSync (safe from shell injection)
 * @returns Path to the created worktree
 */
function claimWU(wuId: string, lane: string): string {
  console.log(`${LOG_PREFIX} Claiming WU ${wuId}...`);

  try {
    // Use execFileSync for safety (no shell injection risk)
    // Use process.execPath to get absolute path to node, then run pnpm via npx
    const result = execFileSync(
      process.execPath,
      [
        '--no-warnings',
        '--experimental-import-meta-resolve',
        ...process.execArgv.filter((a) => !a.startsWith('--inspect')),
        require.resolve('.bin/wu-claim'),
        '--id',
        wuId,
        '--lane',
        lane,
      ],
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd(),
      },
    );

    // Extract worktree path from output using regex exec (sonarjs/prefer-regexp-exec)
    const worktreeMatch = WORKTREE_PATH_REGEX.exec(result);
    if (worktreeMatch) {
      return worktreeMatch[1];
    }

    // Fallback: construct expected worktree path
    const laneSuffix = lane.toLowerCase().replace(/[:\s]+/g, '-');
    return `worktrees/${laneSuffix}-${wuId.toLowerCase()}`;
  } catch (error) {
    die(`Failed to claim WU: ${(error as Error).message}`);
  }
}

async function main(): Promise<void> {
  const args = createWUParser({
    name: 'wu-proto',
    description: 'Create and claim a prototype WU with relaxed validation (rapid prototyping)',
    options: [
      WU_OPTIONS.lane,
      WU_OPTIONS.title,
      WU_OPTIONS.description,
      WU_OPTIONS.codePaths,
      WU_OPTIONS.labels,
      WU_OPTIONS.assignedTo,
    ],
    required: ['lane', 'title'],
    allowPositionalId: false,
  });

  console.log(`${LOG_PREFIX} Creating prototype WU in ${args.lane} lane...`);

  // Validate lane format
  try {
    validateLaneFormat(args.lane);
  } catch (error) {
    die(`Invalid lane format: ${error.message}`);
  }

  await ensureOnMain(getGitForCwd());

  // Auto-generate WU ID
  console.log(`${LOG_PREFIX} Auto-generating WU ID...`);
  let wuId: string;
  try {
    wuId = await generateWuIdWithRetry();
    console.log(`${LOG_PREFIX} Generated WU ID: ${wuId}`);
  } catch (error) {
    die(`Failed to auto-generate WU ID: ${error.message}`);
  }

  // Check if WU already exists
  const wuPath = WU_PATHS.WU(wuId);
  if (existsSync(wuPath)) {
    die(`WU already exists: ${wuPath}`);
  }

  // Get assigned_to from flag or git config
  const assignedTo = args.assignedTo || (await getDefaultAssignedTo());

  // Validate proto spec
  const validation = validateProtoSpec({
    id: wuId,
    lane: args.lane,
    title: args.title,
    opts: {
      description: args.description,
      codePaths: args.codePaths,
      labels: args.labels,
      assignedTo,
    },
  });

  if (!validation.valid) {
    const errorList = validation.errors.map((e) => `  - ${e}`).join(STRING_LITERALS.NEWLINE);
    die(`${LOG_PREFIX} Validation failed:\n\n${errorList}`);
  }

  // WU-1255: Set LUMENFLOW_WU_TOOL to allow pre-push hook bypass
  const previousWuTool = process.env.LUMENFLOW_WU_TOOL;
  process.env.LUMENFLOW_WU_TOOL = OPERATION_NAME;

  try {
    await withMicroWorktree({
      operation: OPERATION_NAME,
      id: wuId,
      logPrefix: LOG_PREFIX,
      execute: async ({ worktreePath }) => {
        // Create WU YAML
        const wuRelativePath = createProtoWUYamlInWorktree(
          worktreePath,
          wuId,
          args.lane,
          args.title,
          DEFAULT_PRIORITY,
          {
            description: args.description,
            codePaths: args.codePaths,
            labels: args.labels,
            assignedTo,
          },
        );

        // Update backlog
        const backlogPath = updateBacklogInWorktree(worktreePath, wuId, args.lane, args.title);

        return {
          commitMessage: COMMIT_FORMATS.CREATE(wuId, args.title),
          files: [wuRelativePath, backlogPath],
        };
      },
    });

    console.log(`\n${LOG_PREFIX} WU created!`);
    console.log(`  ID:     ${wuId}`);
    console.log(`  Title:  ${args.title}`);
    console.log(`  Lane:   ${args.lane}`);
    console.log(`  Type:   ${PROTOTYPE_TYPE}`);
    console.log(`  File:   ${WU_PATHS.WU(wuId)}`);

    // Immediately claim the WU
    const worktreePath = claimWU(wuId, args.lane);

    console.log(`\n${LOG_PREFIX} WU claimed and worktree created!`);
    console.log(`\nNext step:`);
    console.log(`  cd ${worktreePath}`);
  } catch (error) {
    die(`Transaction failed: ${error.message}`);
  } finally {
    // Restore LUMENFLOW_WU_TOOL
    if (previousWuTool === undefined) {
      delete process.env.LUMENFLOW_WU_TOOL;
    } else {
      process.env.LUMENFLOW_WU_TOOL = previousWuTool;
    }
  }
}

// Run CLI
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}

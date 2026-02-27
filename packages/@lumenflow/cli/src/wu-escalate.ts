#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WU Escalation Helper (WU-2225)
 *
 * Provides a CLI path to resolve human escalation triggers on WU specs.
 * Without --resolve: shows current escalation status.
 * With --resolve: sets escalation_resolved_by and escalation_resolved_at
 * via micro-worktree isolation (same pattern as wu-edit).
 *
 * Usage:
 *   pnpm wu:escalate --id WU-14                          # Show escalation status
 *   pnpm wu:escalate --resolve --id WU-14                # Resolve using git user.email
 *   pnpm wu:escalate --resolve --id WU-14 --resolver x@y # Override resolver email
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { getGitForCwd, createGitForPath } from '@lumenflow/core/git-adapter';
import { die } from '@lumenflow/core/error-handler';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { WU_PATHS, defaultWorktreeFrom } from '@lumenflow/core/wu-paths';
import { parseYAML, stringifyYAML } from '@lumenflow/core/wu-yaml';
import { validateWUIDFormat, ensureOnMain } from '@lumenflow/core/wu-helpers';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import {
  FILE_SYSTEM,
  ENV_VARS,
  MICRO_WORKTREE_OPERATIONS,
  LOG_PREFIX,
  COMMIT_FORMATS,
  getLaneBranch,
} from '@lumenflow/core/wu-constants';
// WU-2227: Import worktree detection and validation helpers
import { detectCurrentWorktree } from '@lumenflow/core/wu-done-validators';
import {
  validateWorktreeExists,
  validateWorktreeClean,
  validateWorktreeBranch,
} from './wu-edit-validators.js';
import { runCLI } from './cli-entry-point.js';

const PREFIX = LOG_PREFIX.ESCALATE ?? '[wu:escalate]';
const OPERATION_NAME = MICRO_WORKTREE_OPERATIONS.WU_ESCALATE ?? 'wu-escalate';

interface WuEscalateArgs {
  id: string;
  resolve?: boolean;
  resolver?: string;
}

/**
 * Custom options for wu-escalate
 */
const ESCALATE_OPTIONS = {
  resolve: {
    name: 'resolve',
    flags: '--resolve',
    description: 'Resolve the escalation (set resolved_by and resolved_at)',
  },
  resolver: {
    name: 'resolver',
    flags: '--resolver <email>',
    description: 'Override resolver email (defaults to git user.email)',
  },
};

/**
 * Parse command line arguments
 */
function parseArgs(): WuEscalateArgs {
  return createWUParser({
    name: 'wu-escalate',
    description: 'Show or resolve WU escalation status',
    options: [WU_OPTIONS.id, ESCALATE_OPTIONS.resolve, ESCALATE_OPTIONS.resolver],
    required: ['id'],
    allowPositionalId: true,
  }) as WuEscalateArgs;
}

/**
 * Load WU YAML from a given root directory
 */
function loadWU(id: string, rootDir?: string): { wu: Record<string, unknown>; wuPath: string } {
  const relPath = WU_PATHS.WU(id);
  const wuPath = rootDir ? join(rootDir, relPath) : relPath;

  if (!existsSync(wuPath)) {
    die(`WU ${id} not found at ${wuPath}\n\nEnsure the WU exists and you're in the repo root.`);
  }

  const content = readFileSync(wuPath, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });
  const wu = parseYAML(content) as Record<string, unknown>;
  return { wu, wuPath };
}

/**
 * Show the current escalation status for a WU.
 * Exported for testing.
 */
export function showEscalationStatus(wu: Record<string, unknown>): void {
  const id = wu.id as string;
  const triggers = (wu.escalation_triggers as string[]) || [];
  const requiresEscalation = wu.requires_human_escalation || triggers.length > 0;

  console.log(`\nEscalation Status for ${id}`);
  console.log('='.repeat(40));

  if (!requiresEscalation || triggers.length === 0) {
    console.log('No escalation triggers detected.');
    console.log('This WU does not require human escalation.\n');
    return;
  }

  console.log(`Triggers: ${triggers.join(', ')}`);

  const resolvedBy = wu.escalation_resolved_by as string | undefined;
  const resolvedAt = wu.escalation_resolved_at as string | undefined;

  if (resolvedBy && resolvedAt) {
    console.log(`Status: RESOLVED`);
    console.log(`Resolved by: ${resolvedBy}`);
    console.log(`Resolved at: ${resolvedAt}`);
  } else {
    console.log(`Status: UNRESOLVED`);
    console.log(`\nTo resolve:\n  pnpm wu:escalate --resolve --id ${id}`);
  }

  console.log('');
}

/**
 * WU-2227: Determine if escalation should use worktree-aware mode.
 *
 * Returns the absolute worktree path when:
 * 1. WU status is 'in_progress'
 * 2. WU has a worktree_path set (not branch-pr mode)
 * 3. The worktree can be resolved via defaultWorktreeFrom()
 *
 * Returns null to fall back to micro-worktree mode.
 */
function resolveWorktreeMode(wu: Record<string, unknown>, rootDir?: string): string | null {
  if (wu.status !== 'in_progress') return null;
  if (!wu.worktree_path) return null;

  // Use defaultWorktreeFrom to get a canonical worktree path
  const worktreeRelPath = defaultWorktreeFrom(wu as { lane?: string; id?: string });
  if (!worktreeRelPath) return null;

  // WU-1806 pattern: resolve correctly even when running from inside a worktree
  const currentWorktree = detectCurrentWorktree();
  const targetWorktreeName = basename(worktreeRelPath);

  if (currentWorktree && basename(currentWorktree) === targetWorktreeName) {
    // We're inside the target worktree
    return currentWorktree;
  }

  // Resolve relative to rootDir (for testing) or cwd
  return rootDir ? resolve(rootDir, worktreeRelPath) : resolve(worktreeRelPath);
}

/**
 * Resolve escalation for a WU by setting escalation_resolved_by and
 * escalation_resolved_at.
 *
 * WU-2227: Worktree-aware -- for in_progress WUs with an active worktree,
 * edits the YAML in-place in the worktree (like wu-edit.ts) to prevent
 * rebase conflicts during wu:done. Falls back to micro-worktree isolation
 * for non-in_progress WUs.
 *
 * Exported for testing.
 *
 * @param id - WU ID
 * @param resolverEmail - Optional override email; defaults to git user.email
 * @param rootDir - Optional root directory for WU file lookup (testing)
 * @returns {Promise<{resolver: string, resolvedAt: string}>}
 */
export async function resolveEscalation(
  id: string,
  resolverEmail?: string,
  rootDir?: string,
): Promise<{ resolver: string; resolvedAt: string }> {
  // Load and validate WU
  const { wu } = loadWU(id, rootDir);
  const triggers = (wu.escalation_triggers as string[]) || [];
  const requiresEscalation = wu.requires_human_escalation || triggers.length > 0;

  if (!requiresEscalation || triggers.length === 0) {
    die(
      `WU ${id} has no escalation triggers.\n\n` +
        `Only WUs with escalation_triggers can be resolved.\n` +
        `Current triggers: ${JSON.stringify(triggers)}`,
    );
  }

  // Check if already resolved
  if (wu.escalation_resolved_by && wu.escalation_resolved_at) {
    die(
      `WU ${id} escalation is already resolved.\n\n` +
        `Resolved by: ${wu.escalation_resolved_by}\n` +
        `Resolved at: ${wu.escalation_resolved_at}`,
    );
  }

  // Determine resolver email
  const resolver = resolverEmail || (await getGitForCwd().getConfigValue('user.email'));
  if (!resolver) {
    die(
      'Cannot determine resolver email.\n\n' +
        'Provide --resolver <email> or configure git user.email.',
    );
  }

  const resolvedAt = new Date().toISOString();

  console.log(`${PREFIX} Resolving escalation for ${id}`);
  console.log(`${PREFIX} Resolver: ${resolver}`);
  console.log(`${PREFIX} Triggers: ${triggers.join(', ')}`);

  // WU-2227: Check if we should use worktree-aware mode
  const worktreePath = resolveWorktreeMode(wu, rootDir);

  if (worktreePath) {
    // WORKTREE MODE: Edit YAML in-place in the active worktree
    console.log(`${PREFIX} Editing in_progress WU in active worktree...`);

    // Validate worktree state (same checks as wu-edit.ts)
    validateWorktreeExists(worktreePath, id);
    await validateWorktreeClean(worktreePath, id);

    const expectedBranch = getLaneBranch(wu.lane as string, id);
    await validateWorktreeBranch(worktreePath, expectedBranch, id);

    // Read WU YAML from worktree, apply escalation fields, write back
    const wuRelPath = WU_PATHS.WU(id);
    const wuPath = join(worktreePath, wuRelPath);

    const content = readFileSync(wuPath, {
      encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
    });
    const wuDoc = parseYAML(content) as Record<string, unknown>;

    wuDoc.escalation_resolved_by = resolver;
    wuDoc.escalation_resolved_at = resolvedAt;

    const yamlContent = stringifyYAML(wuDoc);
    writeFileSync(wuPath, yamlContent, {
      encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
    });

    // Commit and push to the lane branch
    const commitFormat =
      typeof COMMIT_FORMATS.ESCALATE === 'function'
        ? COMMIT_FORMATS.ESCALATE(id)
        : `wu(${id.toLowerCase()}): resolve escalation`;

    const worktreeGit = createGitForPath(worktreePath);
    await worktreeGit.add(wuRelPath);
    await worktreeGit.commit(commitFormat);
    await worktreeGit.push('origin', expectedBranch);

    console.log(`${PREFIX} Successfully resolved escalation for ${id} in worktree`);
    console.log(`${PREFIX} Changes committed to lane branch ${expectedBranch}`);
  } else {
    // MICRO-WORKTREE MODE: Atomically update on main (existing behavior)
    const previousWuTool = process.env[ENV_VARS.WU_TOOL];
    process.env[ENV_VARS.WU_TOOL] = OPERATION_NAME;

    try {
      const commitFormat =
        typeof COMMIT_FORMATS.ESCALATE === 'function'
          ? COMMIT_FORMATS.ESCALATE(id)
          : `wu(${id.toLowerCase()}): resolve escalation`;

      await withMicroWorktree({
        operation: OPERATION_NAME,
        id,
        logPrefix: PREFIX,
        execute: async ({ worktreePath: mwPath }) => {
          const wuRelPath = WU_PATHS.WU(id);
          const wuPath = join(mwPath, wuRelPath);

          // Read the WU file from the micro-worktree
          const content = readFileSync(wuPath, {
            encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
          });
          const wuDoc = parseYAML(content) as Record<string, unknown>;

          // Set escalation resolution fields
          wuDoc.escalation_resolved_by = resolver;
          wuDoc.escalation_resolved_at = resolvedAt;

          // Write back
          const yamlContent = stringifyYAML(wuDoc);
          writeFileSync(wuPath, yamlContent, {
            encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
          });

          return {
            commitMessage: commitFormat,
            files: [wuRelPath],
          };
        },
      });
    } finally {
      if (previousWuTool === undefined) {
        delete process.env[ENV_VARS.WU_TOOL];
      } else {
        process.env[ENV_VARS.WU_TOOL] = previousWuTool;
      }
    }

    console.log(`${PREFIX} Successfully resolved escalation for ${id}`);
    console.log(`${PREFIX} Changes pushed to origin/main`);
  }

  return { resolver, resolvedAt };
}

/**
 * Main entry point
 */
export async function main(): Promise<void> {
  const opts = parseArgs();
  const { id } = opts;

  validateWUIDFormat(id);

  if (opts.resolve) {
    // Resolve mode: set escalation fields
    // WU-2227: Check if the WU is in_progress with a worktree before requiring main
    const { wu } = loadWU(id);
    const worktreeMode = resolveWorktreeMode(wu);
    if (!worktreeMode) {
      // Only require main for micro-worktree mode
      await ensureOnMain(getGitForCwd());
    }
    await resolveEscalation(id, opts.resolver);
  } else {
    // Status mode: show current escalation state
    const { wu } = loadWU(id);
    showEscalationStatus(wu);
  }
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}

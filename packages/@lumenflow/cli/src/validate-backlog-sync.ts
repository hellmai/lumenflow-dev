#!/usr/bin/env node
/**
 * @file validate-backlog-sync.ts
 * @description Validates backlog.md is in sync with WU YAML files (WU-1111)
 *
 * Checks that all WU YAML files are referenced in backlog.md and vice versa.
 * This is the TypeScript replacement for tools/validate-backlog-sync.js.
 *
 * Usage:
 *   validate-backlog-sync              # Validate sync
 *
 * Exit codes:
 *   0 - Backlog is in sync
 *   1 - Sync issues found
 *
 * @see {@link docs/04-operations/tasks/backlog.md} - Backlog file
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILE_SYSTEM, EMOJI, PATTERNS } from '@lumenflow/core/dist/wu-constants.js';
import { WU_PATHS } from '@lumenflow/core/dist/wu-paths.js';

const LOG_PREFIX = '[validate-backlog-sync]';

/**
 * Validation result for backlog sync
 */
export interface BacklogSyncResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  wuCount: number;
  backlogCount: number;
}

/**
 * Extract WU IDs from backlog.md content
 *
 * @param content - backlog.md content
 * @returns Array of WU IDs found
 */
function extractWUIDsFromBacklog(content: string): string[] {
  const wuIds: string[] = [];
  const pattern = /WU-\d+/gi;
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const wuId = match[0].toUpperCase();
    if (!wuIds.includes(wuId)) {
      wuIds.push(wuId);
    }
  }

  return wuIds;
}

/**
 * Get all WU IDs from YAML files
 *
 * @param wuDir - Path to WU directory
 * @returns Array of WU IDs
 */
function getWUIDsFromFiles(wuDir: string): string[] {
  if (!existsSync(wuDir)) {
    return [];
  }

  return readdirSync(wuDir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.replace('.yaml', '').toUpperCase());
}

/**
 * Validate that backlog.md is in sync with WU YAML files
 *
 * @param options - Validation options
 * @param options.cwd - Working directory (default: process.cwd())
 * @returns Validation result
 */
export async function validateBacklogSync(
  options: { cwd?: string } = {},
): Promise<BacklogSyncResult> {
  const { cwd = process.cwd() } = options;
  const errors: string[] = [];
  const warnings: string[] = [];

  // Paths
  const backlogPath = path.join(cwd, 'docs', '04-operations', 'tasks', 'backlog.md');
  const wuDir = path.join(cwd, 'docs', '04-operations', 'tasks', 'wu');

  // Check backlog.md exists
  if (!existsSync(backlogPath)) {
    errors.push(`Backlog file not found: ${backlogPath}`);
    return { valid: false, errors, warnings, wuCount: 0, backlogCount: 0 };
  }

  // Get WU IDs from files
  const wuIdsFromFiles = getWUIDsFromFiles(wuDir);

  // Get WU IDs from backlog
  const backlogContent = readFileSync(backlogPath, {
    encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
  });
  const wuIdsFromBacklog = extractWUIDsFromBacklog(backlogContent);

  // Check for WUs in files but not in backlog
  for (const wuId of wuIdsFromFiles) {
    if (!wuIdsFromBacklog.includes(wuId)) {
      errors.push(`${wuId} not found in backlog.md (exists as ${wuId}.yaml)`);
    }
  }

  // Check for WUs in backlog but not as files (warning only)
  for (const wuId of wuIdsFromBacklog) {
    if (!wuIdsFromFiles.includes(wuId)) {
      warnings.push(`${wuId} referenced in backlog.md but ${wuId}.yaml not found`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    wuCount: wuIdsFromFiles.length,
    backlogCount: wuIdsFromBacklog.length,
  };
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  let cwd = process.cwd();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--cwd' || arg === '-C') {
      cwd = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: validate-backlog-sync [options]

Validate that backlog.md is in sync with WU YAML files.

Options:
  --cwd, -C DIR  Working directory (default: current directory)
  -h, --help     Show this help message

Examples:
  validate-backlog-sync
`);
      process.exit(0);
    }
  }

  console.log(`${LOG_PREFIX} Validating backlog sync...`);

  const result = await validateBacklogSync({ cwd });

  if (result.errors.length > 0) {
    console.log(`${EMOJI.FAILURE} Sync errors:`);
    result.errors.forEach((e) => console.log(`  ${e}`));
  }

  if (result.warnings.length > 0) {
    console.log(`${EMOJI.WARNING} Warnings:`);
    result.warnings.forEach((w) => console.log(`  ${w}`));
  }

  console.log(
    `${LOG_PREFIX} WU files: ${result.wuCount}, Backlog references: ${result.backlogCount}`,
  );

  if (result.valid) {
    console.log(`${EMOJI.SUCCESS} Backlog is in sync`);
  } else {
    process.exit(1);
  }
}

// Guard main() for testability
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`${LOG_PREFIX} Unexpected error:`, error);
    process.exit(1);
  });
}

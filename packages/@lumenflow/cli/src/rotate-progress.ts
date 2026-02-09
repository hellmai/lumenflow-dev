#!/usr/bin/env node
/**
 * Rotate Progress CLI Command
 *
 * Moves completed WUs from status.md In Progress section to Completed section.
 * Keeps the status file tidy by archiving done work.
 *
 * WU-1112: INIT-003 Phase 6 - Migrate remaining Tier 1 tools
 *
 * Usage:
 *   pnpm rotate:progress
 *   pnpm rotate:progress --dry-run
 *   pnpm rotate:progress --limit 10
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { EXIT_CODES, STATUS_SECTIONS, FILE_SYSTEM, PATTERNS } from '@lumenflow/core/wu-constants';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { runCLI } from './cli-entry-point.js';

/** Log prefix for console output */
const LOG_PREFIX = '[rotate:progress]';

/**
 * Arguments for rotate-progress command
 */
export interface RotateArgs {
  /** Dry run - show changes without writing */
  dryRun?: boolean;
  /** Maximum number of WUs to rotate */
  limit?: number;
  /** Show help */
  help?: boolean;
}

/**
 * Parse command line arguments for rotate-progress
 *
 * @param argv - Process argv array
 * @returns Parsed arguments
 */
export function parseRotateArgs(argv: string[]): RotateArgs {
  const args: RotateArgs = {};

  // Skip node and script name
  const cliArgs = argv.slice(2);

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--dry-run' || arg === '-n') {
      args.dryRun = true;
    } else if (arg === '--limit' || arg === '-l') {
      const val = cliArgs[++i];
      if (val) args.limit = parseInt(val, 10);
    }
  }

  return args;
}

/**
 * Get WU status from YAML file
 */
function getWuStatus(wuId: string, baseDir: string = process.cwd()): string | null {
  // WU-1301: Use config-based paths
  const yamlPath = join(baseDir, WU_PATHS.WU(wuId));
  if (!existsSync(yamlPath)) {
    return null;
  }

  try {
    const content = readFileSync(yamlPath, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });
    const yaml = parseYaml(content);
    return yaml?.status || null;
  } catch {
    return null;
  }
}

/**
 * Get all WU statuses from YAML files
 */
function getAllWuStatuses(baseDir: string = process.cwd()): Map<string, string> {
  const statuses = new Map<string, string>();
  // WU-1301: Use config-based paths
  const wuDir = join(baseDir, WU_PATHS.WU_DIR());

  if (!existsSync(wuDir)) {
    return statuses;
  }

  const files = readdirSync(wuDir);
  for (const file of files) {
    if (file.endsWith('.yaml') || file.endsWith('.yml')) {
      const wuId = file.replace(/\.ya?ml$/, '');
      const status = getWuStatus(wuId, baseDir);
      if (status) {
        statuses.set(wuId, status);
      }
    }
  }

  return statuses;
}

/**
 * Find WUs in the In Progress section that have status=done in YAML
 *
 * @param statusContent - Content of status.md file
 * @param wuStatuses - Map of WU IDs to their statuses from YAML
 * @returns Array of WU IDs that should be moved to Completed
 */
export function findCompletedWUs(statusContent: string, wuStatuses: Map<string, string>): string[] {
  const completed: string[] = [];

  // Find the In Progress section
  const inProgressStart = statusContent.indexOf(STATUS_SECTIONS.IN_PROGRESS);
  if (inProgressStart === -1) {
    return completed;
  }

  // Find the end of In Progress section (next ## heading or end of file)
  const afterInProgress = statusContent.slice(inProgressStart + STATUS_SECTIONS.IN_PROGRESS.length);
  const nextSectionMatch = afterInProgress.match(/\n##/);
  const inProgressSection = nextSectionMatch
    ? afterInProgress.slice(0, nextSectionMatch.index)
    : afterInProgress;

  // Extract WU IDs from In Progress section
  const wuIdMatches = inProgressSection.match(/WU-\d+/g) || [];
  const uniqueWuIds = [...new Set(wuIdMatches)];

  // Check which ones have done status
  for (const wuId of uniqueWuIds) {
    const status = wuStatuses.get(wuId);
    if (status === 'done' || status === 'completed') {
      completed.push(wuId);
    }
  }

  return completed;
}

/**
 * Build the rotated status.md content
 *
 * @param statusContent - Original status.md content
 * @param completedWUs - WU IDs to move to Completed
 * @returns Updated status.md content
 */
export function buildRotatedContent(statusContent: string, completedWUs: string[]): string {
  if (completedWUs.length === 0) {
    return statusContent;
  }

  let content = statusContent;
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // For each completed WU, move it from In Progress to Completed
  for (const wuId of completedWUs) {
    // Find and remove the line from In Progress section
    const wuLineRegex = new RegExp(`\\n?-\\s*\\[?[\\sx]?\\]?\\s*\\[?${wuId}[^\\n]*`, 'gi');
    const match = content.match(wuLineRegex);

    if (match) {
      // Extract the original line text
      const originalLine = match[0].trim();

      // Remove from current position
      content = content.replace(wuLineRegex, '');

      // Extract title from the original line
      // Match "WU-XXXX - Title" or "WU-XXXX Title" patterns
      const titleMatch = originalLine.match(/WU-\d+\s*[-—]?\s*([^(]*)/);
      let title = wuId;
      if (titleMatch) {
        const fullMatch = titleMatch[0].trim();
        const wuPart = wuId;
        // Get everything after the WU ID
        const rest = fullMatch
          .slice(wuId.length)
          .replace(/^[\s-—]+/, '')
          .trim();
        title = rest ? `${wuPart} - ${rest}` : wuPart;
      }

      // Build the completed entry with date
      const completedEntry = `- [x] ${title} (${today})`;

      // Add to Completed section
      const completedSectionIndex = content.indexOf(STATUS_SECTIONS.COMPLETED);
      if (completedSectionIndex !== -1) {
        const insertPoint = completedSectionIndex + STATUS_SECTIONS.COMPLETED.length;
        content =
          content.slice(0, insertPoint) + '\n' + completedEntry + content.slice(insertPoint);
      }
    }
  }

  // Clean up any double newlines
  content = content.replace(/\n{3,}/g, '\n\n');

  return content;
}

/**
 * Print help message for rotate-progress
 */
/* istanbul ignore next -- CLI entry point */
function printHelp(): void {
  console.log(`
Usage: rotate-progress [options]

Move completed WUs from status.md In Progress to Completed section.

Options:
  -n, --dry-run       Show changes without writing
  -l, --limit <n>     Maximum number of WUs to rotate
  -h, --help          Show this help message

How it works:
  1. Scans status.md for WUs listed in "In Progress" section
  2. Checks each WU's YAML file for status=done
  3. Moves done WUs to "Completed" section with date stamp

Examples:
  rotate:progress               # Rotate all completed WUs
  rotate:progress --dry-run     # Preview what would be rotated
  rotate:progress --limit 5     # Rotate at most 5 WUs
`);
}

/**
 * Main entry point for rotate-progress command
 */
/* istanbul ignore next -- CLI entry point */
async function main(): Promise<void> {
  const args = parseRotateArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(EXIT_CODES.SUCCESS);
  }

  // Read status.md - WU-1301: Use config-based paths
  const statusPath = join(process.cwd(), WU_PATHS.STATUS());
  if (!existsSync(statusPath)) {
    console.error(`${LOG_PREFIX} Error: ${statusPath} not found`);
    process.exit(EXIT_CODES.ERROR);
  }

  const statusContent = readFileSync(statusPath, {
    encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
  });

  // Get all WU statuses
  const wuStatuses = getAllWuStatuses();

  // Find completed WUs
  let completedWUs = findCompletedWUs(statusContent, wuStatuses);

  if (completedWUs.length === 0) {
    console.log(`${LOG_PREFIX} No completed WUs to rotate.`);
    process.exit(EXIT_CODES.SUCCESS);
  }

  // Apply limit if specified
  if (args.limit && args.limit > 0) {
    completedWUs = completedWUs.slice(0, args.limit);
  }

  console.log(`${LOG_PREFIX} Found ${completedWUs.length} WU(s) to rotate:`);
  for (const wuId of completedWUs) {
    console.log(`  - ${wuId}`);
  }

  if (args.dryRun) {
    console.log(`\n${LOG_PREFIX} DRY RUN - No changes made.`);
    const newContent = buildRotatedContent(statusContent, completedWUs);
    console.log(`\n${LOG_PREFIX} Preview of changes:`);
    console.log('---');
    console.log(newContent.slice(0, 500) + '...');
    process.exit(EXIT_CODES.SUCCESS);
  }

  // Build and write updated content
  const newContent = buildRotatedContent(statusContent, completedWUs);
  writeFileSync(statusPath, newContent, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });

  console.log(`\n${LOG_PREFIX} ✅ Rotated ${completedWUs.length} WU(s) to Completed section.`);
}

// Run main if executed directly
if (import.meta.main) {
  runCLI(main);
}

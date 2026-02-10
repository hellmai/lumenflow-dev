#!/usr/bin/env node
/**
 * Memory Triage CLI (WU-1470)
 *
 * Review discovery nodes and promote to WUs or archive.
 *
 * Features:
 * - List open discovery nodes
 * - Promote discovery to WU (integrates with wu:create)
 * - Archive discovery without promotion
 * - Interactive mode for human review
 *
 * Usage:
 *   pnpm mem:triage                        # List open discoveries
 *   pnpm mem:triage --wu WU-1234           # List discoveries for specific WU
 *   pnpm mem:triage --promote mem-aaa1 --lane "Operations: Tooling"
 *   pnpm mem:triage --archive mem-aaa1 --reason "Duplicate"
 *
 * @see {@link packages/@lumenflow/cli/src/lib/mem-triage-core.ts} - Core logic
 * @see {@link packages/@lumenflow/cli/src/__tests__/mem-triage.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { listOpenDiscoveries, promoteDiscovery, archiveDiscovery } from '@lumenflow/memory/triage';
import { createWUParser } from '@lumenflow/core/arg-parser';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';

/**
 * Log prefix for mem:triage output
 */
const LOG_PREFIX = '[mem:triage]';

/**
 * Tool name for audit logging
 */
const TOOL_NAME = 'mem:triage';

/**
 * CLI argument options specific to mem:triage
 */
const CLI_OPTIONS = {
  list: {
    name: 'list',
    flags: '-l, --list',
    description: 'List open discoveries (default action)',
  },
  promote: {
    name: 'promote',
    flags: '-p, --promote <nodeId>',
    description: 'Promote discovery to WU (mem-XXXX format)',
  },
  archive: {
    name: 'archive',
    flags: '-a, --archive <nodeId>',
    description: 'Archive discovery without promotion (mem-XXXX format)',
  },
  reason: {
    name: 'reason',
    flags: '-r, --reason <text>',
    description: 'Reason for archiving (required with --archive)',
  },
  title: {
    name: 'title',
    flags: '--title <text>',
    description: 'Custom title for promoted WU (optional)',
  },
  lane: {
    name: 'lane',
    flags: '--lane <lane>',
    description: 'Lane for promoted WU (required with --promote)',
  },
  wuId: {
    name: 'wuId',
    flags: '--wu-id <id>',
    description: 'Explicit WU ID for promotion (optional)',
  },
  filterWu: {
    name: 'filterWu',
    flags: '--wu <id>',
    description: 'Filter discoveries by WU ID (or "unlinked")',
  },
  filterTag: {
    name: 'filterTag',
    flags: '--tag <tag>',
    description: 'Filter discoveries by tag',
  },
  dryRun: {
    name: 'dryRun',
    flags: '--dry-run',
    description: 'Preview promotion without creating WU',
  },
  json: {
    name: 'json',
    flags: '--json',
    description: 'Output as JSON',
  },
  quiet: {
    name: 'quiet',
    flags: '-q, --quiet',
    description: 'Suppress output except errors',
  },
};

/**
 * Write audit log entry for tool execution
 *
 * @param {string} baseDir - Base directory
 * @param {object} entry - Audit log entry
 */
async function writeAuditLog(baseDir, entry) {
  try {
    const logPath = path.join(baseDir, LUMENFLOW_PATHS.AUDIT_LOG);
    const logDir = path.dirname(logPath);

    await fs.mkdir(logDir, { recursive: true });

    const line = `${JSON.stringify(entry)}\n`;
    await fs.appendFile(logPath, line, 'utf-8');
  } catch {
    // Audit logging is non-fatal - silently ignore errors
  }
}

/**
 * Format a discovery node for display
 *
 * @param {object} node - Discovery node
 * @returns {string} Formatted display string
 */
function formatDiscovery(node) {
  const parts = [];
  parts.push(`  ${node.id}`);

  if (node.metadata?.priority) {
    parts.push(`[${node.metadata.priority}]`);
  }

  if (node.wu_id) {
    parts.push(`(${node.wu_id})`);
  }

  parts.push('-');
  parts.push(node.content.substring(0, 60) + (node.content.length > 60 ? '...' : ''));

  return parts.join(' ');
}

/**
 * Handle list command
 *
 * @param {string} baseDir - Base directory
 * @param {object} args - CLI arguments
 */
interface ListOptions {
  wuId?: string;
  tag?: string;
}

interface TriageArgs {
  filterWu?: string;
  filterTag?: string;
  json?: boolean;
  quiet?: boolean;
  promote?: string;
  archive?: string;
  reason?: string;
  title?: string;
  lane?: string;
  wuId?: string;
  dryRun?: boolean;
}

async function handleList(baseDir: string, args: TriageArgs) {
  const options: ListOptions = {};

  if (args.filterWu) {
    options.wuId = args.filterWu;
  }
  if (args.filterTag) {
    options.tag = args.filterTag;
  }

  const discoveries = await listOpenDiscoveries(baseDir, options);

  if (args.json) {
    console.log(JSON.stringify(discoveries, null, 2));
    return { success: true, count: discoveries.length };
  }

  if (discoveries.length === 0) {
    if (!args.quiet) {
      console.log(`${LOG_PREFIX} No open discoveries found.`);
    }
    return { success: true, count: 0 };
  }

  console.log(`${LOG_PREFIX} ${discoveries.length} open discovery(ies):`);
  console.log('');

  for (const node of discoveries) {
    console.log(formatDiscovery(node));
  }

  console.log('');
  console.log('Actions:');
  console.log('  pnpm mem:triage --promote <nodeId> --lane "<lane>"  # Promote to WU');
  console.log('  pnpm mem:triage --archive <nodeId> --reason "..."  # Archive');

  return { success: true, count: discoveries.length };
}

/**
 * Handle promote command
 *
 * @param {string} baseDir - Base directory
 * @param {object} args - CLI arguments
 */
async function handlePromote(baseDir, args) {
  if (!args.lane) {
    console.error(`${LOG_PREFIX} Error: --lane is required for promotion`);
    console.error('');
    console.error('Usage: pnpm mem:triage --promote mem-XXXX --lane "Operations: Tooling"');
    process.exit(EXIT_CODES.ERROR);
  }

  const result = await promoteDiscovery(baseDir, {
    nodeId: args.promote,
    lane: args.lane,
    title: args.title,
    wuId: args.wuId,
    dryRun: args.dryRun,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (args.dryRun) {
    console.log(`${LOG_PREFIX} Dry-run: Would create WU with:`);
    console.log('');
    console.log(`  ID:       ${result.wuSpec.id}`);
    console.log(`  Title:    ${result.wuSpec.title}`);
    console.log(`  Lane:     ${result.wuSpec.lane}`);
    console.log(`  Priority: ${result.wuSpec.priority}`);
    console.log(`  Notes:    ${result.wuSpec.notes}`);
    console.log('');
    console.log('To execute, run without --dry-run');
    return result;
  }

  console.log(`${LOG_PREFIX} ✅ Promotion spec generated:`);
  console.log('');
  console.log(`  ID:       ${result.wuSpec.id}`);
  console.log(`  Title:    ${result.wuSpec.title}`);
  console.log(`  Lane:     ${result.wuSpec.lane}`);
  console.log(`  Priority: ${result.wuSpec.priority}`);
  console.log('');
  console.log('Next: To create the WU, run:');
  console.log(
    `  pnpm wu:create --id ${result.wuSpec.id} --lane "${result.wuSpec.lane}" --title "${result.wuSpec.title}" --priority ${result.wuSpec.priority}`,
  );

  return result;
}

/**
 * Handle archive command
 *
 * @param {string} baseDir - Base directory
 * @param {object} args - CLI arguments
 */
async function handleArchive(baseDir, args) {
  if (!args.reason) {
    console.error(`${LOG_PREFIX} Error: --reason is required for archiving`);
    console.error('');
    console.error('Usage: pnpm mem:triage --archive mem-XXXX --reason "Duplicate of WU-1234"');
    process.exit(EXIT_CODES.ERROR);
  }

  const result = await archiveDiscovery(baseDir, {
    nodeId: args.archive,
    reason: args.reason,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (!args.quiet) {
    console.log(`${LOG_PREFIX} ✅ Archived ${result.nodeId}`);
    console.log(`  Reason: ${args.reason}`);
  }

  return result;
}

/**
 * Parse CLI arguments
 *
 * @returns {object} Parsed arguments
 */
function parseArguments() {
  return createWUParser({
    name: 'mem-triage',
    description: 'Review discovery nodes and promote to WUs or archive',
    options: [
      CLI_OPTIONS.list,
      CLI_OPTIONS.promote,
      CLI_OPTIONS.archive,
      CLI_OPTIONS.reason,
      CLI_OPTIONS.title,
      CLI_OPTIONS.lane,
      CLI_OPTIONS.wuId,
      CLI_OPTIONS.filterWu,
      CLI_OPTIONS.filterTag,
      CLI_OPTIONS.dryRun,
      CLI_OPTIONS.json,
      CLI_OPTIONS.quiet,
    ],
    required: [],
    allowPositionalId: false,
  });
}

/**
 * Main CLI entry point
 */
async function main() {
  const args = parseArguments();
  const baseDir = process.cwd();
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  let result = null;
  let error = null;
  let action = 'list';

  try {
    if (args.promote) {
      action = 'promote';
      result = await handlePromote(baseDir, args);
    } else if (args.archive) {
      action = 'archive';
      result = await handleArchive(baseDir, args);
    } else {
      action = 'list';
      result = await handleList(baseDir, args);
    }
  } catch (err) {
    error = err.message;
    console.error(`${LOG_PREFIX} Error: ${error}`);
    process.exit(EXIT_CODES.ERROR);
  }

  const durationMs = Date.now() - startTime;

  await writeAuditLog(baseDir, {
    tool: TOOL_NAME,
    action,
    status: error ? 'failed' : 'success',
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs,
    input: {
      baseDir,
      action,
      nodeId: args.promote || args.archive,
      lane: args.lane,
      reason: args.reason,
      wuId: args.wuId,
      filterWu: args.filterWu,
      filterTag: args.filterTag,
      dryRun: args.dryRun,
    },
    output: result,
    error: error ? { message: error } : null,
  });
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}

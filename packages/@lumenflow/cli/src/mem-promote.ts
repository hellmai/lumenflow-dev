#!/usr/bin/env node

/**
 * Memory Promote CLI (WU-1237)
 *
 * Promotes session/WU learnings into project-level knowledge nodes.
 *
 * Features:
 * - Promote individual nodes to project lifecycle
 * - Promote all summaries from a WU
 * - Enforced taxonomy tags
 * - Creates discovered_from relationships for provenance
 * - Dry-run mode for preview
 *
 * Usage:
 *   pnpm mem:promote --node mem-xxxx --tag pattern           # Promote single node
 *   pnpm mem:promote --wu WU-1234 --tag decision             # Promote all WU summaries
 *   pnpm mem:promote --node mem-xxxx --tag pattern --dry-run # Preview
 *
 * @see {@link packages/@lumenflow/memory/src/mem-promote-core.ts} - Core logic
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  promoteNode,
  promoteFromWu,
  ALLOWED_PROMOTION_TAGS,
} from '@lumenflow/memory/mem-promote-core';
import { createWUParser } from '@lumenflow/core/arg-parser';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';

/**
 * Log prefix for mem:promote output
 */
const LOG_PREFIX = '[mem:promote]';

/**
 * Tool name for audit logging
 */
const TOOL_NAME = 'mem:promote';

/**
 * CLI argument options specific to mem:promote
 */
const CLI_OPTIONS = {
  node: {
    name: 'node',
    flags: '-n, --node <nodeId>',
    description: 'Memory node ID to promote (mem-xxxx format)',
  },
  wu: {
    name: 'wu',
    flags: '-w, --wu <wuId>',
    description: 'WU ID to promote all summaries from (WU-XXXX format)',
  },
  tag: {
    name: 'tag',
    flags: '-t, --tag <tag>',
    description: `Tag from taxonomy: ${ALLOWED_PROMOTION_TAGS.join(', ')}`,
  },
  dryRun: {
    name: 'dryRun',
    flags: '--dry-run',
    description: 'Preview what would be promoted without writing',
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

interface PromoteArgs {
  node?: string;
  wu?: string;
  tag?: string;
  dryRun?: boolean;
  json?: boolean;
  quiet?: boolean;
}

/**
 * Write audit log entry for tool execution
 */
async function writeAuditLog(baseDir: string, entry: Record<string, unknown>): Promise<void> {
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
 * Handle promoting a single node
 */
async function handlePromoteNode(
  baseDir: string,
  args: PromoteArgs,
): Promise<Awaited<ReturnType<typeof promoteNode>>> {
  if (!args.tag) {
    console.error(`${LOG_PREFIX} Error: --tag is required`);
    console.error('');
    console.error(`Usage: pnpm mem:promote --node mem-xxxx --tag <tag>`);
    console.error(`Tags: ${ALLOWED_PROMOTION_TAGS.join(', ')}`);
    process.exit(EXIT_CODES.ERROR);
  }

  // args.node is guaranteed to be defined when this function is called
  const nodeId = args.node as string;

  const result = await promoteNode(baseDir, {
    nodeId,
    tag: args.tag,
    dryRun: args.dryRun,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (args.dryRun) {
    console.log(`${LOG_PREFIX} Dry-run: Would promote to:`);
    console.log('');
    console.log(`  ID:        ${result.promotedNode.id}`);
    console.log(`  Lifecycle: ${result.promotedNode.lifecycle}`);
    console.log(`  Tags:      ${result.promotedNode.tags?.join(', ')}`);
    console.log(`  Content:   ${result.promotedNode.content.substring(0, 80)}...`);
    console.log('');
    console.log('To execute, run without --dry-run');
    return result;
  }

  if (!args.quiet) {
    console.log(`${LOG_PREFIX} ✅ Promoted to project level`);
    console.log('');
    console.log(`  Source:    ${args.node}`);
    console.log(`  New ID:    ${result.promotedNode.id}`);
    console.log(`  Lifecycle: project`);
    console.log(`  Tag:       ${args.tag}`);
  }

  return result;
}

/**
 * Handle promoting all summaries from a WU
 */
async function handlePromoteFromWu(
  baseDir: string,
  args: PromoteArgs,
): Promise<Awaited<ReturnType<typeof promoteFromWu>>> {
  if (!args.tag) {
    console.error(`${LOG_PREFIX} Error: --tag is required`);
    console.error('');
    console.error(`Usage: pnpm mem:promote --wu WU-XXXX --tag <tag>`);
    console.error(`Tags: ${ALLOWED_PROMOTION_TAGS.join(', ')}`);
    process.exit(EXIT_CODES.ERROR);
  }

  // args.wu is guaranteed to be defined when this function is called
  const wuId = args.wu as string;

  const result = await promoteFromWu(baseDir, {
    wuId,
    tag: args.tag,
    dryRun: args.dryRun,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (result.promotedNodes.length === 0) {
    if (!args.quiet) {
      console.log(`${LOG_PREFIX} No summaries found for ${args.wu}`);
    }
    return result;
  }

  if (args.dryRun) {
    console.log(
      `${LOG_PREFIX} Dry-run: Would promote ${result.promotedNodes.length} summary(ies):`,
    );
    console.log('');
    for (const node of result.promotedNodes) {
      console.log(`  - ${node.id}: ${node.content.substring(0, 60)}...`);
    }
    console.log('');
    console.log('To execute, run without --dry-run');
    return result;
  }

  if (!args.quiet) {
    console.log(
      `${LOG_PREFIX} ✅ Promoted ${result.promotedNodes.length} summary(ies) from ${args.wu}`,
    );
    console.log('');
    for (const node of result.promotedNodes) {
      console.log(`  - ${node.id}: ${node.content.substring(0, 60)}...`);
    }
  }

  return result;
}

/**
 * Parse CLI arguments
 */
function parseArguments(): PromoteArgs {
  return createWUParser({
    name: 'mem-promote',
    description: 'Promote session/WU learnings to project-level knowledge',
    options: [
      CLI_OPTIONS.node,
      CLI_OPTIONS.wu,
      CLI_OPTIONS.tag,
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
async function main(): Promise<void> {
  const args = parseArguments();
  const baseDir = process.cwd();
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  // Validate: one of --node or --wu must be provided
  if (!args.node && !args.wu) {
    console.error(`${LOG_PREFIX} Error: Either --node or --wu is required`);
    console.error('');
    console.error('Usage:');
    console.error('  pnpm mem:promote --node mem-xxxx --tag pattern');
    console.error('  pnpm mem:promote --wu WU-1234 --tag decision');
    process.exit(EXIT_CODES.ERROR);
  }

  if (args.node && args.wu) {
    console.error(`${LOG_PREFIX} Error: Cannot use both --node and --wu`);
    process.exit(EXIT_CODES.ERROR);
  }

  let result = null;
  let error = null;
  const action = args.node ? 'promote-node' : 'promote-wu';

  try {
    if (args.node) {
      result = await handlePromoteNode(baseDir, args);
    } else {
      result = await handlePromoteFromWu(baseDir, args);
    }
  } catch (err) {
    error = (err as Error).message;
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
      node: args.node,
      wu: args.wu,
      tag: args.tag,
      dryRun: args.dryRun,
    },
    output: result,
    error: error ? { message: error } : null,
  });
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  runCLI(main);
}

#!/usr/bin/env node

/**
 * Memory Profile CLI (WU-1237)
 *
 * Renders top N project-level memories for context injection.
 *
 * Features:
 * - Outputs project-level knowledge profile
 * - Configurable limit (default N=20)
 * - Tag-based filtering
 * - Output format compatible with mem:context
 *
 * Usage:
 *   pnpm mem:profile                           # Top 20 project memories
 *   pnpm mem:profile --limit 10                # Top 10 project memories
 *   pnpm mem:profile --tag decision            # Filter by tag
 *   pnpm mem:profile --json                    # Output as JSON
 *
 * @see {@link packages/@lumenflow/memory/src/mem-profile-core.ts} - Core logic
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { generateProfile, DEFAULT_PROFILE_LIMIT } from '@lumenflow/memory/mem-profile-core';
import { createWUParser } from '@lumenflow/core/arg-parser';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';

/**
 * Log prefix for mem:profile output
 */
const LOG_PREFIX = '[mem:profile]';

/**
 * Tool name for audit logging
 */
const TOOL_NAME = 'mem:profile';

/**
 * CLI argument options specific to mem:profile
 */
const CLI_OPTIONS = {
  limit: {
    name: 'limit',
    flags: '-l, --limit <n>',
    description: `Maximum nodes to include (default: ${DEFAULT_PROFILE_LIMIT})`,
  },
  tag: {
    name: 'tag',
    flags: '-t, --tag <tag>',
    description: 'Filter by tag category (e.g., decision, pattern)',
  },
  json: {
    name: 'json',
    flags: '--json',
    description: 'Output as JSON',
  },
  raw: {
    name: 'raw',
    flags: '--raw',
    description: 'Output raw profile block (for piping to mem:context)',
  },
  quiet: {
    name: 'quiet',
    flags: '-q, --quiet',
    description: 'Suppress output except the profile block',
  },
};

interface ProfileArgs {
  limit?: string;
  tag?: string;
  json?: boolean;
  raw?: boolean;
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
 * Parse CLI arguments
 */
function parseArguments(): ProfileArgs {
  return createWUParser({
    name: 'mem-profile',
    description: 'Generate project knowledge profile for context injection',
    options: [
      CLI_OPTIONS.limit,
      CLI_OPTIONS.tag,
      CLI_OPTIONS.json,
      CLI_OPTIONS.raw,
      CLI_OPTIONS.quiet,
    ],
    required: [],
    allowPositionalId: false,
  });
}

/**
 * Output profile in JSON format
 */
function outputJson(result: Awaited<ReturnType<typeof generateProfile>>): void {
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Output profile in raw format (for piping)
 */
function outputRaw(result: Awaited<ReturnType<typeof generateProfile>>): void {
  if (result.profileBlock) {
    process.stdout.write(result.profileBlock);
  }
}

/**
 * Output profile in human-readable format
 */
function outputHumanReadable(
  result: Awaited<ReturnType<typeof generateProfile>>,
  args: ProfileArgs,
): void {
  if (result.nodes.length === 0) {
    if (!args.quiet) {
      console.log(`${LOG_PREFIX} No project-level memories found.`);
      if (args.tag) {
        console.log(`  Filter: --tag ${args.tag}`);
      }
      console.log('');
      console.log('To promote session learnings to project level, use:');
      console.log('  pnpm mem:promote --node mem-xxxx --tag pattern');
    }
    return;
  }

  if (!args.quiet) {
    console.log(
      `${LOG_PREFIX} Project Profile (${result.stats.includedNodes}/${result.stats.totalProjectNodes} nodes)`,
    );
    if (args.tag) {
      console.log(`  Filter: --tag ${args.tag}`);
    }
    console.log('');
  }

  // Output the profile block
  console.log(result.profileBlock);

  if (!args.quiet) {
    // Stats summary
    console.log('Tag breakdown:');
    for (const [tag, count] of Object.entries(result.stats.byTag)) {
      console.log(`  ${tag}: ${count}`);
    }
  }
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = parseArguments();
  const baseDir = process.cwd();
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  let result = null;
  let error = null;

  try {
    const limit = args.limit ? parseInt(args.limit, 10) : DEFAULT_PROFILE_LIMIT;

    if (isNaN(limit) || limit < 1) {
      console.error(`${LOG_PREFIX} Error: --limit must be a positive integer`);
      process.exit(EXIT_CODES.ERROR);
    }

    result = await generateProfile(baseDir, {
      limit,
      tag: args.tag,
    });

    // Output format based on flags
    if (args.json) {
      outputJson(result);
    } else if (args.raw) {
      outputRaw(result);
    } else {
      outputHumanReadable(result, args);
    }
  } catch (err) {
    error = (err as Error).message;
    console.error(`${LOG_PREFIX} Error: ${error}`);
    process.exit(EXIT_CODES.ERROR);
  }

  const durationMs = Date.now() - startTime;

  await writeAuditLog(baseDir, {
    tool: TOOL_NAME,
    action: 'generate',
    status: error ? 'failed' : 'success',
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs,
    input: {
      baseDir,
      limit: args.limit,
      tag: args.tag,
    },
    output: result
      ? {
          includedNodes: result.stats.includedNodes,
          totalProjectNodes: result.stats.totalProjectNodes,
          byTag: result.stats.byTag,
        }
      : null,
    error: error ? { message: error } : null,
  });
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  runCLI(main);
}

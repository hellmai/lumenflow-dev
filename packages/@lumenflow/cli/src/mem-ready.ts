#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Memory Ready CLI (WU-1468)
 *
 * Deterministic ready-work query for "what next?" oracle.
 * Returns unblocked open nodes, ordered by priority then createdAt.
 *
 * Usage:
 *   pnpm mem:ready --wu WU-1234 [--type <type>] [--format <json|human>] [--quiet]
 *
 * Includes audit logging to .lumenflow/telemetry/tools.ndjson.
 *
 * @see {@link packages/@lumenflow/cli/src/lib/mem-ready-core.ts} - Core logic
 * @see {@link packages/@lumenflow/cli/src/__tests__/mem-ready.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { queryReadyNodes } from '@lumenflow/memory/ready';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { MEMORY_NODE_TYPES } from '@lumenflow/memory/schema';
import { runCLI } from './cli-entry-point.js';

/**
 * Memory node shape for display. Mirrors MemoryNode from @lumenflow/memory/schema.
 * Defined locally because memory package does not emit declaration files.
 */
interface MemoryNodeDisplay {
  id: string;
  type: string;
  lifecycle: string;
  content: string;
  created_at: string;
  wu_id?: string;
  session_id?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

/**
 * Log prefix for mem:ready output
 */
const LOG_PREFIX = '[mem:ready]';

/**
 * Tool name for audit logging
 */
const TOOL_NAME = 'mem:ready';

/**
 * CLI argument options specific to mem:ready
 */
const CLI_OPTIONS = {
  type: {
    name: 'type',
    flags: '-t, --type <type>',
    description: `Filter by node type (${MEMORY_NODE_TYPES.join(', ')})`,
  },
  format: {
    name: 'format',
    flags: '-f, --format <format>',
    description: 'Output format (json, human). Default: human',
  },
  baseDir: {
    name: 'baseDir',
    flags: '-d, --base-dir <path>',
    description: 'Base directory (defaults to current directory)',
  },
  quiet: {
    name: 'quiet',
    flags: '-q, --quiet',
    description: 'Suppress header/footer output, only show nodes',
  },
};

/**
 * Write audit log entry for tool execution
 *
 * @param {string} baseDir - Base directory
 * @param {object} entry - Audit log entry
 */
async function writeAuditLog(baseDir: string, entry: Record<string, unknown>) {
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
 * Format a single node for human-readable output
 *
 * @param {object} node - Memory node
 * @param {number} index - Position in list (0-indexed)
 * @returns {string} Formatted output
 */
function formatNodeHuman(node: MemoryNodeDisplay, index: number) {
  const priority = node.metadata?.priority || '-';
  const lines = [
    `${index + 1}. [${node.id}] (${node.type})`,
    `   Priority:   ${priority}`,
    `   Lifecycle:  ${node.lifecycle}`,
    `   Created:    ${node.created_at}`,
  ];

  if (node.wu_id) {
    lines.push(`   WU:         ${node.wu_id}`);
  }

  // Truncate content for display
  const maxContentLen = 60;
  const content =
    node.content.length > maxContentLen
      ? `${node.content.slice(0, maxContentLen)}...`
      : node.content;
  lines.push(`   Content:    ${content}`);

  return lines.join('\n');
}

/**
 * CLI options used by printHumanFormat and printJsonFormat.
 */
interface ReadyDisplayOptions {
  wu: string;
  type?: string;
  quiet?: boolean;
}

/**
 * Print nodes in human-readable format
 *
 * @param {MemoryNodeDisplay[]} nodes - Ready nodes
 * @param {ReadyDisplayOptions} opts - CLI options
 */
function printHumanFormat(nodes: MemoryNodeDisplay[], opts: ReadyDisplayOptions) {
  if (!opts.quiet) {
    console.log(`${LOG_PREFIX} Ready nodes for ${opts.wu}:`);
    console.log('');
  }

  if (nodes.length === 0) {
    if (!opts.quiet) {
      console.log('  (no ready nodes)');
      console.log('');
    }
    return;
  }

  for (const [i, node] of nodes.entries()) {
    console.log(formatNodeHuman(node, i));
    console.log('');
  }

  if (!opts.quiet) {
    console.log(`${LOG_PREFIX} ${nodes.length} node(s) ready for processing`);
  }
}

/**
 * Print nodes in JSON format
 *
 * @param {object[]} nodes - Ready nodes
 * @param {object} opts - CLI options
 */
function printJsonFormat(nodes: MemoryNodeDisplay[], opts: ReadyDisplayOptions) {
  const output = {
    wuId: opts.wu,
    type: opts.type || null,
    count: nodes.length,
    nodes,
  };

  console.log(JSON.stringify(output, null, 2));
}

/**
 * Main CLI entry point
 */
export async function main() {
  const args = createWUParser({
    name: 'mem-ready',
    description: 'Query ready nodes for a WU (deterministic ordering)',
    options: [
      WU_OPTIONS.wu,
      CLI_OPTIONS.type,
      CLI_OPTIONS.format,
      CLI_OPTIONS.baseDir,
      CLI_OPTIONS.quiet,
    ],
    required: ['wu'],
  });

  const baseDir = args.baseDir || process.cwd();
  const format = args.format || 'human';
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  // Validate format option
  if (!['json', 'human'].includes(format)) {
    console.error(`${LOG_PREFIX} Error: Invalid format "${format}". Use "json" or "human".`);
    process.exit(EXIT_CODES.ERROR);
  }

  // Validate type option if provided
  if (args.type && !MEMORY_NODE_TYPES.includes(args.type)) {
    console.error(
      `${LOG_PREFIX} Error: Invalid type "${args.type}". Valid types: ${MEMORY_NODE_TYPES.join(', ')}`,
    );
    process.exit(EXIT_CODES.ERROR);
  }

  let nodes;
  let error = null;

  try {
    nodes = await queryReadyNodes(baseDir, {
      wuId: args.wu,
      type: args.type,
    });
  } catch (err) {
    error = err.message;
  }

  const durationMs = Date.now() - startTime;

  // Write audit log entry
  await writeAuditLog(baseDir, {
    tool: TOOL_NAME,
    status: error ? 'failed' : 'success',
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs,
    input: {
      baseDir,
      wuId: args.wu,
      type: args.type,
      format,
    },
    output: nodes
      ? {
          count: nodes.length,
          nodeIds: nodes.map((n: MemoryNodeDisplay) => n.id),
        }
      : null,
    error: error ? { message: error } : null,
  });

  if (error) {
    console.error(`${LOG_PREFIX} Error: ${error}`);
    process.exit(EXIT_CODES.ERROR);
  }

  // Print output based on format
  // Cast CLI args to display options -- createWUParser returns OptionValues (Record<string, any>)
  const displayOpts: ReadyDisplayOptions = { wu: args.wu, type: args.type, quiet: args.quiet };
  if (format === 'json') {
    printJsonFormat(nodes, displayOpts);
  } else {
    printHumanFormat(nodes, displayOpts);
  }
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}

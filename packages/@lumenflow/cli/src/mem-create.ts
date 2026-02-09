#!/usr/bin/env node
/**
 * Memory Create CLI (WU-1469)
 *
 * Create memory nodes with discovered-from provenance.
 * KEY DIFFERENTIATOR: supports discovered-from relationship for scope-creep
 * forensics. Creates audit trail of WHY work expanded, not just WHAT changed.
 *
 * Includes audit logging to .lumenflow/telemetry/tools.ndjson.
 *
 * Usage:
 *   pnpm mem:create 'title' [--type <type>] [--discovered-from <id>] [--wu <id>] [--quiet]
 *
 * @see {@link packages/@lumenflow/cli/src/lib/mem-create-core.ts} - Core logic
 * @see {@link packages/@lumenflow/cli/src/__tests__/mem-create.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createMemoryNode } from '@lumenflow/memory/create';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { MEMORY_NODE_TYPES } from '@lumenflow/memory/schema';
import { runCLI } from './cli-entry-point.js';

/**
 * Log prefix for mem:create output
 */
const LOG_PREFIX = '[mem:create]';

/**
 * Tool name for audit logging
 */
const TOOL_NAME = 'mem:create';

/**
 * CLI argument options specific to mem:create
 */
const CLI_OPTIONS = {
  title: {
    name: 'title',
    flags: '-t, --title <text>',
    description: 'Node title/content (required if not positional)',
  },
  type: {
    name: 'type',
    flags: '--type <type>',
    description: `Node type: ${MEMORY_NODE_TYPES.join(', ')} (default: discovery). Aliases: bug, idea, question, dependency (stored as discovery + tags).`,
  },
  discoveredFrom: {
    name: 'discoveredFrom',
    flags: '-d, --discovered-from <id>',
    description: 'Parent node ID for provenance tracking (mem-XXXX format)',
  },
  session: {
    name: 'session',
    flags: '-s, --session <id>',
    description: 'Session ID to link node to (UUID)',
  },
  tags: {
    name: 'tags',
    flags: '--tags <tags>',
    description: 'Comma-separated tags for categorization',
  },
  priority: {
    name: 'priority',
    flags: '-p, --priority <level>',
    description: 'Priority level (P0, P1, P2, P3)',
  },
  baseDir: {
    name: 'baseDir',
    flags: '-b, --base-dir <path>',
    description: 'Base directory (defaults to current directory)',
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
 * Parse CLI arguments and extract the title
 *
 * @returns {{args: object, title: string|undefined}} Parsed args and title
 */
function parseArguments() {
  const args = createWUParser({
    name: 'mem-create',
    description: 'Create a memory node with optional provenance tracking',
    options: [
      CLI_OPTIONS.title,
      CLI_OPTIONS.type,
      CLI_OPTIONS.discoveredFrom,
      WU_OPTIONS.wu,
      CLI_OPTIONS.session,
      CLI_OPTIONS.tags,
      CLI_OPTIONS.priority,
      CLI_OPTIONS.baseDir,
      CLI_OPTIONS.quiet,
    ],
    required: [],
    allowPositionalId: true,
  });

  let title = args.title;
  if (!title && process.argv.length > 2) {
    const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
    if (positionalArgs.length > 0) {
      title = positionalArgs[0];
    }
  }

  return { args, title };
}

/**
 * Print node details to console
 *
 * @param {object} result - Creation result with node and optional relationship
 */
function printNodeDetails(result) {
  const { node, relationship } = result;

  console.log(`${LOG_PREFIX} Node created (${node.id})`);
  console.log('');
  console.log('Node Details:');
  console.log(`  ID:         ${node.id}`);
  console.log(`  Type:       ${node.type}`);
  console.log(`  Lifecycle:  ${node.lifecycle}`);
  console.log(`  Created At: ${node.created_at}`);

  if (node.wu_id) {
    console.log(`  WU:         ${node.wu_id}`);
  }
  if (node.session_id) {
    console.log(`  Session:    ${node.session_id}`);
  }

  console.log('');
  console.log('Content:');
  console.log(`  ${node.content}`);

  if (node.tags && node.tags.length > 0) {
    console.log('');
    console.log('Tags:');
    console.log(`  ${node.tags.join(', ')}`);
  }

  if (node.metadata) {
    printMetadata(node.metadata);
  }

  if (relationship) {
    console.log('');
    console.log('Provenance:');
    console.log(`  Discovered From: ${relationship.to_id}`);
    console.log(`  Relationship:    ${relationship.type}`);
  }

  console.log('');
}

/**
 * Print metadata section to console
 *
 * @param {object} metadata - Node metadata
 */
function printMetadata(metadata) {
  console.log('');
  console.log('Metadata:');
  if (metadata.priority) {
    console.log(`  Priority: ${metadata.priority}`);
  }
}

/**
 * Main CLI entry point
 */
async function main() {
  const { args, title } = parseArguments();

  if (!title) {
    console.error(`${LOG_PREFIX} Error: title is required`);
    console.error('');
    console.error("Usage: pnpm mem:create 'title' [options]");
    console.error("       pnpm mem:create --title 'title' [options]");
    console.error('');
    console.error('Options:');
    console.error(
      '  --type <type>            Node type (discovery, session, checkpoint, note, summary) or alias (bug, idea, question, dependency)',
    );
    console.error('  --discovered-from <id>   Parent node ID for provenance (mem-XXXX)');
    console.error('  --wu <id>                WU ID to link node to (WU-XXX)');
    console.error('  --session <id>           Session ID to link node to (UUID)');
    console.error('  --tags <tags>            Comma-separated tags');
    console.error('  --priority <level>       Priority level (P0, P1, P2, P3)');
    console.error('  --quiet                  Suppress output except errors');
    process.exit(EXIT_CODES.ERROR);
  }

  const baseDir = args.baseDir || process.cwd();
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  // Parse tags if provided
  const tags = args.tags ? args.tags.split(',').map((t) => t.trim()) : undefined;

  let result;
  let error = null;

  try {
    result = await createMemoryNode(baseDir, {
      title,
      type: args.type,
      wuId: args.wu,
      sessionId: args.session,
      discoveredFrom: args.discoveredFrom,
      tags,
      priority: args.priority,
    });
  } catch (err) {
    error = err.message;
  }

  const durationMs = Date.now() - startTime;

  await writeAuditLog(baseDir, {
    tool: TOOL_NAME,
    status: error ? 'failed' : 'success',
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs,
    input: {
      baseDir,
      title,
      type: args.type,
      wuId: args.wu,
      sessionId: args.session,
      discoveredFrom: args.discoveredFrom,
      tags,
      priority: args.priority,
    },
    output: result
      ? {
          success: result.success,
          nodeId: result.node?.id,
          wuId: result.node?.wu_id,
          hasRelationship: !!result.relationship,
        }
      : null,
    error: error ? { message: error } : null,
  });

  if (error) {
    console.error(`${LOG_PREFIX} Error: ${error}`);
    process.exit(EXIT_CODES.ERROR);
  }

  if (args.quiet) {
    console.log(result.node.id);
    process.exit(EXIT_CODES.SUCCESS);
  }

  printNodeDetails(result);
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  runCLI(main);
}

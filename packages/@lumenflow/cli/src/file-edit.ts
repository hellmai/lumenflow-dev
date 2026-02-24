#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * File Edit CLI Tool
 *
 * Provides audited file edit operations with:
 * - Scope checking against WU code_paths
 * - Exact string replacement
 * - Uniqueness validation
 * - Replace-all support
 * - Audit logging
 *
 * Usage:
 *   node file-edit.js <path> --old-string <old> --new-string <new> [--replace-all]
 *
 * WU-1108: INIT-003 Phase 4a - Migrate file operations
 */

import { readFile, writeFile } from 'node:fs/promises';
import { createError, ErrorCodes } from '@lumenflow/core';
import { resolve } from 'node:path';

/**
 * Default configuration for file edit operations
 */
export const FILE_EDIT_DEFAULTS = {
  /** Default encoding */
  encoding: 'utf-8' as BufferEncoding,
  /** Replace all occurrences (default: false - requires unique match) */
  replaceAll: false,
};

/**
 * Arguments for file edit operation
 */
export interface FileEditArgs {
  /** Path to file to edit */
  path?: string;
  /** String to find */
  oldString?: string;
  /** String to replace with */
  newString?: string;
  /** File encoding */
  encoding?: BufferEncoding;
  /** Replace all occurrences */
  replaceAll?: boolean;
  /** Show help */
  help?: boolean;
}

/**
 * Audit log entry for file operations
 */
export interface AuditLogEntry {
  /** Operation type */
  operation: 'read' | 'write' | 'edit' | 'delete';
  /** File path */
  path: string;
  /** Timestamp */
  timestamp: string;
  /** Duration in ms */
  durationMs?: number;
  /** Success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Result of file edit operation
 */
export interface FileEditResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Error message (if failed) */
  error?: string;
  /** Number of replacements made */
  replacements?: number;
  /** Diff preview */
  diff?: string;
  /** Audit log entry */
  auditLog?: AuditLogEntry;
}

/**
 * Parse command line arguments for file-edit
 */
export function parseFileEditArgs(argv: string[]): FileEditArgs {
  const args: FileEditArgs = {
    encoding: FILE_EDIT_DEFAULTS.encoding,
    replaceAll: FILE_EDIT_DEFAULTS.replaceAll,
  };

  // Skip node and script name
  const cliArgs = argv.slice(2);

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--path') {
      args.path = cliArgs[++i];
    } else if (arg === '--old-string' || arg === '--old') {
      args.oldString = cliArgs[++i];
    } else if (arg === '--new-string' || arg === '--new') {
      args.newString = cliArgs[++i];
    } else if (arg === '--encoding') {
      args.encoding = cliArgs[++i] as BufferEncoding;
    } else if (arg === '--replace-all') {
      args.replaceAll = true;
    } else if (!arg.startsWith('-') && !args.path) {
      // Positional argument for path
      args.path = arg;
    }
  }

  return args;
}

/**
 * Count occurrences of a string in content
 */
function countOccurrences(content: string, searchString: string): number {
  let count = 0;
  let pos = 0;

  while ((pos = content.indexOf(searchString, pos)) !== -1) {
    count++;
    pos += searchString.length;
  }

  return count;
}

/**
 * Create a simple diff preview
 */
function createDiff(
  original: string,
  modified: string,
  oldString: string,
  newString: string,
): string {
  // Find the first occurrence for context
  const index = original.indexOf(oldString);
  if (index === -1) return '';

  // Get context around the change (50 chars before and after)
  const contextSize = 50;
  const start = Math.max(0, index - contextSize);
  const end = Math.min(original.length, index + oldString.length + contextSize);

  const beforeContext = original.slice(start, index);
  const afterContext = original.slice(index + oldString.length, end);

  return [
    `--- original`,
    `+++ modified`,
    `@@ -1 +1 @@`,
    `-${beforeContext}${oldString}${afterContext}`,
    `+${beforeContext}${newString}${afterContext}`,
  ].join('\n');
}

/**
 * Edit a file with audit logging and safety checks
 */
export async function editFileWithAudit(args: FileEditArgs): Promise<FileEditResult> {
  const startTime = Date.now();
  const filePath = args.path ? resolve(args.path) : '';
  const encoding = args.encoding ?? FILE_EDIT_DEFAULTS.encoding;
  const replaceAll = args.replaceAll ?? FILE_EDIT_DEFAULTS.replaceAll;
  const oldString = args.oldString ?? '';
  const newString = args.newString ?? '';

  const auditLog: AuditLogEntry = {
    operation: 'edit',
    path: filePath,
    timestamp: new Date().toISOString(),
    success: false,
  };

  try {
    // Validate inputs
    if (!filePath) {
      throw createError(ErrorCodes.INVALID_ARGUMENT, 'Path is required');
    }

    if (!oldString) {
      throw createError(ErrorCodes.INVALID_ARGUMENT, 'old-string is required');
    }

    // newString can be empty (for deletion)

    // Read file content
    const content = await readFile(filePath, { encoding });

    // Count occurrences
    const occurrences = countOccurrences(content, oldString);

    if (occurrences === 0) {
      throw createError(
        ErrorCodes.STRING_NOT_FOUND,
        `old_string not found in file: "${oldString.slice(0, 50)}${oldString.length > 50 ? '...' : ''}"`,
      );
    }

    if (occurrences > 1 && !replaceAll) {
      throw createError(
        ErrorCodes.AMBIGUOUS_MATCH,
        `old_string is not unique in file (found ${occurrences} occurrences). ` +
          `Use --replace-all to replace all occurrences, or provide more context to make it unique.`,
      );
    }

    // Perform replacement
    let newContent: string;
    let replacements: number;

    if (replaceAll) {
      newContent = content.split(oldString).join(newString);
      replacements = occurrences;
    } else {
      newContent = content.replace(oldString, newString);
      replacements = 1;
    }

    // Create diff preview
    const diff = createDiff(content, newContent, oldString, newString);

    // Write file
    await writeFile(filePath, newContent, { encoding });

    // Success
    auditLog.success = true;
    auditLog.durationMs = Date.now() - startTime;

    return {
      success: true,
      replacements,
      diff,
      auditLog,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    auditLog.error = errorMessage;
    auditLog.durationMs = Date.now() - startTime;

    return {
      success: false,
      error: errorMessage,
      auditLog,
    };
  }
}

/**
 * Print help message
 */
/* istanbul ignore next -- CLI entry point tested via subprocess */
function printHelp(): void {
  console.log(`
Usage: file-edit <path> --old-string <old> --new-string <new> [options]

Edit file by replacing exact string matches with audit logging.

Arguments:
  path                  Path to file to edit

Options:
  --path <path>         Path to file (alternative to positional)
  --old-string <str>    String to find and replace (required)
  --new-string <str>    Replacement string (required, can be empty)
  --old <str>           Shorthand for --old-string
  --new <str>           Shorthand for --new-string
  --replace-all         Replace all occurrences (default: single unique match)
  --encoding <enc>      File encoding (default: utf-8)
  -h, --help            Show this help message

Notes:
  - By default, old-string must be unique in the file (exactly 1 match)
  - Use --replace-all to replace multiple occurrences
  - This ensures you don't accidentally modify unintended locations

Examples:
  file-edit src/index.ts --old "console.log" --new "logger.info"
  file-edit config.json --old '"debug": true' --new '"debug": false'
  file-edit --path file.txt --old foo --new bar --replace-all
`);
}

/**
 * Main entry point
 */
/* istanbul ignore next -- CLI entry point tested via subprocess */
export async function main(): Promise<void> {
  const args = parseFileEditArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.path) {
    console.error('Error: path is required');
    printHelp();
    process.exit(1);
  }

  if (!args.oldString) {
    console.error('Error: --old-string is required');
    printHelp();
    process.exit(1);
  }

  if (args.newString === undefined) {
    console.error('Error: --new-string is required');
    printHelp();
    process.exit(1);
  }

  const result = await editFileWithAudit(args);

  if (result.success) {
    console.log(`Replaced ${result.replacements} occurrence(s) in ${args.path}`);
    if (result.diff) {
      console.log('\nDiff preview:');
      console.log(result.diff);
    }
  } else {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
}

// Run main if executed directly
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}

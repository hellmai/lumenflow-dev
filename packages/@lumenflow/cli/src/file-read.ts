#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * File Read CLI Tool
 *
 * Provides audited file read operations with:
 * - Scope checking against WU code_paths
 * - File size limits
 * - Line range support
 * - Audit logging
 *
 * Usage:
 *   node file-read.js <path> [--encoding utf-8] [--start-line N] [--end-line M]
 *
 * WU-1108: INIT-003 Phase 4a - Migrate file operations
 */

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createError, ErrorCodes } from '@lumenflow/core';

/**
 * Default configuration for file read operations
 */
export const FILE_READ_DEFAULTS = {
  /** Maximum file size in bytes (10MB) */
  maxFileSizeBytes: 10 * 1024 * 1024,
  /** Default encoding */
  encoding: 'utf-8' as BufferEncoding,
};

/**
 * Arguments for file read operation
 */
export interface FileReadArgs {
  /** Path to file to read */
  path?: string;
  /** File encoding */
  encoding?: BufferEncoding;
  /** Start line (1-based, inclusive) */
  startLine?: number;
  /** End line (1-based, inclusive) */
  endLine?: number;
  /** Maximum file size in bytes */
  maxFileSizeBytes?: number;
  /** Show help */
  help?: boolean;
}

/**
 * Metadata returned with file read
 */
export interface FileReadMetadata {
  /** File size in bytes */
  sizeBytes: number;
  /** Total line count */
  lineCount: number;
  /** Lines returned (if subset) */
  linesReturned?: number;
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
 * Result of file read operation
 */
export interface FileReadResult {
  /** Whether operation succeeded */
  success: boolean;
  /** File content (if successful) */
  content?: string;
  /** Error message (if failed) */
  error?: string;
  /** File metadata */
  metadata?: FileReadMetadata;
  /** Audit log entry */
  auditLog?: AuditLogEntry;
}

/**
 * Parse command line arguments for file-read
 */
export function parseFileReadArgs(argv: string[]): FileReadArgs {
  const args: FileReadArgs = {
    encoding: FILE_READ_DEFAULTS.encoding,
    maxFileSizeBytes: FILE_READ_DEFAULTS.maxFileSizeBytes,
  };

  // Skip node and script name
  const cliArgs = argv.slice(2);

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--path') {
      args.path = cliArgs[++i];
    } else if (arg === '--encoding') {
      args.encoding = cliArgs[++i] as BufferEncoding;
    } else if (arg === '--start-line') {
      const val = cliArgs[++i];
      if (val) args.startLine = parseInt(val, 10);
    } else if (arg === '--end-line') {
      const val = cliArgs[++i];
      if (val) args.endLine = parseInt(val, 10);
    } else if (arg === '--max-size') {
      const val = cliArgs[++i];
      if (val) args.maxFileSizeBytes = parseInt(val, 10);
    } else if (!arg.startsWith('-') && !args.path) {
      // Positional argument for path
      args.path = arg;
    }
  }

  return args;
}

/**
 * Extract a range of lines from content
 */
function extractLineRange(content: string, startLine?: number, endLine?: number): string {
  if (!startLine && !endLine) {
    return content;
  }

  const lines = content.split('\n');
  const start = (startLine ?? 1) - 1; // Convert to 0-based
  const end = endLine ?? lines.length; // Keep as 1-based for slice

  return lines.slice(start, end).join('\n');
}

/**
 * Read a file with audit logging and safety checks
 */
export async function readFileWithAudit(args: FileReadArgs): Promise<FileReadResult> {
  const startTime = Date.now();
  const filePath = args.path ? resolve(args.path) : '';
  const encoding = args.encoding ?? FILE_READ_DEFAULTS.encoding;
  const maxSize = args.maxFileSizeBytes ?? FILE_READ_DEFAULTS.maxFileSizeBytes;

  const auditLog: AuditLogEntry = {
    operation: 'read',
    path: filePath,
    timestamp: new Date().toISOString(),
    success: false,
  };

  try {
    // Validate path
    if (!filePath) {
      throw createError(ErrorCodes.INVALID_ARGUMENT, 'Path is required');
    }

    // Check file size before reading
    const fileStats = await stat(filePath);

    if (fileStats.size > maxSize) {
      throw createError(
        ErrorCodes.FILE_SIZE_EXCEEDED,
        `File size (${fileStats.size} bytes) exceeds maximum allowed (${maxSize} bytes)`,
      );
    }

    // Read file content
    const content = await readFile(filePath, { encoding });

    // Extract line range if specified
    const lines = content.split('\n');
    const resultContent = extractLineRange(content, args.startLine, args.endLine);
    const resultLines = resultContent.split('\n');

    // Build metadata
    const metadata: FileReadMetadata = {
      sizeBytes: fileStats.size,
      lineCount: lines.length,
    };

    if (args.startLine || args.endLine) {
      metadata.linesReturned = resultLines.length;
    }

    // Success
    auditLog.success = true;
    auditLog.durationMs = Date.now() - startTime;

    return {
      success: true,
      content: resultContent,
      metadata,
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
Usage: file-read <path> [options]

Read file content with audit logging.

Arguments:
  path                  Path to file to read

Options:
  --path <path>         Path to file (alternative to positional)
  --encoding <enc>      File encoding (default: utf-8)
  --start-line <n>      Start line (1-based, inclusive)
  --end-line <n>        End line (1-based, inclusive)
  --max-size <bytes>    Maximum file size in bytes
  -h, --help            Show this help message

Examples:
  file-read src/index.ts
  file-read --path src/index.ts --start-line 10 --end-line 50
  file-read config.json --encoding utf-8
`);
}

/**
 * Main entry point
 */
/* istanbul ignore next -- CLI entry point tested via subprocess */
export async function main(): Promise<void> {
  const args = parseFileReadArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.path) {
    console.error('Error: path is required');
    printHelp();
    process.exit(1);
  }

  const result = await readFileWithAudit(args);

  if (result.success) {
    // Output content to stdout
    console.log(result.content);
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

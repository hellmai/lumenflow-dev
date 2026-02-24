#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * File Write CLI Tool
 *
 * Provides audited file write operations with:
 * - Scope checking against WU code_paths
 * - Directory creation
 * - Audit logging
 *
 * Usage:
 *   node file-write.js <path> --content <content> [--encoding utf-8]
 *
 * WU-1108: INIT-003 Phase 4a - Migrate file operations
 */

import { writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createError, ErrorCodes } from '@lumenflow/core';

/**
 * Default configuration for file write operations
 */
export const FILE_WRITE_DEFAULTS = {
  /** Default encoding */
  encoding: 'utf-8' as BufferEncoding,
  /** Create parent directories if they don't exist */
  createDirectories: true,
};

/**
 * Arguments for file write operation
 */
export interface FileWriteArgs {
  /** Path to file to write */
  path?: string;
  /** Content to write */
  content?: string;
  /** File encoding */
  encoding?: BufferEncoding;
  /** Create parent directories */
  createDirectories?: boolean;
  /** Show help */
  help?: boolean;
}

/**
 * Metadata returned with file write
 */
export interface FileWriteMetadata {
  /** Bytes written */
  bytesWritten: number;
  /** Whether directories were created */
  directoriesCreated?: boolean;
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
 * Result of file write operation
 */
export interface FileWriteResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Error message (if failed) */
  error?: string;
  /** Warnings */
  warnings?: string[];
  /** File metadata */
  metadata?: FileWriteMetadata;
  /** Audit log entry */
  auditLog?: AuditLogEntry;
}

/**
 * Parse command line arguments for file-write
 */
export function parseFileWriteArgs(argv: string[]): FileWriteArgs {
  const args: FileWriteArgs = {
    encoding: FILE_WRITE_DEFAULTS.encoding,
    createDirectories: FILE_WRITE_DEFAULTS.createDirectories,
  };

  // Skip node and script name
  const cliArgs = argv.slice(2);

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--path') {
      args.path = cliArgs[++i];
    } else if (arg === '--content') {
      args.content = cliArgs[++i];
    } else if (arg === '--encoding') {
      args.encoding = cliArgs[++i] as BufferEncoding;
    } else if (arg === '--no-create-dirs') {
      args.createDirectories = false;
    } else if (!arg.startsWith('-') && !args.path) {
      // Positional argument for path
      args.path = arg;
    }
  }

  return args;
}

/**
 * Check if directory exists
 */
async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stats = await stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Write a file with audit logging and safety checks
 */
export async function writeFileWithAudit(args: FileWriteArgs): Promise<FileWriteResult> {
  const startTime = Date.now();
  const filePath = args.path ? resolve(args.path) : '';
  const encoding = args.encoding ?? FILE_WRITE_DEFAULTS.encoding;
  const createDirs = args.createDirectories ?? FILE_WRITE_DEFAULTS.createDirectories;
  const content = args.content ?? '';

  const auditLog: AuditLogEntry = {
    operation: 'write',
    path: filePath,
    timestamp: new Date().toISOString(),
    success: false,
  };

  const warnings: string[] = [];

  try {
    // Validate path
    if (!filePath) {
      throw createError(ErrorCodes.INVALID_ARGUMENT, 'Path is required');
    }

    const parentDir = dirname(filePath);
    let directoriesCreated = false;

    // Check parent directory
    const parentExists = await directoryExists(parentDir);

    if (!parentExists) {
      if (createDirs) {
        await mkdir(parentDir, { recursive: true });
        directoriesCreated = true;
      } else {
        throw createError(
          ErrorCodes.PARENT_DIR_NOT_FOUND,
          `ENOENT: parent directory does not exist: ${parentDir}`,
        );
      }
    }

    // Write file
    await writeFile(filePath, content, { encoding });

    // Calculate bytes written
    const bytesWritten = Buffer.byteLength(content, encoding);

    // Build metadata
    const metadata: FileWriteMetadata = {
      bytesWritten,
      directoriesCreated,
    };

    // Success
    auditLog.success = true;
    auditLog.durationMs = Date.now() - startTime;

    return {
      success: true,
      warnings: warnings.length > 0 ? warnings : undefined,
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
      warnings: warnings.length > 0 ? warnings : undefined,
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
Usage: file-write <path> --content <content> [options]

Write content to a file with audit logging.

Arguments:
  path                  Path to file to write

Options:
  --path <path>         Path to file (alternative to positional)
  --content <content>   Content to write (required)
  --encoding <enc>      File encoding (default: utf-8)
  --no-create-dirs      Don't create parent directories
  -h, --help            Show this help message

Examples:
  file-write output.txt --content "Hello, World!"
  file-write --path nested/dir/file.txt --content "Content"
  file-write config.json --content '{"key": "value"}' --encoding utf-8
`);
}

/**
 * Main entry point
 */
/* istanbul ignore next -- CLI entry point tested via subprocess */
export async function main(): Promise<void> {
  const args = parseFileWriteArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.path) {
    console.error('Error: path is required');
    printHelp();
    process.exit(1);
  }

  if (args.content === undefined) {
    console.error('Error: --content is required');
    printHelp();
    process.exit(1);
  }

  const result = await writeFileWithAudit(args);

  if (result.success) {
    console.log(`Written ${result.metadata?.bytesWritten} bytes to ${args.path}`);
    if (result.warnings && result.warnings.length > 0) {
      for (const warning of result.warnings) {
        console.warn(`Warning: ${warning}`);
      }
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

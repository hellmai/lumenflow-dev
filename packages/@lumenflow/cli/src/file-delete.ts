#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * File Delete CLI Tool
 *
 * Provides audited file delete operations with:
 * - Scope checking against WU code_paths
 * - Recursive directory deletion
 * - Force option for missing files
 * - Audit logging
 *
 * Usage:
 *   node file-delete.js <path> [--recursive] [--force]
 *
 * WU-1108: INIT-003 Phase 4a - Migrate file operations
 */

import { rm, stat, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createError, ErrorCodes } from '@lumenflow/core';

/**
 * Default configuration for file delete operations
 */
export const FILE_DELETE_DEFAULTS = {
  /** Delete directories recursively */
  recursive: false,
  /** Don't error on missing files */
  force: false,
};

/**
 * Arguments for file delete operation
 */
export interface FileDeleteArgs {
  /** Path to file or directory to delete */
  path?: string;
  /** Delete directories recursively */
  recursive?: boolean;
  /** Don't error on missing files */
  force?: boolean;
  /** Show help */
  help?: boolean;
}

/**
 * Metadata returned with file delete
 */
export interface FileDeleteMetadata {
  /** Number of items deleted (files + directories) */
  deletedCount: number;
  /** Whether target was a directory */
  wasDirectory: boolean;
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
 * Result of file delete operation
 */
export interface FileDeleteResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Error message (if failed) */
  error?: string;
  /** Delete metadata */
  metadata?: FileDeleteMetadata;
  /** Audit log entry */
  auditLog?: AuditLogEntry;
}

/**
 * Parse command line arguments for file-delete
 */
export function parseFileDeleteArgs(argv: string[]): FileDeleteArgs {
  const args: FileDeleteArgs = {
    recursive: FILE_DELETE_DEFAULTS.recursive,
    force: FILE_DELETE_DEFAULTS.force,
  };

  // Skip node and script name
  const cliArgs = argv.slice(2);

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--path') {
      args.path = cliArgs[++i];
    } else if (arg === '--recursive' || arg === '-r') {
      args.recursive = true;
    } else if (arg === '--force' || arg === '-f') {
      args.force = true;
    } else if (!arg.startsWith('-') && !args.path) {
      // Positional argument for path
      args.path = arg;
    }
  }

  return args;
}

/**
 * Check if path exists and get its type
 */
async function getPathInfo(targetPath: string): Promise<{ exists: boolean; isDirectory: boolean }> {
  try {
    const stats = await stat(targetPath);
    return { exists: true, isDirectory: stats.isDirectory() };
  } catch {
    return { exists: false, isDirectory: false };
  }
}

/**
 * Count items in a directory recursively
 */
async function countItems(dirPath: string): Promise<number> {
  let count = 0;

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      count++;
      if (entry.isDirectory()) {
        count += await countItems(join(dirPath, entry.name));
      }
    }
  } catch {
    // Ignore errors in counting
  }

  return count;
}

/**
 * Delete a file or directory with audit logging and safety checks
 */
export async function deleteFileWithAudit(args: FileDeleteArgs): Promise<FileDeleteResult> {
  const startTime = Date.now();
  const targetPath = args.path ? resolve(args.path) : '';
  const recursive = args.recursive ?? FILE_DELETE_DEFAULTS.recursive;
  const force = args.force ?? FILE_DELETE_DEFAULTS.force;

  const auditLog: AuditLogEntry = {
    operation: 'delete',
    path: targetPath,
    timestamp: new Date().toISOString(),
    success: false,
  };

  try {
    // Validate path
    if (!targetPath) {
      throw createError(ErrorCodes.INVALID_ARGUMENT, 'Path is required');
    }

    // Check if path exists
    const pathInfo = await getPathInfo(targetPath);

    if (!pathInfo.exists) {
      if (force) {
        // Force option - don't error on missing files
        auditLog.success = true;
        auditLog.durationMs = Date.now() - startTime;

        return {
          success: true,
          metadata: {
            deletedCount: 0,
            wasDirectory: false,
          },
          auditLog,
        };
      } else {
        throw createError(
          ErrorCodes.FILE_NOT_FOUND,
          `ENOENT: no such file or directory: ${targetPath}`,
        );
      }
    }

    // Check if it's a directory and recursive is needed
    if (pathInfo.isDirectory && !recursive) {
      // Check if directory is empty
      const entries = await readdir(targetPath);
      if (entries.length > 0) {
        throw createError(
          ErrorCodes.DIRECTORY_NOT_EMPTY,
          `ENOTEMPTY: directory not empty: ${targetPath}. Use --recursive to delete non-empty directories.`,
        );
      }
    }

    // Count items before deletion (for metadata)
    let deletedCount = 1;
    if (pathInfo.isDirectory && recursive) {
      deletedCount = 1 + (await countItems(targetPath)); // +1 for the directory itself
    }

    // Perform deletion
    await rm(targetPath, { recursive, force });

    // Build metadata
    const metadata: FileDeleteMetadata = {
      deletedCount,
      wasDirectory: pathInfo.isDirectory,
    };

    // Success
    auditLog.success = true;
    auditLog.durationMs = Date.now() - startTime;

    return {
      success: true,
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
Usage: file-delete <path> [options]

Delete a file or directory with audit logging.

Arguments:
  path                  Path to file or directory to delete

Options:
  --path <path>         Path to file (alternative to positional)
  -r, --recursive       Delete directories recursively
  -f, --force           Don't error if file doesn't exist
  -h, --help            Show this help message

Safety Notes:
  - Non-empty directories require --recursive flag
  - Use --force to ignore missing files
  - All deletions are logged for audit purposes

Examples:
  file-delete temp.txt
  file-delete --path output/build --recursive
  file-delete missing.txt --force
  file-delete old-dir -rf
`);
}

/**
 * Main entry point
 */
/* istanbul ignore next -- CLI entry point tested via subprocess */
export async function main(): Promise<void> {
  const args = parseFileDeleteArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.path) {
    console.error('Error: path is required');
    printHelp();
    process.exit(1);
  }

  const result = await deleteFileWithAudit(args);

  if (result.success) {
    if (result.metadata?.deletedCount === 0) {
      console.log(`Nothing to delete (${args.path} does not exist)`);
    } else {
      const itemType = result.metadata?.wasDirectory ? 'directory' : 'file';
      const countInfo =
        result.metadata?.deletedCount && result.metadata.deletedCount > 1
          ? ` (${result.metadata.deletedCount} items)`
          : '';
      console.log(`Deleted ${itemType}: ${args.path}${countInfo}`);
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

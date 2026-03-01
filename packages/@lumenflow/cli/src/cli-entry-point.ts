// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared CLI entry point wrapper
 *
 * Provides consistent error handling for all CLI commands.
 * Catches async errors, logs them, and exits with proper code.
 *
 * WU-1071: Use import.meta.main (Node.js 22.16.0+) instead of the old
 * process.argv[1] === fileURLToPath(import.meta.url) pattern. The old
 * pattern fails with pnpm symlinks because process.argv[1] is the symlink
 * path but import.meta.url resolves to the real path - they never match
 * so main() is never called.
 *
 * WU-1085: Initializes color support respecting NO_COLOR/FORCE_COLOR/--no-color
 *
 * WU-1929: Adds branded header support via showHeader option
 *
 * WU-1233: Adds EPIPE protection for pipe resilience. When CLI output is piped
 * through head/tail, the pipe may close before all output is written. Without
 * this protection, Node.js throws unhandled EPIPE errors crashing the process.
 *
 * @example
 * ```typescript
 * // At the bottom of each CLI file:
 * import { runCLI } from './cli-entry-point.js';
 *
 * if (import.meta.main) {
 *   void runCLI(main);
 * }
 * ```
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_CODES } from '@lumenflow/core/wu-constants';
import { initColorSupport, StreamErrorHandler, ProcessExitError } from '@lumenflow/core';
import { getErrorMessage } from '@lumenflow/core/error-handler';
import { printHeader } from './formatters.js';
import { runSignalMiddleware, resolveCommandNameFromArgv } from './signal-middleware.js';

const HELP_HINT_MESSAGE = 'Hint: Run with --help to see valid options.';
const COMMANDER_USAGE_ERROR_CODES = new Set([
  'commander.unknownOption',
  'commander.missingArgument',
  'commander.missingMandatoryOptionValue',
  'commander.optionMissingArgument',
]);

/**
 * WU-1929: Read the CLI package version from the nearest package.json.
 * Returns empty string on failure (no crash for missing file).
 */
export function getCliVersion(): string {
  try {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(thisDir, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : '';
  } catch {
    return '';
  }
}

/**
 * Options for runCLI wrapper.
 */
export interface RunCLIOptions {
  /** WU-1929: Print branded header before executing the command */
  showHeader?: boolean;
  /** WU-2147: Explicit command name override for signal middleware */
  commandName?: string;
}

/**
 * Wraps an async main function with proper error handling.
 * WU-1085: Also initializes color support based on NO_COLOR/FORCE_COLOR/--no-color
 * WU-1233: Attaches EPIPE handler for graceful pipe closure
 * WU-1538: Catches ProcessExitError from core modules and maps to process.exit
 * WU-1929: Optionally prints branded header with version
 *
 * @param main - The async main function to execute
 * @param options - Optional configuration (showHeader, etc.)
 * @returns Promise that resolves when main completes (or after error handling)
 */
export async function runCLI(main: () => Promise<void>, options?: RunCLIOptions): Promise<void> {
  // WU-1233: Attach EPIPE handler before running command
  // This must be done early to catch UnsafeAny EPIPE errors during execution
  const streamErrorHandler = StreamErrorHandler.createWithDefaults();
  streamErrorHandler.attach();

  // WU-1085: Initialize color support before running command
  initColorSupport();

  // WU-1929: Print branded header if requested
  if (options?.showHeader) {
    printHeader({ version: getCliVersion() });
  }

  // WU-2147: Surface unread coordination signals for high-value commands.
  // This middleware is fail-open and writes only to stderr.
  await runSignalMiddleware({
    commandName: options?.commandName ?? resolveCommandNameFromArgv(process.argv),
    baseDir: process.cwd(),
  });

  try {
    await main();
  } catch (err: unknown) {
    // WU-1538: ProcessExitError carries the intended exit code from core modules.
    // die() already logged the message, so we just exit with the correct code.
    if (err instanceof ProcessExitError) {
      process.exit(err.exitCode);
      return;
    }

    // Generic errors: log message and exit with error code
    const message = getErrorMessage(err);
    console.error(message);
    if (shouldPrintHelpHint(err, message)) {
      console.error(HELP_HINT_MESSAGE);
    }
    process.exit(EXIT_CODES.ERROR);
  }
}

// WU-2048: getErrorMessage imported from @lumenflow/core/error-handler

function shouldPrintHelpHint(err: unknown, message: string): boolean {
  const directCode = getStringProperty(err, 'code');
  if (directCode && COMMANDER_USAGE_ERROR_CODES.has(directCode)) {
    return true;
  }

  const details = getObjectProperty(err, 'details');
  const detailsCode = getStringProperty(details, 'code');
  if (detailsCode && COMMANDER_USAGE_ERROR_CODES.has(detailsCode)) {
    return true;
  }

  const normalized = message.toLowerCase();
  return (
    normalized.includes('unknown option') ||
    normalized.includes('required option') ||
    normalized.includes('missing argument') ||
    normalized.includes('option argument missing')
  );
}

function getObjectProperty(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const maybeObject = value as Record<string, unknown>;
  const property = maybeObject[key];
  if (!property || typeof property !== 'object') {
    return null;
  }
  return property as Record<string, unknown>;
}

function getStringProperty(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const maybeObject = value as Record<string, unknown>;
  const property = maybeObject[key];
  return typeof property === 'string' ? property : null;
}

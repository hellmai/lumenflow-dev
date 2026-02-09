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
 *   runCLI(main);
 * }
 * ```
 */
import { EXIT_CODES } from '@lumenflow/core/wu-constants';
import { initColorSupport, StreamErrorHandler } from '@lumenflow/core';

/**
 * Wraps an async main function with proper error handling.
 * WU-1085: Also initializes color support based on NO_COLOR/FORCE_COLOR/--no-color
 * WU-1233: Attaches EPIPE handler for graceful pipe closure
 *
 * @param main - The async main function to execute
 * @returns Promise that resolves when main completes (or after error handling)
 */
export async function runCLI(main: () => Promise<void>): Promise<void> {
  // WU-1233: Attach EPIPE handler before running command
  // This must be done early to catch any EPIPE errors during execution
  const streamErrorHandler = StreamErrorHandler.createWithDefaults();
  streamErrorHandler.attach();

  // WU-1085: Initialize color support before running command
  initColorSupport();

  try {
    await main();
  } catch (err: unknown) {
    const message = getErrorMessage(err);
    console.error(message);
    process.exit(EXIT_CODES.ERROR);
  }
}

/**
 * Extracts error message from unknown error type.
 */
function getErrorMessage(err: unknown): string {
  if (err === null || err === undefined) {
    return 'Unknown error';
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

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
import { EXIT_CODES } from '@lumenflow/core/dist/wu-constants.js';

/**
 * Wraps an async main function with proper error handling.
 *
 * @param main - The async main function to execute
 * @returns Promise that resolves when main completes (or after error handling)
 */
export async function runCLI(main: () => Promise<void>): Promise<void> {
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

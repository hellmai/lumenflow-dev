/**
 * Shared CLI entry point wrapper
 *
 * Provides consistent error handling for all CLI commands.
 * Catches async errors, logs them, and exits with proper code.
 *
 * @example
 * ```typescript
 * // At the bottom of each CLI file:
 * import { runCLI } from './cli-entry-point.js';
 * import { fileURLToPath } from 'node:url';
 *
 * if (process.argv[1] === fileURLToPath(import.meta.url)) {
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

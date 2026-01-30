/**
 * Stream Error Handler
 *
 * WU-1233: Centralized EPIPE protection for CLI commands.
 *
 * When CLI output is piped through head/tail, the pipe may close before
 * all output is written. Node.js throws EPIPE errors in this case.
 * This handler catches those errors and exits gracefully.
 *
 * Unix convention: Exit with code 0 on EPIPE (the consumer got what it needed).
 *
 * @example
 * ```typescript
 * import { StreamErrorHandler } from '@lumenflow/core';
 *
 * // In CLI entry point:
 * const handler = StreamErrorHandler.createWithDefaults();
 * handler.attach();
 * ```
 */

import type { WriteStream } from 'node:tty';
import { STREAM_ERRORS, EXIT_CODES } from './wu-constants.js';

/**
 * Dependencies for StreamErrorHandler
 *
 * Uses dependency injection for testability.
 */
export interface StreamErrorHandlerDeps {
  /** Standard output stream */
  stdout: WriteStream;
  /** Standard error stream */
  stderr: WriteStream;
  /** Exit function (defaults to process.exit) */
  exitFn: (code: number) => void;
}

/**
 * Error type with code property (Node.js system errors)
 */
interface NodeSystemError extends Error {
  code?: string;
}

/**
 * StreamErrorHandler
 *
 * Attaches error listeners to stdout/stderr to handle EPIPE errors gracefully.
 * Follows single responsibility principle - only handles stream errors.
 */
export class StreamErrorHandler {
  private readonly deps: StreamErrorHandlerDeps;
  private attached = false;
  private stdoutHandler: ((err: NodeSystemError) => void) | null = null;
  private stderrHandler: ((err: NodeSystemError) => void) | null = null;

  constructor(deps: StreamErrorHandlerDeps) {
    this.deps = deps;
  }

  /**
   * Create a handler with default dependencies (process.stdout, process.stderr, process.exit)
   */
  static createWithDefaults(): StreamErrorHandler {
    return new StreamErrorHandler({
      stdout: process.stdout as WriteStream,
      stderr: process.stderr as WriteStream,
      exitFn: (code: number) => process.exit(code),
    });
  }

  /**
   * Attach error listeners to stdout and stderr
   *
   * Safe to call multiple times - will not attach duplicate listeners.
   */
  attach(): void {
    if (this.attached) {
      return;
    }

    this.stdoutHandler = this.createErrorHandler();
    this.stderrHandler = this.createErrorHandler();

    this.deps.stdout.on('error', this.stdoutHandler);
    this.deps.stderr.on('error', this.stderrHandler);

    this.attached = true;
  }

  /**
   * Detach error listeners from stdout and stderr
   *
   * Safe to call even if not attached.
   */
  detach(): void {
    if (!this.attached) {
      return;
    }

    if (this.stdoutHandler) {
      this.deps.stdout.removeListener('error', this.stdoutHandler);
      this.stdoutHandler = null;
    }

    if (this.stderrHandler) {
      this.deps.stderr.removeListener('error', this.stderrHandler);
      this.stderrHandler = null;
    }

    this.attached = false;
  }

  /**
   * Create an error handler that catches EPIPE and exits gracefully
   */
  private createErrorHandler(): (err: NodeSystemError) => void {
    return (err: NodeSystemError) => {
      // Only handle EPIPE errors
      if (err.code === STREAM_ERRORS.EPIPE) {
        // Exit gracefully with success code (Unix convention)
        // The consumer of the pipe got what it needed
        this.deps.exitFn(EXIT_CODES.SUCCESS);
      }
      // Non-EPIPE errors are not handled here - let them propagate
    };
  }
}

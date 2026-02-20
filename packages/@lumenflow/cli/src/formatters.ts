/**
 * Beautiful CLI Output Formatters
 *
 * WU-1929: Provides branded header, colored status indicators,
 * structured tables, and progress spinners for consistent CLI output.
 *
 * Dependencies: chalk (color), cli-table3 (tables) - both already in package.json.
 * Spinner: lightweight inline implementation (no external dependency).
 *
 * @module formatters
 */

import chalk from 'chalk';
import Table from 'cli-table3';

// ── Constants ───────────────────────────────────────────────────────

const BRAND_NAME = 'LumenFlow';
const HEADER_WIDTH = 50;
const SPINNER_INTERVAL_MS = 80;
const SPINNER_FRAMES = ['|', '/', '-', '\\'];

/**
 * Color mappings for WU status values.
 * Maps each status to a chalk color function name.
 */
export const STATUS_COLORS: Record<string, (text: string) => string> = {
  ready: chalk.cyan,
  in_progress: chalk.yellow,
  done: chalk.green,
  blocked: chalk.red,
  waiting: chalk.magenta,
};

/** Default color for unknown statuses */
const DEFAULT_STATUS_COLOR = chalk.white;

// ── AC1: Branded Header ─────────────────────────────────────────────

/**
 * Format a branded header string with version information.
 *
 * @param options - Header options
 * @param options.version - CLI version string (optional)
 * @returns Formatted header string
 */
export function formatHeader(options: { version?: string } = {}): string {
  const separator = chalk.dim('─'.repeat(HEADER_WIDTH));
  const versionStr = options.version ? ` v${options.version}` : '';
  const title = chalk.bold.cyan(`${BRAND_NAME}${versionStr}`);
  const tagline = chalk.dim('The governance layer between AI agents and the world.');

  return [separator, title, tagline, separator].join('\n');
}

/**
 * Print the branded header to console.log.
 *
 * @param options - Header options
 * @param options.version - CLI version string (optional)
 */
export function printHeader(options: { version?: string } = {}): void {
  console.log(formatHeader(options));
}

// ── AC2: Colored Status Indicators ──────────────────────────────────

/**
 * Apply color to a WU status string based on its value.
 *
 * @param status - The WU status string (e.g., "ready", "in_progress", "done", "blocked")
 * @returns Colored string suitable for terminal output
 */
export function statusColor(status: string): string {
  const colorFn = STATUS_COLORS[status] ?? DEFAULT_STATUS_COLOR;
  return colorFn(status);
}

// ── AC3: Structured Tables ──────────────────────────────────────────

/**
 * Create a formatted table string using cli-table3.
 *
 * @param options - Table configuration
 * @param options.head - Column headers
 * @param options.rows - Array of row arrays
 * @param options.colWidths - Optional column widths
 * @returns Formatted table string
 */
export function createStatusTable(options: {
  head: string[];
  rows: string[][];
  colWidths?: number[];
}): string {
  const tableConfig: Table.TableConstructorOptions = {
    head: options.head,
    style: {
      head: ['cyan'],
    },
  };

  if (options.colWidths) {
    tableConfig.colWidths = options.colWidths;
  }

  const table = new Table(tableConfig);

  for (const row of options.rows) {
    table.push(row);
  }

  return table.toString();
}

// ── AC4: Progress Spinners ──────────────────────────────────────────

/**
 * Spinner interface for long-running operations.
 */
export interface Spinner {
  /** Start the spinner animation */
  start(): void;
  /** Stop the spinner (clears the line) */
  stop(): void;
  /** Stop with a success message */
  succeed(message?: string): void;
  /** Stop with a failure message */
  fail(message?: string): void;
}

/**
 * Create a lightweight terminal spinner for long-running operations.
 * Uses stderr to avoid polluting stdout (which may be piped).
 * No external dependency required.
 *
 * @param message - The message to display next to the spinner
 * @returns Spinner object with start/stop/succeed/fail methods
 */
export function createSpinner(message: string): Spinner {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let frameIndex = 0;

  function clearLine(): void {
    // Move cursor to beginning of line and clear it
    process.stderr.write('\r\x1B[K');
  }

  function renderFrame(): void {
    const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length];
    clearLine();
    process.stderr.write(`${chalk.cyan(frame)} ${message}`);
    frameIndex++;
  }

  return {
    start(): void {
      if (intervalId !== null) return;
      frameIndex = 0;
      renderFrame();
      intervalId = setInterval(renderFrame, SPINNER_INTERVAL_MS);
    },

    stop(): void {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      clearLine();
    },

    succeed(msg?: string): void {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      clearLine();
      const text = msg ?? message;
      process.stderr.write(`${chalk.green('✓')} ${text}\n`);
    },

    fail(msg?: string): void {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      clearLine();
      const text = msg ?? message;
      process.stderr.write(`${chalk.red('✗')} ${text}\n`);
    },
  };
}

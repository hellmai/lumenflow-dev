/**
 * @lumenflow/cli - Command-line interface for LumenFlow workflow framework
 *
 * This package provides CLI commands for the LumenFlow workflow framework.
 * Most functionality is exposed via bin commands, but the cli-entry-point
 * helper is exported for use in custom CLI wrappers.
 *
 * @see https://lumenflow.dev/reference/cli
 */

export { runCLI, getCliVersion } from './cli-entry-point.js';
export type { RunCLIOptions } from './cli-entry-point.js';
// WU-1929: Export formatters for consistent CLI output
export {
  formatHeader,
  printHeader,
  statusColor,
  createStatusTable,
  createSpinner,
  STATUS_COLORS,
} from './formatters.js';
export type { Spinner } from './formatters.js';

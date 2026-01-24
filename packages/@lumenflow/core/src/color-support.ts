/**
 * @file color-support.ts
 * Color control for CLI commands (WU-1085)
 *
 * Respects standard environment variables and CLI flags:
 * - NO_COLOR: Disable colors (https://no-color.org/)
 * - FORCE_COLOR: Override color level 0-3 (chalk standard)
 * - --no-color: CLI flag to disable colors
 *
 * @see https://no-color.org/
 * @see https://github.com/chalk/chalk#supportscolor
 */

import chalk from 'chalk';

/** Internal storage for color level (allows testing without chalk singleton issues) */
let currentColorLevel: number = chalk.level;

/**
 * Get the current color level.
 * @returns Color level 0-3 (0 = no colors, 3 = full 16m colors)
 */
export function getColorLevel(): number {
  return currentColorLevel;
}

/**
 * Initialize color support respecting NO_COLOR and FORCE_COLOR standards.
 * Call this before any colored output.
 *
 * Priority order:
 * 1. NO_COLOR env var (always wins, per spec)
 * 2. --no-color CLI flag
 * 3. FORCE_COLOR env var
 * 4. Default chalk detection
 *
 * @param argv - Command line arguments (defaults to process.argv)
 * @see https://no-color.org/
 * @see https://github.com/chalk/chalk#supportscolor
 */
export function initColorSupport(argv: string[] = process.argv): void {
  // NO_COLOR standard (https://no-color.org/)
  // "When set (to any value, including empty string), it should disable colors"
  if (process.env.NO_COLOR !== undefined) {
    chalk.level = 0;
    currentColorLevel = 0;
    return;
  }

  // CLI --no-color flag
  if (argv.includes('--no-color')) {
    chalk.level = 0;
    currentColorLevel = 0;
    return;
  }

  // FORCE_COLOR override (chalk standard)
  // Values: 0 = no color, 1 = basic, 2 = 256, 3 = 16m
  if (process.env.FORCE_COLOR !== undefined) {
    const level = parseInt(process.env.FORCE_COLOR, 10);
    if (!isNaN(level) && level >= 0 && level <= 3) {
      chalk.level = level as 0 | 1 | 2 | 3;
      currentColorLevel = level;
    }
    // Invalid values are ignored, keep default
    return;
  }

  // Use chalk's default detection
  currentColorLevel = chalk.level;
}

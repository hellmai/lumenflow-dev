#!/usr/bin/env node
/**
 * Coverage Gate for Quality Gates
 *
 * WU-1433: Adds coverage checking to gates with configurable mode (warn/block).
 * Enforces ≥90% coverage on hex core files (application layer).
 *
 * Mode flag allows gradual rollout:
 * - warn: Log failures but don't block (default)
 * - block: Fail the gate if thresholds not met
 *
 * @see {@link tools/gates.mjs} - Integration point
 * @see {@link vitest.config.ts} - Coverage thresholds
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection */
import { readFileSync, existsSync } from 'node:fs';
import { EMOJI, FILE_SYSTEM, STRING_LITERALS } from './wu-constants.js';

/**
 * Coverage gate modes
 * @constant
 */
export const COVERAGE_GATE_MODES = Object.freeze({
  /** Log warnings but don't fail the gate */
  WARN: 'warn',
  /** Fail the gate if thresholds not met */
  BLOCK: 'block',
});

/**
 * Glob patterns for hex core files that require ≥90% coverage.
 * These are the critical application layer files.
 *
 * @constant {string[]}
 */
export const HEX_CORE_PATTERNS = Object.freeze([
  'packages/@exampleapp/application/',
  'packages/@exampleapp/prompts/',
]);

/**
 * Coverage threshold for hex core files (percentage)
 * @constant {number}
 */
export const COVERAGE_THRESHOLD = 90;

/**
 * Default path to coverage summary JSON
 * @constant {string}
 */
export const DEFAULT_COVERAGE_PATH = 'coverage/coverage-summary.json';

/**
 * Check if a file path is in the hex core layer.
 *
 * WU-2448: Coverage reporters may emit absolute paths (e.g., /home/.../packages/...)
 * or file:// URLs; use substring matching so hex-core checks still apply.
 *
 * @param {string|null|undefined} filePath - File path to check
 * @returns {boolean} True if file is in hex core layer
 */
export function isHexCoreFile(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }

  // Normalize backslashes to forward slashes for cross-platform compatibility
  const normalizedPath = filePath.replace(/\\/g, '/');
  return HEX_CORE_PATTERNS.some((pattern) => normalizedPath.includes(pattern));
}

/**
 * Parse coverage JSON file.
 *
 * @param {string} coveragePath - Path to coverage-summary.json
 * @returns {object|null} Parsed coverage data or null if invalid
 */
export function parseCoverageJson(coveragePath) {
  if (!existsSync(coveragePath)) {
    return null;
  }

  try {
    const content = readFileSync(coveragePath, { encoding: 'utf-8' });
    const data = JSON.parse(content);

    // Transform to consistent format
    const files = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === 'total') continue;
      files[key] = value;
    }

    return {
      total: data.total,
      files,
    };
  } catch {
    return null;
  }
}

/**
 * Check if coverage meets thresholds for hex core files.
 *
 * @param {object|null} coverageData - Parsed coverage data
 * @returns {{ pass: boolean, failures: Array<{ file: string, actual: number, threshold: number, metric: string }> }}
 */
export function checkCoverageThresholds(coverageData) {
  if (!coverageData || !coverageData.files) {
    return { pass: true, failures: [] };
  }

  const failures = [];

  for (const [file, metricsValue] of Object.entries(coverageData.files)) {
    if (!isHexCoreFile(file)) {
      continue;
    }

    // Check lines coverage (primary metric)
    const metrics = metricsValue as { lines?: { pct: number } };
    const linesCoverage = metrics.lines?.pct ?? 0;
    if (linesCoverage < COVERAGE_THRESHOLD) {
      failures.push({
        file,
        actual: linesCoverage,
        threshold: COVERAGE_THRESHOLD,
        metric: 'lines',
      });
    }
  }

  return {
    pass: failures.length === 0,
    failures,
  };
}

/**
 * Format coverage data for display.
 *
 * @param {object|null} coverageData - Parsed coverage data
 * @returns {string} Formatted output string
 */
export function formatCoverageDelta(coverageData) {
  if (!coverageData) {
    return '';
  }

  const lines = [];
  const totalPct = coverageData.total?.lines?.pct ?? 0;

  lines.push(
    `${STRING_LITERALS.NEWLINE}Coverage Summary: ${totalPct.toFixed(1)}% lines${STRING_LITERALS.NEWLINE}`
  );

  // Show hex core files
  const hexCoreFiles = Object.entries(coverageData.files || {}).filter(([file]) =>
    isHexCoreFile(file)
  );

  if (hexCoreFiles.length > 0) {
    lines.push('Hex Core Files:');
    for (const [file, metricsValue] of hexCoreFiles) {
      const metrics = metricsValue as { lines?: { pct: number } };
      const pct = metrics.lines?.pct ?? 0;
      const status = pct >= COVERAGE_THRESHOLD ? EMOJI.SUCCESS : EMOJI.FAILURE;
      const shortFile = file.replace('packages/@exampleapp/', '');
      lines.push(`  ${status} ${shortFile}: ${pct.toFixed(1)}%`);
    }
  }

  return lines.join(STRING_LITERALS.NEWLINE);
}

/**
 * Logger interface for coverage gate output
 */
interface CoverageGateLogger {
  log: (...args: unknown[]) => void;
}

/**
 * Options for running coverage gate
 */
export interface CoverageGateOptions {
  /** Gate mode ('warn' or 'block') */
  mode?: string;
  /** Path to coverage JSON */
  coveragePath?: string;
  /** Logger for output */
  logger?: CoverageGateLogger;
}

/**
 * Run coverage gate.
 *
 * @param {CoverageGateOptions} options - Gate options
 * @returns {Promise<{ ok: boolean, mode: string, duration: number, message: string }>}
 */
export async function runCoverageGate(options: CoverageGateOptions = {}) {
  const start = Date.now();
  const mode = options.mode || COVERAGE_GATE_MODES.WARN;
  const coveragePath = options.coveragePath || DEFAULT_COVERAGE_PATH;
  const logger =
    options.logger && typeof options.logger.log === 'function' ? options.logger : console;

  // Parse coverage data
  const coverageData = parseCoverageJson(coveragePath);

  if (!coverageData) {
    const duration = Date.now() - start;
    logger.log(`\n${EMOJI.WARNING} Coverage gate: No coverage data found at ${coveragePath}`);
    logger.log('  Run tests with coverage first: pnpm test:coverage\n');
    return { ok: true, mode, duration, message: 'No coverage data' };
  }

  // Check thresholds
  const { pass, failures } = checkCoverageThresholds(coverageData);

  // Format and display
  const output = formatCoverageDelta(coverageData);
  logger.log(output);

  const duration = Date.now() - start;

  if (!pass) {
    logger.log(`\n${EMOJI.FAILURE} Coverage below ${COVERAGE_THRESHOLD}% for hex core files:`);
    for (const failure of failures) {
      const shortFile = failure.file.replace('packages/@exampleapp/', '');
      logger.log(
        `  - ${shortFile}: ${failure.actual.toFixed(1)}% (requires ${failure.threshold}%)`
      );
    }

    if (mode === COVERAGE_GATE_MODES.BLOCK) {
      logger.log(`\n${EMOJI.FAILURE} Coverage gate FAILED (mode: block)\n`);
      return { ok: false, mode, duration, message: 'Coverage threshold not met' };
    } else {
      logger.log(`\n${EMOJI.WARNING} Coverage gate WARNING (mode: warn)\n`);
      logger.log('  Note: This will become blocking in future. Fix coverage now.\n');
      return { ok: true, mode, duration, message: 'Coverage warning' };
    }
  }

  logger.log(`\n${EMOJI.SUCCESS} Coverage gate passed\n`);
  return { ok: true, mode, duration, message: 'Coverage OK' };
}

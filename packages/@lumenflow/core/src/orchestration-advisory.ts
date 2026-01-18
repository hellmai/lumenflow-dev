/**
 * Orchestration Advisory Emitter
 *
 * Utility functions for emitting mandatory agent advisories and checking compliance.
 * Used by wu-claim.mjs (emit advisory) and wu-done.mjs (check compliance).
 *
 * @module orchestration-advisory
 * @see {@link ./orchestration-rules.mjs} - detectMandatoryAgents function
 * @see {@link ./domain/orchestration.constants.mjs} - MANDATORY_TRIGGERS patterns
 */

import picocolors from 'picocolors';
import { detectMandatoryAgents } from './orchestration-rules.js';
import type { MandatoryAgentName } from './domain/orchestration.types.js';

/**
 * Log prefix for orchestration advisory messages.
 */
const ADVISORY_PREFIX = '[orchestrate]';

/**
 * Box drawing characters for advisory display.
 */
const BOX_CHARS = {
  HORIZONTAL: '═',
  BULLET: '•',
} as const;

/**
 * Advisory box width in characters.
 */
const ADVISORY_BOX_WIDTH = 60;

/**
 * Emit a mandatory agent advisory to the terminal.
 *
 * Called after wu:claim to inform the agent which mandatory agents
 * must be invoked before wu:done.
 *
 * @param codePaths - Array of file paths being touched by the WU
 * @param wuId - Work Unit ID (e.g., 'WU-1234')
 *
 * @example
 * emitMandatoryAgentAdvisory(['supabase/migrations/001.sql'], 'WU-1234');
 * // Outputs coloured advisory box with security-auditor requirement
 */
export function emitMandatoryAgentAdvisory(codePaths: readonly string[], wuId: string): void {
  if (codePaths.length === 0) {
    return;
  }

  const mandatoryAgents = detectMandatoryAgents(codePaths);

  if (mandatoryAgents.length === 0) {
    return;
  }

  const horizontalLine = BOX_CHARS.HORIZONTAL.repeat(ADVISORY_BOX_WIDTH);

  console.log('');
  console.log(picocolors.yellow(horizontalLine));
  console.log(picocolors.yellow(picocolors.bold(' MANDATORY AGENT ADVISORY ')));
  console.log(picocolors.yellow(horizontalLine));
  console.log('');
  console.log(`${ADVISORY_PREFIX} Based on code_paths in ${wuId}, the following`);
  console.log(`${ADVISORY_PREFIX} mandatory agents MUST be invoked BEFORE wu:done:`);
  console.log('');

  for (const agent of mandatoryAgents) {
    console.log(picocolors.cyan(`  ${BOX_CHARS.BULLET} ${agent}`));
  }

  console.log('');
  console.log(picocolors.gray(`Run: pnpm orchestrate:suggest --wu ${wuId}`));
  console.log(picocolors.yellow(horizontalLine));
  console.log('');
}

/**
 * Result of mandatory agent compliance check.
 */
export interface ComplianceResult {
  /**
   * True if no mandatory agents are required or all have been invoked.
   */
  compliant: boolean;

  /**
   * List of mandatory agent names that have not been invoked.
   */
  missing: MandatoryAgentName[];
}

/**
 * Check if mandatory agents have been invoked for a WU.
 *
 * Called by wu:done to warn (non-blocking) if mandatory agents
 * were not confirmed as invoked.
 *
 * Note: Current implementation returns missing based on code_paths only.
 * Future versions will check telemetry for actual agent invocations.
 *
 * @param codePaths - Array of file paths touched by the WU
 * @param _wuId - Work Unit ID (reserved for future telemetry lookup)
 * @returns Compliance result with compliant flag and missing agents
 *
 * @example
 * const result = checkMandatoryAgentsCompliance(['src/auth/login.js'], 'WU-1234');
 * if (!result.compliant) {
 *   console.warn(`Missing agents: ${result.missing.join(', ')}`);
 * }
 */
export function checkMandatoryAgentsCompliance(
  codePaths: readonly string[],
  _wuId: string,
): ComplianceResult {
  if (codePaths.length === 0) {
    return { compliant: true, missing: [] };
  }

  const mandatoryAgents = detectMandatoryAgents(codePaths);

  return {
    compliant: mandatoryAgents.length === 0,
    missing: mandatoryAgents,
  };
}

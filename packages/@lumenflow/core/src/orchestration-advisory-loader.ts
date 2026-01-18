/**
 * Orchestration Advisory Loader
 *
 * Pure JavaScript implementation of mandatory agent advisory.
 * Uses minimatch for glob pattern matching (same as TypeScript version).
 *
 * @module orchestration-advisory-loader
 * @see {@link ./orchestration-advisory.mjs} - TypeScript version for tests
 * @see {@link ./domain/orchestration.constants.mjs} - Pattern definitions
 */

import { minimatch } from 'minimatch';
import picocolors from 'picocolors';

/**
 * Mandatory agent trigger patterns.
 * Mirrors MANDATORY_TRIGGERS from orchestration.constants.mjs.
 */
const MANDATORY_TRIGGERS = {
  'security-auditor': ['supabase/migrations/**', '**/auth/**', '**/rls/**', '**/permissions/**'],
  'beacon-guardian': ['**/prompts/**', '**/classification/**', '**/detector/**', '**/llm/**'],
};

/**
 * Detect mandatory agents based on code paths.
 *
 * @param {string[]} codePaths - Array of file paths
 * @returns {string[]} Array of mandatory agent names
 */
function detectMandatoryAgents(codePaths) {
  if (!codePaths || codePaths.length === 0) {
    return [];
  }

  const triggeredAgents = new Set();

  for (const [agentName, patterns] of Object.entries(MANDATORY_TRIGGERS)) {
    const isTriggered = codePaths.some((filePath) =>
      patterns.some((pattern) => minimatch(filePath, pattern)),
    );

    if (isTriggered) {
      triggeredAgents.add(agentName);
    }
  }

  return Array.from(triggeredAgents);
}

/**
 * Emit mandatory agent advisory based on code paths.
 *
 * @param {string[]} codePaths - Array of file paths
 * @param {string} wuId - Work Unit ID
 */
export function emitMandatoryAgentAdvisory(codePaths, wuId) {
  if (!codePaths || codePaths.length === 0) {
    return;
  }

  const mandatoryAgents = detectMandatoryAgents(codePaths);

  if (mandatoryAgents.length === 0) {
    return;
  }

  const horizontalLine = '═'.repeat(60);

  console.log('');
  console.log(picocolors.yellow(horizontalLine));
  console.log(picocolors.yellow(picocolors.bold(' MANDATORY AGENT ADVISORY ')));
  console.log(picocolors.yellow(horizontalLine));
  console.log('');
  console.log(`[orchestrate] Based on code_paths in ${wuId}, the following`);
  console.log(`[orchestrate] mandatory agents MUST be invoked BEFORE wu:done:`);
  console.log('');

  for (const agent of mandatoryAgents) {
    console.log(picocolors.cyan(`  • ${agent}`));
  }

  console.log('');
  console.log(picocolors.gray(`Run: pnpm orchestrate:suggest --wu ${wuId}`));
  console.log(picocolors.yellow(horizontalLine));
  console.log('');
}

/**
 * Check mandatory agent compliance.
 *
 * @param {string[]} codePaths - Array of file paths
 * @param {string} _wuId - Work Unit ID (reserved for future telemetry lookup)
 * @returns {{compliant: boolean, missing: string[]}}
 */
export function checkMandatoryAgentsCompliance(codePaths, _wuId) {
  if (!codePaths || codePaths.length === 0) {
    return { compliant: true, missing: [] };
  }

  const mandatoryAgents = detectMandatoryAgents(codePaths);

  return {
    compliant: mandatoryAgents.length === 0,
    missing: mandatoryAgents,
  };
}

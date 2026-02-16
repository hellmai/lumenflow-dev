/**
 * Orchestration Rules
 *
 * Pure functions for agent detection and suggestion generation.
 * Uses minimatch for glob pattern matching (NOT regex).
 *
 * @module orchestration-rules
 * @see {@link ./domain/orchestration.constants.ts} - MANDATORY_TRIGGERS patterns
 * @see {@link https://lumenflow.dev/reference/agent-selection-guide/} - Agent selection rules
 */

import { minimatch } from 'minimatch';
import { MANDATORY_TRIGGERS, type MandatoryAgentName } from './domain/orchestration.constants.js';

/**
 * Threshold for considering a WU "near completion".
 * WUs with DoD progress >= this value trigger code-reviewer suggestion.
 */
const NEAR_COMPLETION_THRESHOLD = 8;

type SuggestionPriority = 'high' | 'medium' | 'low';

interface WUProgressRecord {
  wuId: string;
  dodProgress: number;
  dodTotal: number;
  agents: Record<string, string>;
}

interface OrchestrationSuggestion {
  id: string;
  priority: SuggestionPriority;
  action: string;
  reason: string;
  command: string;
}

/**
 * Detect mandatory agents that should be invoked based on code paths.
 *
 * Uses minimatch glob patterns from MANDATORY_TRIGGERS to determine
 * which agents are required for the given file paths.
 *
 * @param {readonly string[]} codePaths - Array of file paths being touched by the WU
 * @returns {MandatoryAgentName[]} Array of unique mandatory agent names that should be invoked
 */
export function detectMandatoryAgents(codePaths: readonly string[]): MandatoryAgentName[] {
  if (codePaths.length === 0) {
    return [];
  }

  const triggeredAgents = new Set<MandatoryAgentName>();

  for (const [agentName, patterns] of Object.entries(MANDATORY_TRIGGERS) as [
    MandatoryAgentName,
    readonly string[],
  ][]) {
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
 * Generate suggestions for next actions based on WU progress and agent history.
 *
 * @param {readonly object[]} wuProgress - Array of WU progress records
 * @param {object} _agentHistory - Record of agent metrics (reserved for future use)
 * @returns {object[]} Array of prioritised suggestions
 */
export function generateSuggestions(
  wuProgress: readonly WUProgressRecord[],
  _agentHistory: Record<string, unknown> = {},
): OrchestrationSuggestion[] {
  if (wuProgress.length === 0) {
    return [];
  }

  const suggestions: OrchestrationSuggestion[] = [];
  let suggestionCounter = 0;

  for (const wu of wuProgress) {
    const wuSuggestions = generateWUSuggestions(wu, () => ++suggestionCounter);
    suggestions.push(...wuSuggestions);
  }

  // Sort by priority: high > medium > low
  return suggestions.sort((a, b) => {
    const priorityOrder: Record<SuggestionPriority, number> = {
      high: 0,
      medium: 1,
      low: 2,
    };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

/**
 * Generate suggestions for a single WU.
 *
 * @param {object} wu - WU progress record
 * @param {function} nextId - Function to generate unique suggestion IDs
 * @returns {object[]} Array of suggestions for this WU
 */
function generateWUSuggestions(
  wu: WUProgressRecord,
  nextId: () => number,
): OrchestrationSuggestion[] {
  const suggestions: OrchestrationSuggestion[] = [];

  // Check for pending mandatory agents (HIGH priority)
  // Note: For LumenFlow framework development, MANDATORY_TRIGGERS is empty.
  // Projects using LumenFlow can configure their own mandatory agents.
  const mandatoryAgentNames = Object.keys(MANDATORY_TRIGGERS);

  for (const agentName of mandatoryAgentNames) {
    if (wu.agents[agentName] === 'pending') {
      suggestions.push({
        id: `sug-${nextId().toString().padStart(3, '0')}`,
        priority: 'high',
        action: `Run ${agentName}`,
        reason: `Mandatory agent pending for ${wu.wuId}`,
        command: `pnpm orchestrate:run ${agentName} --wu ${wu.wuId}`,
      });
    }
  }

  // Check for code-reviewer near completion (MEDIUM priority)
  const isNearCompletion = wu.dodProgress >= NEAR_COMPLETION_THRESHOLD;
  const codeReviewerStatus = wu.agents['code-reviewer'];
  const needsCodeReviewer =
    isNearCompletion && codeReviewerStatus !== 'pass' && codeReviewerStatus !== 'fail';

  if (needsCodeReviewer) {
    suggestions.push({
      id: `sug-${nextId().toString().padStart(3, '0')}`,
      priority: 'medium',
      action: `Run code-reviewer`,
      reason: `${wu.wuId} is near completion (${wu.dodProgress}/${wu.dodTotal})`,
      command: `pnpm orchestrate:run code-reviewer --wu ${wu.wuId}`,
    });
  }

  // Check for test-engineer when tests pending (LOW priority)
  const testEngineerStatus = wu.agents['test-engineer'];
  const needsTestEngineer = testEngineerStatus === 'pending';

  if (needsTestEngineer) {
    suggestions.push({
      id: `sug-${nextId().toString().padStart(3, '0')}`,
      priority: 'low',
      action: `Run test-engineer`,
      reason: `Tests pending for ${wu.wuId}`,
      command: `pnpm orchestrate:run test-engineer --wu ${wu.wuId}`,
    });
  }

  return suggestions;
}

/**
 * WU-1542: Agent trigger descriptions for error messages.
 * Maps agent names to human-readable descriptions of their trigger patterns.
 *
 * Note: For LumenFlow framework development, this is empty since we don't have
 * application-specific mandatory agents. Projects using LumenFlow should
 * configure their own trigger descriptions based on their domain requirements.
 */
const AGENT_TRIGGER_DESCRIPTIONS: Record<string, string> = {
  // No mandatory agent triggers for LumenFlow framework development.
  // Example for application-specific triggers:
  // 'security-auditor': 'supabase/migrations/**, auth/**, rls/**',
  // 'llm-reviewer': 'prompts/**, llm/**',
};

/**
 * WU-1542: Build a formatted error message for mandatory agent enforcement failures.
 *
 * @param {string} wuId - Work Unit ID
 * @param {readonly string[]} missingAgents - Array of mandatory agent names that were not invoked
 * @param {readonly string[]} codePaths - Array of file paths that triggered the agents
 * @returns {string} Formatted error message string
 */
export function buildMandatoryAgentsErrorMessage(
  wuId: string,
  missingAgents: readonly string[],
  codePaths: readonly string[],
): string {
  const lines = [
    '',
    '='.repeat(70),
    ' MANDATORY AGENT ENFORCEMENT FAILED (--require-agents)',
    '='.repeat(70),
    '',
    `WU ${wuId} cannot be completed because the following mandatory agents`,
    'were not confirmed as invoked before wu:done:',
    '',
  ];

  for (const agent of missingAgents) {
    const description = AGENT_TRIGGER_DESCRIPTIONS[agent] || 'unknown patterns';
    lines.push(`  - ${agent}`);
    lines.push(`    Triggered by: ${description}`);
  }

  lines.push('');
  lines.push('Code paths that triggered mandatory agents:');
  for (const path of codePaths.slice(0, 5)) {
    lines.push(`  - ${path}`);
  }
  if (codePaths.length > 5) {
    lines.push(`  ... and ${codePaths.length - 5} more`);
  }

  lines.push('');
  lines.push('Required action:');
  lines.push('  1. Invoke the required agents BEFORE calling wu:done');
  lines.push("  2. Check your project's mandatory agent configuration");
  lines.push('  3. Consult agent documentation for compliance requirements');
  lines.push('');
  lines.push('To bypass (only if appropriate for your project):');
  lines.push('  Remove --require-agents flag from wu:done command');
  lines.push('');
  lines.push(
    'See: https://lumenflow.dev/reference/agent-selection-guide/ for agent invocation guidance',
  );
  lines.push('='.repeat(70));

  return lines.join('\n');
}

/**
 * WU-1542: Check mandatory agent compliance with optional blocking mode.
 *
 * @param {readonly string[]} codePaths - Array of file paths being touched by the WU
 * @param {string} wuId - Work Unit ID for error message context
 * @param {{ blocking: boolean }} options - Options including blocking mode flag
 * @returns {{ compliant: boolean, blocking: boolean, missing: string[], errorMessage?: string }}
 */
export function checkMandatoryAgentsComplianceBlocking(
  codePaths: readonly string[],
  wuId: string,
  options: { blocking: boolean },
): { compliant: boolean; blocking: boolean; missing: string[]; errorMessage?: string } {
  const missingAgents = detectMandatoryAgents(codePaths);

  if (missingAgents.length === 0) {
    return {
      compliant: true,
      blocking: false,
      missing: [],
    };
  }

  // Non-blocking mode: return compliance info without error message
  if (!options.blocking) {
    return {
      compliant: false,
      blocking: false,
      missing: missingAgents,
    };
  }

  // Blocking mode: generate error message
  return {
    compliant: false,
    blocking: true,
    missing: missingAgents,
    errorMessage: buildMandatoryAgentsErrorMessage(wuId, missingAgents, codePaths),
  };
}

// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file spawn-task-builder.ts
 * WU-2012: Extracted from wu-spawn.ts
 *
 * Assembles complete spawn prompts (Task invocations and Codex prompts)
 * from the guidance, constraints, and template sections.
 *
 * Also contains lane occupation checking (checkLaneOccupation,
 * generateLaneOccupationWarning).
 *
 * Single responsibility: Orchestrate the assembly of spawn prompt sections
 * into complete Task tool invocations or Codex-friendly markdown prompts.
 *
 * @module spawn-task-builder
 */

import { getConfig } from './lumenflow-config.js';
import type { LumenFlowConfig } from './lumenflow-config-schema.js';
import { resolvePolicy } from './resolve-policy.js';
import { classifyWork } from './work-classifier.js';
import type { SpawnStrategy } from './spawn-strategy.js';
import { generateExecutionModeSection, generateThinkToolGuidance } from './wu-spawn-helpers.js';
import { generateClientSkillsGuidance, generateSkillsSelectionSection } from './wu-spawn-skills.js';
import { TRUNCATION_WARNING_BANNER } from './spawn-template-assembler.js';
import {
  generatePolicyBasedTestGuidance,
  generateDesignContextSection,
  generateMandatoryStandards,
  generateEnforcementSummary,
} from './spawn-guidance-generators.js';
import { generateConstraints, generateCodexConstraints } from './spawn-constraints-generator.js';
import {
  type WUDoc,
  generateEffortScalingRules,
  generateParallelToolCallGuidance,
  generateIterativeSearchHeuristics,
  generateTokenBudgetAwareness,
  generateCompletionFormat,
  generateAgentCoordinationSection,
  generateQuickFixCommands,
  generateLaneSelectionSection,
  generateWorktreePathGuidance,
  generateBugDiscoverySection,
  generateLaneGuidance,
  generateActionSection,
} from './spawn-agent-guidance.js';
import {
  type ClientContext,
  formatAcceptance,
  generateImplementationContext,
  detectMandatoryAgents,
  generateMandatoryAgentSection,
  generatePreamble,
  generateClientBlocksSection,
  generateInvariantsPriorArtSection,
} from './spawn-prompt-helpers.js';
import { checkLaneLock, type LockMetadata } from './lane-lock.js';

// ============================================================================
// Private Types
// ============================================================================

/**
 * Options for lane occupation warning
 */
interface LaneOccupationWarningOptions {
  /** Whether the lock is stale (>24h old) */
  isStale?: boolean;
}

// ============================================================================
// Exported Types
// ============================================================================

/**
 * Options for spawn generation
 */
export interface SpawnOptions {
  thinking?: boolean;
  noThinking?: boolean;
  budget?: string;
  client?: ClientContext;
  config?: LumenFlowConfig;
  /** WU-1240: Base directory for memory context loading */
  baseDir?: string;
  /** WU-1240: Include memory context section (default: false for backward compat) */
  includeMemoryContext?: boolean;
  /** WU-1240: Skip memory context even if includeMemoryContext is true */
  noContext?: boolean;
  /** WU-1240: Memory context content (pre-generated, for async integration) */
  memoryContextContent?: string;
}

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Generate the complete Task tool invocation
 *
 * @param {object} doc - WU YAML document
 * @param {string} id - WU ID
 * @param {SpawnStrategy} strategy - Client strategy
 * @param {object} [options={}] - Thinking mode options
 * @returns {string} Complete Task tool invocation
 */
export function generateTaskInvocation(
  doc: WUDoc,
  id: string,
  strategy: SpawnStrategy,
  options: SpawnOptions = {},
): string {
  const codePaths = doc.code_paths || [];
  const mandatoryAgents = detectMandatoryAgents(codePaths);

  const preamble = generatePreamble(id, strategy);
  const clientContext = options.client;
  const config = options.config || getConfig();

  // WU-1279: Resolve policy and use policy-based test guidance
  const policy = resolvePolicy(config);

  // WU-1900: Run work classifier for domain-aware prompt generation
  const classificationConfig = config?.methodology?.work_classification;
  const classification = classifyWork(
    {
      code_paths: doc.code_paths,
      lane: doc.lane,
      type: doc.type,
      description: doc.description,
    },
    classificationConfig,
  );

  // WU-1900: Pass classifier hint to test guidance
  const testGuidance = generatePolicyBasedTestGuidance(doc.type || 'feature', policy, {
    testMethodologyHint: classification.testMethodologyHint,
  });

  // WU-1279: Generate enforcement summary from resolved policy
  const enforcementSummary = generateEnforcementSummary(policy);

  // WU-1279: Generate mandatory standards based on resolved policy
  const mandatoryStandards = generateMandatoryStandards(policy);
  const clientSkillsGuidance = generateClientSkillsGuidance(clientContext);
  const skillsSection =
    generateSkillsSelectionSection(doc, config, clientContext?.name) +
    (clientSkillsGuidance ? `\n${clientSkillsGuidance}` : '');
  const clientBlocks = generateClientBlocksSection(clientContext);
  const mandatorySection = generateMandatoryAgentSection(mandatoryAgents, id);
  const laneGuidance = generateLaneGuidance(doc.lane);
  const bugDiscoverySection = generateBugDiscoverySection(id);

  // WU-1900: Generate constraints with conditional TDD CHECKPOINT
  const shouldIncludeTddCheckpoint = classification.domain !== 'ui' && policy.testing !== 'none';
  const constraints = generateConstraints(id, {
    includeTddCheckpoint: shouldIncludeTddCheckpoint,
  });

  // WU-1900: Generate design context section for UI-classified work
  const designContextSection = generateDesignContextSection(classification);

  const implementationContext = generateImplementationContext(doc);

  // WU-2252: Generate invariants/prior-art section for code_paths
  const invariantsPriorArt = generateInvariantsPriorArtSection(codePaths);

  // WU-1986: Anthropic multi-agent best practices sections
  const effortScaling = generateEffortScalingRules();
  const parallelToolCalls = generateParallelToolCallGuidance();
  const searchHeuristics = generateIterativeSearchHeuristics();
  const tokenBudget = generateTokenBudgetAwareness(id);
  const completionFormat = generateCompletionFormat(id);

  // WU-1987: Agent coordination and quick fix sections
  const agentCoordination = generateAgentCoordinationSection(id);
  const quickFix = generateQuickFixCommands();

  // WU-2107: Lane selection guidance
  const laneSelection = generateLaneSelectionSection();

  // WU-2362: Worktree path guidance for sub-agents
  const worktreeGuidance = generateWorktreePathGuidance(doc.worktree_path);

  // WU-1240: Memory context section
  const shouldIncludeMemoryContext = options.includeMemoryContext && !options.noContext;
  const memoryContextSection = shouldIncludeMemoryContext ? options.memoryContextContent || '' : '';

  // Generate thinking mode sections if applicable
  const executionModeSection = generateExecutionModeSection(options);
  const thinkToolGuidance = generateThinkToolGuidance(options);

  // Build optional sections string
  const thinkingSections = [executionModeSection, thinkToolGuidance]
    .filter((section) => section.length > 0)
    .join('\n\n---\n\n');

  const thinkingBlock = thinkingSections ? `${thinkingSections}\n\n---\n\n` : '';

  // Build the task prompt
  // WU-1192: Truncation warning at start, test guidance after </task> per "Lost in the Middle" research
  const taskPrompt = `${TRUNCATION_WARNING_BANNER}<task>
${preamble}
</task>

---

${testGuidance}

---

# ${id}: ${doc.title || 'Untitled'}

## WU Details

- **ID:** ${id}
- **Lane:** ${doc.lane || 'Unknown'}
- **Type:** ${doc.type || 'feature'}
- **Status:** ${doc.status || 'unknown'}
- **Worktree:** ${doc.worktree_path || `worktrees/<lane>-${id.toLowerCase()}`}

## Description

${doc.description || 'No description provided.'}

## Acceptance Criteria

${formatAcceptance(doc.acceptance)}

## Code Paths

${codePaths.length > 0 ? codePaths.map((p) => `- ${p}`).join('\n') : '- No code paths defined'}
${mandatorySection}${invariantsPriorArt ? `---\n\n${invariantsPriorArt}\n\n` : ''}${implementationContext ? `---\n\n${implementationContext}\n\n` : ''}---

${thinkingBlock}${skillsSection}
${memoryContextSection ? `---\n\n${memoryContextSection}\n\n` : ''}---

${mandatoryStandards}

---

${enforcementSummary}

${designContextSection ? `---\n\n${designContextSection}\n\n` : ''}${clientBlocks ? `---\n\n${clientBlocks}\n\n` : ''}${worktreeGuidance ? `---\n\n${worktreeGuidance}\n\n` : ''}---

${bugDiscoverySection}

---

${effortScaling}

---

${parallelToolCalls}

---

${searchHeuristics}

---

${tokenBudget}

---

${completionFormat}

---

${agentCoordination}

---

${quickFix}

---

${laneSelection}

---

${laneGuidance}${laneGuidance ? '\n\n---\n\n' : ''}## Action

${generateActionSection(doc, id)}

${constraints}`;

  // Escape special characters for XML output
  const escapedPrompt = taskPrompt
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Build the Task tool invocation block using antml format
  // Using array join to avoid XML parsing issues
  const openTag = '<' + 'antml:invoke name="Task">';
  const closeTag = '</' + 'antml:invoke>';
  const paramOpen = '<' + 'antml:parameter name="';
  const paramClose = '</' + 'antml:parameter>';

  const invocation = [
    '<' + 'antml:function_calls>',
    openTag,
    `${paramOpen}subagent_type">general-purpose${paramClose}`,
    `${paramOpen}description">Execute ${id}${paramClose}`,
    `${paramOpen}prompt">${escapedPrompt}${paramClose}`,
    closeTag,
    '</' + 'antml:function_calls>',
  ].join('\n');

  return invocation;
}

/**
 * Generate Codex-specific prompt output
 *
 * @param {object} doc - WU YAML document
 * @param {string} id - WU ID
 * @param {SpawnStrategy} strategy - Client strategy
 * @param {SpawnOptions} options - Options
 * @returns {string} Complete Codex prompt
 */
export function generateCodexPrompt(
  doc: WUDoc,
  id: string,
  strategy: SpawnStrategy,
  options: SpawnOptions = {},
): string {
  const codePaths = doc.code_paths || [];
  const mandatoryAgents = detectMandatoryAgents(codePaths);

  const preamble = generatePreamble(id, strategy);
  const mandatorySection = generateMandatoryAgentSection(mandatoryAgents, id);
  const laneGuidance = generateLaneGuidance(doc.lane);
  const bugDiscoverySection = generateBugDiscoverySection(id);
  const implementationContext = generateImplementationContext(doc);
  const action = generateActionSection(doc, id);
  const constraints = generateCodexConstraints(id);
  const clientContext = options.client;
  const config = options.config || getConfig();
  const clientSkillsGuidance = generateClientSkillsGuidance(clientContext);
  const skillsSection =
    generateSkillsSelectionSection(doc, config, clientContext?.name) +
    (clientSkillsGuidance ? `\n${clientSkillsGuidance}` : '');
  const clientBlocks = generateClientBlocksSection(clientContext);

  // WU-1290: Resolve policy and use policy-based test guidance
  const policy = resolvePolicy(config);
  const testGuidance = generatePolicyBasedTestGuidance(doc.type || 'feature', policy);

  // WU-1290: Generate enforcement summary from resolved policy
  const enforcementSummary = generateEnforcementSummary(policy);

  // WU-1290: Generate mandatory standards based on resolved policy
  const mandatoryStandards = generateMandatoryStandards(policy);

  const executionModeSection = generateExecutionModeSection(options);
  const thinkToolGuidance = generateThinkToolGuidance(options);
  const thinkingSections = [executionModeSection, thinkToolGuidance]
    .filter((section) => section.length > 0)
    .join('\n\n---\n\n');
  const thinkingBlock = thinkingSections ? `${thinkingSections}\n\n---\n\n` : '';

  return `# ${id}: ${doc.title || 'Untitled'}

${testGuidance}

---

## Context

${preamble}

---

## WU Details

- **ID:** ${id}
- **Lane:** ${doc.lane || 'Unknown'}
- **Type:** ${doc.type || 'feature'}
- **Status:** ${doc.status || 'unknown'}
- **Worktree:** ${doc.worktree_path || `worktrees/<lane>-${id.toLowerCase()}`}

## Description

${doc.description || 'No description provided.'}

## Scope (code_paths)

Only change files within these paths:

${codePaths.length > 0 ? codePaths.map((p) => `- ${p}`).join('\n') : '- No code paths defined'}

## Acceptance Criteria

${formatAcceptance(doc.acceptance)}

---

${mandatoryStandards}

---

${enforcementSummary}

---

${skillsSection}

---

## Action

${action}

---

## Verification

- Run in worktree: \`pnpm gates\`
- From shared checkout: \`node packages/@lumenflow/agent/verification ${id}\`

---

${mandatorySection}${implementationContext ? `${implementationContext}\n\n---\n\n` : ''}${clientBlocks ? `${clientBlocks}\n\n---\n\n` : ''}${thinkingBlock}${bugDiscoverySection}

---

${laneGuidance}${laneGuidance ? '\n\n---\n\n' : ''}${constraints}
`;
}

/**
 * WU-1603: Check if a lane is currently occupied by another WU
 *
 * @param {string} lane - Lane name (e.g., "Operations: Tooling")
 * @returns {import('./lane-lock.js').LockMetadata|null} Lock metadata if occupied, null otherwise
 */
export function checkLaneOccupation(lane: string): LockMetadata | null {
  const lockStatus = checkLaneLock(lane);
  if (lockStatus.locked && lockStatus.metadata) {
    return lockStatus.metadata;
  }
  return null;
}

/**
 * WU-1603: Generate a warning message when lane is occupied
 *
 * @param {import('./lane-lock.js').LockMetadata} lockMetadata - Lock metadata
 * @param {string} targetWuId - WU ID being spawned
 * @param {LaneOccupationWarningOptions} [options={}] - Options
 * @returns {string} Warning message
 */
export function generateLaneOccupationWarning(
  lockMetadata: LockMetadata,
  targetWuId: string,
  options: LaneOccupationWarningOptions = {},
): string {
  const { isStale = false } = options;

  let warning = `\u26a0\ufe0f  Lane "${lockMetadata.lane}" is occupied by ${lockMetadata.wuId}\n`;
  warning += `   This violates WIP=1 (Work In Progress limit of 1 per lane).\n\n`;

  if (isStale) {
    warning += `   \u23f0 This lock is STALE (>24 hours old) - the WU may be abandoned.\n`;
    warning += `   Consider using pnpm wu:block --id ${lockMetadata.wuId} if work is stalled.\n\n`;
  }

  warning += `   Options:\n`;
  warning += `   1. Wait for ${lockMetadata.wuId} to complete or block\n`;
  warning += `   2. Choose a different lane for ${targetWuId}\n`;
  warning += `   3. Block ${lockMetadata.wuId} if work is stalled: pnpm wu:block --id ${lockMetadata.wuId}`;

  return warning;
}

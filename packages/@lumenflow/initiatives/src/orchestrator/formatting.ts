/**
 * Output formatting for initiative orchestration.
 *
 * All display/output formatting functions for execution plans,
 * checkpoint waves, progress stats, and spawn commands.
 *
 * @module orchestrator/formatting
 */

import { existsSync, readFileSync } from 'node:fs';
import type { WUEntry } from '../initiative-yaml.js';
import type { InitiativeDoc } from '../initiative-yaml.js';
import type { ExecutionPlan, ProgressStats, BottleneckWU, CheckpointWaveResult } from './types.js';
import { getAllDependencies } from './shared.js';
import { WU_STATUS, STRING_LITERALS } from '@lumenflow/core/wu-constants';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { parseYAML } from '@lumenflow/core/wu-yaml';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
// WU-2027: Import spawn generation for embedding in orchestration output
import { generateTaskInvocation } from '@lumenflow/core/wu-spawn';
import { SpawnStrategyFactory } from '@lumenflow/core/spawn-strategy';

/**
 * WU-2280: Banner separator for ACTION REQUIRED output.
 * Used to make it unambiguous that agents have NOT been spawned yet.
 */
const BANNER_SEPARATOR =
  '==============================================================================';

/**
 * WU-2040: XML tag patterns for Task invocation extraction.
 * Split to avoid XML parsing issues in agent tools.
 */
const ANTML_NS = 'antml:';
const XML_PATTERNS = {
  FUNCTION_CALLS_OPEN: `<${ANTML_NS}function_calls>`,
  FUNCTION_CALLS_CLOSE: `</${ANTML_NS}function_calls>`,
  INVOKE_OPEN: `<${ANTML_NS}invoke`,
  INVOKE_CLOSE: `</${ANTML_NS}invoke>`,
};

/**
 * Format execution plan for display.
 *
 * WU-2430: Enhanced to show skippedWithReasons and deferred WUs.
 *
 * @param {object} initiative - Initiative document
 * @param {{waves: Array<Array<{id: string, doc: object}>>, skipped: string[], skippedWithReasons?: Array<{id: string, reason: string}>, deferred?: Array<{id: string, blockedBy: string[], reason: string}>}} plan - Execution plan
 * @returns {string} Formatted plan output
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- display formatting inherently complex
export function formatExecutionPlan(initiative: InitiativeDoc, plan: ExecutionPlan): string {
  const lines = [];

  lines.push(`Initiative: ${initiative.id} \u2014 ${initiative.title}`);
  lines.push('');

  if (plan.skipped.length > 0) {
    lines.push(`Skipped (already done): ${plan.skipped.join(', ')}`);
    lines.push('');
  }

  // WU-2430: Show WUs skipped due to non-ready status
  if (plan.skippedWithReasons && plan.skippedWithReasons.length > 0) {
    lines.push('Skipped (not ready):');
    for (const entry of plan.skippedWithReasons) {
      lines.push(`  - ${entry.id}: ${entry.reason}`);
    }
    lines.push('');
  }

  // WU-2430: Show WUs deferred due to unmet dependencies
  if (plan.deferred && plan.deferred.length > 0) {
    lines.push('Deferred (waiting for dependencies):');
    for (const entry of plan.deferred) {
      lines.push(`  - ${entry.id}: ${entry.reason}`);
      if (entry.blockedBy && entry.blockedBy.length > 0) {
        lines.push(`      blocked by: ${entry.blockedBy.join(', ')}`);
      }
    }
    lines.push('');
  }

  if (plan.waves.length === 0) {
    lines.push('No pending WUs to execute.');
    return lines.join(STRING_LITERALS.NEWLINE);
  }

  lines.push(`Execution Plan: ${plan.waves.length} wave(s)`);
  lines.push('');

  // Identify bottleneck WUs (WU-1596)
  const allWUs = plan.waves.flat();
  const bottleneckWUs = getBottleneckWUs(allWUs);

  if (bottleneckWUs.length > 0) {
    lines.push('Bottleneck WUs (prioritise these for fastest unblocking):');
    for (const bottleneck of bottleneckWUs) {
      lines.push(
        `  - ${bottleneck.id}: ${bottleneck.title} [blocks ${bottleneck.blocksCount} WU${bottleneck.blocksCount !== 1 ? 's' : ''}]`,
      );
    }
    lines.push('');
  }

  for (let i = 0; i < plan.waves.length; i++) {
    const wave = plan.waves[i]!;
    lines.push(`Wave ${i} (${wave.length} WU${wave.length !== 1 ? 's' : ''} in parallel):`);

    for (const wu of wave) {
      // WU-1251: Use getAllDependencies to combine blocked_by and dependencies arrays
      const blockers = getAllDependencies(wu.doc);
      const blockerStr = blockers.length > 0 ? ` [blocked by: ${blockers.join(', ')}]` : '';
      // Mark bottleneck WUs (WU-1596)
      const isBottleneck = bottleneckWUs.some((b) => b.id === wu.id);
      const bottleneckMarker = isBottleneck ? ' *BOTTLENECK*' : '';
      lines.push(`  - ${wu.id}: ${wu.doc.title}${blockerStr}${bottleneckMarker}`);
    }

    lines.push('');
  }

  // Add coordination guidance for multi-wave plans (WU-1592)
  if (plan.waves.length > 1) {
    lines.push('Coordination Guidance:');
    lines.push('  - Poll mem:inbox between waves: pnpm mem:inbox --since 10m');
    lines.push('  - Check for bug discoveries from sub-agents');
    lines.push('  - Review signals before proceeding to next wave');
    lines.push('');
  }

  return lines.join(STRING_LITERALS.NEWLINE);
}

/**
 * Generate spawn commands for a wave of WUs.
 *
 * @param {Array<{id: string, doc: object}>} wave - WUs in the wave
 * @returns {string[]} Array of spawn command strings
 */
export function generateSpawnCommands(wave: WUEntry[]): string[] {
  return wave.map(
    (wu) => `pnpm wu:delegate --id ${wu.id} --parent-wu <PARENT-WU-ID> --client claude-code`,
  );
}

/**
 * Calculate progress statistics for WUs.
 *
 * @param {Array<{id: string, doc: object}>} wus - WUs to calculate progress for
 * @returns {{total: number, done: number, active: number, pending: number, blocked: number, percentage: number}}
 */
export function calculateProgress(wus: WUEntry[]): ProgressStats {
  const stats = {
    total: wus.length,
    done: 0,
    active: 0,
    pending: 0,
    blocked: 0,
    percentage: 0,
  };

  for (const { doc } of wus) {
    switch (doc.status) {
      case WU_STATUS.DONE:
        stats.done++;
        break;
      case WU_STATUS.IN_PROGRESS:
        stats.active++;
        break;
      case WU_STATUS.BLOCKED:
        stats.blocked++;
        break;
      case WU_STATUS.READY:
        stats.pending++;
        break;
      default:
        // Skip other statuses (e.g., cancelled) - counted in total only
        break;
    }
  }

  stats.percentage = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  return stats;
}

/**
 * Format progress for display.
 *
 * @param {{total: number, done: number, active: number, pending: number, blocked: number, percentage: number}} progress
 * @returns {string} Formatted progress string
 */
export function formatProgress(progress: ProgressStats): string {
  const bar = createProgressBar(progress.percentage);
  return [
    `Progress: ${bar} ${progress.percentage}%`,
    `  Done: ${progress.done}/${progress.total}`,
    `  Active: ${progress.active}`,
    `  Pending: ${progress.pending}`,
    `  Blocked: ${progress.blocked}`,
  ].join(STRING_LITERALS.NEWLINE);
}

/**
 * Create a visual progress bar.
 *
 * @param {number} percentage - Completion percentage (0-100)
 * @param {number} [width=20] - Bar width in characters
 * @returns {string} Visual progress bar
 */
function createProgressBar(percentage: number, width = 20): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

/**
 * Get bottleneck WUs from a set of WUs based on how many downstream WUs they block.
 * A bottleneck is a WU that blocks multiple other WUs.
 *
 * @param {Array<{id: string, doc: object}>} wus - WUs to analyse
 * @param {number} [limit=5] - Maximum number of bottlenecks to return
 * @returns {Array<{id: string, title: string, blocksCount: number}>} Bottleneck WUs sorted by impact
 */
export function getBottleneckWUs(wus: WUEntry[], limit = 5): BottleneckWU[] {
  // Build a map of WU ID -> count of WUs that depend on it
  const blocksCounts = new Map();

  // Initialise all WUs with 0
  for (const wu of wus) {
    blocksCounts.set(wu.id, 0);
  }

  // Count how many WUs each WU blocks
  for (const wu of wus) {
    // WU-1251: Use getAllDependencies to combine blocked_by and dependencies arrays
    const blockers = getAllDependencies(wu.doc);
    for (const blockerId of blockers) {
      if (blocksCounts.has(blockerId)) {
        blocksCounts.set(blockerId, blocksCounts.get(blockerId) + 1);
      }
    }
  }

  // Convert to array and filter out WUs that don't block anything
  const bottlenecks: BottleneckWU[] = [];
  for (const wu of wus) {
    const blocksCount = blocksCounts.get(wu.id);
    if (blocksCount !== undefined && blocksCount > 0) {
      bottlenecks.push({
        id: wu.id,
        title: wu.doc.title ?? wu.id,
        blocksCount,
      });
    }
  }

  // Sort by blocks count descending
  bottlenecks.sort((a, b) => b.blocksCount - a.blocksCount);

  return bottlenecks.slice(0, limit);
}

/**
 * Format checkpoint wave output with Task invocations.
 *
 * WU-1821: Token discipline - keep output minimal for context management.
 * WU-2040: Output full Task invocation blocks instead of pnpm wu:spawn meta-prompts.
 * WU-2280: Prevent false wave spawned confusion - use markdown code blocks and ACTION REQUIRED banner.
 * WU-2430: Handle dry-run mode - indicate preview mode clearly.
 *
 * @param {{initiative: string, wave: number, wus: Array<{id: string, lane: string}>, manifestPath: string, blockedBy?: string[], waitingMessage?: string, dryRun?: boolean}} waveData
 * @returns {string} Formatted output with embedded Task invocations
 */
export function formatCheckpointOutput(waveData: CheckpointWaveResult): string {
  const lines = [];
  const isDryRun = waveData.dryRun === true;

  // WU-2040: Handle blocked case with waiting message
  if (waveData.blockedBy && waveData.blockedBy.length > 0) {
    lines.push(`Waiting for dependencies to complete:`);
    for (const depId of waveData.blockedBy) {
      lines.push(`  - ${depId}`);
    }
    lines.push('');
    lines.push(waveData.waitingMessage || 'No WUs can spawn until dependencies have stamps.');
    lines.push('');
    lines.push('Check dependency progress with:');
    lines.push(`  pnpm mem:inbox --since 10m`);
    lines.push(`  pnpm orchestrate:initiative -i ${waveData.initiative} -c`);
    return lines.join(STRING_LITERALS.NEWLINE);
  }

  // WU-2430: Dry-run header
  if (isDryRun) {
    lines.push('[DRY-RUN PREVIEW] Checkpoint mode output (no manifest written)');
    lines.push('');
  }

  lines.push(`Wave ${waveData.wave} manifest: ${waveData.manifestPath}`);
  lines.push(`WUs in this wave: ${waveData.wus.length}`);

  for (const wu of waveData.wus) {
    lines.push(`  - ${wu.id} (${wu.lane})`);
  }

  lines.push('');

  // WU-2280: ACTION REQUIRED banner - per Anthropic skill best practices
  // Make it unambiguous that agents have NOT been spawned yet
  lines.push(BANNER_SEPARATOR);
  lines.push('ACTION REQUIRED: Agents have NOT been spawned yet.');
  lines.push('');
  lines.push('To spawn agents, copy the XML below and invoke the Task tool.');
  lines.push('The output below is documentation only - it will NOT execute automatically.');
  lines.push(BANNER_SEPARATOR);
  lines.push('');

  // WU-2280: Wrap XML in markdown code block to prevent confusion with actual tool calls
  // Raw XML output could be mistaken for a tool invocation by agents
  lines.push('```xml');

  // Build the Task invocation content
  const xmlLines = [];
  xmlLines.push(XML_PATTERNS.FUNCTION_CALLS_OPEN);

  for (const wu of waveData.wus) {
    try {
      // Generate full Task invocation with embedded spawn prompt
      const fullInvocation = generateEmbeddedSpawnPrompt(wu.id);

      // Extract just the inner invoke block (remove outer function_calls wrapper)
      const startIdx = fullInvocation.indexOf(XML_PATTERNS.INVOKE_OPEN);
      const endIdx = fullInvocation.indexOf(XML_PATTERNS.INVOKE_CLOSE);

      if (startIdx !== -1 && endIdx !== -1) {
        const invokeBlock = fullInvocation.substring(
          startIdx,
          endIdx + XML_PATTERNS.INVOKE_CLOSE.length,
        );
        xmlLines.push(invokeBlock);
      }
    } catch {
      // Fallback to simple reference if WU file not found
      xmlLines.push(`<!-- Could not generate Task invocation for ${wu.id} -->`);
    }
  }

  xmlLines.push(XML_PATTERNS.FUNCTION_CALLS_CLOSE);
  lines.push(xmlLines.join(STRING_LITERALS.NEWLINE));

  lines.push('```');

  lines.push('');
  lines.push('Resume with:');
  lines.push(`  pnpm mem:ready --wu WU-ORCHESTRATOR`);
  lines.push(`  pnpm orchestrate:initiative -i ${waveData.initiative} -c`);

  return lines.join(STRING_LITERALS.NEWLINE);
}

/**
 * WU-2027: Generate embedded spawn prompt for a WU.
 *
 * Instead of outputting a meta-prompt like "Run: pnpm wu:spawn --id WU-XXX",
 * this function runs the spawn logic internally and returns the full ~3KB
 * prompt content ready for embedding in a Task invocation.
 *
 * This follows Anthropic guidance that sub-agent prompts must be fully
 * self-contained to prevent delegation failures.
 *
 * @param {string} wuId - WU ID (e.g., 'WU-001')
 * @returns {string} Escaped spawn prompt content ready for XML embedding
 * @throws {Error} If WU file not found or cannot be parsed
 */
export function generateEmbeddedSpawnPrompt(wuId: string): string {
  const wuPath = WU_PATHS.WU(wuId);

  if (!existsSync(wuPath)) {
    throw createError(ErrorCodes.WU_NOT_FOUND, `WU file not found: ${wuPath}`, {
      wuId,
      path: wuPath,
    });
  }

  // Read and parse WU YAML
  const text = readFileSync(wuPath, 'utf8');
  const doc = parseYAML(text);

  // Generate the full Task invocation (includes XML wrapper)
  // The prompt is already XML-escaped in generateTaskInvocation
  return generateTaskInvocation(doc, wuId, SpawnStrategyFactory.create('claude-code'));
}

/**
 * WU-2027: Format a Task invocation with embedded spawn content for a WU.
 *
 * Creates a complete Task tool invocation block with the full spawn prompt
 * embedded directly, rather than a meta-prompt referencing wu:spawn.
 *
 * @param {{id: string, doc: object}} wu - WU with id and YAML doc
 * @returns {string} Complete Task invocation with embedded spawn content
 */
export function formatTaskInvocationWithEmbeddedSpawn(wu: WUEntry): string {
  // Generate the full Task invocation for this WU
  return generateTaskInvocation(wu.doc, wu.id, SpawnStrategyFactory.create('claude-code'));
}

/**
 * WU-2027: Format execution plan with embedded spawns (no meta-prompts).
 * WU-2280: Updated to use markdown code blocks and ACTION REQUIRED banner.
 *
 * Generates Task invocation blocks for all WUs in the execution plan,
 * with full spawn content embedded directly. This replaces the meta-prompt
 * pattern that was causing delegation failures.
 *
 * @param {{waves: Array<Array<{id: string, doc: object}>>, skipped: string[]}} plan - Execution plan
 * @returns {string} Formatted output with embedded Task invocations
 */

export function formatExecutionPlanWithEmbeddedSpawns(plan: ExecutionPlan): string {
  const lines = [];

  if (plan.waves.length === 0) {
    return 'No pending WUs to execute.';
  }

  for (let waveIndex = 0; waveIndex < plan.waves.length; waveIndex++) {
    const wave = plan.waves[waveIndex]!;
    lines.push(
      `## Wave ${waveIndex} (${wave.length} WU${wave.length !== 1 ? 's' : ''} in parallel)`,
    );
    lines.push('');

    // WU-2280: ACTION REQUIRED banner - per Anthropic skill best practices
    lines.push(BANNER_SEPARATOR);
    lines.push('ACTION REQUIRED: Agents have NOT been spawned yet.');
    lines.push('');
    lines.push('To spawn agents, copy the XML below and invoke the Task tool.');
    lines.push('The output below is documentation only - it will NOT execute automatically.');
    lines.push(BANNER_SEPARATOR);
    lines.push('');

    // WU-2280: Wrap XML in markdown code block to prevent confusion with actual tool calls
    lines.push('```xml');

    // Build parallel spawn block for this wave
    const xmlLines = [];
    const openTag = '<' + 'antml:function_calls>';
    const closeTag = '</' + 'antml:function_calls>';

    xmlLines.push(openTag);

    for (const wu of wave) {
      const fullInvocation = generateTaskInvocation(
        wu.doc,
        wu.id,
        SpawnStrategyFactory.create('claude-code'),
      );

      // Extract just the inner invoke block (remove outer function_calls wrapper)
      // Use indexOf for reliable extraction (regex can have escaping issues)
      const startPattern = '<' + 'antml:invoke';
      const endPattern = '</' + 'antml:invoke>';
      const startIdx = fullInvocation.indexOf(startPattern);
      const endIdx = fullInvocation.indexOf(endPattern);

      if (startIdx !== -1 && endIdx !== -1) {
        let invokeBlock = fullInvocation.substring(startIdx, endIdx + endPattern.length);

        // Add run_in_background parameter for parallel execution
        if (!invokeBlock.includes('run_in_background')) {
          const paramOpen = '<' + 'antml:parameter name="';
          const paramClose = '</' + 'antml:parameter>';
          const invokeTag = '<' + 'antml:invoke name="Task">';
          invokeBlock = invokeBlock.replace(
            invokeTag,
            `${invokeTag}\n${paramOpen}run_in_background">true${paramClose}`,
          );
        }
        xmlLines.push(invokeBlock);
      }
    }

    xmlLines.push(closeTag);
    lines.push(xmlLines.join(STRING_LITERALS.NEWLINE));
    lines.push('```');
    lines.push('');

    if (waveIndex < plan.waves.length - 1) {
      lines.push(`After all Wave ${waveIndex} agents complete, proceed to Wave ${waveIndex + 1}.`);
      lines.push('Before next wave: pnpm mem:inbox --since 10m (check for bug discoveries)');
      lines.push('');
    }
  }

  return lines.join(STRING_LITERALS.NEWLINE);
}

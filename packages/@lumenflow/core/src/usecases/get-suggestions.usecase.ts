/**
 * GetSuggestions Use Case
 *
 * Applies orchestration rules to generate recommendations for next actions.
 * Combines WU progress analysis with code path detection.
 *
 * @module get-suggestions.usecase
 * @see {@link ../orchestration-rules.ts} - Rule functions
 * @see {@link ../ports/metrics-collector.port.ts} - Port interface
 */

import type { IMetricsCollector } from '../ports/metrics-collector.port.js';
import type { Suggestion, MandatoryAgentName } from '../domain/orchestration.types.js';
import { detectMandatoryAgents, generateSuggestions } from '../orchestration-rules.js';

/**
 * Bottleneck scores mapping WU IDs to their impact scores.
 * Impact score = number of downstream WUs blocked by this WU.
 */
export type BottleneckScores = Record<string, number>;

/**
 * Options for the GetSuggestions use case.
 */
export interface GetSuggestionsOptions {
  /**
   * Code paths to analyse for mandatory agent triggers.
   * When provided, detects which agents should be invoked.
   */
  codePaths?: string[];

  /**
   * Bottleneck impact scores from flow:bottlenecks analysis.
   * When provided, suggestions for high-impact WUs are ranked higher
   * within the same priority level.
   *
   * @see flow-bottlenecks.mjs for score calculation
   */
  bottleneckScores?: BottleneckScores;
}

/**
 * Use case for generating orchestration suggestions.
 *
 * Combines two sources of suggestions:
 * 1. WU progress analysis - suggests agents based on current state
 * 2. Code path analysis - detects mandatory agents from file patterns
 *
 * @example
 * const collector = new FileSystemMetricsCollector(basePath);
 * const useCase = new GetSuggestionsUseCase(collector);
 *
 * // Get suggestions based on current WU state
 * const suggestions = await useCase.execute();
 *
 * // Get suggestions including code path analysis
 * const suggestionsWithPaths = await useCase.execute({
 *   codePaths: ['supabase/migrations/001.sql', 'src/prompts/system.ts']
 * });
 */
export class GetSuggestionsUseCase {
  constructor(private readonly metricsCollector: IMetricsCollector) {}

  /**
   * Execute the use case to generate suggestions.
   *
   * @param options - Optional configuration including code paths and bottleneck scores
   * @returns Promise resolving to prioritised suggestions
   * @throws Error if collector methods fail
   */
  async execute(options: GetSuggestionsOptions = {}): Promise<Suggestion[]> {
    const { codePaths = [], bottleneckScores = {} } = options;

    const [wuProgress, agentMetrics] = await Promise.all([
      this.metricsCollector.getWUProgress(),
      this.metricsCollector.getAgentMetrics(),
    ]);

    // Generate suggestions from WU progress
    let progressSuggestions = generateSuggestions(wuProgress, agentMetrics);

    // Enrich suggestions with impact scores if available (WU-1596)
    progressSuggestions = this.enrichWithImpactScores(progressSuggestions, bottleneckScores);

    // Detect mandatory agents from code paths
    const mandatoryAgents = detectMandatoryAgents(codePaths);

    // Generate additional suggestions for detected mandatory agents
    const pathSuggestions = this.generateMandatoryAgentSuggestions(
      mandatoryAgents,
      progressSuggestions,
      wuProgress.length > 0 ? wuProgress[0].wuId : 'current'
    );

    // Combine and deduplicate suggestions
    const allSuggestions = [...progressSuggestions, ...pathSuggestions];

    // Sort by priority (high > medium > low), then by impact score (descending)
    return this.sortSuggestions(allSuggestions, bottleneckScores);
  }

  /**
   * Enrich suggestions with impact score information in reason field.
   *
   * @param suggestions - Suggestions to enrich
   * @param bottleneckScores - WU ID to impact score mapping
   * @returns Enriched suggestions
   */
  private enrichWithImpactScores(
    suggestions: Suggestion[],
    bottleneckScores: BottleneckScores
  ): Suggestion[] {
    if (Object.keys(bottleneckScores).length === 0) {
      return suggestions;
    }

    return suggestions.map((suggestion) => {
      const wuId = this.extractWuIdFromCommand(suggestion.command);
      if (!wuId) {
        return suggestion;
      }

      const impactScore = bottleneckScores[wuId];
      if (impactScore === undefined || impactScore === 0) {
        return suggestion;
      }

      // Enrich reason with impact score
      return {
        ...suggestion,
        reason: `${suggestion.reason} (blocks ${impactScore} downstream WU${impactScore === 1 ? '' : 's'})`,
      };
    });
  }

  /**
   * Extract WU ID from a suggestion command.
   *
   * @param command - Command string containing WU ID
   * @returns WU ID or null if not found
   */
  private extractWuIdFromCommand(command: string | undefined): string | null {
    if (!command) {
      return null;
    }

    const match = command.match(/WU-\d+/);
    return match ? match[0] : null;
  }

  /**
   * Sort suggestions by priority, then by impact score within same priority.
   *
   * @param suggestions - Suggestions to sort
   * @param bottleneckScores - WU ID to impact score mapping
   * @returns Sorted suggestions
   */
  private sortSuggestions(
    suggestions: Suggestion[],
    bottleneckScores: BottleneckScores
  ): Suggestion[] {
    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };

    return suggestions.sort((a, b) => {
      // First sort by priority
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      // Within same priority, sort by impact score (higher score first)
      const aWuId = this.extractWuIdFromCommand(a.command);
      const bWuId = this.extractWuIdFromCommand(b.command);

      const aScore = aWuId ? (bottleneckScores[aWuId] ?? 0) : 0;
      const bScore = bWuId ? (bottleneckScores[bWuId] ?? 0) : 0;

      return bScore - aScore; // Descending order (higher score first)
    });
  }

  /**
   * Generate suggestions for mandatory agents detected from code paths.
   *
   * Avoids duplicating suggestions that already exist from WU progress analysis.
   *
   * @param mandatoryAgents - Agents detected from code paths
   * @param existingSuggestions - Suggestions already generated
   * @param wuId - WU ID for the suggestion
   * @returns Additional suggestions for mandatory agents
   */
  private generateMandatoryAgentSuggestions(
    mandatoryAgents: MandatoryAgentName[],
    existingSuggestions: Suggestion[],
    wuId: string
  ): Suggestion[] {
    const suggestions: Suggestion[] = [];
    let nextId = existingSuggestions.length + 1;

    for (const agentName of mandatoryAgents) {
      // Check if suggestion already exists for this agent
      const alreadyExists = existingSuggestions.some((s) =>
        s.action.toLowerCase().includes(agentName)
      );

      if (!alreadyExists) {
        suggestions.push({
          id: `sug-${(nextId++).toString().padStart(3, '0')}`,
          priority: 'high',
          action: `Run ${agentName}`,
          reason: `Code paths indicate ${agentName} is required`,
          command: `pnpm orchestrate:run ${agentName} --wu ${wuId}`,
        });
      }
    }

    return suggestions;
  }
}

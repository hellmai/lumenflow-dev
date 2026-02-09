#!/usr/bin/env node

/**
 * lane:suggest CLI Command (WU-1189, WU-1190)
 *
 * LLM-driven lane generation based on codebase context.
 * Analyzes project structure and uses LLM to suggest appropriate lane definitions.
 *
 * Usage:
 *   pnpm lane:suggest                    # Generate suggestions
 *   pnpm lane:suggest --dry-run          # Preview without LLM call
 *   pnpm lane:suggest --interactive      # Accept/skip/edit each suggestion
 *   pnpm lane:suggest --output lanes.yaml # Write to file
 *   pnpm lane:suggest --include-git      # Add git history context (WU-1190)
 */

import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import * as readline from 'node:readline';
import path from 'node:path';
import YAML from 'yaml';
import chalk from 'chalk';
import { findProjectRoot, createWUParser } from '@lumenflow/core';
import {
  gatherProjectContext,
  generateSystemPrompt,
  generateUserPrompt,
  getDefaultSuggestions,
  isValidLaneFormat,
  type LaneSuggestion,
  type ProjectContext,
} from '@lumenflow/core/lane-suggest-prompt';
import {
  extractGitContext,
  summarizeGitContext,
  type GitContext,
} from '@lumenflow/core/git-context-extractor';
import { runCLI } from './cli-entry-point.js';

/**
 * CLI option definitions
 */
const LANE_SUGGEST_OPTIONS = {
  dryRun: {
    name: 'dryRun',
    flags: '--dry-run',
    description: 'Show what would be suggested without making LLM call',
  },
  interactive: {
    name: 'interactive',
    flags: '--interactive, -i',
    description: 'Interactively accept/skip/edit each suggestion',
  },
  output: {
    name: 'output',
    flags: '--output, -o <file>',
    description: 'Write suggestions to YAML file',
  },
  json: {
    name: 'json',
    flags: '--json',
    description: 'Output suggestions as JSON',
  },
  noLlm: {
    name: 'noLlm',
    flags: '--no-llm',
    description: 'Use heuristic-based suggestions (no LLM)',
  },
  includeGit: {
    name: 'includeGit',
    flags: '--include-git',
    description: 'Add git history context (co-occurrence, ownership, churn) to LLM prompt',
  },
};

interface LaneSuggestOptions {
  dryRun?: boolean;
  interactive?: boolean;
  output?: string;
  json?: boolean;
  noLlm?: boolean;
  includeGit?: boolean;
}

/**
 * Parse CLI options
 */
function parseOptions(): LaneSuggestOptions {
  const opts = createWUParser({
    name: 'lane-suggest',
    description: 'Suggest lane definitions based on codebase context',
    options: Object.values(LANE_SUGGEST_OPTIONS),
  });

  return {
    dryRun: opts.dryRun ?? false,
    interactive: opts.interactive ?? false,
    output: opts.output,
    json: opts.json ?? false,
    noLlm: opts.noLlm ?? false,
    includeGit: opts.includeGit ?? false,
  };
}

/**
 * Format a lane suggestion for terminal output
 */
function formatSuggestion(suggestion: LaneSuggestion, index: number): string {
  const lines: string[] = [];
  lines.push(chalk.bold.cyan(`\n[${index + 1}] ${suggestion.lane}`));
  lines.push(chalk.gray(`    Description: ${suggestion.description}`));
  lines.push(chalk.gray(`    Rationale: ${suggestion.rationale}`));
  lines.push(chalk.gray(`    Code Paths:`));
  for (const cp of suggestion.code_paths) {
    lines.push(chalk.gray(`      - ${cp}`));
  }
  lines.push(chalk.gray(`    Keywords: ${suggestion.keywords.join(', ')}`));
  return lines.join('\n');
}

/**
 * Interactive mode: prompt user for each suggestion
 */
async function interactiveMode(suggestions: LaneSuggestion[]): Promise<LaneSuggestion[]> {
  const accepted: LaneSuggestion[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };

  console.log(chalk.bold('\nInteractive Mode'));
  console.log(chalk.gray('For each suggestion, choose: (a)ccept, (s)kip, (e)dit, (q)uit\n'));

  for (let i = 0; i < suggestions.length; i++) {
    const suggestion = suggestions[i];
    console.log(formatSuggestion(suggestion, i));

    const answer = await question(chalk.yellow('\n  Action [a/s/e/q]: '));

    switch (answer.toLowerCase().trim()) {
      case 'a':
      case 'accept':
      case '': // Default to accept
        accepted.push(suggestion);
        console.log(chalk.green('  Accepted'));
        break;

      case 's':
      case 'skip':
        console.log(chalk.gray('  Skipped'));
        break;

      case 'e':
      case 'edit': {
        const newLane = await question(chalk.yellow(`  New lane name [${suggestion.lane}]: `));
        const newDesc = await question(
          chalk.yellow(`  New description [${suggestion.description}]: `),
        );

        const edited: LaneSuggestion = {
          ...suggestion,
          lane: newLane.trim() || suggestion.lane,
          description: newDesc.trim() || suggestion.description,
        };

        // Validate lane format
        if (!isValidLaneFormat(edited.lane)) {
          console.log(chalk.red('  Invalid lane format. Expected "Parent: Sublane"'));
          console.log(chalk.gray('  Using original lane name'));
          edited.lane = suggestion.lane;
        }

        accepted.push(edited);
        console.log(chalk.green('  Edited and accepted'));
        break;
      }

      case 'q':
      case 'quit':
        console.log(chalk.gray('  Quitting interactive mode'));
        rl.close();
        return accepted;

      default:
        console.log(chalk.gray('  Unknown action, skipping'));
        break;
    }
  }

  rl.close();
  return accepted;
}

/**
 * Generate lane inference YAML from suggestions
 */
function generateLaneInferenceYAML(suggestions: LaneSuggestion[]): string {
  // Group suggestions by parent lane
  const grouped: Record<
    string,
    Record<string, { code_paths: string[]; keywords: string[]; description: string }>
  > = {};

  for (const suggestion of suggestions) {
    const [parent, sublane] = suggestion.lane.split(': ');
    if (!parent || !sublane) continue;

    if (!grouped[parent]) {
      grouped[parent] = {};
    }

    grouped[parent][sublane] = {
      description: suggestion.description,
      code_paths: suggestion.code_paths,
      keywords: suggestion.keywords,
    };
  }

  const header = `# Lane Inference Configuration
# Generated by: pnpm lane:suggest
# Customize this file to match your project structure

`;

  return header + YAML.stringify(grouped);
}

/**
 * Display dry-run information
 */
function displayDryRun(
  context: ProjectContext,
  systemPrompt: string,
  userPrompt: string,
  gitContext?: GitContext,
  gitSummary?: string,
): void {
  console.log(chalk.bold.cyan('\n=== DRY RUN MODE ===\n'));
  console.log(chalk.gray('This shows what would be sent to the LLM.\n'));

  console.log(chalk.bold('Project Context:'));
  console.log(chalk.gray(`  - Monorepo: ${context.isMonorepo}`));
  console.log(chalk.gray(`  - Packages: ${context.packageNames.length}`));
  console.log(chalk.gray(`  - Has docs/: ${context.hasDocsDir}`));
  console.log(chalk.gray(`  - Has apps/: ${context.hasAppsDir}`));
  console.log(chalk.gray(`  - Existing lanes: ${context.existingLanes.length}`));

  if (context.packageNames.length > 0) {
    console.log(chalk.bold('\nPackages Found:'));
    for (const pkg of context.packageNames) {
      console.log(chalk.gray(`  - ${pkg}`));
    }
  }

  if (context.directoryStructure.length > 0) {
    console.log(chalk.bold('\nDirectory Structure:'));
    for (const dir of context.directoryStructure) {
      console.log(chalk.gray(`  - ${dir}/`));
    }
  }

  // Display git context if available (WU-1190)
  if (gitContext && gitSummary) {
    console.log(chalk.bold('\nGit History Context (--include-git):'));
    if (gitContext.hasLimitedHistory) {
      console.log(
        chalk.yellow(`  Limited history: ${gitContext.error ?? 'sparse commit history'}`),
      );
    } else {
      console.log(chalk.gray(`  - Co-occurrences: ${gitContext.coOccurrences.length} pairs found`));
      console.log(
        chalk.gray(`  - Ownership signals: ${gitContext.ownership.length} paths analyzed`),
      );
      console.log(chalk.gray(`  - Churn hotspots: ${gitContext.churn.length} files identified`));
    }
    console.log(chalk.bold('\nGit Summary (for LLM):'));
    console.log(chalk.gray(gitSummary.slice(0, 500) + (gitSummary.length > 500 ? '...' : '')));
  }

  console.log(chalk.bold('\nSystem Prompt Preview:'));
  console.log(chalk.gray(systemPrompt.slice(0, 500) + '...'));

  console.log(chalk.bold('\nUser Prompt Preview:'));
  console.log(chalk.gray(userPrompt.slice(0, 1000) + '...'));

  console.log(chalk.bold('\nDefault Suggestions (without LLM):'));
  const defaults = getDefaultSuggestions(context);
  for (let i = 0; i < defaults.length; i++) {
    console.log(formatSuggestion(defaults[i], i));
  }

  console.log(chalk.cyan('\n=== END DRY RUN ==='));
  console.log(chalk.gray('\nTo generate actual suggestions, run without --dry-run'));
}

/**
 * Get suggestions using heuristics (LLM deferred per WU-1189)
 */
function getSuggestions(context: ProjectContext, noLlm: boolean): LaneSuggestion[] {
  if (noLlm) {
    console.log(chalk.gray('  Using heuristic-based suggestions (--no-llm)'));
  } else {
    console.log(chalk.yellow('  Note: LLM integration requires API configuration'));
    console.log(chalk.gray('  Using heuristic-based suggestions as fallback'));
    console.log(chalk.gray('  Set OPENAI_API_KEY or use --no-llm for explicit heuristics\n'));
  }
  // NOTE: LLM call implementation deferred per WU-1189 scope
  return getDefaultSuggestions(context);
}

/**
 * Output suggestions as JSON
 */
function outputAsJson(suggestions: LaneSuggestion[], context: ProjectContext): void {
  const result = {
    suggestions,
    context: {
      packageCount: context.packageNames.length,
      docsFound: context.hasDocsDir,
      existingConfig: context.existingLanes.length > 0,
    },
  };
  console.log(chalk.bold('\nJSON Output:'));
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Write suggestions to YAML file
 */
function writeToFile(suggestions: LaneSuggestion[], outputFile: string, projectRoot: string): void {
  const outputPath = path.isAbsolute(outputFile) ? outputFile : path.join(projectRoot, outputFile);
  const yamlContent = generateLaneInferenceYAML(suggestions);

  const outputDir = path.dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(outputPath, yamlContent);
  console.log(chalk.green(`\nLane configuration written to: ${outputPath}`));
}

/**
 * Display suggestions in terminal
 */
function displaySuggestions(suggestions: LaneSuggestion[]): void {
  suggestions.forEach((s, i) => console.log(formatSuggestion(s, i)));
}

/**
 * Show save instructions
 */
function showSaveInstructions(): void {
  console.log(chalk.bold('\nTo save these suggestions:'));
  console.log(chalk.gray('  pnpm lane:suggest --output .lumenflow.lane-inference.yaml'));
  console.log(chalk.gray('  pnpm lane:suggest --interactive --output lanes.yaml'));
  console.log(chalk.gray('  pnpm lane:suggest --json > lanes.json'));
}

/**
 * Generate user prompt with optional git context (WU-1190)
 */
function generateEnrichedUserPrompt(context: ProjectContext, gitSummary?: string): string {
  let prompt = generateUserPrompt(context);

  if (gitSummary) {
    // Insert git context before the instructions section
    const instructionsMarker = '## Instructions';
    const insertionPoint = prompt.indexOf(instructionsMarker);

    if (insertionPoint !== -1) {
      const gitSection = `## Git History Analysis

The following insights were extracted from the repository's git history.
Use these to understand which files are often changed together (suggesting shared ownership),
who the primary contributors are for different areas, and which files have high churn (potential complexity).

${gitSummary}

`;
      prompt = prompt.slice(0, insertionPoint) + gitSection + prompt.slice(insertionPoint);
    } else {
      // Fallback: append at the end
      prompt += `\n\n## Git History Analysis\n\n${gitSummary}`;
    }
  }

  return prompt;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const opts = parseOptions();
  const projectRoot = findProjectRoot();

  console.log(chalk.bold('[lane:suggest] Analyzing project structure...'));
  console.log(chalk.gray(`  Project root: ${projectRoot}`));

  const context = gatherProjectContext(projectRoot);

  // Extract git context if requested (WU-1190)
  let gitContext: GitContext | undefined;
  let gitSummary: string | undefined;

  if (opts.includeGit) {
    console.log(chalk.gray('  Extracting git history context...'));
    gitContext = extractGitContext(projectRoot);

    if (gitContext.hasLimitedHistory) {
      console.log(chalk.yellow(`  Git history limited: ${gitContext.error ?? 'sparse history'}`));
    } else {
      console.log(chalk.gray(`    - ${gitContext.coOccurrences.length} co-occurrence pairs`));
      console.log(chalk.gray(`    - ${gitContext.ownership.length} ownership signals`));
      console.log(chalk.gray(`    - ${gitContext.churn.length} churn hotspots`));
    }

    // Summarize for LLM prompt (respecting token limits)
    gitSummary = summarizeGitContext(gitContext, { maxTokens: 500 });
  }

  if (opts.dryRun) {
    const userPrompt = generateEnrichedUserPrompt(context, gitSummary);
    displayDryRun(context, generateSystemPrompt(), userPrompt, gitContext, gitSummary);
    return;
  }

  let suggestions = getSuggestions(context, opts.noLlm ?? false);

  if (suggestions.length === 0) {
    console.log(chalk.yellow('\nNo lane suggestions generated.'));
    console.log(chalk.gray('Try providing more project structure (packages/, docs/, etc.)'));
    return;
  }

  console.log(chalk.bold(`\nGenerated ${suggestions.length} lane suggestion(s):`));

  if (opts.interactive) {
    suggestions = await interactiveMode(suggestions);
    if (suggestions.length === 0) {
      console.log(chalk.yellow('\nNo suggestions accepted.'));
      return;
    }
    console.log(chalk.bold(`\nAccepted ${suggestions.length} suggestion(s)`));
  } else {
    displaySuggestions(suggestions);
  }

  if (opts.json) {
    outputAsJson(suggestions, context);
    return;
  }

  if (opts.output) {
    writeToFile(suggestions, opts.output, projectRoot);
    return;
  }

  showSaveInstructions();
}

// Entry point
if (import.meta.main) {
  void runCLI(main);
}

// Export for testing
export { main, parseOptions, formatSuggestion, interactiveMode, generateLaneInferenceYAML };

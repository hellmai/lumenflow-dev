// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Prompt Linter with 3-Tier Token Budget Enforcement
 *
 * Enforces token budget constraints on LLM prompts:
 * - BLOCK: >450 tokens OR +>120 delta (exit 1)
 * - WARN: ≥400 tokens OR +>50 delta (continue, log warning)
 * - LOG: Always log tokenCount, delta, hash, top 3 longest lines
 *
 * Uses proper telemetry via getLogger() (no console spam).
 *
 * Part of WU-676: Single-Call LLM Orchestrator token budget enforcement.
 */

import { analyzePrompt, getLongestLines } from './token-counter.js';
import { readFile, writeFile, mkdir, appendFile, access } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'path';
import { glob } from 'glob';
import yaml from 'yaml';
import { EXIT_CODES, STRING_LITERALS } from './wu-constants.js';
import { ProcessExitError } from './error-handler.js';
import { createPathFactory } from './path-factory.js';

/**
 * WU-2124: Use PathFactory for project root resolution.
 * Replaces: resolve(__dirname, '../..')
 */
const pathFactory = createPathFactory();
const ROOT_DIR = pathFactory.projectRoot;

// Default config path
const DEFAULT_CONFIG_PATH = resolve(ROOT_DIR, 'config/prompts/linter.yml');

// Telemetry cache path (for storing previous metrics) - WU-1430: Use centralized constant
const METRICS_CACHE_PATH = pathFactory.resolveLumenflowPath('PROMPT_METRICS');
export const PROMPT_LINTER_FAILURE_MESSAGE = 'Prompt linter failed:';

/**
 * Load config from YAML file with fallback to defaults
 * @param {string} configPath - Path to config file (optional)
 * @returns {Object} Configuration object
 */
export function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  // Default configuration (fallback if file missing or invalid)
  const defaults = {
    version: 1,
    token_budgets: {
      default: {
        hard_cap: 450,
        warn_threshold: 400,
      },
      retry: {
        hard_cap: 150,
      },
    },
    delta_budgets: {
      warn: 50,
      block: 120,
    },
    retry_pattern: 'retry',
  };

  try {
    if (!existsSync(configPath)) {
      // Config file not found, use defaults
      return defaults;
    }

    const content = readFileSync(configPath, { encoding: 'utf-8' });
    const parsed = yaml.parse(content);

    // Merge parsed config with defaults (handles incomplete configs)
    return {
      version: parsed.version ?? defaults.version,
      token_budgets: {
        default: {
          hard_cap:
            parsed.token_budgets?.default?.hard_cap ?? defaults.token_budgets.default.hard_cap,
          warn_threshold:
            parsed.token_budgets?.default?.warn_threshold ??
            defaults.token_budgets.default.warn_threshold,
        },
        retry: {
          hard_cap: parsed.token_budgets?.retry?.hard_cap ?? defaults.token_budgets.retry.hard_cap,
        },
      },
      delta_budgets: {
        warn: parsed.delta_budgets?.warn ?? defaults.delta_budgets.warn,
        block: parsed.delta_budgets?.block ?? defaults.delta_budgets.block,
      },
      retry_pattern: parsed.retry_pattern ?? defaults.retry_pattern,
    };
  } catch (_error) {
    // YAML parsing error or other failure, use defaults
    console.error(`⚠️  Failed to load config from ${configPath}: ${_error.message}`);
    console.error(`   Using default token budgets.`);
    return defaults;
  }
}

/**
 * Load previous metrics from cache
 * @returns {Promise<Object>} Previous metrics by file path
 */
async function loadPreviousMetrics() {
  try {
    const fileExists = await access(METRICS_CACHE_PATH)
      .then(() => true)
      .catch(() => false);
    if (fileExists) {
      const data = await readFile(METRICS_CACHE_PATH, { encoding: 'utf-8' });
      return JSON.parse(data);
    }
  } catch {
    // Ignore errors, return empty metrics
  }
  return {};
}

/**
 * Save current metrics to cache
 * @param {Object} metrics - Metrics by file path
 * @returns {Promise<void>}
 */
async function savemetrics(metrics: UnsafeAny) {
  try {
    const dir = dirname(METRICS_CACHE_PATH);
    const dirExists = await access(dir)
      .then(() => true)
      .catch(() => false);
    if (!dirExists) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(METRICS_CACHE_PATH, JSON.stringify(metrics, null, 2));
  } catch {
    // Ignore errors (cache is optional)
  }
}

/**
 * Output mode options for logging
 */
interface LogOutputOptions {
  /** Suppress non-essential output */
  quiet?: boolean;
  /** Enable verbose output */
  verbose?: boolean;
}

type LogLevel = 'info' | 'warn' | 'error';

interface LogData extends Record<string, unknown> {
  file?: string;
  tokenCount?: number;
  delta?: number;
  message?: string;
}

/**
 * Log via proper telemetry (simulated getLogger for CLI context)
 * In production, this would use apps/web/src/lib/logger.ts
 * @param {string} level - Log level (info, warn, error)
 * @param {string} event - Event name
 * @param {Object} data - Structured data
 * @param {LogOutputOptions} [output] - Output mode
 * @returns {Promise<void>}
 */
async function log(level: LogLevel, event: string, data: LogData, output: LogOutputOptions = {}) {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    level,
    event,
    ...data,
  };

  // For CLI, write to telemetry prompt lint file - WU-1430/WU-2124: Use PathFactory
  const ndjsonPath = pathFactory.resolveLumenflowPath('PROMPT_LINT');
  const line = `${JSON.stringify(entry)}${STRING_LITERALS.NEWLINE}`;

  try {
    const dir = dirname(ndjsonPath);
    const dirExists = await access(dir)
      .then(() => true)
      .catch(() => false);
    if (!dirExists) {
      await mkdir(dir, { recursive: true });
    }
    await appendFile(ndjsonPath, line);
  } catch {
    // Fallback to stderr if file write fails
    console.error(JSON.stringify(entry));
  }

  const shouldPrintToConsole = output.verbose ? true : output.quiet ? level !== 'info' : true;

  // Also output human-readable to stderr
  const levelEmojiMap: Record<LogLevel, string> = {
    info: '📊',
    warn: '⚠️ ',
    error: '❌',
  };
  const levelEmoji = levelEmojiMap[level];

  if (shouldPrintToConsole) {
    const message = `${levelEmoji} [${event}] ${data.file || ''} ${data.tokenCount ? `${data.tokenCount} tokens` : ''}`;
    console.error(message);
    if (data.delta !== undefined) {
      console.error(`   Delta: ${data.delta > 0 ? '+' : ''}${data.delta} tokens`);
    }
    if (data.message) {
      console.error(`   ${data.message}`);
    }
  }
}

/**
 * Lint a single prompt file
 * @param {string} filePath - Absolute path to prompt file
 * @param {Object} previousMetrics - Previous metrics for delta calculation
 * @param {string} mode - Mode (pre-commit, pre-push, ci, local)
 * @param {Object} config - Configuration object from loadConfig()
 * @param {{quiet?: boolean, verbose?: boolean}} output - Output mode
 * @returns {Promise<{passed: boolean, tokenCount: number, delta: number, hash: string}>}
 */
async function lintPromptFile(
  filePath: UnsafeAny,
  previousMetrics: UnsafeAny,
  mode: UnsafeAny,
  config: UnsafeAny,
  output: UnsafeAny,
) {
  // Analyze prompt
  const { tokenCount, hash, text } = analyzePrompt(filePath);

  // Calculate delta from previous metrics
  const previous = previousMetrics[filePath];
  const delta = previous ? tokenCount - previous.tokenCount : 0;

  // Determine cap based on file name and config pattern
  const isRetryPrompt = filePath.includes(config.retry_pattern);
  const cap = isRetryPrompt
    ? config.token_budgets.retry.hard_cap
    : config.token_budgets.default.hard_cap;

  // Get top 3 longest lines for cleanup targeting
  const longestLines = getLongestLines(text, 3);

  // BLOCK: hard cap or sudden bloat
  if (tokenCount > cap || delta > config.delta_budgets.block) {
    await log(
      'error',
      'prompt.lint.blocked',
      {
        file: filePath,
        tokenCount,
        delta,
        hash,
        cap,
        mode,
        message: `Exceeds ${cap} token cap or delta >${config.delta_budgets.block}`,
        longestLines: longestLines.map((l) => `Line ${l.number}: ${l.length} chars`),
      },
      output,
    );
    return { passed: false, tokenCount, delta, hash };
  }

  // WARN: approaching cap or gradual creep
  if (
    tokenCount >= config.token_budgets.default.warn_threshold ||
    delta > config.delta_budgets.warn
  ) {
    await log(
      'warn',
      'prompt.lint.warning',
      {
        file: filePath,
        tokenCount,
        delta,
        hash,
        threshold: config.token_budgets.default.warn_threshold,
        mode,
        message: 'Approaching token budget cap',
        longestLines: longestLines.map((l) => `Line ${l.number}: ${l.length} chars`),
      },
      output,
    );
  }

  // LOG: always log metrics
  await log(
    'info',
    'prompt.lint.measured',
    {
      file: filePath,
      tokenCount,
      delta,
      hash,
      mode,
      longestLines: longestLines.map((l) => `Line ${l.number}: ${l.length} chars`),
    },
    output,
  );

  return { passed: true, tokenCount, delta, hash };
}

/**
 * Options for linting prompts
 */
export interface LintPromptsOptions {
  /** Suppress non-essential output */
  quiet?: boolean;
  /** Enable verbose output */
  verbose?: boolean;
}

/**
 * Main linter function
 * @param {string[]} filePaths - Prompt files to lint (optional, finds all if empty)
 * @param {string} mode - Mode (pre-commit, pre-push, ci, local)
 * @param {string} configPath - Optional config file path
 * @param {LintPromptsOptions} [options] - Output options
 * @returns {Promise<{passed: boolean, results: Array, config: Object}>}
 */
export async function lintPrompts(
  filePaths: string[] = [],
  mode = 'local',
  configPath: string | undefined = undefined,
  options: LintPromptsOptions = {},
) {
  // Load configuration
  const config = loadConfig(configPath);
  const output = { quiet: options.quiet === true, verbose: options.verbose === true };

  // If no files provided, find all orchestrator prompt files (WU-676 scope only)
  if (filePaths.length === 0) {
    // WU-1068: Changed from @exampleapp to generic ai/prompts for framework reusability
    const pattern = 'ai/prompts/orchestrator-*/**/*.yaml';
    filePaths = await glob(pattern, { cwd: ROOT_DIR, absolute: true });
  }

  // Load previous metrics for delta calculation
  const previousMetrics = await loadPreviousMetrics();

  // Lint each file
  const results: UnsafeAny[] = [];
  let allPassed = true;

  for (const filePath of filePaths) {
    const result = await lintPromptFile(filePath, previousMetrics, mode, config, output);
    results.push({ filePath, ...result });

    if (!result.passed) {
      allPassed = false;
    }

    // Update metrics cache
    previousMetrics[filePath] = {
      tokenCount: result.tokenCount,
      hash: result.hash,
      timestamp: new Date().toISOString(),
    };
  }

  // Save updated metrics
  await savemetrics(previousMetrics);

  return { passed: allPassed, results, config };
}

/**
 * CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const modeFlag = args.find((arg) => arg.startsWith('--mode='));
  const mode = modeFlag ? modeFlag.split('=')[1] : 'local';
  const quiet = args.includes('--quiet');
  const verbose = args.includes('--verbose');

  // Get files to lint (from args or find all)
  const files = args.filter((arg) => !arg.startsWith('--'));

  console.error(`\n🔍 Linting prompts (mode: ${mode})...\n`);

  const { passed, results, config } = await lintPrompts(files, mode, undefined, { quiet, verbose });

  // Summary
  const total = results.length;
  const blocked = results.filter((r) => !r.passed).length;
  const warned = results.filter(
    (r) => r.passed && r.tokenCount >= config.token_budgets.default.warn_threshold,
  ).length;

  console.error(`\n📋 Summary: ${total} prompts analyzed`);
  if (blocked > 0) {
    console.error(
      `   ❌ ${blocked} BLOCKED (>${config.token_budgets.default.hard_cap} tokens or delta >${config.delta_budgets.block})`,
    );
  }
  if (warned > 0) {
    console.error(
      `   ⚠️  ${warned} WARNING (≥${config.token_budgets.default.warn_threshold} tokens or delta >${config.delta_budgets.warn})`,
    );
  }
  if (blocked === 0 && warned === 0) {
    console.error(`   ✅ All prompts within budget`);
  }

  throw new ProcessExitError(
    passed ? 'All prompts within budget' : 'Prompt lint failed',
    passed ? EXIT_CODES.SUCCESS : EXIT_CODES.ERROR,
  );
}

// Export main for testability (WU-1538)
export { main as lintMain };

export interface PromptLinterCliDeps {
  runMain: () => Promise<void>;
  setExitCode: (exitCode: number) => void;
  logError: (...args: unknown[]) => void;
}

const DEFAULT_PROMPT_LINTER_CLI_DEPS: PromptLinterCliDeps = {
  runMain: main,
  setExitCode: (exitCode) => {
    process.exitCode = exitCode;
  },
  logError: console.error,
};

export async function runPromptLinterCli(
  deps: PromptLinterCliDeps = DEFAULT_PROMPT_LINTER_CLI_DEPS,
): Promise<void> {
  try {
    await deps.runMain();
  } catch (error) {
    if (error instanceof ProcessExitError) {
      deps.setExitCode(error.exitCode);
      return;
    }
    deps.logError(PROMPT_LINTER_FAILURE_MESSAGE, error);
    deps.setExitCode(EXIT_CODES.ERROR);
  }
}

// Run CLI if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  void runPromptLinterCli();
}

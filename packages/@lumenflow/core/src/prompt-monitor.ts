// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Nightly Prompt Monitor
 *
 * Monitors all prompts for token budget drift and hash changes.
 * Designed to run as a GitHub Actions cron job (nightly at 2 AM).
 *
 * Logs to .lumenflow/telemetry/prompt-nightly.ndjson and Axiom.
 * Alerts if:
 * - Any prompt ≥400 tokens (approaching cap)
 * - Any delta >50 tokens since yesterday
 * - rules_hash changed outside a WU (unintentional drift)
 *
 * Part of WU-676: Single-Call LLM Orchestrator token budget enforcement.
 */

import { analyzePrompt } from './token-counter.js';
import { readFile, writeFile, mkdir, appendFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'path';
import { glob } from 'glob';
import { EXIT_CODES, STRING_LITERALS } from './wu-constants.js';
import { ProcessExitError } from './error-handler.js';
import { createPathFactory } from './path-factory.js';

/**
 * WU-2124: Use PathFactory for project root resolution.
 * Replaces: resolve(__dirname, '../..')
 */
const pathFactory = createPathFactory();
const ROOT_DIR = pathFactory.projectRoot;

// Paths (WU-2124: use PathFactory.resolveLumenflowPath instead of __dirname-relative)
const TELEMETRY_DIR = pathFactory.resolveLumenflowPath('TELEMETRY');
const YESTERDAY_METRICS_PATH = resolve(TELEMETRY_DIR, 'prompt-metrics-yesterday.json');
const TODAY_METRICS_PATH = resolve(TELEMETRY_DIR, 'prompt-metrics.json');
const NDJSON_LOG_PATH = resolve(TELEMETRY_DIR, 'prompt-nightly.ndjson');

// Alert thresholds
const WARN_THRESHOLD = 400;
const DELTA_THRESHOLD = 50;
export const PROMPT_MONITOR_FAILURE_MESSAGE = 'Nightly monitor failed:';

interface PromptMetricsEntry {
  tokenCount: number;
  hash: string;
  timestamp?: string;
}

/**
 * Load yesterday's metrics
 */
async function loadYesterdayMetrics(): Promise<Record<string, PromptMetricsEntry>> {
  try {
    const exists = await access(YESTERDAY_METRICS_PATH)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      const data = await readFile(YESTERDAY_METRICS_PATH, { encoding: 'utf-8' });
      return JSON.parse(data) as Record<string, PromptMetricsEntry>;
    }
  } catch (error) {
    console.error('Failed to load yesterday metrics:', error);
  }
  return {};
}

/**
 * Save today's metrics
 */
async function saveMetrics(metrics: Record<string, PromptMetricsEntry>) {
  try {
    const dir = dirname(TODAY_METRICS_PATH);
    const dirExists = await access(dir)
      .then(() => true)
      .catch(() => false);
    if (!dirExists) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(TODAY_METRICS_PATH, JSON.stringify(metrics, null, 2));
  } catch (error) {
    console.error('Failed to save metrics:', error);
  }
}

/**
 * Log to NDJSON
 */
async function log(event: string, data: Record<string, unknown>) {
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    ...data,
  };

  const line = `${JSON.stringify(entry)}${STRING_LITERALS.NEWLINE}`;

  try {
    const dir = dirname(NDJSON_LOG_PATH);
    const dirExists = await access(dir)
      .then(() => true)
      .catch(() => false);
    if (!dirExists) {
      await mkdir(dir, { recursive: true });
    }
    await appendFile(NDJSON_LOG_PATH, line);
  } catch (error) {
    console.error('Failed to log:', error);
  }

  // Also output to stdout for GitHub Actions logs
  console.log(JSON.stringify(entry));
}

/**
 * Main monitor function
 */
async function monitor() {
  console.log('\n🌙 Nightly Prompt Monitor Starting...\n');

  // Find all prompt files
  // WU-1068: Changed from @exampleapp to generic ai/prompts for framework reusability
  // Projects should configure prompt paths in workspace.yaml
  const pattern = 'ai/prompts/**/*.yaml';
  const promptFiles = await glob(pattern, { cwd: ROOT_DIR, absolute: true });

  console.log(`Found ${promptFiles.length} prompt files to analyze\n`);

  // Load yesterday's metrics for delta calculation
  const yesterdayMetrics = await loadYesterdayMetrics();
  const todayMetrics: Record<string, PromptMetricsEntry> = {};

  let totalAlerts = 0;

  for (const filePath of promptFiles) {
    try {
      const { tokenCount, hash } = analyzePrompt(filePath);
      const yesterday = yesterdayMetrics[filePath];

      // Calculate delta
      const delta = yesterday ? tokenCount - yesterday.tokenCount : 0;
      const hashChanged = yesterday ? hash !== yesterday.hash : false;

      // Store today's metrics
      todayMetrics[filePath] = {
        tokenCount,
        hash,
        timestamp: new Date().toISOString(),
      };

      // Log metrics
      await log('prompt.nightly.metrics', {
        prompt: filePath,
        tokenCount,
        hash,
        delta,
        hashChanged,
      });

      // Alert: approaching cap
      if (tokenCount >= WARN_THRESHOLD) {
        totalAlerts++;
        await log('prompt.nightly.approaching_cap', {
          prompt: filePath,
          tokenCount,
          cap: 450,
          message: `Prompt at ${tokenCount} tokens (approaching 450 cap)`,
        });
        console.error(`⚠️  ${filePath}: ${tokenCount} tokens (approaching cap)`);
      }

      // Alert: significant delta
      if (Math.abs(delta) > DELTA_THRESHOLD) {
        totalAlerts++;
        await log('prompt.nightly.significant_delta', {
          prompt: filePath,
          tokenCount,
          delta,
          message: `Delta ${delta > 0 ? '+' : ''}${delta} tokens exceeds threshold`,
        });
        console.error(`⚠️  ${filePath}: Delta ${delta > 0 ? '+' : ''}${delta} tokens`);
      }

      // Alert: hash changed
      if (hashChanged && yesterday) {
        totalAlerts++;
        await log('prompt.nightly.hash_changed', {
          prompt: filePath,
          oldHash: yesterday.hash,
          newHash: hash,
          message: 'Prompt hash changed - investigate if intentional',
        });
        console.error(`⚠️  ${filePath}: Hash changed (${yesterday.hash} → ${hash})`);
      }

      // Success log (no alerts)
      if (tokenCount < WARN_THRESHOLD && Math.abs(delta) <= DELTA_THRESHOLD && !hashChanged) {
        console.log(`✅ ${filePath}: ${tokenCount} tokens (delta: ${delta})`);
      }
    } catch (error) {
      console.error(`❌ Failed to analyze ${filePath}:`, error);
      await log('prompt.nightly.analysis_failed', {
        prompt: filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Save today's metrics for tomorrow's delta calculation
  await saveMetrics(todayMetrics);

  // Rotate metrics (today becomes yesterday)
  const todayExists = await access(TODAY_METRICS_PATH)
    .then(() => true)
    .catch(() => false);
  if (todayExists) {
    try {
      const todayData = await readFile(TODAY_METRICS_PATH, { encoding: 'utf-8' });
      await writeFile(YESTERDAY_METRICS_PATH, todayData);
    } catch (error) {
      console.error('Failed to rotate metrics:', error);
    }
  }

  // Summary
  console.log(`\n📊 Nightly Monitor Complete`);
  console.log(`   Total prompts: ${promptFiles.length}`);
  console.log(`   Alerts: ${totalAlerts}`);

  if (totalAlerts > 0) {
    console.log(`\n⚠️  Review alerts above and investigate if changes were intentional\n`);
    throw new ProcessExitError('Prompt alerts detected', EXIT_CODES.ERROR);
  } else {
    console.log(`\n✅ All prompts within budget and stable\n`);
    throw new ProcessExitError('Monitor complete', EXIT_CODES.SUCCESS);
  }
}

// Export monitor for testability (WU-1538)
export { monitor };

export interface PromptMonitorCliDeps {
  runMonitor: () => Promise<void>;
  setExitCode: (exitCode: number) => void;
  logError: (...args: unknown[]) => void;
}

const DEFAULT_PROMPT_MONITOR_CLI_DEPS: PromptMonitorCliDeps = {
  runMonitor: monitor,
  setExitCode: (exitCode) => {
    process.exitCode = exitCode;
  },
  logError: console.error,
};

export async function runMonitorCli(
  deps: PromptMonitorCliDeps = DEFAULT_PROMPT_MONITOR_CLI_DEPS,
): Promise<void> {
  try {
    await deps.runMonitor();
  } catch (error) {
    if (error instanceof ProcessExitError) {
      deps.setExitCode(error.exitCode);
      return;
    }
    deps.logError(PROMPT_MONITOR_FAILURE_MESSAGE, error);
    deps.setExitCode(EXIT_CODES.ERROR);
  }
}

// Run monitor when executed directly
if (import.meta.main) {
  void runMonitorCli();
}

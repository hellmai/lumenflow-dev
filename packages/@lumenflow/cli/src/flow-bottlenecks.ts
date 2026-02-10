#!/usr/bin/env node
/**
 * Flow Bottlenecks Analysis CLI (WU-1018)
 *
 * Analyzes WU dependency graph to identify bottlenecks and critical paths.
 *
 * Usage:
 *   pnpm flow:bottlenecks                   # Default: top 10 bottlenecks, JSON output
 *   pnpm flow:bottlenecks --limit 5         # Top 5 bottlenecks
 *   pnpm flow:bottlenecks --format table    # Table output
 *   pnpm flow:bottlenecks --format mermaid  # Mermaid diagram of critical path
 *
 * @module flow-bottlenecks
 * @see {@link @lumenflow/metrics/flow/analyze-bottlenecks}
 */

import { Command } from 'commander';
import {
  getBottleneckAnalysis,
  type BottleneckAnalysis,
  type DependencyGraph,
} from '@lumenflow/metrics';
import { buildDependencyGraphAsync, renderMermaid } from '@lumenflow/core/dependency-graph';

import { getConfig } from '@lumenflow/core/config';
import { runCLI } from './cli-entry-point.js';

/** Log prefix for console output */
const LOG_PREFIX = '[flow:bottlenecks]';

/** Default bottleneck limit */
const DEFAULT_LIMIT = 10;

/** Output format options */
const OUTPUT_FORMATS = {
  JSON: 'json',
  TABLE: 'table',
  MERMAID: 'mermaid',
} as const;

/**
 * Parse command line arguments
 */
function parseArgs() {
  const program = new Command()
    .name('flow-bottlenecks')
    .description('Analyze WU dependency graph for bottlenecks and critical paths')
    .option(
      '--limit <number>',
      `Number of bottlenecks to show (default: ${DEFAULT_LIMIT})`,
      String(DEFAULT_LIMIT),
    )
    .option(
      '--format <type>',
      `Output format: json, table, mermaid (default: json)`,
      OUTPUT_FORMATS.JSON,
    )
    .exitOverride();

  try {
    program.parse(process.argv);
    return program.opts();
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string };
    if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
      process.exit(0);
    }
    throw err;
  }
}

/**
 * Convert core DependencyGraph to metrics DependencyGraph format
 *
 * The core module uses a slightly different node format, so we need to transform it.
 */
function convertToMetricsGraph(
  coreGraph: Map<
    string,
    { id: string; title: string; status: string; blockedBy: string[]; blocks: string[] }
  >,
): DependencyGraph {
  const metricsGraph: DependencyGraph = new Map();

  for (const [id, node] of coreGraph.entries()) {
    metricsGraph.set(id, {
      id: node.id,
      title: node.title,
      blocks: node.blocks,
      blockedBy: node.blockedBy,
      status: node.status,
    });
  }

  return metricsGraph;
}

/**
 * Format analysis as table output
 */
function formatAsTable(analysis: BottleneckAnalysis): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('  BOTTLENECK ANALYSIS');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  // Critical Path section
  lines.push('┌─────────────────────────────────────────────────────────────┐');
  lines.push('│ CRITICAL PATH                                               │');
  lines.push('├─────────────────────────────────────────────────────────────┤');

  if (analysis.criticalPath.warning) {
    lines.push(`│ ⚠️  ${analysis.criticalPath.warning.padEnd(56)} │`);
    if (analysis.criticalPath.cycleNodes && analysis.criticalPath.cycleNodes.length > 0) {
      lines.push(`│ Cycle nodes: ${analysis.criticalPath.cycleNodes.join(', ').slice(0, 46)} │`);
    }
  } else if (analysis.criticalPath.path.length === 0) {
    lines.push('│ No critical path (all WUs are independent or completed)   │');
  } else {
    lines.push(`│ Length: ${analysis.criticalPath.length} WUs`);
    lines.push('│');
    lines.push('│ Path:');
    for (let i = 0; i < analysis.criticalPath.path.length; i++) {
      const wuId = analysis.criticalPath.path[i];
      const arrow = i < analysis.criticalPath.path.length - 1 ? ' → ' : '';
      lines.push(`│   ${i + 1}. ${wuId}${arrow}`);
    }
  }
  lines.push('└─────────────────────────────────────────────────────────────┘');
  lines.push('');

  // Bottlenecks section
  lines.push('┌─────────────────────────────────────────────────────────────┐');
  lines.push('│ TOP BOTTLENECKS (by impact score)                          │');
  lines.push('├─────────────────────────────────────────────────────────────┤');

  if (analysis.bottlenecks.length === 0) {
    lines.push('│ No bottlenecks found (no active dependencies)             │');
  } else {
    lines.push('│  #  WU ID     Score  Title                                │');
    lines.push('│ ─── ───────── ─────  ─────────────────────────────────────│');
    for (let i = 0; i < analysis.bottlenecks.length; i++) {
      const b = analysis.bottlenecks[i];
      const rank = String(i + 1).padStart(2);
      const score = String(b.score).padStart(5);
      const title = (b.title ?? 'Unknown').slice(0, 35);
      lines.push(`│ ${rank}. ${b.id.padEnd(9)} ${score}  ${title}`);
    }
  }
  lines.push('└─────────────────────────────────────────────────────────────┘');
  lines.push('');

  // Explanation
  lines.push('Impact score = number of downstream WUs blocked (recursively)');
  lines.push('Critical path = longest dependency chain in the graph');

  return lines.join('\n');
}

/**
 * Format critical path as Mermaid diagram
 */
function formatAsMermaid(
  analysis: BottleneckAnalysis,
  coreGraph: Map<
    string,
    { id: string; title: string; status: string; blockedBy: string[]; blocks: string[] }
  >,
): string {
  if (analysis.criticalPath.path.length === 0) {
    return '%%{ Critical path is empty - no active dependencies }%%\ngraph TD\n  empty[No critical path]';
  }

  const rootId = analysis.criticalPath.path[0];
  return renderMermaid(coreGraph, { rootId, direction: 'TD', depth: analysis.criticalPath.length });
}

/**
 * Main function
 */
async function main() {
  const opts = parseArgs();
  const limit = parseInt(opts.limit, 10);

  console.log(`${LOG_PREFIX} Building dependency graph...`);

  // Build dependency graph from WU YAML files
  const coreGraph = await buildDependencyGraphAsync();

  if (coreGraph.size === 0) {
    console.log(`${LOG_PREFIX} No WUs found in dependency graph.`);
    // WU-1311: Use config-based WU directory path
    console.log(
      `${LOG_PREFIX} Ensure WU YAML files exist in ${getConfig().directories.wuDir}/ with blocked_by/blocks fields.`,
    );
    return;
  }

  console.log(`${LOG_PREFIX} Found ${coreGraph.size} WUs in graph`);

  // Convert to metrics-compatible graph format
  const metricsGraph = convertToMetricsGraph(coreGraph);

  // Perform bottleneck analysis
  console.log(`${LOG_PREFIX} Analyzing bottlenecks (top ${limit})...`);
  const analysis = getBottleneckAnalysis(metricsGraph, limit);

  // Count active WUs
  const activeWUs = Array.from(coreGraph.values()).filter((n) => n.status !== 'done').length;
  console.log(`${LOG_PREFIX} Active WUs: ${activeWUs}`);
  console.log(`${LOG_PREFIX} Bottlenecks found: ${analysis.bottlenecks.length}`);
  console.log(`${LOG_PREFIX} Critical path length: ${analysis.criticalPath.length}`);

  // Output analysis
  console.log('');
  switch (opts.format) {
    case OUTPUT_FORMATS.TABLE:
      console.log(formatAsTable(analysis));
      break;
    case OUTPUT_FORMATS.MERMAID:
      console.log(formatAsMermaid(analysis, coreGraph));
      break;
    default:
      console.log(JSON.stringify(analysis, null, 2));
  }
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}

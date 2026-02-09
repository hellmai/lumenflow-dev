#!/usr/bin/env node
/**
 * WU Dependency Visualization (WU-1247)
 *
 * Shows dependency graph for a WU in ASCII or Mermaid format.
 *
 * Usage:
 *   pnpm wu:deps WU-1247                    # ASCII format
 *   pnpm wu:deps WU-1247 --format mermaid   # Mermaid diagram
 *   pnpm wu:deps WU-1247 --depth 5          # Deeper traversal
 *   pnpm wu:deps WU-1247 --direction up     # Only upstream deps
 */

import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { die } from '@lumenflow/core/error-handler';
import {
  buildDependencyGraph,
  buildDependencyGraphAsync,
  renderASCII,
  renderMermaid,
  validateGraph,
} from '@lumenflow/core/dependency-graph';
import { OUTPUT_FORMATS } from '@lumenflow/initiatives/constants';
import { PATTERNS } from '@lumenflow/core/wu-constants';
import { getConfig } from '@lumenflow/core/config';

async function main() {
  const args = createWUParser({
    name: 'wu-deps',
    description: 'Visualize WU dependency graph',
    options: [WU_OPTIONS.id, WU_OPTIONS.format, WU_OPTIONS.depth, WU_OPTIONS.direction],
    required: [],
    allowPositionalId: true,
  });

  const wuId = args.id;

  if (!wuId) {
    die('WU ID is required.\n\nUsage: pnpm wu:deps WU-1247');
  }

  if (!PATTERNS.WU_ID.test(wuId)) {
    die(`Invalid WU ID format: "${wuId}"\n\nExpected format: WU-<number> (e.g., WU-1247)`);
  }

  console.log(`[wu:deps] Building dependency graph...`);
  const graph = await buildDependencyGraphAsync();

  if (!graph.has(wuId)) {
    // WU-1311: Use config-based WU directory path
    die(
      `WU not found in graph: ${wuId}\n\nEnsure the WU exists in ${getConfig().directories.wuDir}/`,
    );
  }

  const format = args.format || OUTPUT_FORMATS.ASCII;
  const depth = args.depth ? parseInt(args.depth, 10) : 3;
  const direction = args.direction || 'both';

  // Validate direction
  if (!['up', 'down', 'both'].includes(direction)) {
    die(`Invalid direction: "${direction}"\n\nValid options: up, down, both`);
  }

  let output;

  switch (format) {
    case OUTPUT_FORMATS.MERMAID:
      output = renderMermaid(graph, { rootId: wuId, direction: 'TD', depth });
      break;
    case OUTPUT_FORMATS.JSON:
      output = renderGraphJSON(graph, wuId, depth, direction);
      break;
    case OUTPUT_FORMATS.ASCII:
    default:
      output = renderASCII(graph, wuId, { direction, depth });
      break;
  }

  console.log('');
  console.log(output);

  // Validate and warn about issues
  const validation = validateGraph(graph);
  if (validation.hasCycle) {
    console.log('\n⚠️  Warning: Circular dependencies detected in graph!');
    console.log('Run with --validate for full validation report.');
  }
}

interface GraphOutput {
  root: {
    id: string;
    title: string;
    status: string;
  };
  upstream?: unknown[];
  downstream?: unknown[];
}

function renderGraphJSON(
  graph: Map<
    string,
    { id: string; title: string; status: string; blockedBy: string[]; blocks: string[] }
  >,
  rootId: string,
  depth: number,
  direction: string,
) {
  const node = graph.get(rootId);
  if (!node) return JSON.stringify({ error: 'WU not found' }, null, 2);

  const visited = new Set<string>();
  const collectDeps = (id: string, currentDepth: number, isUpstream: boolean): unknown => {
    if (currentDepth > depth || visited.has(id)) return null;
    visited.add(id);

    const n = graph.get(id);
    if (!n) return { id, status: 'unknown', deps: [] };

    const deps = isUpstream ? n.blockedBy : n.blocks;
    return {
      id,
      title: n.title,
      status: n.status,
      deps: deps
        .filter((d) => graph.has(d))
        .map((d) => collectDeps(d, currentDepth + 1, isUpstream))
        .filter(Boolean),
    };
  };

  const output: GraphOutput = {
    root: {
      id: node.id,
      title: node.title,
      status: node.status,
    },
  };

  visited.clear();
  if (direction === 'up' || direction === 'both') {
    visited.add(rootId);
    output.upstream = node.blockedBy
      .filter((d) => graph.has(d))
      .map((d) => collectDeps(d, 1, true))
      .filter(Boolean);
  }

  visited.clear();
  if (direction === 'down' || direction === 'both') {
    visited.add(rootId);
    output.downstream = node.blocks
      .filter((d) => graph.has(d))
      .map((d) => collectDeps(d, 1, false))
      .filter(Boolean);
  }

  return JSON.stringify(output, null, 2);
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  runCLI(main);
}

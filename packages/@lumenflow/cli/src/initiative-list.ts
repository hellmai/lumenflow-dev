#!/usr/bin/env node
/**
 * Initiative List Helper (WU-1247)
 *
 * Lists all initiatives with progress percentages.
 *
 * Usage:
 *   pnpm initiative:list                    # Table format
 *   pnpm initiative:list --format json      # JSON format
 *   pnpm initiative:list --status open      # Filter by status
 */

import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { listInitiatives, getInitiativeProgress } from '@lumenflow/initiatives/yaml';
import { OUTPUT_FORMATS } from '@lumenflow/initiatives/constants';
import Table from 'cli-table3';

function renderTable(initiatives, useColor) {
  if (initiatives.length === 0) {
    console.log('No initiatives found.');
    return;
  }

  const table = new Table({
    head: ['ID', 'Title', 'Status', 'Progress', 'WUs'],
    colWidths: [12, 35, 15, 12, 12],
    style: {
      head: useColor ? ['cyan'] : [],
    },
  });

  for (const { id, doc } of initiatives) {
    const progress = getInitiativeProgress(id);
    const progressPct = `${progress.percentage}%`;
    const wuCount = `${progress.done}/${progress.total}`;

    table.push([id, truncate(doc.title, 33), doc.status, progressPct, wuCount]);
  }

  console.log(table.toString());

  // Summary
  const statusCounts = {};
  for (const { doc } of initiatives) {
    statusCounts[doc.status] = (statusCounts[doc.status] || 0) + 1;
  }
  const summary = Object.entries(statusCounts)
    .map(([status, count]) => `${count} ${status}`)
    .join(', ');
  console.log(`\nTotal: ${initiatives.length} initiatives (${summary})`);
}

function renderJSON(initiatives) {
  const output = initiatives.map(({ id, doc }) => {
    const progress = getInitiativeProgress(id);
    return {
      id,
      slug: doc.slug,
      title: doc.title,
      status: doc.status,
      priority: doc.priority,
      progress: {
        percentage: progress.percentage,
        done: progress.done,
        inProgress: progress.inProgress,
        ready: progress.ready,
        blocked: progress.blocked,
        total: progress.total,
      },
    };
  });

  console.log(JSON.stringify(output, null, 2));
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? `${str.substring(0, maxLen - 3)}...` : str;
}

async function main() {
  const args = createWUParser({
    name: 'initiative-list',
    description: 'List all initiatives with progress percentages',
    options: [WU_OPTIONS.format, WU_OPTIONS.status, WU_OPTIONS.color],
    required: [],
    allowPositionalId: false,
  });

  let initiatives = listInitiatives();

  // Filter by status if specified
  if (args.status) {
    initiatives = initiatives.filter((i) => i.doc.status === args.status);
  }

  // Sort by ID
  initiatives.sort((a, b) => a.id.localeCompare(b.id));

  const format = args.format || OUTPUT_FORMATS.TABLE;

  switch (format) {
    case OUTPUT_FORMATS.JSON:
      renderJSON(initiatives);
      break;
    case OUTPUT_FORMATS.TABLE:
    default:
      renderTable(initiatives, args.color);
      break;
  }
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}

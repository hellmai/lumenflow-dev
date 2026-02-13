#!/usr/bin/env node
/**
 * Initiative Status Helper (WU-1247)
 *
 * Shows detailed initiative view with phases and WUs.
 *
 * Usage:
 *   pnpm initiative:status INIT-001
 *   pnpm initiative:status --id INIT-001 --format json
 */

import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { die } from '@lumenflow/core/error-handler';
import {
  findInitiative,
  getInitiativeProgress,
  getInitiativeWUs,
  getInitiativePhases,
} from '@lumenflow/initiatives/yaml';
import { OUTPUT_FORMATS } from '@lumenflow/initiatives/constants';
import { WU_STATUS } from '@lumenflow/core/wu-constants';

function normalizeLifecycleStatus(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function hasIncompletePhase(phases) {
  if (!Array.isArray(phases) || phases.length === 0) {
    return false;
  }
  return phases.some((phase) => {
    if (phase === null || typeof phase !== 'object') {
      return true;
    }
    return normalizeLifecycleStatus(phase.status) !== WU_STATUS.DONE;
  });
}

export function deriveInitiativeLifecycleStatus(status, phases) {
  const normalizedStatus = normalizeLifecycleStatus(status);
  if (normalizedStatus === WU_STATUS.DONE && hasIncompletePhase(phases)) {
    return WU_STATUS.IN_PROGRESS;
  }
  return normalizedStatus || WU_STATUS.IN_PROGRESS;
}

function getWUBlockers(doc) {
  return doc.blocked_by || doc.dependencies || [];
}

function priorityRank(priority) {
  const p = String(priority || '').toUpperCase();
  const map = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return map[p] ?? 9;
}

function isRunnableReady(wu, wuById) {
  if (wu.doc.status !== WU_STATUS.READY) return false;
  const blockers = getWUBlockers(wu.doc);
  return blockers.every((blockerId) => {
    const blocker = wuById.get(blockerId);
    return !blocker || blocker.doc.status === WU_STATUS.DONE;
  });
}

function renderDetailed(initiative, useColor) {
  const { id, doc } = initiative;
  const progress = getInitiativeProgress(id);
  const wus = getInitiativeWUs(id);
  const wuById = new Map(wus.map((wu) => [wu.id, wu]));
  const phaseGroups = getInitiativePhases(id);
  const status = deriveInitiativeLifecycleStatus(doc.status, doc.phases);

  // Header
  console.log(`\n${id}: ${doc.title}`);
  console.log(
    `Status: ${status} | Progress: ${progress.percentage}% (${progress.done}/${progress.total} WUs)`,
  );
  if (status !== normalizeLifecycleStatus(doc.status)) {
    console.log(
      `Lifecycle mismatch: metadata status '${doc.status}' is inconsistent with phase state; reporting '${status}'.`,
    );
  }

  // Start here (actionable next steps)
  console.log('\nStart here:');
  console.log(
    `  1) Plan waves (recommended): pnpm orchestrate:initiative --initiative ${id} --dry-run`,
  );

  const runnableReady = wus
    .filter((wu) => isRunnableReady(wu, wuById))
    .sort((a, b) => {
      const byPriority = priorityRank(a.doc.priority) - priorityRank(b.doc.priority);
      if (byPriority !== 0) return byPriority;
      return a.id.localeCompare(b.id);
    });

  if (runnableReady.length > 0) {
    const next = runnableReady[0];
    console.log(`  2) Start next WU: pnpm wu:claim --id ${next.id} --lane "${next.doc.lane}"`);
    console.log(`     Then cd into the created worktree (shown by wu:claim output)`);
  } else if (progress.inProgress > 0) {
    console.log(
      `  2) Continue: ${progress.inProgress} WU(s) already in progress (finish those first)`,
    );
  } else if (progress.blocked > 0) {
    console.log(`  2) Unblock: ${progress.blocked} WU(s) blocked (resolve blockers first)`);
  } else {
    console.log('  2) No runnable ready WUs found (check dependencies/blocked_by)');
  }

  if (doc.description) {
    console.log(`\nDescription: ${doc.description}`);
  }

  if (doc.owner) {
    console.log(`Owner: ${doc.owner}`);
  }

  if (doc.target_date) {
    console.log(`Target: ${doc.target_date}`);
  }

  // Phases
  if (doc.phases && doc.phases.length > 0) {
    console.log('\nPhases:');
    for (const phase of doc.phases) {
      const phaseWUs = phaseGroups.get(phase.id) || [];
      const phaseStatus = formatStatus(phase.status, useColor);
      console.log(
        `  ${phase.id}. ${phase.title.padEnd(30)} [${phaseStatus}] ${phaseWUs.length} WUs`,
      );
    }

    // WUs without phase
    const unassigned = phaseGroups.get(null) || [];
    if (unassigned.length > 0) {
      console.log(`  -. Unassigned                       ${unassigned.length} WUs`);
    }
  }

  // WU summary by status
  console.log('\nWork Units by Status:');
  const byStatus = groupWUsByStatus(wus);

  for (const [status, statusWUs] of Object.entries(byStatus)) {
    if (statusWUs.length > 0) {
      console.log(`  ${capitalizeFirst(status)} (${statusWUs.length}):`);
      for (const wu of statusWUs.slice(0, 5)) {
        console.log(`    - ${wu.id}: ${truncate(wu.doc.title, 50)}`);
      }
      if (statusWUs.length > 5) {
        console.log(`    ... and ${statusWUs.length - 5} more`);
      }
    }
  }

  // Success metrics
  if (doc.success_metrics && doc.success_metrics.length > 0) {
    console.log('\nSuccess Metrics:');
    for (const metric of doc.success_metrics) {
      console.log(`  - ${metric}`);
    }
  }

  console.log('');
}

function renderJSON(initiative) {
  const { id, doc } = initiative;
  const progress = getInitiativeProgress(id);
  const wus = getInitiativeWUs(id);
  const phaseGroups = getInitiativePhases(id);
  const status = deriveInitiativeLifecycleStatus(doc.status, doc.phases);

  const output = {
    id,
    slug: doc.slug,
    title: doc.title,
    description: doc.description,
    status,
    rawStatus: doc.status,
    priority: doc.priority,
    owner: doc.owner,
    created: doc.created,
    targetDate: doc.target_date,
    progress: {
      percentage: progress.percentage,
      done: progress.done,
      inProgress: progress.inProgress,
      ready: progress.ready,
      blocked: progress.blocked,
      total: progress.total,
    },
    phases: (doc.phases || []).map((phase) => {
      const phaseWUs = phaseGroups.get(phase.id) || [];
      return {
        id: phase.id,
        title: phase.title,
        status: phase.status,
        wuCount: phaseWUs.length,
        wus: phaseWUs.map((w) => ({ id: w.id, title: w.doc.title, status: w.doc.status })),
      };
    }),
    workUnits: wus.map((w) => ({
      id: w.id,
      title: w.doc.title,
      status: w.doc.status,
      phase: w.doc.phase,
    })),
    successMetrics: doc.success_metrics || [],
    labels: doc.labels || [],
  };

  console.log(JSON.stringify(output, null, 2));
}

function groupWUsByStatus(wus) {
  const groups = {
    [WU_STATUS.DONE]: [],
    [WU_STATUS.IN_PROGRESS]: [],
    [WU_STATUS.READY]: [],
    [WU_STATUS.BLOCKED]: [],
    other: [],
  };

  for (const wu of wus) {
    const status = wu.doc.status;
    if (groups[status]) {
      groups[status].push(wu);
    } else {
      groups.other.push(wu);
    }
  }

  return groups;
}

function formatStatus(status, useColor) {
  if (!useColor) return status;
  // Color support is opt-in, but we keep it simple for now
  return status;
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? `${str.substring(0, maxLen - 3)}...` : str;
}

function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}

async function main() {
  const args = createWUParser({
    name: 'initiative-status',
    description: 'Show detailed initiative view with phases and WUs',
    options: [WU_OPTIONS.id, WU_OPTIONS.format, WU_OPTIONS.color],
    required: [],
    allowPositionalId: true,
  });

  const initRef = args.id;

  if (!initRef) {
    die('Initiative ID or slug is required.\n\nUsage: pnpm initiative:status INIT-001');
  }

  const initiative = findInitiative(initRef);

  if (!initiative) {
    die(
      `Initiative not found: ${initRef}\n\n` +
        `Run 'pnpm initiative:list' to see available initiatives.`,
    );
  }

  const format = args.format || OUTPUT_FORMATS.TABLE;

  switch (format) {
    case OUTPUT_FORMATS.JSON:
      renderJSON(initiative);
      break;
    default:
      renderDetailed(initiative, args.color);
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

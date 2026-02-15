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
import type { InitiativeDoc, InitiativeEntry, WUDoc, WUEntry } from '@lumenflow/initiatives/yaml';
import { OUTPUT_FORMATS } from '@lumenflow/initiatives/constants';
import { WU_STATUS } from '@lumenflow/core/wu-constants';

type InitiativeProgress = ReturnType<typeof getInitiativeProgress>;
type InitiativePhaseGroups = ReturnType<typeof getInitiativePhases>;

interface InitiativePhaseDoc {
  id: number;
  title?: string;
  status?: string;
}

interface GroupedWUs {
  [WU_STATUS.DONE]: WUEntry[];
  [WU_STATUS.IN_PROGRESS]: WUEntry[];
  [WU_STATUS.READY]: WUEntry[];
  [WU_STATUS.BLOCKED]: WUEntry[];
  other: WUEntry[];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function normalizeLifecycleStatus(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function toInitiativePhases(doc: InitiativeDoc): InitiativePhaseDoc[] {
  return Array.isArray(doc.phases) ? (doc.phases as InitiativePhaseDoc[]) : [];
}

function hasIncompletePhase(phases: InitiativePhaseDoc[]): boolean {
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

export function deriveInitiativeLifecycleStatus(status: unknown, phases: InitiativePhaseDoc[]): string {
  const normalizedStatus = normalizeLifecycleStatus(status);
  if (normalizedStatus === WU_STATUS.DONE && hasIncompletePhase(phases)) {
    return WU_STATUS.IN_PROGRESS;
  }
  return normalizedStatus || WU_STATUS.IN_PROGRESS;
}

function getWUBlockers(doc: WUDoc): string[] {
  const blockedBy = asStringArray(doc.blocked_by);
  if (blockedBy.length > 0) {
    return blockedBy;
  }
  return asStringArray(doc.dependencies);
}

function priorityRank(priority: unknown): number {
  const p = String(priority || '').toUpperCase();
  const map: Record<'P0' | 'P1' | 'P2' | 'P3', number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return p in map ? map[p as keyof typeof map] : 9;
}

function isRunnableReady(wu: WUEntry, wuById: Map<string, WUEntry>): boolean {
  if (normalizeLifecycleStatus(wu.doc.status) !== WU_STATUS.READY) return false;
  const blockers = getWUBlockers(wu.doc);
  return blockers.every((blockerId) => {
    const blocker = wuById.get(blockerId);
    return !blocker || normalizeLifecycleStatus(blocker.doc.status) === WU_STATUS.DONE;
  });
}

function renderDetailed(initiative: InitiativeEntry, useColor: boolean): void {
  const { id, doc } = initiative;
  const progress: InitiativeProgress = getInitiativeProgress(id);
  const wus: WUEntry[] = getInitiativeWUs(id);
  const wuById = new Map(wus.map((wu) => [wu.id, wu]));
  const phaseGroups: InitiativePhaseGroups = getInitiativePhases(id);
  const phases = toInitiativePhases(doc);
  const status = deriveInitiativeLifecycleStatus(doc.status, phases);
  const docTitle = asString(doc.title);
  const rawStatus = asString(doc.status);
  const normalizedRawStatus = normalizeLifecycleStatus(rawStatus);

  // Header
  console.log(`\n${id}: ${docTitle || '(untitled)'}`);
  console.log(
    `Status: ${status} | Progress: ${progress.percentage}% (${progress.done}/${progress.total} WUs)`,
  );
  if (status !== normalizedRawStatus) {
    console.log(
      `Lifecycle mismatch: metadata status '${rawStatus}' is inconsistent with phase state; reporting '${status}'.`,
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
    if (next) {
      console.log(
        `  2) Start next WU: pnpm wu:claim --id ${next.id} --lane "${asString(next.doc.lane)}"`,
      );
      console.log(`     Then cd into the created worktree (shown by wu:claim output)`);
    }
  } else if (progress.inProgress > 0) {
    console.log(
      `  2) Continue: ${progress.inProgress} WU(s) already in progress (finish those first)`,
    );
  } else if (progress.blocked > 0) {
    console.log(`  2) Unblock: ${progress.blocked} WU(s) blocked (resolve blockers first)`);
  } else {
    console.log('  2) No runnable ready WUs found (check dependencies/blocked_by)');
  }

  const description = asString(doc.description);
  if (description) {
    console.log(`\nDescription: ${description}`);
  }

  const owner = asString(doc.owner);
  if (owner) {
    console.log(`Owner: ${owner}`);
  }

  const targetDate = asString(doc.target_date);
  if (targetDate) {
    console.log(`Target: ${targetDate}`);
  }

  // Phases
  if (phases.length > 0) {
    console.log('\nPhases:');
    for (const phase of phases) {
      const phaseWUs = phaseGroups.get(phase.id) || [];
      const phaseStatus = formatStatus(normalizeLifecycleStatus(phase.status), useColor);
      const phaseTitle = asString(phase.title) || `Phase ${phase.id}`;
      console.log(
        `  ${phase.id}. ${phaseTitle.padEnd(30)} [${phaseStatus}] ${phaseWUs.length} WUs`,
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
        console.log(`    - ${wu.id}: ${truncate(asString(wu.doc.title), 50)}`);
      }
      if (statusWUs.length > 5) {
        console.log(`    ... and ${statusWUs.length - 5} more`);
      }
    }
  }

  // Success metrics
  const successMetrics = asStringArray(doc.success_metrics);
  if (successMetrics.length > 0) {
    console.log('\nSuccess Metrics:');
    for (const metric of successMetrics) {
      console.log(`  - ${metric}`);
    }
  }

  console.log('');
}

function renderJSON(initiative: InitiativeEntry): void {
  const { id, doc } = initiative;
  const progress: InitiativeProgress = getInitiativeProgress(id);
  const wus: WUEntry[] = getInitiativeWUs(id);
  const phaseGroups: InitiativePhaseGroups = getInitiativePhases(id);
  const phases = toInitiativePhases(doc);
  const status = deriveInitiativeLifecycleStatus(doc.status, phases);

  const output = {
    id,
    slug: asString(doc.slug),
    title: asString(doc.title),
    description: asString(doc.description),
    status,
    rawStatus: asString(doc.status),
    priority: asString(doc.priority),
    owner: asString(doc.owner),
    created: asString(doc.created),
    targetDate: asString(doc.target_date),
    progress: {
      percentage: progress.percentage,
      done: progress.done,
      inProgress: progress.inProgress,
      ready: progress.ready,
      blocked: progress.blocked,
      total: progress.total,
    },
    phases: phases.map((phase) => {
      const phaseWUs = phaseGroups.get(phase.id) || [];
      return {
        id: phase.id,
        title: asString(phase.title),
        status: normalizeLifecycleStatus(phase.status),
        wuCount: phaseWUs.length,
        wus: phaseWUs.map((w) => ({
          id: w.id,
          title: asString(w.doc.title),
          status: normalizeLifecycleStatus(w.doc.status),
        })),
      };
    }),
    workUnits: wus.map((w) => ({
      id: w.id,
      title: asString(w.doc.title),
      status: normalizeLifecycleStatus(w.doc.status),
      phase: w.doc.phase ?? null,
    })),
    successMetrics: asStringArray(doc.success_metrics),
    labels: asStringArray(doc.labels),
  };

  console.log(JSON.stringify(output, null, 2));
}

function groupWUsByStatus(wus: WUEntry[]): GroupedWUs {
  const groups: GroupedWUs = {
    [WU_STATUS.DONE]: [],
    [WU_STATUS.IN_PROGRESS]: [],
    [WU_STATUS.READY]: [],
    [WU_STATUS.BLOCKED]: [],
    other: [],
  };

  for (const wu of wus) {
    const status = normalizeLifecycleStatus(wu.doc.status);
    switch (status) {
      case WU_STATUS.DONE:
        groups[WU_STATUS.DONE].push(wu);
        break;
      case WU_STATUS.IN_PROGRESS:
        groups[WU_STATUS.IN_PROGRESS].push(wu);
        break;
      case WU_STATUS.READY:
        groups[WU_STATUS.READY].push(wu);
        break;
      case WU_STATUS.BLOCKED:
        groups[WU_STATUS.BLOCKED].push(wu);
        break;
      default:
        groups.other.push(wu);
        break;
    }
  }

  return groups;
}

function formatStatus(status: string, useColor: boolean): string {
  if (!useColor) return status;
  // Color support is opt-in, but we keep it simple for now
  return status;
}

function truncate(str: string, maxLen: number): string {
  if (!str) return '';
  return str.length > maxLen ? `${str.substring(0, maxLen - 3)}...` : str;
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}

async function main() {
  const args = createWUParser({
    name: 'initiative-status',
    description: 'Show detailed initiative view with phases and WUs',
    options: [WU_OPTIONS.id, WU_OPTIONS.format, WU_OPTIONS.color],
    required: [],
    allowPositionalId: true,
  }) as { id?: string; format?: string; color?: boolean };

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
      renderDetailed(initiative, Boolean(args.color));
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

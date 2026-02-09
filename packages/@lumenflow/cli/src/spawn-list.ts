#!/usr/bin/env node
/**
 * Spawn List Command (WU-1950)
 *
 * Displays spawn trees for WUs or initiatives.
 * Shows parent-child relationships with status indicators.
 *
 * Usage:
 *   pnpm spawn:list --wu WU-XXX          # Spawns for a specific WU
 *   pnpm spawn:list --initiative INIT-XXX # All spawns in an initiative
 *   pnpm spawn:list --json               # JSON output
 *
 * @see {@link packages/@lumenflow/cli/src/lib/spawn-tree.ts} - Tree builder
 * @see {@link packages/@lumenflow/cli/src/__tests__/spawn-list.test.ts} - Tests
 */

import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { die } from '@lumenflow/core/error-handler';
import { PATTERNS, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { WU_PATHS } from '@lumenflow/core/wu-paths';

/** Local EMOJI constants for spawn-list output */
const EMOJI = {
  WARNING: '⚠️',
  ERROR: '❌',
};

/** Custom options for spawn-list command */
const SPAWN_LIST_OPTIONS = {
  initiative: {
    name: 'initiative',
    flags: '--initiative <initId>',
    description: 'Initiative ID to show all spawns for (e.g., INIT-001)',
  },
  json: {
    name: 'json',
    flags: '--json',
    description: 'Output as JSON',
    default: false,
  },
};
import {
  buildSpawnTree,
  formatSpawnTree,
  getSpawnsByWU,
  getSpawnsByInitiative,
  treeToJSON,
  STATUS_INDICATORS,
} from '@lumenflow/core/spawn-tree';
import { SpawnStatus } from '@lumenflow/core/spawn-registry-schema';
import { runCLI } from './cli-entry-point.js';

/** SpawnEvent type for spawn records */
interface SpawnEvent {
  id?: string;
  lane?: string;
  status?: string;
  parentWuId?: string;
  targetWuId?: string;
  spawnedAt?: string;
  completedAt?: string;
}

const LOG_PREFIX = '[spawn:list]';

/** Default paths for spawn registry and WU files (WU-1301: uses config-based paths) */
const DEFAULT_PATHS = Object.freeze({
  REGISTRY_DIR: LUMENFLOW_PATHS.STATE_DIR,
  WU_DIR: WU_PATHS.WU_DIR(),
});

/** Initiative ID pattern */
const INIT_PATTERN = /^INIT-\d+$/;

/**
 * Prints the legend for status indicators
 */
function printLegend() {
  console.log('\nLegend:');
  console.log(`  ${STATUS_INDICATORS[SpawnStatus.PENDING]} pending`);
  console.log(`  ${STATUS_INDICATORS[SpawnStatus.COMPLETED]} completed`);
  console.log(`  ${STATUS_INDICATORS[SpawnStatus.TIMEOUT]} timeout`);
  console.log(`  ${STATUS_INDICATORS[SpawnStatus.CRASHED]} crashed`);
}

/**
 * Main entry point
 */
async function main() {
  const args = createWUParser({
    name: 'spawn-list',
    description: 'Display spawn trees for WUs or initiatives',
    options: [WU_OPTIONS.wu, SPAWN_LIST_OPTIONS.initiative, SPAWN_LIST_OPTIONS.json],
    required: [],
    allowPositionalId: false,
  });

  const { wu, initiative, json } = args;

  // Validate: exactly one of --wu or --initiative required
  if (!wu && !initiative) {
    die(
      'Either --wu or --initiative is required.\n\nUsage:\n  pnpm spawn:list --wu WU-XXX\n  pnpm spawn:list --initiative INIT-XXX',
    );
  }

  if (wu && initiative) {
    die('Cannot specify both --wu and --initiative. Choose one.');
  }

  // Handle --wu
  if (wu) {
    const wuId = wu.toUpperCase();
    if (!PATTERNS.WU_ID.test(wuId)) {
      die(`Invalid WU ID format: ${wu}. Expected format: WU-XXX`);
    }

    const spawns = await getSpawnsByWU(wuId, DEFAULT_PATHS.REGISTRY_DIR);

    if (json) {
      const tree = buildSpawnTree(spawns, wuId);
      console.log(JSON.stringify(treeToJSON(tree), null, 2));
      return;
    }

    if (spawns.length === 0) {
      console.log(`${LOG_PREFIX} ${EMOJI.WARNING} No spawns found for ${wuId}`);
      console.log(`\n${wuId} (root)`);
      console.log('  (no spawns)');
      return;
    }

    console.log(`${LOG_PREFIX} Spawn tree for ${wuId}:\n`);
    const tree = buildSpawnTree(spawns, wuId);
    console.log(formatSpawnTree(tree));
    printLegend();
    console.log(`\nTotal: ${spawns.length} spawn(s)`);
    return;
  }

  // Handle --initiative
  if (initiative) {
    const initId = initiative.toUpperCase();
    if (!INIT_PATTERN.test(initId)) {
      die(`Invalid initiative ID format: ${initiative}. Expected format: INIT-XXX`);
    }

    const spawns = await getSpawnsByInitiative(
      initId,
      DEFAULT_PATHS.REGISTRY_DIR,
      DEFAULT_PATHS.WU_DIR,
    );

    if (json) {
      // For initiative, output flat list since there may be multiple root WUs
      console.log(JSON.stringify(spawns, null, 2));
      return;
    }

    if (spawns.length === 0) {
      console.log(`${LOG_PREFIX} ${EMOJI.WARNING} No spawns found for ${initId}`);
      return;
    }

    // Group spawns by parent WU and display trees
    console.log(`${LOG_PREFIX} Spawns for ${initId}:\n`);

    // Find unique root WUs (parents that are not targets of other spawns)
    const typedSpawns = spawns as SpawnEvent[];
    const targetWuIds = new Set(typedSpawns.map((s) => s.targetWuId));
    const rootWuIds = [...new Set(typedSpawns.map((s) => s.parentWuId))].filter(
      (id) => !targetWuIds.has(id),
    );

    for (const rootWuId of rootWuIds) {
      const tree = buildSpawnTree(spawns, rootWuId);
      console.log(formatSpawnTree(tree));
      console.log('');
    }

    printLegend();
    console.log(`\nTotal: ${spawns.length} spawn(s) across ${rootWuIds.length} root WU(s)`);
  }
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  runCLI(main);
}

#!/usr/bin/env node
/**
 * Delegation List Command (WU-1950, WU-1674)
 *
 * Displays delegation trees for WUs or initiatives.
 * WU-1604: Includes explicit delegation lineage records from wu:delegate.
 * Shows parent-child relationships with status indicators.
 *
 * Usage:
 *   pnpm delegation:list --wu WU-XXX           # Delegations for a specific WU
 *   pnpm delegation:list --initiative INIT-XXX # All delegations in an initiative
 *   pnpm delegation:list --json                # JSON output
 */

import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { die } from '@lumenflow/core/error-handler';
import { PATTERNS, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { WU_PATHS } from '@lumenflow/core/wu-paths';

/** Local EMOJI constants for delegation-list output */
const EMOJI = {
  WARNING: '⚠️',
  ERROR: '❌',
};

/** Custom options for delegation-list command */
const DELEGATION_LIST_OPTIONS = {
  initiative: {
    name: 'initiative',
    flags: '--initiative <initId>',
    description: 'Initiative ID to show all delegations for (e.g., INIT-001)',
  },
  json: {
    name: 'json',
    flags: '--json',
    description: 'Output as JSON',
    default: false,
  },
};
import {
  buildDelegationTree,
  formatDelegationTree,
  getDelegationsByWU,
  getDelegationsByInitiative,
  treeToJSON,
  STATUS_INDICATORS,
} from '@lumenflow/core/delegation-tree';
import { DelegationStatus } from '@lumenflow/core/delegation-registry-schema';
import { runCLI } from './cli-entry-point.js';

/** DelegationEvent type for delegation records */
interface DelegationEvent {
  id?: string;
  lane?: string;
  status?: string;
  parentWuId?: string;
  targetWuId?: string;
  delegatedAt?: string;
  completedAt?: string;
}

const LOG_PREFIX = '[delegation:list]';

/** Default paths for delegation registry and WU files (WU-1301: uses config-based paths) */
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
  console.log(`  ${STATUS_INDICATORS[DelegationStatus.PENDING]} pending`);
  console.log(`  ${STATUS_INDICATORS[DelegationStatus.COMPLETED]} completed`);
  console.log(`  ${STATUS_INDICATORS[DelegationStatus.TIMEOUT]} timeout`);
  console.log(`  ${STATUS_INDICATORS[DelegationStatus.CRASHED]} crashed`);
}

/**
 * Main entry point
 */
async function main() {
  const args = createWUParser({
    name: 'delegation-list',
    description: 'Display delegation trees for WUs or initiatives',
    options: [WU_OPTIONS.wu, DELEGATION_LIST_OPTIONS.initiative, DELEGATION_LIST_OPTIONS.json],
    required: [],
    allowPositionalId: false,
  });

  const { wu, initiative, json } = args;

  // Validate: exactly one of --wu or --initiative required
  if (!wu && !initiative) {
    die(
      'Either --wu or --initiative is required.\n\nUsage:\n  pnpm delegation:list --wu WU-XXX\n  pnpm delegation:list --initiative INIT-XXX',
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

    const delegations = await getDelegationsByWU(wuId, DEFAULT_PATHS.REGISTRY_DIR);

    if (json) {
      const tree = buildDelegationTree(delegations, wuId);
      console.log(JSON.stringify(treeToJSON(tree), null, 2));
      return;
    }

    if (delegations.length === 0) {
      console.log(`${LOG_PREFIX} ${EMOJI.WARNING} No delegations found for ${wuId}`);
      console.log(`\n${wuId} (root)`);
      console.log('  (no delegations)');
      return;
    }

    console.log(`${LOG_PREFIX} Delegation tree for ${wuId}:\n`);
    const tree = buildDelegationTree(delegations, wuId);
    console.log(formatDelegationTree(tree));
    printLegend();
    console.log(`\nTotal: ${delegations.length} delegation(s)`);
    return;
  }

  // Handle --initiative
  if (initiative) {
    const initId = initiative.toUpperCase();
    if (!INIT_PATTERN.test(initId)) {
      die(`Invalid initiative ID format: ${initiative}. Expected format: INIT-XXX`);
    }

    const delegations = await getDelegationsByInitiative(
      initId,
      DEFAULT_PATHS.REGISTRY_DIR,
      DEFAULT_PATHS.WU_DIR,
    );

    if (json) {
      // For initiative, output flat list since there may be multiple root WUs
      console.log(JSON.stringify(delegations, null, 2));
      return;
    }

    if (delegations.length === 0) {
      console.log(`${LOG_PREFIX} ${EMOJI.WARNING} No delegations found for ${initId}`);
      return;
    }

    // Group delegations by parent WU and display trees
    console.log(`${LOG_PREFIX} Delegations for ${initId}:\n`);

    // Find unique root WUs (parents that are not targets of other delegations)
    const typedDelegations = delegations as DelegationEvent[];
    const targetWuIds = new Set(typedDelegations.map((s) => s.targetWuId));
    const rootWuIds = [...new Set(typedDelegations.map((s) => s.parentWuId))].filter(
      (id) => !targetWuIds.has(id),
    );

    for (const rootWuId of rootWuIds) {
      const tree = buildDelegationTree(delegations, rootWuId);
      console.log(formatDelegationTree(tree));
      console.log('');
    }

    printLegend();
    console.log(
      `\nTotal: ${delegations.length} delegation(s) across ${rootWuIds.length} root WU(s)`,
    );
  }
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}

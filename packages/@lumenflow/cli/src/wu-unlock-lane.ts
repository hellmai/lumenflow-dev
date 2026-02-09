#!/usr/bin/env node
/**
 * WU Unlock Lane Helper
 *
 * Provides a dedicated audited command for operators to safely clear lane locks.
 *
 * Safety-first approach:
 * - Zombie locks (PID not running): Can be unlocked without --force
 * - Stale locks (>24h old): Can be unlocked without --force
 * - Active locks (recent, PID running): Require --force to unlock
 *
 * All unlocks require a --reason parameter for audit purposes.
 *
 * Usage:
 *   pnpm wu:unlock-lane --lane "Core" --reason "Process crashed"
 *   pnpm wu:unlock-lane --lane "Core" --reason "Emergency" --force
 *   pnpm wu:unlock-lane --list  # List all current locks
 */

import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { die } from '@lumenflow/core/error-handler';
import {
  auditedUnlock,
  checkLaneLock,
  getAllLaneLocks,
  isLockStale,
  isZombieLock,
} from '@lumenflow/core/lane-lock';
import { LOG_PREFIX, EXIT_CODES } from '@lumenflow/core/wu-constants';

const PREFIX = LOG_PREFIX.UNLOCK_LANE || '[wu-unlock-lane]';

function listLocks() {
  const locks = getAllLaneLocks();

  if (locks.size === 0) {
    console.log(`${PREFIX} No lane locks found.`);
    return;
  }

  console.log(`${PREFIX} Current lane locks:`);
  console.log('');

  for (const [lane, metadata] of locks) {
    const stale = isLockStale(metadata);
    const zombie = isZombieLock(metadata);

    let status: string;
    if (zombie) {
      status = 'ZOMBIE (PID not running - safe to remove)';
    } else if (stale) {
      status = 'STALE (>24h old - safe to remove)';
    } else {
      status = 'ACTIVE (requires --force)';
    }

    console.log(`  Lane: ${lane}`);
    console.log(`    WU: ${metadata.wuId}`);
    console.log(`    PID: ${metadata.pid}`);
    console.log(`    Timestamp: ${metadata.timestamp}`);
    console.log(`    Status: ${status}`);
    console.log('');
  }
}

function showLaneStatus(lane: string) {
  const lockStatus = checkLaneLock(lane);

  if (!lockStatus.locked) {
    console.log(`${PREFIX} Lane "${lane}" is not locked.`);
    return;
  }

  const { metadata } = lockStatus;
  const stale = isLockStale(metadata);
  const zombie = isZombieLock(metadata);

  console.log(`${PREFIX} Lane "${lane}" is locked:`);
  console.log(`  WU: ${metadata.wuId}`);
  console.log(`  PID: ${metadata.pid}`);
  console.log(`  Timestamp: ${metadata.timestamp}`);
  console.log(`  Agent Session: ${metadata.agentSession || 'N/A'}`);
  console.log('');

  if (zombie) {
    console.log(`  Status: ZOMBIE`);
    console.log(`    The process that acquired this lock is no longer running.`);
    console.log(`    This lock can be safely removed without --force.`);
    console.log('');
    console.log(`  Suggested command:`);
    console.log(`    pnpm wu:unlock-lane --lane "${lane}" --reason "Zombie lock cleanup"`);
  } else if (stale) {
    console.log(`  Status: STALE`);
    console.log(`    This lock is more than 24 hours old.`);
    console.log(`    This lock can be safely removed without --force.`);
    console.log('');
    console.log(`  Suggested command:`);
    console.log(`    pnpm wu:unlock-lane --lane "${lane}" --reason "Stale lock cleanup"`);
  } else {
    console.log(`  Status: ACTIVE`);
    console.log(`    This lock is recent and the process (PID ${metadata.pid}) is still running.`);
    console.log(`    Removing this lock requires --force and should only be done in emergencies.`);
    console.log('');
    console.log(`  Emergency unlock (use with caution):`);
    console.log(`    pnpm wu:unlock-lane --lane "${lane}" --reason "<explanation>" --force`);
  }
}

async function main() {
  const args = createWUParser({
    name: 'wu-unlock-lane',
    description: 'Safely unlock a lane lock with audit logging',
    options: [
      WU_OPTIONS.lane,
      WU_OPTIONS.reason,
      WU_OPTIONS.force,
      {
        name: 'list',
        flags: '--list',
        description: 'List all current lane locks',
      },
      {
        name: 'status',
        flags: '--status',
        description: 'Show detailed status for the specified lane',
      },
    ],
    required: [],
    allowPositionalId: false,
  });

  if (args.list) {
    listLocks();
    process.exit(EXIT_CODES.SUCCESS);
  }

  if (!args.lane) {
    die(
      'Missing --lane parameter.\n\n' +
        'Usage:\n' +
        '  pnpm wu:unlock-lane --lane "Core" --reason "<text>"\n' +
        '  pnpm wu:unlock-lane --list\n' +
        '  pnpm wu:unlock-lane --lane "Core" --status',
    );
  }

  if (args.status) {
    showLaneStatus(args.lane);
    process.exit(EXIT_CODES.SUCCESS);
  }

  if (!args.reason) {
    die(
      'Missing --reason parameter.\n\n' +
        'A reason is required for audit purposes.\n\n' +
        'Example:\n' +
        `  pnpm wu:unlock-lane --lane "${args.lane}" --reason "Process crashed during claim"`,
    );
  }

  console.log(`${PREFIX} Attempting to unlock lane "${args.lane}"...`);

  const result = auditedUnlock(args.lane, {
    reason: args.reason,
    force: args.force || false,
  });

  if (result.notFound) {
    console.log(`${PREFIX} Lane "${args.lane}" was not locked.`);
    process.exit(EXIT_CODES.SUCCESS);
  }

  if (!result.released) {
    console.error(`${PREFIX} Failed to unlock lane.`);
    console.error(`${PREFIX} ${result.error}`);
    process.exit(EXIT_CODES.FAILURE);
  }

  console.log(`${PREFIX} Successfully unlocked lane "${args.lane}".`);

  if (result.forced) {
    console.warn(`${PREFIX} ⚠️  This was a forced unlock of an active lock.`);
    console.warn(
      `${PREFIX}    Ensure ${result.previousLock?.wuId || 'the owning WU'} is notified.`,
    );
  }

  console.log(`${PREFIX} Previous owner: ${result.previousLock?.wuId || 'unknown'}`);
  console.log(`${PREFIX} Reason: ${result.reason}`);
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  runCLI(main);
}

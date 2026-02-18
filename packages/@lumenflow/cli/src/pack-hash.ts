#!/usr/bin/env node
/**
 * @file pack-hash.ts
 * Compute integrity hash for a LumenFlow domain pack (WU-1825)
 *
 * Outputs sha256:hex string ready for copy-paste into workspace.yaml PackPin.
 * Uses existing computeDeterministicPackHash from kernel.
 *
 * Usage:
 *   pnpm pack:hash --id software-delivery
 *   pnpm pack:hash --id my-pack --packs-root ./packs
 *   pnpm pack:hash --pack-root ./path/to/pack
 */

import { resolve } from 'node:path';
import { computeDeterministicPackHash, SHA256_INTEGRITY_PREFIX } from '@lumenflow/kernel';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core';
import { runCLI } from './cli-entry-point.js';

export const LOG_PREFIX = '[pack:hash]';

// --- Default packs root ---

const DEFAULT_PACKS_ROOT = 'packages/@lumenflow/packs';

// --- Pack root resolution ---

export interface ResolvePackRootOptions {
  directPackRoot?: string;
  packId?: string;
  packsRoot?: string;
}

/**
 * Resolve the pack root directory from CLI options.
 *
 * Resolution order:
 * 1. --pack-root (direct path, takes priority)
 * 2. --id + --packs-root (resolves <packs-root>/<pack-id>)
 * 3. Returns null if neither is provided
 */
export function resolvePackRoot(options: ResolvePackRootOptions): string | null {
  const { directPackRoot, packId, packsRoot } = options;

  if (directPackRoot) {
    return resolve(directPackRoot);
  }

  if (packId && packsRoot) {
    return resolve(packsRoot, packId);
  }

  return null;
}

// --- Hash computation ---

export interface ComputePackHashOptions {
  packRoot: string;
  hashExclusions?: string[];
}

/**
 * Compute the integrity hash for a pack directory.
 *
 * @returns sha256:<hex> string suitable for workspace.yaml PackPin.integrity
 * @throws Error if the pack directory does not exist or cannot be read
 */
export async function computePackHash(options: ComputePackHashOptions): Promise<string> {
  const { packRoot, hashExclusions } = options;
  const absolutePackRoot = resolve(packRoot);

  const hex = await computeDeterministicPackHash({
    packRoot: absolutePackRoot,
    exclusions: hashExclusions,
  });

  return `${SHA256_INTEGRITY_PREFIX}${hex}`;
}

// --- CLI options ---

const PACK_HASH_OPTIONS = {
  packId: {
    name: 'id',
    flags: '--id <packId>',
    description: 'Pack ID to hash (resolves under --packs-root)',
  },
  packsRoot: {
    name: 'packsRoot',
    flags: '--packs-root <dir>',
    description: `Root directory containing packs (default: "${DEFAULT_PACKS_ROOT}")`,
  },
  packRoot: {
    name: 'packRoot',
    flags: '--pack-root <dir>',
    description: 'Direct path to pack directory (overrides --id and --packs-root)',
  },
};

/**
 * CLI main entry point for pack:hash
 */
export async function main(): Promise<void> {
  const opts = createWUParser({
    name: 'pack-hash',
    description: 'Compute integrity hash for a LumenFlow domain pack',
    options: [
      PACK_HASH_OPTIONS.packId,
      PACK_HASH_OPTIONS.packsRoot,
      PACK_HASH_OPTIONS.packRoot,
      WU_OPTIONS.force,
    ],
  });

  const packId = opts.id as string | undefined;
  const packsRoot = (opts.packsRoot as string | undefined) ?? DEFAULT_PACKS_ROOT;
  const directPackRoot = opts.packRoot as string | undefined;

  const resolvedPackRoot = resolvePackRoot({ directPackRoot, packId, packsRoot });

  if (!resolvedPackRoot) {
    console.error(`${LOG_PREFIX} Error: Provide --id <packId> or --pack-root <dir>`);
    process.exit(1);
  }

  const hash = await computePackHash({ packRoot: resolvedPackRoot });
  console.log(hash);
}

// Run if executed directly
if (import.meta.main) {
  void runCLI(main);
}

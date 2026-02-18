#!/usr/bin/env node
/**
 * @file pack-validate.ts
 * Validate a LumenFlow domain pack for integrity (WU-1824)
 *
 * Wraps existing PackLoader validation: manifest schema, import boundaries,
 * tool entry resolution, and integrity hash computation.
 *
 * Usage:
 *   pnpm pack:validate --id software-delivery
 *   pnpm pack:validate --id my-pack --packs-root ./packs
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import YAML from 'yaml';
import {
  DomainPackManifestSchema,
  resolvePackToolEntryPath,
  validatePackImportBoundaries,
  computeDeterministicPackHash,
  PACK_MANIFEST_FILE_NAME,
  UTF8_ENCODING,
} from '@lumenflow/kernel';
import type { DomainPackManifest } from '@lumenflow/kernel';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core';
import { runCLI } from './cli-entry-point.js';

export const LOG_PREFIX = '[pack:validate]';

// --- Check status types ---

type CheckStatus = 'pass' | 'fail' | 'skip';

export interface CheckResult {
  status: CheckStatus;
  error?: string;
}

export interface IntegrityCheckResult extends CheckResult {
  hash?: string;
}

export interface ValidationResult {
  manifest: CheckResult;
  importBoundaries: CheckResult;
  toolEntries: CheckResult;
  integrity: IntegrityCheckResult;
  allPassed: boolean;
}

// --- Default packs root ---

const DEFAULT_PACKS_ROOT = 'packages/@lumenflow/packs';

// --- Core validation function ---

export interface ValidatePackOptions {
  packRoot: string;
  hashExclusions?: string[];
}

/**
 * Validate a pack directory, running each check independently.
 *
 * Checks:
 * 1. Manifest schema validation (DomainPackManifestSchema)
 * 2. Tool entry resolution (resolvePackToolEntryPath)
 * 3. Import boundary check (validatePackImportBoundaries)
 * 4. Integrity hash computation (computeDeterministicPackHash)
 *
 * Each check reports pass/fail independently. Later checks are skipped
 * if an earlier check they depend on fails (e.g., tool entries require
 * a valid manifest).
 */
export async function validatePack(options: ValidatePackOptions): Promise<ValidationResult> {
  const { packRoot, hashExclusions } = options;
  const absolutePackRoot = resolve(packRoot);

  // 1. Manifest validation
  let manifest: DomainPackManifest | undefined;
  const manifestResult = await validateManifest(absolutePackRoot);

  if (manifestResult.status === 'pass' && manifestResult.manifest) {
    manifest = manifestResult.manifest;
  }

  // 2. Tool entry resolution (depends on manifest)
  const toolEntriesResult = manifest
    ? validateToolEntries(absolutePackRoot, manifest)
    : { status: 'skip' as const, error: 'Skipped: manifest validation failed' };

  // 3. Import boundary check (independent of manifest)
  const importBoundariesResult = await checkImportBoundaries(absolutePackRoot, hashExclusions);

  // 4. Integrity hash computation (independent)
  const integrityResult = await computeIntegrity(absolutePackRoot, hashExclusions);

  const allPassed =
    manifestResult.status === 'pass' &&
    toolEntriesResult.status === 'pass' &&
    importBoundariesResult.status === 'pass' &&
    integrityResult.status === 'pass';

  return {
    manifest: manifestResult,
    importBoundaries: importBoundariesResult,
    toolEntries: toolEntriesResult,
    integrity: integrityResult,
    allPassed,
  };
}

// --- Individual check functions ---

interface ManifestCheckResult extends CheckResult {
  manifest?: DomainPackManifest;
}

async function validateManifest(packRoot: string): Promise<ManifestCheckResult> {
  try {
    const manifestPath = join(packRoot, PACK_MANIFEST_FILE_NAME);
    const manifestRaw = await readFile(manifestPath, UTF8_ENCODING);
    const parsed = YAML.parse(manifestRaw) as unknown;
    const manifest = DomainPackManifestSchema.parse(parsed);
    return { status: 'pass', manifest };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'fail', error: message };
  }
}

function validateToolEntries(packRoot: string, manifest: DomainPackManifest): CheckResult {
  try {
    for (const tool of manifest.tools) {
      resolvePackToolEntryPath(packRoot, tool.entry);
    }
    return { status: 'pass' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'fail', error: message };
  }
}

async function checkImportBoundaries(
  packRoot: string,
  hashExclusions?: string[],
): Promise<CheckResult> {
  try {
    await validatePackImportBoundaries(packRoot, hashExclusions);
    return { status: 'pass' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'fail', error: message };
  }
}

async function computeIntegrity(
  packRoot: string,
  hashExclusions?: string[],
): Promise<IntegrityCheckResult> {
  try {
    const hash = await computeDeterministicPackHash({
      packRoot,
      exclusions: hashExclusions,
    });
    return { status: 'pass', hash };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'fail', error: message };
  }
}

// --- Report formatting ---

const CHECK_LABELS = {
  manifest: 'Manifest schema',
  importBoundaries: 'Import boundaries',
  toolEntries: 'Tool entry resolution',
  integrity: 'Integrity hash',
} as const;

const STATUS_INDICATORS = {
  pass: 'PASS',
  fail: 'FAIL',
  skip: 'SKIP',
} as const;

export function formatValidationReport(result: ValidationResult): string {
  const lines: string[] = [];

  lines.push('Pack Validation Report');
  lines.push('=====================');
  lines.push('');

  const checks: [keyof typeof CHECK_LABELS, CheckResult | IntegrityCheckResult][] = [
    ['manifest', result.manifest],
    ['importBoundaries', result.importBoundaries],
    ['toolEntries', result.toolEntries],
    ['integrity', result.integrity],
  ];

  for (const [key, check] of checks) {
    const label = CHECK_LABELS[key];
    const indicator = STATUS_INDICATORS[check.status];
    lines.push(`  [${indicator}] ${label}`);

    if (check.status === 'fail' && check.error) {
      lines.push(`         Error: ${check.error}`);
    }

    if (key === 'integrity' && 'hash' in check && check.hash) {
      lines.push(`         Hash: sha256:${check.hash}`);
    }
  }

  lines.push('');
  lines.push(`Result: ${result.allPassed ? 'ALL CHECKS PASSED' : 'VALIDATION FAILED'}`);

  return lines.join('\n');
}

// --- CLI options ---

const PACK_VALIDATE_OPTIONS = {
  packId: {
    name: 'id',
    flags: '--id <packId>',
    description: 'Pack ID to validate (resolves under --packs-root)',
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
 * CLI main entry point for pack:validate
 */
export async function main(): Promise<void> {
  const opts = createWUParser({
    name: 'pack-validate',
    description: 'Validate a LumenFlow domain pack for integrity',
    options: [
      PACK_VALIDATE_OPTIONS.packId,
      PACK_VALIDATE_OPTIONS.packsRoot,
      PACK_VALIDATE_OPTIONS.packRoot,
      WU_OPTIONS.force,
    ],
  });

  const packId = opts.id as string | undefined;
  const packsRoot = (opts.packsRoot as string | undefined) ?? DEFAULT_PACKS_ROOT;
  const directPackRoot = opts.packRoot as string | undefined;

  let resolvedPackRoot: string;

  if (directPackRoot) {
    resolvedPackRoot = resolve(directPackRoot);
  } else if (packId) {
    resolvedPackRoot = resolve(packsRoot, packId);
  } else {
    console.error(`${LOG_PREFIX} Error: Provide --id <packId> or --pack-root <dir>`);
    process.exit(1);
  }

  console.log(`${LOG_PREFIX} Validating pack at: ${resolvedPackRoot}`);

  const result = await validatePack({ packRoot: resolvedPackRoot });
  const report = formatValidationReport(result);
  console.log(report);

  if (!result.allPassed) {
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  void runCLI(main);
}

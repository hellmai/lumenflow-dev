#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
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
  validateDomainPackToolSafety,
  isBroadWildcardScopePattern,
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
  securityLint: CheckResult;
  integrity: IntegrityCheckResult;
  allPassed: boolean;
}

// --- Default packs root ---

const DEFAULT_PACKS_ROOT = 'packages/@lumenflow/packs';
const HTTPS_PROTOCOL = 'https:';
const NETWORK_URL_PROPERTY = 'url';

const SECURITY_LINT_ERROR = {
  PERMISSION_SCOPE_READ_WRITE:
    'permission/scope mismatch: read-permission tool cannot request write path access.',
  PERMISSION_SCOPE_WRITE_MISSING:
    'permission/scope mismatch: write-permission tool must include at least one write path scope.',
  WILDCARD_WRITE:
    'forbidden wildcard write scope. Replace with constrained path pattern (for example reports/**/*.md).',
  NETWORK_URL_REQUIRED:
    'network-scoped tools must constrain input_schema.properties.url via const/enum https URL allow-list.',
  NETWORK_URL_INVALID: 'network-scoped tool has invalid URL in input_schema.properties.url.',
  NETWORK_URL_SCHEME: 'network-scoped tool URL must use https:// in input_schema.properties.url.',
} as const;

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

  // 4. Security lint (depends on manifest)
  const securityLintResult = manifest
    ? runSecurityLint(manifest)
    : { status: 'skip' as const, error: 'Skipped: manifest validation failed' };

  // 5. Integrity hash computation (independent)
  const integrityResult = await computeIntegrity(absolutePackRoot, hashExclusions);

  const allPassed =
    manifestResult.status === 'pass' &&
    toolEntriesResult.status === 'pass' &&
    importBoundariesResult.status === 'pass' &&
    securityLintResult.status === 'pass' &&
    integrityResult.status === 'pass';

  return {
    manifest: manifestResult,
    importBoundaries: importBoundariesResult,
    toolEntries: toolEntriesResult,
    securityLint: securityLintResult,
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractNetworkUrls(tool: DomainPackManifest['tools'][number]): string[] {
  const inputSchema = tool.input_schema;
  if (!isObjectRecord(inputSchema)) {
    return [];
  }

  const properties = inputSchema.properties;
  if (!isObjectRecord(properties)) {
    return [];
  }

  const urlSchema = properties[NETWORK_URL_PROPERTY];
  if (!isObjectRecord(urlSchema)) {
    return [];
  }

  if (typeof urlSchema.const === 'string') {
    return [urlSchema.const];
  }

  if (!Array.isArray(urlSchema.enum)) {
    return [];
  }

  return urlSchema.enum.filter((candidate): candidate is string => typeof candidate === 'string');
}

function lintPermissionScopeConsistency(tool: DomainPackManifest['tools'][number]): string[] {
  const pathScopes = tool.required_scopes.filter(
    (scope): scope is Extract<(typeof tool.required_scopes)[number], { type: 'path' }> =>
      scope.type === 'path',
  );
  const hasWritePathScope = pathScopes.some((scope) => scope.access === 'write');

  const issues: string[] = [];
  if (tool.permission === 'read' && hasWritePathScope) {
    issues.push(SECURITY_LINT_ERROR.PERMISSION_SCOPE_READ_WRITE);
  }
  if (tool.permission === 'write' && pathScopes.length > 0 && !hasWritePathScope) {
    issues.push(SECURITY_LINT_ERROR.PERMISSION_SCOPE_WRITE_MISSING);
  }
  return issues;
}

function runSecurityLint(manifest: DomainPackManifest): CheckResult {
  const issues = new Set<string>();

  for (const tool of manifest.tools) {
    for (const issue of lintPermissionScopeConsistency(tool)) {
      issues.add(`Tool "${tool.name}": ${issue}`);
    }

    for (const issue of validateDomainPackToolSafety(tool)) {
      issues.add(`Tool "${tool.name}": ${issue}`);
    }

    const hasNetworkScope = tool.required_scopes.some((scope) => scope.type === 'network');

    for (const scope of tool.required_scopes) {
      if (scope.type !== 'path') {
        continue;
      }
      if (
        (tool.permission === 'write' || tool.permission === 'admin') &&
        scope.access === 'write' &&
        isBroadWildcardScopePattern(scope.pattern)
      ) {
        issues.add(`Tool "${tool.name}": ${SECURITY_LINT_ERROR.WILDCARD_WRITE}`);
      }
    }

    if (!hasNetworkScope) {
      continue;
    }

    const allowedUrls = extractNetworkUrls(tool);
    if (allowedUrls.length === 0) {
      issues.add(`Tool "${tool.name}": ${SECURITY_LINT_ERROR.NETWORK_URL_REQUIRED}`);
      continue;
    }

    for (const allowedUrl of allowedUrls) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(allowedUrl);
      } catch {
        issues.add(
          `Tool "${tool.name}" URL "${allowedUrl}": ${SECURITY_LINT_ERROR.NETWORK_URL_INVALID}`,
        );
        continue;
      }

      if (parsedUrl.protocol !== HTTPS_PROTOCOL) {
        issues.add(
          `Tool "${tool.name}" URL "${allowedUrl}": ${SECURITY_LINT_ERROR.NETWORK_URL_SCHEME}`,
        );
      }
    }
  }

  if (issues.size > 0) {
    return {
      status: 'fail',
      error: [...issues].join('\n'),
    };
  }

  return { status: 'pass' };
}

// --- Report formatting ---

const CHECK_LABELS = {
  manifest: 'Manifest schema',
  importBoundaries: 'Import boundaries',
  toolEntries: 'Tool entry resolution',
  securityLint: 'Security lint',
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
    ['securityLint', result.securityLint],
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

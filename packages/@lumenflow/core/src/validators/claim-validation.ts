// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file claim-validation.ts
 * @description Validates absolute claims in WU/initiative specs against live code.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { globSync } from 'glob';
import micromatch from 'micromatch';
import { WORKSPACE_CONFIG_FILE_NAME } from '../config-contract.js';
import { parseYAML } from '../wu-yaml.js';
import { createWuPaths } from '../wu-paths.js';
import { DIRECTORIES, FILE_SYSTEM } from '../wu-constants.js';

const CLAIM_NOTE_ALLOW_PREFIX = 'claim-validation:allow';
const CLAIM_ALLOWLIST_ALL = 'all';
const LINE_SPLIT_PATTERN = /\r?\n/;
const CLAIM_LINE_PREFIX_WORDS = 8;

const LEGACY_CONFIG_FILE_LITERAL = '.lumenflow.config.yaml';
const LEGACY_CONFIG_CLAIM_PATTERN = /\.lumenflow\.config\.yaml/i;
const RUNCLI_MAIN_CLAIM_PATTERN = /runcli\s*\(\s*main\s*\)/i;
const PROCESS_EXIT_CLAIM_PATTERN = /process\.exit/i;
const CORE_TEXT_PATTERN = /\bcore\b/i;
const ABSOLUTE_NEGATION_PATTERN =
  /\b(no|zero|without|remove|removed|eliminate|eliminated|delete|deleted|gone)\b/i;
const ABSOLUTE_UNIVERSAL_PATTERN = /\b(all|every)\b/i;
const PROCESS_EXIT_USAGE_PATTERN = /\bprocess\.exit\s*\(/;
const IMPORT_META_MAIN_PATTERN = /\bimport\.meta\.main\b/;
const MAIN_CATCH_PATTERN = /main\(\)\.catch\s*\(/;
const RUNCLI_MAIN_CALL = 'runCLI(main';
const EXPORTED_MAIN_PATTERN = /export\s+async\s+function\s+main\s*\(|export\s+function\s+main\s*\(/;

const YAML_EXTENSION = '.yaml';

const SOURCE_GLOBS = {
  LEGACY_CONFIG: [
    `${DIRECTORIES.PACKAGES}**/src/**/*.{ts,tsx,js,mjs,cjs}`,
    'actions/**/src/**/*.{ts,tsx,js,mjs,cjs}',
    `${DIRECTORIES.TOOLS}**/*.{ts,js,mjs,cjs}`,
  ],
  CLI_ENTRYPOINTS: [`${DIRECTORIES.PACKAGES}**/cli/src/**/*.ts`],
  CORE_RUNTIME: [`${DIRECTORIES.PACKAGES}**/core/src/**/*.{ts,js,mjs,cjs}`],
} as const;

const SOURCE_GLOB_IGNORES = [
  '**/__tests__/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/dist/**',
  '**/node_modules/**',
] as const;

const CLAIM_VALIDATOR_SOURCE_GLOB = `${DIRECTORIES.PACKAGES}**/core/src/validators/claim-validation.ts`;
const LEGACY_CONFIG_SCAN_IGNORES = [...SOURCE_GLOB_IGNORES, CLAIM_VALIDATOR_SOURCE_GLOB] as const;

const CORE_RUNTIME_IGNORES = [
  ...SOURCE_GLOB_IGNORES,
  `${DIRECTORIES.PACKAGES}**/core/src/cli/**`,
] as const;

export const CLAIM_VALIDATION_IDS = {
  LEGACY_CONFIG_HARD_CUT: 'legacy-config-hard-cut',
  RUNCLI_MAIN_REQUIRED: 'runcli-main-required',
  CORE_NO_PROCESS_EXIT: 'core-no-process-exit',
} as const;

export type ClaimValidationId = (typeof CLAIM_VALIDATION_IDS)[keyof typeof CLAIM_VALIDATION_IDS];

export interface ClaimValidationAllowlistEntry {
  claimId: ClaimValidationId | typeof CLAIM_ALLOWLIST_ALL;
  pathPattern: string;
  reason?: string;
  source?: string;
}

export interface ClaimValidationEvidence {
  filePath: string;
  line: number;
  lineText: string;
}

export interface ClaimValidationSpecReference {
  id: string;
  filePath: string;
  line: number;
  section: 'acceptance' | 'success_metrics';
}

export interface ClaimValidationMismatch {
  claimId: ClaimValidationId;
  claimText: string;
  specReference: ClaimValidationSpecReference;
  evidence: ClaimValidationEvidence[];
  remediationHint: string;
}

export interface ClaimValidationResult {
  ok: boolean;
  scannedClaims: number;
  checkedClaims: number;
  mismatches: ClaimValidationMismatch[];
  warnings: string[];
}

export interface ClaimValidationOptions {
  cwd?: string;
  wuId?: string;
  allowlist?: ClaimValidationAllowlistEntry[];
}

interface SpecClaim {
  claimText: string;
  specReference: ClaimValidationSpecReference;
}

interface SpecLoadResult {
  claims: SpecClaim[];
  initiativeRef: string | null;
  allowlist: ClaimValidationAllowlistEntry[];
}

interface CheckDefinition {
  id: ClaimValidationId;
  isMatch: (claimText: string) => boolean;
  runScan: (projectRoot: string) => ClaimValidationEvidence[];
  remediationHint: string;
}

const CHECK_DEFINITIONS: readonly CheckDefinition[] = [
  {
    id: CLAIM_VALIDATION_IDS.LEGACY_CONFIG_HARD_CUT,
    isMatch: (claimText: string): boolean => {
      return (
        LEGACY_CONFIG_CLAIM_PATTERN.test(claimText) && ABSOLUTE_NEGATION_PATTERN.test(claimText)
      );
    },
    runScan: (projectRoot: string): ClaimValidationEvidence[] => {
      return scanLinesForPattern({
        projectRoot,
        globs: SOURCE_GLOBS.LEGACY_CONFIG,
        ignores: LEGACY_CONFIG_SCAN_IGNORES,
        includeLine: (line: string): boolean => {
          return line.includes(LEGACY_CONFIG_FILE_LITERAL) && !isCommentOnlyLine(line);
        },
      });
    },
    remediationHint: `Remove runtime usage of ${LEGACY_CONFIG_FILE_LITERAL} and keep ${WORKSPACE_CONFIG_FILE_NAME} as the only config contract.`,
  },
  {
    id: CLAIM_VALIDATION_IDS.RUNCLI_MAIN_REQUIRED,
    isMatch: (claimText: string): boolean => {
      return (
        RUNCLI_MAIN_CLAIM_PATTERN.test(claimText) && ABSOLUTE_UNIVERSAL_PATTERN.test(claimText)
      );
    },
    runScan: (projectRoot: string): ClaimValidationEvidence[] => {
      const files = listSourceFiles(projectRoot, SOURCE_GLOBS.CLI_ENTRYPOINTS, SOURCE_GLOB_IGNORES);
      const evidence: ClaimValidationEvidence[] = [];

      for (const filePath of files) {
        const content = readUtf8(filePath);
        if (!content) {
          continue;
        }

        const hasExportedMain = EXPORTED_MAIN_PATTERN.test(content);
        if (!hasExportedMain) {
          continue;
        }

        const hasImportMetaMain = IMPORT_META_MAIN_PATTERN.test(content);
        const hasMainCatch = MAIN_CATCH_PATTERN.test(content);
        const hasRunCLI = content.includes(RUNCLI_MAIN_CALL);

        if ((hasImportMetaMain || hasMainCatch) && !hasRunCLI) {
          const lines = content.split(LINE_SPLIT_PATTERN);
          const lineNumber =
            findLineNumber(lines, (line) => line.includes('import.meta.main')) ??
            findLineNumber(lines, (line) => line.includes('main().catch(')) ??
            1;
          const lineText = lines[lineNumber - 1]?.trim() ?? '';
          evidence.push({
            filePath: toRelativePath(projectRoot, filePath),
            line: lineNumber,
            lineText,
          });
        }
      }

      return evidence;
    },
    remediationHint:
      'Wrap entrypoint execution with runCLI(main) and import runCLI from cli-entry-point.',
  },
  {
    id: CLAIM_VALIDATION_IDS.CORE_NO_PROCESS_EXIT,
    isMatch: (claimText: string): boolean => {
      return (
        PROCESS_EXIT_CLAIM_PATTERN.test(claimText) &&
        CORE_TEXT_PATTERN.test(claimText) &&
        ABSOLUTE_NEGATION_PATTERN.test(claimText)
      );
    },
    runScan: (projectRoot: string): ClaimValidationEvidence[] => {
      return scanLinesForPattern({
        projectRoot,
        globs: SOURCE_GLOBS.CORE_RUNTIME,
        ignores: CORE_RUNTIME_IGNORES,
        includeLine: (line: string): boolean => {
          return PROCESS_EXIT_USAGE_PATTERN.test(line) && !isCommentOnlyLine(line);
        },
      });
    },
    remediationHint:
      'Replace process.exit() with typed errors in core modules and exit only at CLI boundaries.',
  },
] as const;

export async function validateClaimValidation(
  options: ClaimValidationOptions = {},
): Promise<ClaimValidationResult> {
  const projectRoot = options.cwd ?? process.cwd();
  const warnings: string[] = [];

  const wuId = options.wuId?.trim();
  if (!wuId) {
    warnings.push('No WU ID provided; claim validation skipped.');
    return {
      ok: true,
      scannedClaims: 0,
      checkedClaims: 0,
      mismatches: [],
      warnings,
    };
  }

  const wuSpec = loadWUSpec(projectRoot, wuId, warnings);
  if (!wuSpec) {
    return {
      ok: true,
      scannedClaims: 0,
      checkedClaims: 0,
      mismatches: [],
      warnings,
    };
  }

  const initiativeSpec = wuSpec.initiativeRef
    ? loadInitiativeSpec(projectRoot, wuSpec.initiativeRef, warnings)
    : null;

  const claims = [...wuSpec.claims, ...(initiativeSpec?.claims ?? [])];
  const allowlist = [
    ...(options.allowlist ?? []),
    ...wuSpec.allowlist,
    ...(initiativeSpec?.allowlist ?? []),
  ];

  const checkClaims = claims.flatMap((claim) => {
    return CHECK_DEFINITIONS.filter((check) => check.isMatch(claim.claimText)).map((check) => ({
      claim,
      check,
    }));
  });

  if (checkClaims.length === 0) {
    return {
      ok: true,
      scannedClaims: claims.length,
      checkedClaims: 0,
      mismatches: [],
      warnings,
    };
  }

  const evidenceByCheck = new Map<ClaimValidationId, ClaimValidationEvidence[]>();
  for (const check of CHECK_DEFINITIONS) {
    const shouldRun = checkClaims.some((entry) => entry.check.id === check.id);
    if (!shouldRun) {
      continue;
    }

    const rawEvidence = check.runScan(projectRoot);
    const filteredEvidence = applyAllowlist(rawEvidence, allowlist, check.id);
    evidenceByCheck.set(check.id, filteredEvidence);
  }

  const mismatches: ClaimValidationMismatch[] = [];
  for (const { claim, check } of checkClaims) {
    const evidence = evidenceByCheck.get(check.id) ?? [];
    if (evidence.length === 0) {
      continue;
    }

    mismatches.push({
      claimId: check.id,
      claimText: claim.claimText,
      specReference: claim.specReference,
      evidence,
      remediationHint: check.remediationHint,
    });
  }

  return {
    ok: mismatches.length === 0,
    scannedClaims: claims.length,
    checkedClaims: checkClaims.length,
    mismatches,
    warnings,
  };
}

function loadWUSpec(projectRoot: string, wuId: string, warnings: string[]): SpecLoadResult | null {
  const wuPaths = createWuPaths({ projectRoot });
  const wuPath = path.join(projectRoot, wuPaths.WU(wuId));

  if (!existsSync(wuPath)) {
    warnings.push(`WU spec not found for ${wuId}: ${wuPath}`);
    return null;
  }

  const rawText = readUtf8(wuPath);
  if (!rawText) {
    warnings.push(`WU spec could not be read for ${wuId}: ${wuPath}`);
    return null;
  }

  const doc = parseYAML(rawText) as Record<string, unknown> | null;
  if (!doc) {
    warnings.push(`WU spec could not be parsed for ${wuId}: ${wuPath}`);
    return null;
  }

  const claims = extractClaims({
    specId: wuId,
    filePath: wuPath,
    section: 'acceptance',
    values: asStringArray(doc.acceptance),
    rawText,
  });

  const initiativeRef = asString(doc.initiative);
  const allowlist = parseAllowlistNotes({
    specId: wuId,
    notes: asStringArray(doc.notes),
  });

  return {
    claims,
    initiativeRef: initiativeRef ?? null,
    allowlist,
  };
}

function loadInitiativeSpec(
  projectRoot: string,
  initiativeRef: string,
  warnings: string[],
): SpecLoadResult | null {
  const wuPaths = createWuPaths({ projectRoot });
  const initiativesDir = path.join(projectRoot, wuPaths.INITIATIVES_DIR());

  if (!existsSync(initiativesDir)) {
    warnings.push(`Initiatives directory not found: ${initiativesDir}`);
    return null;
  }

  const initiativePath = resolveInitiativePath(initiativesDir, initiativeRef);
  if (!initiativePath) {
    warnings.push(`Initiative spec not found for reference: ${initiativeRef}`);
    return null;
  }

  const rawText = readUtf8(initiativePath);
  if (!rawText) {
    warnings.push(`Initiative spec could not be read: ${initiativePath}`);
    return null;
  }

  const doc = parseYAML(rawText) as Record<string, unknown> | null;
  if (!doc) {
    warnings.push(`Initiative spec could not be parsed: ${initiativePath}`);
    return null;
  }

  const initiativeId = asString(doc.id) ?? initiativeRef;
  const claims = extractClaims({
    specId: initiativeId,
    filePath: initiativePath,
    section: 'success_metrics',
    values: asStringArray(doc.success_metrics),
    rawText,
  });

  const allowlist = parseAllowlistNotes({
    specId: initiativeId,
    notes: asStringArray(doc.notes),
  });

  return {
    claims,
    initiativeRef: null,
    allowlist,
  };
}

function resolveInitiativePath(initiativesDir: string, initiativeRef: string): string | null {
  const directPath = path.join(initiativesDir, `${initiativeRef}${YAML_EXTENSION}`);
  if (existsSync(directPath)) {
    return directPath;
  }

  const files = readdirSync(initiativesDir).filter((file) => file.endsWith(YAML_EXTENSION));
  const refLower = initiativeRef.toLowerCase();

  for (const file of files) {
    const candidatePath = path.join(initiativesDir, file);
    const rawText = readUtf8(candidatePath);
    if (!rawText) {
      continue;
    }

    const doc = parseYAML(rawText) as Record<string, unknown> | null;
    if (!doc) {
      continue;
    }

    const candidateId = asString(doc.id)?.toLowerCase();
    const candidateSlug = asString(doc.slug)?.toLowerCase();

    if (candidateId === refLower || candidateSlug === refLower) {
      return candidatePath;
    }
  }

  return null;
}

function extractClaims(input: {
  specId: string;
  filePath: string;
  section: ClaimValidationSpecReference['section'];
  values: string[];
  rawText: string;
}): SpecClaim[] {
  return input.values.map((claimText) => ({
    claimText,
    specReference: {
      id: input.specId,
      filePath: input.filePath,
      line: findClaimLineNumber(input.rawText, claimText),
      section: input.section,
    },
  }));
}

function parseAllowlistNotes(input: {
  specId: string;
  notes: string[];
}): ClaimValidationAllowlistEntry[] {
  const entries: ClaimValidationAllowlistEntry[] = [];

  for (const note of input.notes) {
    const trimmed = note.trim();
    if (!trimmed.toLowerCase().startsWith(CLAIM_NOTE_ALLOW_PREFIX)) {
      continue;
    }

    const entry = parseAllowlistDirective(trimmed, input.specId);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

function parseAllowlistDirective(
  note: string,
  specId: string,
): ClaimValidationAllowlistEntry | null {
  const parts = note.split(/\s+/).filter(Boolean);

  if (parts.length < 3) {
    return null;
  }

  const claimToken = parts[1]?.trim().toLowerCase() ?? '';
  const pathPattern = parts
    .slice(2)
    .join(' ')
    .trim()
    .replace(/^['"]|['"]$/g, '');

  if (!pathPattern) {
    return null;
  }

  const claimId = normalizeClaimId(claimToken);
  if (!claimId) {
    return null;
  }

  return {
    claimId,
    pathPattern,
    source: specId,
    reason: note,
  };
}

function normalizeClaimId(value: string): ClaimValidationAllowlistEntry['claimId'] | null {
  if (value === CLAIM_ALLOWLIST_ALL) {
    return CLAIM_ALLOWLIST_ALL;
  }

  const validIds = new Set<ClaimValidationId>(Object.values(CLAIM_VALIDATION_IDS));
  if (validIds.has(value as ClaimValidationId)) {
    return value as ClaimValidationId;
  }

  return null;
}

function applyAllowlist(
  evidence: ClaimValidationEvidence[],
  allowlist: ClaimValidationAllowlistEntry[],
  claimId: ClaimValidationId,
): ClaimValidationEvidence[] {
  if (allowlist.length === 0) {
    return evidence;
  }

  return evidence.filter((item) => {
    for (const allowEntry of allowlist) {
      const claimMatches =
        allowEntry.claimId === CLAIM_ALLOWLIST_ALL || allowEntry.claimId === claimId;
      if (!claimMatches) {
        continue;
      }

      if (micromatch.isMatch(item.filePath, allowEntry.pathPattern)) {
        return false;
      }
    }

    return true;
  });
}

function scanLinesForPattern(input: {
  projectRoot: string;
  globs: readonly string[];
  ignores: readonly string[];
  includeLine: (line: string) => boolean;
}): ClaimValidationEvidence[] {
  const files = listSourceFiles(input.projectRoot, input.globs, input.ignores);
  const evidence: ClaimValidationEvidence[] = [];

  for (const filePath of files) {
    const content = readUtf8(filePath);
    if (!content) {
      continue;
    }

    const lines = content.split(LINE_SPLIT_PATTERN);
    lines.forEach((line, index) => {
      if (!input.includeLine(line)) {
        return;
      }

      evidence.push({
        filePath: toRelativePath(input.projectRoot, filePath),
        line: index + 1,
        lineText: line.trim(),
      });
    });
  }

  return evidence;
}

function listSourceFiles(
  projectRoot: string,
  globs: readonly string[],
  ignores: readonly string[],
): string[] {
  const allMatches = new Set<string>();

  for (const pattern of globs) {
    const matches = globSync(pattern, {
      cwd: projectRoot,
      absolute: true,
      nodir: true,
      ignore: [...ignores],
    });

    matches.forEach((match) => allMatches.add(path.resolve(match)));
  }

  return Array.from(allMatches).sort((left, right) => left.localeCompare(right));
}

function isCommentOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('*/')
  );
}

function findClaimLineNumber(rawText: string, claimText: string): number {
  const lines = rawText.split(LINE_SPLIT_PATTERN);
  const normalizedClaim = normalizeText(claimText);
  const claimPrefix = normalizedClaim
    .split(' ')
    .filter(Boolean)
    .slice(0, CLAIM_LINE_PREFIX_WORDS)
    .join(' ');

  if (claimPrefix.length === 0) {
    return 1;
  }

  const exactLine = findLineNumber(lines, (line) => normalizeText(line).includes(claimPrefix));
  return exactLine ?? 1;
}

function findLineNumber(lines: string[], matches: (line: string) => boolean): number | null {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    if (matches(line)) {
      return index + 1;
    }
  }
  return null;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/['"`]/g, '').replace(/\s+/g, ' ').trim();
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed) {
        result.push(trimmed);
      }
    }
  }
  return result;
}

function readUtf8(filePath: string): string | null {
  try {
    return readFileSync(filePath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  } catch {
    return null;
  }
}

function toRelativePath(projectRoot: string, absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).split(path.sep).join('/');
}

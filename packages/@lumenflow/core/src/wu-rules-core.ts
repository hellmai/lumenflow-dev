import path from 'node:path';
import { minimatch } from 'minimatch';
import { TEST_TYPES, WU_TYPES } from './wu-constants.js';

export type ValidationPhase = 'intent' | 'structural' | 'reality';

export interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  suggestion: string;
  metadata?: Record<string, unknown>;
}

export interface WUValidationContextInput {
  id?: string;
  type?: string;
  status?: string;
  code_paths?: unknown;
  tests?: unknown;
  test_paths?: unknown;
  cwd?: string;
  baseRef?: string;
  headRef?: string;
}

export interface WUValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  metadata: {
    missingCodePaths: string[];
    missingCoverageCodePaths: string[];
    missingTestPaths: string[];
    changedFiles: string[];
    parityState: CliBinDiffState;
    parityReason?: string;
  };
}

export const RULE_CODES = {
  CODE_PATH_SHAPE: 'R001_CODE_PATH_SHAPE',
  MINIMUM_TEST_INTENT: 'R002_MINIMUM_TEST_INTENT',
  CODE_PATH_EXISTENCE: 'R003_CODE_PATH_EXISTENCE',
  CODE_PATH_COVERAGE: 'R004_CODE_PATH_COVERAGE',
  PARITY_MISSING_SURFACE: 'R005_PARITY_MISSING_SURFACE',
  PARITY_UNAVAILABLE: 'R005_PARITY_UNAVAILABLE',
  TEST_CLASSIFICATION: 'R007_TEST_CLASSIFICATION',
  TEST_EXISTENCE: 'R008_TEST_EXISTENCE',
} as const;

export const CLI_PACKAGE_JSON_PATH = 'packages/@lumenflow/cli/package.json';

export const REGISTRATION_SURFACES = {
  PUBLIC_MANIFEST: 'packages/@lumenflow/cli/src/public-manifest.ts',
  MCP_TOOLS: 'packages/@lumenflow/mcp/src/tools.ts',
} as const;

const DEFAULT_HEAD_REF = 'HEAD';
const AUTOMATED_TEST_BUCKETS = ['unit', 'e2e', 'integration'] as const;
type AutomatedTestBucket = (typeof AUTOMATED_TEST_BUCKETS)[number];

const BASIC_GLOB_CHAR_PATTERN = /[*?[\]{}]/;
const EXTGLOB_PATTERN = /[@!+*?]\(/;

export type CliBinDiffState = 'changed' | 'unchanged' | 'unavailable';

export interface CliBinDiffResult {
  state: CliBinDiffState;
  reason?: string;
  baseRef?: string;
  headRef: string;
}

interface NormalizedTests {
  manual: string[];
  unit: string[];
  e2e: string[];
  integration: string[];
}

interface NormalizedContext {
  id: string;
  type?: string;
  status?: string;
  codePathsRaw: unknown[];
  codePaths: string[];
  tests: NormalizedTests;
  cwd: string;
  baseRef?: string;
  headRef: string;
}

export type ResolveChangedFilesResult =
  | { ok: true; files: string[]; baseRef: string; headRef: string }
  | { ok: false; reason: string };

export interface WURuleResolvers {
  pathReferenceExists: (reference: string, cwd: string) => Promise<boolean>;
  resolveChangedFiles: (options: {
    cwd: string;
    baseRef?: string;
    headRef?: string;
  }) => Promise<ResolveChangedFilesResult>;
  resolveCliBinDiff: (options: {
    cwd: string;
    baseRef?: string;
    headRef?: string;
  }) => Promise<CliBinDiffResult>;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeCodePathsRaw(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value;
}

function normalizeTests(testsValue: unknown): NormalizedTests {
  const testsRecord =
    testsValue && typeof testsValue === 'object' && !Array.isArray(testsValue)
      ? (testsValue as Record<string, unknown>)
      : {};

  return {
    manual: normalizeStringArray(testsRecord[TEST_TYPES.MANUAL]),
    unit: normalizeStringArray(testsRecord[TEST_TYPES.UNIT]),
    e2e: normalizeStringArray(testsRecord[TEST_TYPES.E2E]),
    integration: normalizeStringArray(testsRecord[TEST_TYPES.INTEGRATION]),
  };
}

function normalizeContext(input: WUValidationContextInput): NormalizedContext {
  const testsSource =
    input.tests && typeof input.tests === 'object'
      ? input.tests
      : input.test_paths && typeof input.test_paths === 'object'
        ? input.test_paths
        : {};

  const codePathsRaw = normalizeCodePathsRaw(input.code_paths);
  const codePaths = normalizeStringArray(input.code_paths);

  return {
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : '(unknown-wu)',
    type: typeof input.type === 'string' ? input.type : undefined,
    status: typeof input.status === 'string' ? input.status : undefined,
    codePathsRaw,
    codePaths,
    tests: normalizeTests(testsSource),
    cwd: input.cwd?.trim() || process.cwd(),
    baseRef: input.baseRef,
    headRef: input.headRef || DEFAULT_HEAD_REF,
  };
}

function isDocsOrProcess(type?: string): boolean {
  return type === WU_TYPES.DOCUMENTATION || type === WU_TYPES.PROCESS;
}

export function hasGlobPattern(pathValue: string): boolean {
  return BASIC_GLOB_CHAR_PATTERN.test(pathValue) || EXTGLOB_PATTERN.test(pathValue);
}

export function normalizePathForCoverage(pathValue: string): string {
  return pathValue
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '');
}

function isDirectoryLikeCodePath(codePath: string): boolean {
  if (codePath.endsWith('/')) {
    return true;
  }
  const fileName = path.posix.basename(codePath);
  return !fileName.includes('.');
}

function addIssue(issues: ValidationIssue[], issue: ValidationIssue): void {
  issues.push(issue);
}

export function isCodePathCoveredByChangedFiles(options: {
  codePath: string;
  changedFiles: string[];
}): boolean {
  const normalizedCodePath = normalizePathForCoverage(options.codePath);
  if (!normalizedCodePath) {
    return false;
  }

  const glob = hasGlobPattern(normalizedCodePath);
  const directoryLike = isDirectoryLikeCodePath(options.codePath);

  return options.changedFiles.some((changedFile) => {
    const normalizedChangedFile = normalizePathForCoverage(changedFile);
    if (!normalizedChangedFile) {
      return false;
    }

    if (normalizedChangedFile === normalizedCodePath) {
      return true;
    }

    if (glob) {
      return minimatch(normalizedChangedFile, normalizedCodePath, { dot: true });
    }

    if (directoryLike) {
      return normalizedChangedFile.startsWith(`${normalizedCodePath}/`);
    }

    return false;
  });
}

export function findMissingCodePathCoverage(options: {
  codePaths: string[];
  changedFiles: string[];
}): string[] {
  const { codePaths, changedFiles } = options;
  return codePaths.filter(
    (codePath) => !isCodePathCoveredByChangedFiles({ codePath, changedFiles }),
  );
}

export function isPathLikeTestEntry(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  // Treat sentence-like entries as prose, not file paths.
  // This avoids misclassifying notes like "N/A - metadata-only changes..." as paths.
  const hasWhitespace = /\s/.test(trimmed);
  const hasGlob = hasGlobPattern(trimmed);
  const hasFileSuffix = /(\.(test|spec)\.[A-Za-z0-9]+|\.[A-Za-z0-9]+)$/.test(trimmed);
  if (
    hasWhitespace &&
    !trimmed.startsWith('./') &&
    !trimmed.startsWith('../') &&
    !trimmed.startsWith('/') &&
    !hasGlob &&
    !hasFileSuffix
  ) {
    return false;
  }

  if (trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.startsWith('/')) {
    return true;
  }

  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return true;
  }

  if (hasGlobPattern(trimmed)) {
    return true;
  }

  if (/\.(test|spec)\.[A-Za-z0-9]+$/i.test(trimmed)) {
    return true;
  }

  if (!trimmed.includes(' ') && /\.[A-Za-z0-9]+$/.test(trimmed)) {
    return true;
  }

  return false;
}

function validateRule001PathShape(context: NormalizedContext, issues: ValidationIssue[]): void {
  context.codePathsRaw.forEach((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim()) {
      addIssue(issues, {
        code: RULE_CODES.CODE_PATH_SHAPE,
        severity: 'error',
        message: `code_paths[${index}] must be a non-empty string path or glob.`,
        suggestion: 'Provide a non-empty path/glob string or remove this entry.',
      });
    }
  });
}

function validateRule002MinimumTestIntent(
  context: NormalizedContext,
  issues: ValidationIssue[],
): void {
  if (isDocsOrProcess(context.type)) {
    return;
  }

  if (context.codePaths.length === 0) {
    return;
  }

  const hasTestIntent =
    context.tests.manual.length > 0 ||
    context.tests.unit.length > 0 ||
    context.tests.e2e.length > 0 ||
    context.tests.integration.length > 0;

  if (!hasTestIntent) {
    addIssue(issues, {
      code: RULE_CODES.MINIMUM_TEST_INTENT,
      severity: 'error',
      message:
        'At least one test entry is required across tests.manual, tests.unit, tests.e2e, or tests.integration.',
      suggestion:
        'Add at least one test entry. Use tests.manual for descriptive checks when no automated path applies.',
    });
  }
}

async function validateRule003CodePathExistence(
  context: NormalizedContext,
  issues: ValidationIssue[],
  missingCodePaths: string[],
  pathReferenceExists: WURuleResolvers['pathReferenceExists'],
): Promise<void> {
  const missing: string[] = [];

  for (const codePath of context.codePaths) {
    // eslint-disable-next-line no-await-in-loop -- path existence checks are bounded by code_paths length
    const exists = await pathReferenceExists(codePath, context.cwd);
    if (!exists) {
      missing.push(codePath);
    }
  }

  if (missing.length > 0) {
    missingCodePaths.push(...missing);
    addIssue(issues, {
      code: RULE_CODES.CODE_PATH_EXISTENCE,
      severity: 'error',
      message: `code_paths existence check failed for ${missing.length} path(s).`,
      suggestion:
        'Create the missing files/glob targets, or update code_paths to match actual repository paths.',
      metadata: { missingCodePaths: missing },
    });
  }
}

async function validateRule004Coverage(
  context: NormalizedContext,
  issues: ValidationIssue[],
  changedFilesOutput: string[],
  missingCoverageCodePaths: string[],
  resolveChangedFiles: WURuleResolvers['resolveChangedFiles'],
): Promise<void> {
  if (context.codePaths.length === 0) {
    return;
  }

  const changedFiles = await resolveChangedFiles({
    cwd: context.cwd,
    baseRef: context.baseRef,
    headRef: context.headRef,
  });

  if (!changedFiles.ok) {
    const coverageReason = 'reason' in changedFiles ? changedFiles.reason : 'git diff unavailable';
    missingCoverageCodePaths.push(...context.codePaths);
    addIssue(issues, {
      code: RULE_CODES.CODE_PATH_COVERAGE,
      severity: 'error',
      message: `Unable to evaluate code_paths coverage: ${coverageReason}`,
      suggestion:
        'Ensure git diff base is available (origin/main or main) and rerun from the claimed worktree/branch context.',
    });
    return;
  }

  changedFilesOutput.push(...changedFiles.files);

  const missing = findMissingCodePathCoverage({
    codePaths: context.codePaths,
    changedFiles: changedFiles.files,
  });

  if (missing.length > 0) {
    missingCoverageCodePaths.push(...missing);
    addIssue(issues, {
      code: RULE_CODES.CODE_PATH_COVERAGE,
      severity: 'error',
      message: `code_paths coverage failed: ${missing.length} scoped path(s) have no matching branch diff changes.`,
      suggestion:
        'Commit changes that touch each missing code_path, or update code_paths to match actual branch scope.',
      metadata: {
        missingCodePaths: missing,
        changedFiles: changedFiles.files,
        baseRef: changedFiles.baseRef,
        headRef: changedFiles.headRef,
      },
    });
  }
}

function validateRule007AutomatedTestClassification(
  context: NormalizedContext,
  issues: ValidationIssue[],
): Record<AutomatedTestBucket, string[]> {
  const pathLikeEntries: Record<AutomatedTestBucket, string[]> = {
    unit: [],
    e2e: [],
    integration: [],
  };

  for (const bucket of AUTOMATED_TEST_BUCKETS) {
    for (const entry of context.tests[bucket]) {
      if (!isPathLikeTestEntry(entry)) {
        addIssue(issues, {
          code: RULE_CODES.TEST_CLASSIFICATION,
          severity: 'error',
          message: `tests.${bucket} entry is not path-like: "${entry}".`,
          suggestion: `Move descriptive text to tests.manual and keep tests.${bucket} for file paths/globs only.`,
          metadata: { bucket, value: entry },
        });
        continue;
      }

      pathLikeEntries[bucket].push(entry);
    }
  }

  return pathLikeEntries;
}

async function validateRule008AutomatedTestExistence(
  context: NormalizedContext,
  issues: ValidationIssue[],
  pathLikeEntries: Record<AutomatedTestBucket, string[]>,
  missingTestPaths: string[],
  pathReferenceExists: WURuleResolvers['pathReferenceExists'],
): Promise<void> {
  const missing: string[] = [];

  for (const bucket of AUTOMATED_TEST_BUCKETS) {
    for (const testPath of pathLikeEntries[bucket]) {
      // eslint-disable-next-line no-await-in-loop -- bounded by test path list sizes
      const exists = await pathReferenceExists(testPath, context.cwd);
      if (!exists) {
        missing.push(testPath);
      }
    }
  }

  if (missing.length > 0) {
    missingTestPaths.push(...missing);
    addIssue(issues, {
      code: RULE_CODES.TEST_EXISTENCE,
      severity: 'error',
      message: `Automated test path existence failed for ${missing.length} path(s).`,
      suggestion:
        'Create the missing automated test files/glob targets, or move non-path notes to tests.manual.',
      metadata: { missingTestPaths: missing },
    });
  }
}

async function validateRule005Parity(
  context: NormalizedContext,
  issues: ValidationIssue[],
  resolveCliBinDiff: WURuleResolvers['resolveCliBinDiff'],
): Promise<CliBinDiffResult> {
  const includesCliPackage = context.codePaths.includes(CLI_PACKAGE_JSON_PATH);
  if (!includesCliPackage) {
    return { state: 'unchanged', headRef: context.headRef };
  }

  const diff = await resolveCliBinDiff({
    cwd: context.cwd,
    baseRef: context.baseRef,
    headRef: context.headRef,
  });

  if (diff.state === 'unavailable') {
    addIssue(issues, {
      code: RULE_CODES.PARITY_UNAVAILABLE,
      severity: 'warning',
      message: `Skipped CLI registration parity check: ${diff.reason || 'bin diff unavailable.'}`,
      suggestion:
        'Ensure git base/head refs are available, then rerun reality validation to enforce parity.',
      metadata: {
        baseRef: diff.baseRef,
        headRef: diff.headRef,
      },
    });
    return diff;
  }

  if (diff.state === 'unchanged') {
    return diff;
  }

  const hasPublicManifest = context.codePaths.includes(REGISTRATION_SURFACES.PUBLIC_MANIFEST);
  const hasMcpTools = context.codePaths.includes(REGISTRATION_SURFACES.MCP_TOOLS);

  if (!hasPublicManifest) {
    addIssue(issues, {
      code: RULE_CODES.PARITY_MISSING_SURFACE,
      severity: 'error',
      message: `CLI bin changed but '${REGISTRATION_SURFACES.PUBLIC_MANIFEST}' is missing from code_paths.`,
      suggestion: `Add '${REGISTRATION_SURFACES.PUBLIC_MANIFEST}' to code_paths for CLI registration parity.`,
      metadata: { surface: REGISTRATION_SURFACES.PUBLIC_MANIFEST, baseRef: diff.baseRef },
    });
  }

  if (!hasMcpTools) {
    addIssue(issues, {
      code: RULE_CODES.PARITY_MISSING_SURFACE,
      severity: 'error',
      message: `CLI bin changed but '${REGISTRATION_SURFACES.MCP_TOOLS}' is missing from code_paths.`,
      suggestion: `Add '${REGISTRATION_SURFACES.MCP_TOOLS}' to code_paths for CLI registration parity.`,
      metadata: { surface: REGISTRATION_SURFACES.MCP_TOOLS, baseRef: diff.baseRef },
    });
  }

  return diff;
}

function finalizeValidation(issues: ValidationIssue[], metadata: WUValidationResult['metadata']) {
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  return {
    valid: errors.length === 0,
    issues,
    errors,
    warnings,
    metadata,
  } satisfies WUValidationResult;
}

function runCommonPhaseRules(context: NormalizedContext, issues: ValidationIssue[]): void {
  validateRule001PathShape(context, issues);
  validateRule002MinimumTestIntent(context, issues);
}

export function validateWURulesSync(
  input: WUValidationContextInput,
  options: { phase?: ValidationPhase } = {},
): WUValidationResult {
  const phase = options.phase || 'structural';
  if (phase === 'reality') {
    throw new Error(
      'validateWURulesSync does not support phase "reality". Use validateWURulesWithResolvers.',
    );
  }

  const context = normalizeContext(input);
  const issues: ValidationIssue[] = [];

  runCommonPhaseRules(context, issues);

  return finalizeValidation(issues, {
    missingCodePaths: [],
    missingCoverageCodePaths: [],
    missingTestPaths: [],
    changedFiles: [],
    parityState: 'unavailable',
  });
}

export async function validateWURulesWithResolvers(
  input: WUValidationContextInput,
  options: { phase?: ValidationPhase } = {},
  resolvers: WURuleResolvers,
): Promise<WUValidationResult> {
  const phase = options.phase || 'structural';

  if (phase !== 'reality') {
    return validateWURulesSync(input, { phase });
  }

  const context = normalizeContext(input);
  const issues: ValidationIssue[] = [];
  const missingCodePaths: string[] = [];
  const missingCoverageCodePaths: string[] = [];
  const missingTestPaths: string[] = [];
  const changedFiles: string[] = [];

  runCommonPhaseRules(context, issues);

  await validateRule003CodePathExistence(
    context,
    issues,
    missingCodePaths,
    resolvers.pathReferenceExists,
  );
  await validateRule004Coverage(
    context,
    issues,
    changedFiles,
    missingCoverageCodePaths,
    resolvers.resolveChangedFiles,
  );
  const parity = await validateRule005Parity(context, issues, resolvers.resolveCliBinDiff);
  const pathLikeEntries = validateRule007AutomatedTestClassification(context, issues);
  await validateRule008AutomatedTestExistence(
    context,
    issues,
    pathLikeEntries,
    missingTestPaths,
    resolvers.pathReferenceExists,
  );

  return finalizeValidation(issues, {
    missingCodePaths,
    missingCoverageCodePaths,
    missingTestPaths,
    changedFiles,
    parityState: parity.state,
    parityReason: parity.reason,
  });
}

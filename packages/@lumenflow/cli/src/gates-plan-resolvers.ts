/**
 * Gates Plan Resolvers
 *
 * WU-1647: Extracted pure plan-resolution functions that decide
 * what mode (full/incremental/skip) each gate should use.
 *
 * These functions are side-effect-free and only depend on their inputs.
 *
 * @module gates-plan-resolvers
 */

import { isLintableFile } from '@lumenflow/core/incremental-lint';
import { getBasename, normalizePath, extractPackagesFromCodePaths } from './gates-utils.js';

// ── Types ──────────────────────────────────────────────────────────────

export type FormatCheckPlan = {
  mode: 'full' | 'incremental' | 'skip';
  files: string[];
  reason?: 'file-list-error' | 'prettier-config';
};

export type LintPlan = {
  mode: 'full' | 'incremental' | 'skip';
  files: string[];
};

export type TestPlan = {
  mode: 'full' | 'incremental';
  reason?: 'untracked-code' | 'test-config' | 'file-list-error';
};

/**
 * WU-1299: Docs-only test plan type
 * Indicates how tests should be handled in docs-only mode based on code_paths
 */
export type DocsOnlyTestPlan = {
  mode: 'skip' | 'filtered';
  packages: string[];
  reason?: 'no-code-packages';
};

// ── Config file detection ──────────────────────────────────────────────

const PRETTIER_CONFIG_FILES = new Set([
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.yaml',
  '.prettierrc.yml',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.ts',
  'prettier.config.js',
  'prettier.config.cjs',
  'prettier.config.ts',
  'prettier.config.mjs',
  '.prettierignore',
]);

// WU-1356: Extended to support multiple build tools and test runners
const TEST_CONFIG_BASENAMES = new Set([
  'turbo.json', // Turborepo
  'nx.json', // Nx
  'lerna.json', // Lerna
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'package.json',
]);
// WU-1356: Extended to support vitest, jest, and mocha config patterns
const TEST_CONFIG_PATTERNS = [
  /^vitest\.config\.(ts|mts|js|mjs|cjs)$/i,
  /^jest\.config\.(ts|js|mjs|cjs|json)$/i,
  /^\.mocharc\.(js|json|yaml|yml)$/i,
  // eslint-disable-next-line security/detect-unsafe-regex -- static tsconfig pattern; no backtracking risk
  /^tsconfig(\..+)?\.json$/i,
];

export function isPrettierConfigFile(filePath: string): boolean {
  if (!filePath) return false;
  const basename = getBasename(filePath);
  return PRETTIER_CONFIG_FILES.has(basename);
}

export function isTestConfigFile(filePath: string): boolean {
  if (!filePath) return false;
  const basename = getBasename(filePath);
  if (TEST_CONFIG_BASENAMES.has(basename)) {
    return true;
  }
  return TEST_CONFIG_PATTERNS.some((pattern) => pattern.test(basename));
}

// ── Plan resolvers ─────────────────────────────────────────────────────

/* eslint-disable sonarjs/no-duplicate-string -- Pre-existing: format check reasons are intentionally distinct string literals */
export function resolveFormatCheckPlan({
  changedFiles,
  fileListError = false,
}: {
  changedFiles: string[];
  fileListError?: boolean;
}): FormatCheckPlan {
  if (fileListError) {
    return { mode: 'full', files: [], reason: 'file-list-error' };
  }
  if (changedFiles.some(isPrettierConfigFile)) {
    return { mode: 'full', files: [], reason: 'prettier-config' };
  }
  if (changedFiles.length === 0) {
    return { mode: 'skip', files: [] };
  }
  return { mode: 'incremental', files: changedFiles };
}

export function resolveLintPlan({
  isMainBranch,
  changedFiles,
}: {
  isMainBranch: boolean;
  changedFiles: string[];
}): LintPlan {
  if (isMainBranch) {
    return { mode: 'full', files: [] };
  }

  const lintTargets = changedFiles.filter((filePath) => {
    const normalized = normalizePath(filePath);
    return (
      (normalized.startsWith('apps/') || normalized.startsWith('packages/')) &&
      isLintableFile(normalized)
    );
  });

  if (lintTargets.length === 0) {
    return { mode: 'skip', files: [] };
  }

  return { mode: 'incremental', files: lintTargets };
}
/* eslint-enable sonarjs/no-duplicate-string */

export function resolveTestPlan({
  isMainBranch,
  hasUntrackedCode,
  hasConfigChange,
  fileListError,
}: {
  isMainBranch: boolean;
  hasUntrackedCode: boolean;
  hasConfigChange: boolean;
  fileListError: boolean;
}): TestPlan {
  if (fileListError) {
    return { mode: 'full', reason: 'file-list-error' };
  }
  if (hasUntrackedCode) {
    return { mode: 'full', reason: 'untracked-code' };
  }
  if (hasConfigChange) {
    return { mode: 'full', reason: 'test-config' };
  }
  if (isMainBranch) {
    return { mode: 'full' };
  }
  return { mode: 'incremental' };
}

/**
 * WU-1299: Resolve test plan for docs-only mode
 */
export function resolveDocsOnlyTestPlan({ codePaths }: { codePaths: string[] }): DocsOnlyTestPlan {
  const packages = extractPackagesFromCodePaths(codePaths);

  if (packages.length === 0) {
    return {
      mode: 'skip',
      packages: [],
      reason: 'no-code-packages',
    };
  }

  return {
    mode: 'filtered',
    packages,
  };
}

/**
 * WU-1299: Format message for docs-only test skipping/filtering
 */
export function formatDocsOnlySkipMessage(plan: DocsOnlyTestPlan): string {
  if (plan.mode === 'skip') {
    return '\uD83D\uDCDD docs-only mode: skipping all tests (no code packages in code_paths)';
  }

  const packageList = plan.packages.join(', ');
  return `\uD83D\uDCDD docs-only mode: running tests only for packages in code_paths: ${packageList}`;
}

/**
 * Resolve spec-linter execution strategy.
 * If current WU is known, run scoped validation only.
 * If unknown, fall back to global validation.
 */
export function resolveSpecLinterPlan(wuId: string | null): {
  scopedWuId: string | null;
  runGlobal: boolean;
} {
  if (wuId) {
    return {
      scopedWuId: wuId,
      runGlobal: false,
    };
  }

  return {
    scopedWuId: null,
    runGlobal: true,
  };
}

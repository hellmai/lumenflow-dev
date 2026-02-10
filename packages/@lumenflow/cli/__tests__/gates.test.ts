/**
 * @file gates.test.ts
 * WU-1042: Tests for prettier guidance helpers in gates.
 * WU-1087: Tests for createWUParser-based argument parsing.
 * WU-1299: Tests for docs-only mode package filtering.
 */

/* eslint-disable sonarjs/no-duplicate-string -- Test files commonly repeat string literals for clarity */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  buildPrettierWriteCommand,
  formatFormatCheckGuidance,
  parsePrettierListOutput,
  parseGatesOptions,
  GATES_OPTIONS,
  isPrettierConfigFile,
  resolveFormatCheckPlan,
  resolveLintPlan,
  isTestConfigFile,
  resolveTestPlan,
  extractPackagesFromCodePaths,
  resolveDocsOnlyTestPlan,
  formatDocsOnlySkipMessage,
  loadCurrentWUCodePaths,
} from '../src/gates.js';

describe('gates prettier helpers (WU-1042)', () => {
  it('parses list-different output into file paths', () => {
    const output = [
      'Checking formatting...',
      '[error] packages/foo.ts',
      'packages/bar.ts',
      '[error] Code style issues found in 2 files. Forgot to run Prettier?',
      'All matched files use Prettier',
      '',
    ].join('\n');

    expect(parsePrettierListOutput(output)).toEqual(['packages/foo.ts', 'packages/bar.ts']);
  });

  it('builds a prettier write command with quoted files', () => {
    const command = buildPrettierWriteCommand(['packages/foo.ts', 'docs/readme.md']);
    expect(command).toBe('pnpm prettier --write "packages/foo.ts" "docs/readme.md"');
  });

  it('formats guidance with command and file list', () => {
    const lines = formatFormatCheckGuidance(['packages/foo.ts']);
    const output = lines.join('\n');

    expect(output).toContain('format:check failed');
    expect(output).toContain('pnpm prettier --write "packages/foo.ts"');
    expect(output).toContain('- packages/foo.ts');
  });

  it('returns empty guidance when no files provided', () => {
    expect(formatFormatCheckGuidance([])).toEqual([]);
  });
});

describe('gates argument parsing (WU-1087)', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    // Reset argv before each test
    process.argv = ['node', 'gates.js'];
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  describe('GATES_OPTIONS', () => {
    it('exports gates-specific option definitions', () => {
      expect(GATES_OPTIONS).toBeDefined();
      expect(GATES_OPTIONS.docsOnly).toBeDefined();
      expect(GATES_OPTIONS.fullLint).toBeDefined();
      expect(GATES_OPTIONS.fullTests).toBeDefined();
      expect(GATES_OPTIONS.fullCoverage).toBeDefined();
      expect(GATES_OPTIONS.coverageMode).toBeDefined();
      expect(GATES_OPTIONS.verbose).toBeDefined();
    });

    it('has correct flag definitions', () => {
      expect(GATES_OPTIONS.docsOnly.flags).toBe('--docs-only');
      expect(GATES_OPTIONS.fullLint.flags).toBe('--full-lint');
      expect(GATES_OPTIONS.fullTests.flags).toBe('--full-tests');
      expect(GATES_OPTIONS.fullCoverage.flags).toBe('--full-coverage');
      expect(GATES_OPTIONS.coverageMode.flags).toBe('--coverage-mode <mode>');
      expect(GATES_OPTIONS.verbose.flags).toBe('--verbose');
    });
  });

  describe('parseGatesOptions', () => {
    it('parses --docs-only flag', () => {
      process.argv = ['node', 'gates.js', '--docs-only'];
      const opts = parseGatesOptions();
      expect(opts.docsOnly).toBe(true);
    });

    it('parses --full-lint flag', () => {
      process.argv = ['node', 'gates.js', '--full-lint'];
      const opts = parseGatesOptions();
      expect(opts.fullLint).toBe(true);
    });

    it('parses --full-tests flag', () => {
      process.argv = ['node', 'gates.js', '--full-tests'];
      const opts = parseGatesOptions();
      expect(opts.fullTests).toBe(true);
    });

    it('parses --full-coverage flag', () => {
      process.argv = ['node', 'gates.js', '--full-coverage'];
      const opts = parseGatesOptions();
      expect(opts.fullCoverage).toBe(true);
    });

    it('parses --coverage-mode with value', () => {
      process.argv = ['node', 'gates.js', '--coverage-mode', 'warn'];
      const opts = parseGatesOptions();
      expect(opts.coverageMode).toBe('warn');
    });

    it('defaults --coverage-mode to block', () => {
      process.argv = ['node', 'gates.js'];
      const opts = parseGatesOptions();
      expect(opts.coverageMode).toBe('block');
    });

    it('parses --verbose flag', () => {
      process.argv = ['node', 'gates.js', '--verbose'];
      const opts = parseGatesOptions();
      expect(opts.verbose).toBe(true);
    });

    it('handles multiple flags together', () => {
      process.argv = ['node', 'gates.js', '--docs-only', '--verbose'];
      const opts = parseGatesOptions();
      expect(opts.docsOnly).toBe(true);
      expect(opts.verbose).toBe(true);
    });

    it('filters pnpm -- separator correctly', () => {
      // When invoked via `pnpm gates -- --docs-only`, pnpm passes ["--", "--docs-only"]
      process.argv = ['node', 'gates.js', '--', '--docs-only'];
      const opts = parseGatesOptions();
      expect(opts.docsOnly).toBe(true);
    });
  });
});

describe('gates incremental planning (WU-1165)', () => {
  describe('format check planning', () => {
    it('falls back to full format check when file list fails', () => {
      const plan = resolveFormatCheckPlan({ changedFiles: [], fileListError: true });
      expect(plan.mode).toBe('full');
      expect(plan.reason).toBe('file-list-error');
    });

    it('falls back to full format check when prettier config changes', () => {
      const plan = resolveFormatCheckPlan({
        changedFiles: ['.prettierrc', 'packages/@lumenflow/cli/src/gates.ts'],
      });
      expect(plan.mode).toBe('full');
      expect(plan.reason).toBe('prettier-config');
    });

    it('skips format check when no files changed', () => {
      const plan = resolveFormatCheckPlan({ changedFiles: [] });
      expect(plan.mode).toBe('skip');
    });

    it('runs incremental format check for changed files', () => {
      const plan = resolveFormatCheckPlan({
        changedFiles: ['packages/@lumenflow/cli/src/gates.ts'],
      });
      expect(plan.mode).toBe('incremental');
      expect(plan.files).toEqual(['packages/@lumenflow/cli/src/gates.ts']);
    });
  });

  describe('lint planning', () => {
    it('runs full lint on main branch', () => {
      const plan = resolveLintPlan({
        isMainBranch: true,
        changedFiles: ['packages/@lumenflow/cli/src/gates.ts'],
      });
      expect(plan.mode).toBe('full');
    });

    it('skips lint when no lintable files changed', () => {
      const plan = resolveLintPlan({
        isMainBranch: false,
        changedFiles: ['docs/README.md', 'apps/docs/content.mdx'],
      });
      expect(plan.mode).toBe('skip');
    });

    it('runs incremental lint for apps and packages files', () => {
      const plan = resolveLintPlan({
        isMainBranch: false,
        changedFiles: [
          'packages/@lumenflow/cli/src/gates.ts',
          'apps/web/src/app.tsx',
          'tools/cli-entry.mjs',
        ],
      });
      expect(plan.mode).toBe('incremental');
      expect(plan.files).toEqual(['packages/@lumenflow/cli/src/gates.ts', 'apps/web/src/app.tsx']);
    });
  });

  describe('test planning', () => {
    it('falls back to full tests on main branch', () => {
      const plan = resolveTestPlan({
        isMainBranch: true,
        hasUntrackedCode: false,
        hasConfigChange: false,
        fileListError: false,
      });
      expect(plan.mode).toBe('full');
    });

    it('falls back to full tests when untracked code files exist', () => {
      const plan = resolveTestPlan({
        isMainBranch: false,
        hasUntrackedCode: true,
        hasConfigChange: false,
        fileListError: false,
      });
      expect(plan.mode).toBe('full');
      expect(plan.reason).toBe('untracked-code');
    });

    it('falls back to full tests when config changes', () => {
      const plan = resolveTestPlan({
        isMainBranch: false,
        hasUntrackedCode: false,
        hasConfigChange: true,
        fileListError: false,
      });
      expect(plan.mode).toBe('full');
      expect(plan.reason).toBe('test-config');
    });

    it('falls back to full tests when file list fails', () => {
      const plan = resolveTestPlan({
        isMainBranch: false,
        hasUntrackedCode: false,
        hasConfigChange: false,
        fileListError: true,
      });
      expect(plan.mode).toBe('full');
      expect(plan.reason).toBe('file-list-error');
    });

    it('runs incremental tests when conditions allow', () => {
      const plan = resolveTestPlan({
        isMainBranch: false,
        hasUntrackedCode: false,
        hasConfigChange: false,
        fileListError: false,
      });
      expect(plan.mode).toBe('incremental');
    });
  });

  describe('config file detection', () => {
    it('detects prettier config and ignore files', () => {
      expect(isPrettierConfigFile('.prettierrc')).toBe(true);
      expect(isPrettierConfigFile('prettier.config.mjs')).toBe(true);
      expect(isPrettierConfigFile('.prettierignore')).toBe(true);
      expect(isPrettierConfigFile('packages/@lumenflow/cli/src/gates.ts')).toBe(false);
    });

    it('detects test config files', () => {
      expect(isTestConfigFile('vitest.config.ts')).toBe(true);
      expect(isTestConfigFile('turbo.json')).toBe(true);
      expect(isTestConfigFile('tsconfig.base.json')).toBe(true);
      expect(isTestConfigFile('pnpm-lock.yaml')).toBe(true);
      expect(isTestConfigFile('package.json')).toBe(true);
      expect(isTestConfigFile('packages/@lumenflow/cli/src/gates.ts')).toBe(false);
    });
  });
});

describe('docs-only mode package filtering (WU-1299)', () => {
  describe('extractPackagesFromCodePaths', () => {
    it('extracts package names from packages/* paths', () => {
      const codePaths = [
        'packages/@lumenflow/cli/src/gates.ts',
        'packages/@lumenflow/core/src/index.ts',
      ];
      const packages = extractPackagesFromCodePaths(codePaths);
      expect(packages).toEqual(['@lumenflow/cli', '@lumenflow/core']);
    });

    // WU-1415: apps/ paths are no longer extracted because they aren't valid turbo packages
    // Turbo --filter expects actual package names from package.json, not directory names
    it('skips apps/* paths (not valid turbo packages)', () => {
      const codePaths = ['apps/web/src/app.tsx', 'apps/docs/content.mdx'];
      const packages = extractPackagesFromCodePaths(codePaths);
      expect(packages).toEqual([]);
    });

    it('handles mixed packages and apps paths (apps skipped)', () => {
      const codePaths = ['packages/@lumenflow/cli/src/gates.ts', 'apps/web/src/app.tsx'];
      const packages = extractPackagesFromCodePaths(codePaths);
      expect(packages).toEqual(['@lumenflow/cli']);
    });

    it('deduplicates package names', () => {
      const codePaths = [
        'packages/@lumenflow/cli/src/gates.ts',
        'packages/@lumenflow/cli/src/index.ts',
      ];
      const packages = extractPackagesFromCodePaths(codePaths);
      expect(packages).toEqual(['@lumenflow/cli']);
    });

    it('handles docs-only paths (returns empty array)', () => {
      const codePaths = ['docs/README.md', 'docs/guide.md'];
      const packages = extractPackagesFromCodePaths(codePaths);
      expect(packages).toEqual([]);
    });

    it('returns empty array for empty input', () => {
      expect(extractPackagesFromCodePaths([])).toEqual([]);
      expect(extractPackagesFromCodePaths(undefined as unknown as string[])).toEqual([]);
    });
  });

  describe('resolveDocsOnlyTestPlan', () => {
    it('returns skip mode when no packages are found in code_paths', () => {
      const plan = resolveDocsOnlyTestPlan({
        codePaths: ['docs/README.md'],
      });
      expect(plan.mode).toBe('skip');
      expect(plan.packages).toEqual([]);
      expect(plan.reason).toBe('no-code-packages');
    });

    it('returns filtered mode when packages are found in code_paths', () => {
      const plan = resolveDocsOnlyTestPlan({
        codePaths: ['packages/@lumenflow/cli/src/gates.ts'],
      });
      expect(plan.mode).toBe('filtered');
      expect(plan.packages).toEqual(['@lumenflow/cli']);
    });

    it('includes all packages from code_paths', () => {
      const plan = resolveDocsOnlyTestPlan({
        codePaths: [
          'packages/@lumenflow/cli/src/gates.ts',
          'packages/@lumenflow/core/src/index.ts',
        ],
      });
      expect(plan.mode).toBe('filtered');
      expect(plan.packages).toContain('@lumenflow/cli');
      expect(plan.packages).toContain('@lumenflow/core');
    });

    it('handles empty code_paths', () => {
      const plan = resolveDocsOnlyTestPlan({
        codePaths: [],
      });
      expect(plan.mode).toBe('skip');
      expect(plan.reason).toBe('no-code-packages');
    });

    it('handles undefined code_paths', () => {
      const plan = resolveDocsOnlyTestPlan({
        codePaths: undefined as unknown as string[],
      });
      expect(plan.mode).toBe('skip');
      expect(plan.reason).toBe('no-code-packages');
    });
  });

  describe('formatDocsOnlySkipMessage', () => {
    it('formats skip message when all tests are skipped', () => {
      const message = formatDocsOnlySkipMessage({
        mode: 'skip',
        packages: [],
        reason: 'no-code-packages',
      });
      expect(message).toContain('docs-only');
      expect(message).toContain('skip');
    });

    it('formats filtered message with package names', () => {
      const message = formatDocsOnlySkipMessage({
        mode: 'filtered',
        packages: ['@lumenflow/cli', '@lumenflow/core'],
      });
      expect(message).toContain('docs-only');
      expect(message).toContain('@lumenflow/cli');
      expect(message).toContain('@lumenflow/core');
    });

    it('handles single package in message', () => {
      const message = formatDocsOnlySkipMessage({
        mode: 'filtered',
        packages: ['@lumenflow/cli'],
      });
      expect(message).toContain('@lumenflow/cli');
    });
  });

  describe('loadCurrentWUCodePaths', () => {
    it('returns empty array when no WU is detected', () => {
      // When not in a WU branch, getCurrentWU returns null
      // This test verifies the function handles that gracefully
      const codePaths = loadCurrentWUCodePaths({ cwd: '/nonexistent/path' });
      expect(Array.isArray(codePaths)).toBe(true);
    });
  });
});

describe('gates cwd handling (WU-1558)', () => {
  it('does not mutate process cwd via process.chdir', () => {
    const gatesSourcePath = path.resolve(import.meta.dirname, '../src/gates.ts');
    const gatesSource = readFileSync(gatesSourcePath, 'utf-8');

    expect(gatesSource).not.toContain('process.chdir(');
  });
});

describe('workspace lint/typecheck script coverage (WU-1461)', () => {
  const repoRoot = path.resolve(import.meta.dirname, '../../../..');

  function listWorkspacePackageJsonFiles(): string[] {
    const packageJsonFiles: string[] = [];
    const workspaceRoots = ['packages/@lumenflow', 'apps'];

    for (const root of workspaceRoots) {
      const absoluteRoot = path.join(repoRoot, root);
      if (!existsSync(absoluteRoot)) {
        continue;
      }

      for (const entry of readdirSync(absoluteRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }
        const relativePath = path.join(root, entry.name, 'package.json');
        if (existsSync(path.join(repoRoot, relativePath))) {
          packageJsonFiles.push(relativePath);
        }
      }
    }

    return packageJsonFiles.sort();
  }

  it('requires all in-scope packages to define lint and typecheck scripts', () => {
    const inScopePackageJsonFiles = listWorkspacePackageJsonFiles();
    const missingScripts: string[] = [];

    for (const relativePath of inScopePackageJsonFiles) {
      const packageJsonPath = path.join(repoRoot, relativePath);
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
        scripts?: Record<string, string>;
      };
      const scripts = packageJson.scripts ?? {};

      if (!scripts.lint) {
        missingScripts.push(`${relativePath}: missing scripts.lint`);
      }
      if (!scripts.typecheck) {
        missingScripts.push(`${relativePath}: missing scripts.typecheck`);
      }
    }

    expect(missingScripts).toEqual([]);
  });
});

// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @fileoverview AST-based regression guard for banned runtime path literals.
 *
 * WU-2093 hardening goals:
 * - Detect banned literals from AST string/template nodes (no line-regex scanning)
 * - Cover all 7 runtime packages: core, cli, mcp, memory, initiatives, agent, metrics
 * - Keep explicit allowlists for constants/schema/template contexts
 */

import { describe, it, expect } from 'vitest';
import { glob } from 'glob';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

interface ScanTarget {
  label: string;
  dir: string;
}

interface ExtractedLiteral {
  line: number;
  snippet: string;
  value: string;
}

interface PathLiteralViolation {
  file: string;
  line: number;
  snippet: string;
  token: string;
}

interface BannedRule {
  token: string;
  matches: (value: string) => boolean;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

const SCAN_TARGETS: ScanTarget[] = [
  {
    label: 'core',
    dir: path.join(REPO_ROOT, 'packages', '@lumenflow', 'core', 'src'),
  },
  {
    label: 'cli',
    dir: path.join(REPO_ROOT, 'packages', '@lumenflow', 'cli', 'src'),
  },
  {
    label: 'mcp',
    dir: path.join(REPO_ROOT, 'packages', '@lumenflow', 'mcp', 'src'),
  },
  {
    label: 'memory',
    dir: path.join(REPO_ROOT, 'packages', '@lumenflow', 'memory', 'src'),
  },
  {
    label: 'initiatives',
    dir: path.join(REPO_ROOT, 'packages', '@lumenflow', 'initiatives', 'src'),
  },
  {
    label: 'agent',
    dir: path.join(REPO_ROOT, 'packages', '@lumenflow', 'agent', 'src'),
  },
  {
    label: 'metrics',
    dir: path.join(REPO_ROOT, 'packages', '@lumenflow', 'metrics', 'src'),
  },
];

const ALWAYS_ALLOWED_PATH_SEGMENTS = [
  '__tests__/',
  '__snapshots__/',
  '/e2e/',
  '/dist/',
  '/node_modules/',
  // Canonical path/constants/schema sources
  'wu-constants.ts',
  'wu-paths-constants.ts',
  'wu-git-constants.ts',
  'lumenflow-config.ts',
  'config-contract.ts',
  'lumenflow-config-schema.ts',
  'schemas/directories-config.ts',
  'domain/orchestration.constants.ts',
  // Template/generator files where literals are rendered for users/scripts
  'hooks/generators/',
  'init-templates.ts',
  'init-detection.ts',
  'onboarding-smoke-test.ts',
  'wu-spawn-prompt-builders.ts',
  'spawn-guidance-generators.ts',
  'lane-health.ts',
  // Helper modules with documentation-oriented path examples
  'lumenflow-home.ts',
  'wu-yaml.ts',
  'backlog-editor.ts',
  'code-paths-overlap.ts',
  'git-staged-validator.ts',
  'ports/context.ports.ts',
  'domain/context.schemas.ts',
];

const BANNED_RULES: BannedRule[] = [
  {
    token: 'docs/04-operations',
    matches: (value) => value.includes('docs/04-operations'),
  },
  {
    token: '.lumenflow/state',
    matches: (value) => value.includes('.lumenflow/state'),
  },
  {
    token: '.lumenflow.lane-inference.yaml',
    matches: (value) => value.includes('.lumenflow.lane-inference.yaml'),
  },
  {
    token: 'origin/main',
    matches: (value) => value.includes('origin/main'),
  },
  {
    token: 'worktrees/',
    matches: (value) => value.includes('worktrees/'),
  },
  {
    token: '.claude/skills',
    matches: (value) => value.includes('.claude/skills'),
  },
  {
    token: '.claude/agents',
    matches: (value) => value.includes('.claude/agents'),
  },
  {
    token: 'workspace.yaml',
    matches: (value) => hasWorkspaceYamlToken(value),
  },
  {
    token: '.git',
    matches: (value) => hasGitDirectoryToken(value),
  },
];

const EMBEDDED_TEMPLATE_GUARD_FILES = [
  path.join(REPO_ROOT, 'packages', '@lumenflow', 'core', 'src', 'spawn-constraints-generator.ts'),
  path.join(REPO_ROOT, 'packages', '@lumenflow', 'core', 'src', 'spawn-task-builder.ts'),
  path.join(REPO_ROOT, 'packages', '@lumenflow', 'core', 'src', 'spawn-agent-guidance.ts'),
];

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function hasWorkspaceYamlToken(value: string): boolean {
  return /(?:^|[^A-Za-z0-9_.-])workspace\.yaml(?:$|[^A-Za-z0-9_.-])/.test(value);
}

function hasGitDirectoryToken(value: string): boolean {
  return /(?:^|[^A-Za-z0-9_.-])\.git(?:$|[^A-Za-z0-9_.-])/.test(value);
}

function normalizeLiteralValue(value: string): string {
  return value.trim();
}

function isPathLikeLiteral(value: string): boolean {
  const normalized = normalizeLiteralValue(value);
  if (normalized.length === 0) return false;
  if (/\s/.test(normalized)) return false;
  if (!/[./]/.test(normalized)) return false;
  return /^[A-Za-z0-9_./:\\${}-]+$/.test(normalized);
}

function isAllowlistedFile(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return ALWAYS_ALLOWED_PATH_SEGMENTS.some((segment) => normalized.includes(segment));
}

async function getRuntimeSourceFiles(scanTarget: ScanTarget): Promise<string[]> {
  return glob('**/*.ts', {
    cwd: scanTarget.dir,
    absolute: true,
    ignore: [
      '**/__tests__/**',
      '**/__snapshots__/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/e2e/**',
    ],
  });
}

function getLineText(sourceText: string, line: number): string {
  const lines = sourceText.split('\n');
  return lines[line - 1]?.trim() ?? '';
}

function extractLiteralsFromAst(sourceText: string, fileName: string): ExtractedLiteral[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const extracted: ExtractedLiteral[] = [];

  const pushLiteral = (node: ts.Node, value: string): void => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    extracted.push({
      line,
      value,
      snippet: getLineText(sourceText, line),
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      pushLiteral(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      const renderedTemplate =
        node.head.text +
        node.templateSpans
          .map((span) => `\${${span.expression.getText(sourceFile)}}${span.literal.text}`)
          .join('');
      pushLiteral(node, renderedTemplate);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return extracted;
}

function scanSourceTextForBannedPathLiterals(
  sourceText: string,
  fileName: string,
): PathLiteralViolation[] {
  const literals = extractLiteralsFromAst(sourceText, fileName);
  const violations: PathLiteralViolation[] = [];

  for (const literal of literals) {
    const candidateValue = normalizeLiteralValue(literal.value);
    if (!isPathLikeLiteral(candidateValue)) {
      continue;
    }

    for (const rule of BANNED_RULES) {
      if (!rule.matches(candidateValue)) {
        continue;
      }

      violations.push({
        file: normalizePath(fileName),
        line: literal.line,
        snippet: literal.snippet,
        token: rule.token,
      });
      break;
    }
  }

  return violations;
}

function scanSourceTextForEmbeddedBannedPathTokens(
  sourceText: string,
  fileName: string,
): PathLiteralViolation[] {
  const literals = extractLiteralsFromAst(sourceText, fileName);
  const violations: PathLiteralViolation[] = [];

  for (const literal of literals) {
    const candidateValue = normalizeLiteralValue(literal.value);
    if (candidateValue.length === 0) {
      continue;
    }

    for (const rule of BANNED_RULES) {
      if (!rule.matches(candidateValue)) {
        continue;
      }

      violations.push({
        file: normalizePath(fileName),
        line: literal.line,
        snippet: literal.snippet,
        token: rule.token,
      });
      break;
    }
  }

  return violations;
}

function scanFileForBannedPathLiterals(filePath: string): PathLiteralViolation[] {
  if (isAllowlistedFile(filePath)) {
    return [];
  }

  const sourceText = readFileSync(filePath, 'utf-8');
  return scanSourceTextForBannedPathLiterals(sourceText, filePath);
}

function scanFileForEmbeddedBannedPathTokens(filePath: string): PathLiteralViolation[] {
  const sourceText = readFileSync(filePath, 'utf-8');
  return scanSourceTextForEmbeddedBannedPathTokens(sourceText, filePath);
}

function formatViolationReport(violations: PathLiteralViolation[]): string {
  return violations
    .map((v) => `  ${normalizePath(v.file)}:${v.line} [${v.token}] ${v.snippet}`)
    .join('\n');
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('/**')
  );
}

// Keep WU-1539 regression checks for local duplicate constants in CLI/initiatives.
const LOCAL_CONSTANT_PATTERN = /^const\s+(WU_EVENTS_PATH|WU_EVENTS_FILE|SIGNALS_FILE)\s*=/;
const INLINE_STAMP_TEMPLATE_PATTERN = /[`'"]\.lumenflow\/stamps\/\$\{/;

function scanFileForLegacyLocalConstantDebt(
  filePath: string,
): Array<{ line: number; content: string; pattern: string }> {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations: Array<{ line: number; content: string; pattern: string }> = [];

  lines.forEach((line, index) => {
    if (isCommentLine(line)) return;

    if (LOCAL_CONSTANT_PATTERN.test(line.trim())) {
      violations.push({
        line: index + 1,
        content: line.trim(),
        pattern: 'local wu-events constant',
      });
    }

    if (INLINE_STAMP_TEMPLATE_PATTERN.test(line)) {
      violations.push({
        line: index + 1,
        content: line.trim(),
        pattern: 'inline stamp path',
      });
    }
  });

  return violations;
}

async function getCliAndInitiativesRuntimeFiles(): Promise<string[]> {
  const files: string[] = [];

  for (const target of SCAN_TARGETS.filter((t) => t.label === 'cli' || t.label === 'initiatives')) {
    const matched = await getRuntimeSourceFiles(target);
    files.push(...matched);
  }

  return files;
}

// ---------------------------------------------------------------------------
// WU-2113: LUMENFLOW_ env var literal guard
// ---------------------------------------------------------------------------

/**
 * Files that canonically define LUMENFLOW_* env var name strings.
 * These are excluded from env var literal scanning.
 */
const ENV_VAR_ALLOWLIST_SEGMENTS = [
  '__tests__/',
  '__snapshots__/',
  '/e2e/',
  '/dist/',
  '/node_modules/',
  // Canonical env var constant definitions
  'wu-context-constants.ts',
  // Files that already define local constants for env var names
  'force-bypass-audit.ts',
  'micro-worktree-shared.ts',
  'lumenflow-home.ts',
  'cloud-detect.ts',
  'wu-recovery.ts',
  'test-baseline.ts',
  'spawn-prompt-schema.ts',
  // CLI files with local env var constants
  'release.ts',
  'wu-sandbox.ts',
  'onboard.ts',
  'initiative-bulk-assign-wus.ts',
  'pack-publish.ts',
  // Shims package (defines its own env var constants in Zod schemas)
  'shims/src/types.ts',
  // MCP package constants
  'mcp-constants.ts',
  // Packs: software-delivery tool implementations with local constants
  'tool-impl/git-runner.ts',
  // Control plane SDK constants
  'sync-port.ts',
  // Template/generator/hook files where env var names appear in rendered output
  'hooks/generators/',
  'init-templates.ts',
  'init-detection.ts',
  // wu-context-constants already in path allowlist but explicit for clarity
  'wu-constants.ts',
];

/** Matches LUMENFLOW_<WORD> env var name patterns in string literals.
 * Does NOT match shell variable references like $LUMENFLOW_HOME. */
const LUMENFLOW_ENV_VAR_PATTERN = /(?<!\$)\bLUMENFLOW_[A-Z][A-Z0-9_]*\b/;

/**
 * Matches known non-env-var LUMENFLOW_ prefixed strings that should not
 * be flagged. These are error codes, sentinel tokens, internal identifiers,
 * and similar constants that use the LUMENFLOW_ prefix but are NOT
 * environment variable names.
 */
const LUMENFLOW_NON_ENV_EXCEPTIONS = [
  // MCP/pack error codes (LUMENFLOW_*_ERROR pattern)
  /^LUMENFLOW_\w+_ERROR$/,
  // Spawn sentinel tokens
  /^LUMENFLOW_SPAWN_(?:END|COMPLETE)$/,
  // Truncation warning sentinel
  /^LUMENFLOW_TRUNCATION_WARNING$/,
  // Framework scope/path constants (code identifiers, not env vars)
  /^LUMENFLOW_PATHS$/,
  /^LUMENFLOW_PACKAGES$/,
  /^LUMENFLOW_DIR$/,
  /^LUMENFLOW_AGENTS_DIR$/,
  /^LUMENFLOW_CLIENT_IDS$/,
  /^LUMENFLOW_SCOPE_NAME$/,
  /^LUMENFLOW_DIR_NAME$/,
  /^LUMENFLOW_HOME_ENV$/,
  /^LUMENFLOW_FORCE_ENV$/,
  /^LUMENFLOW_FORCE_REASON_ENV$/,
  /^LUMENFLOW_WU_TOOL_ENV$/,
  /^LUMENFLOW_CLOUD_ENV$/,
  /^LUMENFLOW_LEGACY_ROLLBACK_ENV_KEY$/,
];

interface EnvVarBaselineData {
  description: string;
  wuId: string;
  lastUpdated: string;
  baseline: number;
  note: string;
}

const ENV_VAR_BASELINE_PATH = path.join(
  REPO_ROOT,
  'tools',
  'baselines',
  'enforcement',
  'lumenflow-env-var-baseline.json',
);

function isEnvVarAllowlistedFile(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return ENV_VAR_ALLOWLIST_SEGMENTS.some((segment) => normalized.includes(segment));
}

function isNonEnvVarException(value: string): boolean {
  return LUMENFLOW_NON_ENV_EXCEPTIONS.some((pattern) => pattern.test(value));
}

/**
 * Scans source text for raw LUMENFLOW_* env var references.
 * Detects both:
 * 1. String literals containing LUMENFLOW_* env var names (e.g., 'LUMENFLOW_FORCE')
 * 2. Property access on process.env (e.g., process.env.LUMENFLOW_HEADLESS)
 *
 * Unlike path literal scanning, this does NOT require isPathLikeLiteral
 * because env var names don't contain '/' or '.'.
 */
function scanSourceTextForEnvVarLiterals(
  sourceText: string,
  fileName: string,
): PathLiteralViolation[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const violations: PathLiteralViolation[] = [];

  const pushViolation = (node: ts.Node): void => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    violations.push({
      file: normalizePath(fileName),
      line,
      snippet: getLineText(sourceText, line),
      token: 'LUMENFLOW_',
    });
  };

  const visit = (node: ts.Node): void => {
    // Case 1: String literals containing LUMENFLOW_ env var patterns
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const value = node.text;
      if (LUMENFLOW_ENV_VAR_PATTERN.test(value)) {
        const match = value.match(/\bLUMENFLOW_[A-Z][A-Z0-9_]*\b/);
        if (!match || !isNonEnvVarException(match[0])) {
          pushViolation(node);
        }
      }
    } else if (ts.isTemplateExpression(node)) {
      const renderedTemplate =
        node.head.text +
        node.templateSpans
          .map((span) => `\${${span.expression.getText(sourceFile)}}${span.literal.text}`)
          .join('');
      if (LUMENFLOW_ENV_VAR_PATTERN.test(renderedTemplate)) {
        const match = renderedTemplate.match(/\bLUMENFLOW_[A-Z][A-Z0-9_]*\b/);
        if (!match || !isNonEnvVarException(match[0])) {
          pushViolation(node);
        }
      }
    }

    // Case 2: Property access - process.env.LUMENFLOW_*
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.name) &&
      LUMENFLOW_ENV_VAR_PATTERN.test(node.name.text) &&
      !isNonEnvVarException(node.name.text)
    ) {
      // Check that the parent is process.env.*
      const expr = node.expression;
      if (
        ts.isPropertyAccessExpression(expr) &&
        ts.isIdentifier(expr.expression) &&
        expr.expression.text === 'process' &&
        ts.isIdentifier(expr.name) &&
        expr.name.text === 'env'
      ) {
        pushViolation(node);
      }
    }

    // Case 3: Element access - process.env['LUMENFLOW_*']
    // Already caught by Case 1 (string literal inside brackets)

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

function scanFileForEnvVarLiterals(filePath: string): PathLiteralViolation[] {
  if (isEnvVarAllowlistedFile(filePath)) {
    return [];
  }

  const sourceText = readFileSync(filePath, 'utf-8');
  return scanSourceTextForEnvVarLiterals(sourceText, filePath);
}

function loadEnvVarBaseline(): number | null {
  if (!existsSync(ENV_VAR_BASELINE_PATH)) {
    return null;
  }

  const raw = readFileSync(ENV_VAR_BASELINE_PATH, 'utf-8');
  const data = JSON.parse(raw) as EnvVarBaselineData;

  if (typeof data.baseline !== 'number') {
    return null;
  }

  return data.baseline;
}

function persistEnvVarBaseline(count: number): void {
  const data: EnvVarBaselineData = {
    description:
      'Ratcheting baseline for raw LUMENFLOW_* env var string literals. Count must not increase.',
    wuId: 'WU-2113',
    lastUpdated: new Date().toISOString().split('T')[0],
    baseline: count,
    note: `Computed from codebase scan. ${count} raw LUMENFLOW_ env var literals across production files.`,
  };

  writeFileSync(ENV_VAR_BASELINE_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

describe('WU-2093: AST path literal guard foundations', () => {
  it('detects banned literals in string and template literals', () => {
    const source = [
      "const docsPath = 'docs/04-operations/tasks/backlog.md';",
      'const worktreePath = `worktrees/${lane}`;',
      "const laneInference = '.lumenflow.lane-inference.yaml';",
      "const gitDir = '.git';",
    ].join('\n');

    const violations = scanSourceTextForBannedPathLiterals(source, 'fixtures/violation.ts');
    const tokens = violations.map((v) => v.token);

    expect(tokens).toContain('docs/04-operations');
    expect(tokens).toContain('worktrees/');
    expect(tokens).toContain('.lumenflow.lane-inference.yaml');
    expect(tokens).toContain('.git');
  });

  it('does not flag workspace.yaml boundary false positives', () => {
    const source = [
      "const pnpmWorkspace = 'pnpm-workspace.yaml';",
      "const configFile = 'workspace.yaml';",
      "const githubWorkflow = '.github/workflows/release.yaml';",
      "const gitDirectory = '.git';",
    ].join('\n');

    const violations = scanSourceTextForBannedPathLiterals(
      source,
      'fixtures/workspace-boundary.ts',
    );
    const workspaceViolations = violations.filter((v) => v.token === 'workspace.yaml');
    const gitViolations = violations.filter((v) => v.token === '.git');

    expect(workspaceViolations).toHaveLength(1);
    expect(workspaceViolations[0]?.snippet).toContain("'workspace.yaml'");
    expect(gitViolations).toHaveLength(1);
    expect(gitViolations[0]?.snippet).toContain("'.git'");
  });

  it('respects explicit allowlisted file contexts', () => {
    const source = "const pathToken = 'docs/04-operations/tasks/wu';";
    const allowlistedFile = path.join(
      REPO_ROOT,
      'packages',
      '@lumenflow',
      'core',
      'src',
      'schemas',
      'directories-config.ts',
    );

    const violations = isAllowlistedFile(allowlistedFile)
      ? []
      : scanSourceTextForBannedPathLiterals(source, allowlistedFile);

    expect(violations).toHaveLength(0);
  });

  it('detects banned tokens embedded in multiline template literals', () => {
    const source = [
      'const gitGuidance = `',
      '  Start by rebasing on origin/main',
      '`;',
      'const worktreeGuidance = `',
      '  Then continue from worktrees/<lane>-wu-123',
      '`;',
    ].join('\n');

    const violations = scanSourceTextForEmbeddedBannedPathTokens(
      source,
      'fixtures/multiline-template.ts',
    );
    const tokens = violations.map((v) => v.token);

    expect(tokens).toContain('origin/main');
    expect(tokens).toContain('worktrees/');
  });
});

describe('WU-2093: AST path literal regression guard', () => {
  it('scans all 7 runtime packages for banned literals', async () => {
    const filesPerTarget = await Promise.all(
      SCAN_TARGETS.map(async (target) => {
        const files = await getRuntimeSourceFiles(target);
        return { target: target.label, files };
      }),
    );

    for (const target of filesPerTarget) {
      expect(target.files.length, `No files discovered for ${target.target}`).toBeGreaterThan(0);
    }

    const allViolations: PathLiteralViolation[] = [];
    for (const { files } of filesPerTarget) {
      for (const file of files) {
        const violations = scanFileForBannedPathLiterals(file);
        allViolations.push(...violations);
      }
    }

    if (allViolations.length > 0) {
      expect.fail(
        `Found ${allViolations.length} banned runtime path literal(s).\n\n` +
          `Use getConfig()/createWuPaths()/shared constants instead of inline literals.\n` +
          `Violations:\n${formatViolationReport(allViolations)}`,
      );
    }

    expect(allViolations).toHaveLength(0);
  });

  it('scans core spawn template generators for embedded banned path tokens', () => {
    const violations: PathLiteralViolation[] = [];

    for (const filePath of EMBEDDED_TEMPLATE_GUARD_FILES) {
      violations.push(...scanFileForEmbeddedBannedPathTokens(filePath));
    }

    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} embedded banned token(s) in core spawn template generators.\n\n` +
          `These files render runtime prompt text and must remain config/constant driven.\n` +
          `Violations:\n${formatViolationReport(violations)}`,
      );
    }

    expect(violations).toHaveLength(0);
  });
});

describe('WU-1539: legacy local constant guards', () => {
  it('rejects local wu-events/signal constants and inline stamp templates in CLI+initiatives runtime files', async () => {
    const files = await getCliAndInitiativesRuntimeFiles();
    const allViolations: Array<{
      file: string;
      violations: Array<{ line: number; content: string; pattern: string }>;
    }> = [];

    for (const file of files) {
      if (isAllowlistedFile(file)) {
        continue;
      }

      const violations = scanFileForLegacyLocalConstantDebt(file);
      if (violations.length > 0) {
        allViolations.push({
          file: normalizePath(path.relative(REPO_ROOT, file)),
          violations,
        });
      }
    }

    if (allViolations.length > 0) {
      const report = allViolations
        .map(({ file, violations }) => {
          const detail = violations
            .map((v) => `    line ${v.line} [${v.pattern}] ${v.content}`)
            .join('\n');
          return `  ${file}:\n${detail}`;
        })
        .join('\n\n');

      expect.fail(
        `Found ${allViolations.length} file(s) with legacy local path constant debt.\n\n` +
          `Use LUMENFLOW_PATHS/WU_PATHS shared constants.\n` +
          `Violations:\n${report}`,
      );
    }

    expect(allViolations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// WU-2114: File extension literal guard
// ---------------------------------------------------------------------------

/**
 * Files that canonically define file extension constants or legitimately
 * use bare extension strings. These are excluded from file extension scanning.
 */
const FILE_EXT_ALLOWLIST_SEGMENTS = [
  '__tests__/',
  '__snapshots__/',
  '/e2e/',
  '/dist/',
  '/node_modules/',
  // Canonical file extension constant definitions
  'wu-paths-constants.ts',
  // Files that define local extension-related constants
  'wu-constants.ts',
  'config-contract.ts',
  'lumenflow-config.ts',
  'lumenflow-config-schema.ts',
  // Template/generator files where extension strings appear in rendered output
  'hooks/generators/',
  'init-templates.ts',
  'init-detection.ts',
  // CLI files with extension-related logic
  'onboarding-smoke-test.ts',
  // Schema/domain files that reference file patterns
  'schemas/directories-config.ts',
  'domain/orchestration.constants.ts',
  'spawn-prompt-schema.ts',
  // Docs layout preset definitions
  'docs-layout-presets.ts',
];

/**
 * Matches bare file extension strings — strings that are EXACTLY a dot
 * followed by a known extension. Does NOT match paths containing extensions
 * (e.g., 'foo.yaml', '/path/to/file.json', 'README.md content').
 */
const BARE_FILE_EXTENSION_PATTERN = /^\.(yaml|yml|json|md|ts|js|mjs|cjs)$/;

interface FileExtBaselineData {
  description: string;
  wuId: string;
  lastUpdated: string;
  baseline: number;
  note: string;
}

const FILE_EXT_BASELINE_PATH = path.join(
  REPO_ROOT,
  'tools',
  'baselines',
  'enforcement',
  'file-extension-baseline.json',
);

function isFileExtAllowlistedFile(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return FILE_EXT_ALLOWLIST_SEGMENTS.some((segment) => normalized.includes(segment));
}

/**
 * Scans source text for bare file extension string literals.
 * Detects string literals that are exactly a bare extension (e.g., '.yaml', '.json').
 * Does NOT flag paths containing extensions (e.g., 'config.yaml', '/path/to/file.json').
 */
function scanSourceTextForFileExtLiterals(
  sourceText: string,
  fileName: string,
): PathLiteralViolation[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const violations: PathLiteralViolation[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const value = node.text;
      if (BARE_FILE_EXTENSION_PATTERN.test(value)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        violations.push({
          file: normalizePath(fileName),
          line,
          snippet: getLineText(sourceText, line),
          token: '.ext literal',
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

function scanFileForFileExtLiterals(filePath: string): PathLiteralViolation[] {
  if (isFileExtAllowlistedFile(filePath)) {
    return [];
  }

  const sourceText = readFileSync(filePath, 'utf-8');
  return scanSourceTextForFileExtLiterals(sourceText, filePath);
}

function loadFileExtBaseline(): number | null {
  if (!existsSync(FILE_EXT_BASELINE_PATH)) {
    return null;
  }

  const raw = readFileSync(FILE_EXT_BASELINE_PATH, 'utf-8');
  const data = JSON.parse(raw) as FileExtBaselineData;

  if (typeof data.baseline !== 'number') {
    return null;
  }

  return data.baseline;
}

function persistFileExtBaseline(count: number): void {
  const data: FileExtBaselineData = {
    description:
      'Ratcheting baseline for bare file extension string literals. Count must not increase.',
    wuId: 'WU-2114',
    lastUpdated: new Date().toISOString().split('T')[0],
    baseline: count,
    note: `Computed from codebase scan. ${count} bare file extension literals across production files.`,
  };

  writeFileSync(FILE_EXT_BASELINE_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function shouldPersistRatchetingBaseline(
  savedBaseline: number | null,
  currentCount: number,
  isExplicitUpdate: boolean,
): boolean {
  const isFirstRun = savedBaseline === null;
  const isImprovement = savedBaseline !== null && currentCount < savedBaseline;
  return isFirstRun || isImprovement || isExplicitUpdate;
}

describe('WU-2114: file extension literal guard foundations', () => {
  it('detects bare file extension strings', () => {
    const source = [
      "const ext = '.yaml';",
      "const jsonExt = '.json';",
      "const mdExt = '.md';",
      "const tsExt = '.ts';",
      "const jsExt = '.js';",
      "const ymlExt = '.yml';",
      "const mjsExt = '.mjs';",
      "const cjsExt = '.cjs';",
    ].join('\n');

    const violations = scanSourceTextForFileExtLiterals(source, 'fixtures/ext-violation.ts');
    expect(violations).toHaveLength(8);
    expect(violations.every((v) => v.token === '.ext literal')).toBe(true);
  });

  it('does not flag paths containing file extensions', () => {
    const source = [
      "const configPath = 'config.yaml';",
      "const filePath = '/path/to/file.json';",
      "const readme = 'README.md';",
      "const script = 'index.ts';",
      "const module = 'app.module.js';",
      "const fullPath = 'docs/04-operations/tasks/wu/WU-123.yaml';",
    ].join('\n');

    const violations = scanSourceTextForFileExtLiterals(source, 'fixtures/ext-paths.ts');
    expect(violations).toHaveLength(0);
  });

  it('does not flag non-extension dot strings', () => {
    const source = [
      "const version = '.1';",
      "const hidden = '.git';",
      "const dotFile = '.env';",
      "const partial = '.lumenflow';",
    ].join('\n');

    const violations = scanSourceTextForFileExtLiterals(source, 'fixtures/non-ext.ts');
    expect(violations).toHaveLength(0);
  });

  it('catches .endsWith style patterns in test scan', () => {
    const source = [
      "if (file.endsWith('.yaml')) { doSomething(); }",
      "const isJson = name.endsWith('.json');",
      "const isMd = path.endsWith('.md');",
    ].join('\n');

    const violations = scanSourceTextForFileExtLiterals(source, 'fixtures/endswith.ts');
    expect(violations).toHaveLength(3);
  });

  it('respects file extension allowlisted files', () => {
    const allowlistedFile = path.join(
      REPO_ROOT,
      'packages',
      '@lumenflow',
      'core',
      'src',
      'wu-paths-constants.ts',
    );

    expect(isFileExtAllowlistedFile(allowlistedFile)).toBe(true);
  });

  it('does not allowlist arbitrary files', () => {
    const regularFile = path.join(
      REPO_ROOT,
      'packages',
      '@lumenflow',
      'core',
      'src',
      'some-module.ts',
    );

    expect(isFileExtAllowlistedFile(regularFile)).toBe(false);
  });
});

describe('WU-2114: file extension ratcheting regression guard', () => {
  it('scans all 7 runtime packages for bare file extension literals', async () => {
    const filesPerTarget = await Promise.all(
      SCAN_TARGETS.map(async (target) => {
        const files = await getRuntimeSourceFiles(target);
        return { target: target.label, files };
      }),
    );

    // Verify all scan targets discovered files
    for (const target of filesPerTarget) {
      expect(
        target.files.length,
        `No source files discovered for ${target.target}`,
      ).toBeGreaterThan(0);
    }

    // Collect all violations
    const allViolations: PathLiteralViolation[] = [];
    for (const { files } of filesPerTarget) {
      for (const file of files) {
        const violations = scanFileForFileExtLiterals(file);
        allViolations.push(...violations);
      }
    }

    const currentCount = allViolations.length;
    const savedBaseline = loadFileExtBaseline();

    // WU-2131: Compare before writes. Regression failure must not mutate baseline.
    if (savedBaseline !== null && currentCount > savedBaseline) {
      expect.fail(
        `File extension literal ratchet FAILED: count increased from ${savedBaseline} to ${currentCount} ` +
          `(+${currentCount - savedBaseline}).\n\n` +
          `New bare file extension literals detected. Use FILE_EXTENSIONS constant from wu-paths-constants.ts instead.\n` +
          `To intentionally update the baseline after a deliberate migration:\n` +
          `  UPDATE_BASELINE=true pnpm --filter @lumenflow/core exec vitest run src/__tests__/path-literal-guard.test.ts -t "file extension ratcheting regression guard"\n\n` +
          `Violations:\n${formatViolationReport(allViolations)}`,
      );
    }

    if (savedBaseline !== null) {
      // Log ratchet status for visibility
      const delta = savedBaseline - currentCount;
      const status = delta > 0 ? `IMPROVED: reduced by ${delta}` : 'STABLE: no change';
      console.log(
        `File extension ratchet: ${currentCount} (baseline: ${savedBaseline}) -- ${status}`,
      );
    } else {
      // First run: baseline established
      console.log(`File extension ratchet: baseline established at ${currentCount} references`);
    }

    const isExplicitUpdate = process.env.UPDATE_BASELINE === 'true';
    if (shouldPersistRatchetingBaseline(savedBaseline, currentCount, isExplicitUpdate)) {
      persistFileExtBaseline(currentCount);
      if (isExplicitUpdate && savedBaseline !== null && currentCount === savedBaseline) {
        console.log(`File extension ratchet: baseline explicitly updated to ${currentCount}`);
      }
    }

    // The test itself passes as long as count does not increase
    expect(currentCount).toBeGreaterThanOrEqual(0);
  });

  it('would fail if a new bare file extension literal were added', () => {
    const existingSource = "const safe = 'hello';";
    const newSource = [existingSource, "const ext = '.yaml';"].join('\n');

    const existingViolations = scanSourceTextForFileExtLiterals(
      existingSource,
      'fixtures/existing.ts',
    );
    const newViolations = scanSourceTextForFileExtLiterals(newSource, 'fixtures/new.ts');

    // Adding a bare file extension literal increases the count
    expect(newViolations.length).toBeGreaterThan(existingViolations.length);
  });
});

describe('WU-2113: LUMENFLOW_ env var literal guard foundations', () => {
  it('detects raw LUMENFLOW_ env var string literals', () => {
    const source = [
      'const headless = process.env.LUMENFLOW_HEADLESS;',
      "const force = 'LUMENFLOW_FORCE';",
      "if (process.env.LUMENFLOW_ADMIN === '1') {}",
    ].join('\n');

    const violations = scanSourceTextForEnvVarLiterals(source, 'fixtures/env-var-violation.ts');
    expect(violations).toHaveLength(3);
    expect(violations.every((v) => v.token === 'LUMENFLOW_')).toBe(true);
  });

  it('does not flag LUMENFLOW_ error codes (non-env-var patterns)', () => {
    const source = [
      "const errorCode = 'LUMENFLOW_INIT_ERROR';",
      "const gatesError = 'LUMENFLOW_GATES_ERROR';",
      "const validateError = 'LUMENFLOW_VALIDATE_ERROR';",
    ].join('\n');

    const violations = scanSourceTextForEnvVarLiterals(source, 'fixtures/error-codes.ts');
    expect(violations).toHaveLength(0);
  });

  it('does not flag LUMENFLOW_ sentinel tokens', () => {
    const source = [
      "const sentinel = 'LUMENFLOW_SPAWN_END';",
      "const complete = 'LUMENFLOW_SPAWN_COMPLETE';",
      "const warning = 'LUMENFLOW_TRUNCATION_WARNING';",
    ].join('\n');

    const violations = scanSourceTextForEnvVarLiterals(source, 'fixtures/sentinels.ts');
    expect(violations).toHaveLength(0);
  });

  it('detects env vars in template literals', () => {
    const source = 'const msg = `env: LUMENFLOW_FORCE`;';

    const violations = scanSourceTextForEnvVarLiterals(source, 'fixtures/template-env.ts');
    expect(violations).toHaveLength(1);
  });

  it('respects env var allowlisted files', () => {
    const allowlistedFile = path.join(
      REPO_ROOT,
      'packages',
      '@lumenflow',
      'core',
      'src',
      'wu-context-constants.ts',
    );

    expect(isEnvVarAllowlistedFile(allowlistedFile)).toBe(true);
  });

  it('does not allowlist arbitrary files', () => {
    const regularFile = path.join(
      REPO_ROOT,
      'packages',
      '@lumenflow',
      'core',
      'src',
      'some-module.ts',
    );

    expect(isEnvVarAllowlistedFile(regularFile)).toBe(false);
  });
});

describe('WU-2113: LUMENFLOW_ env var ratcheting regression guard', () => {
  it('scans all 7 runtime packages for raw LUMENFLOW_ env var literals', async () => {
    const filesPerTarget = await Promise.all(
      SCAN_TARGETS.map(async (target) => {
        const files = await getRuntimeSourceFiles(target);
        return { target: target.label, files };
      }),
    );

    // Verify all scan targets discovered files
    for (const target of filesPerTarget) {
      expect(
        target.files.length,
        `No source files discovered for ${target.target}`,
      ).toBeGreaterThan(0);
    }

    // Collect all violations
    const allViolations: PathLiteralViolation[] = [];
    for (const { files } of filesPerTarget) {
      for (const file of files) {
        const violations = scanFileForEnvVarLiterals(file);
        allViolations.push(...violations);
      }
    }

    const currentCount = allViolations.length;
    const savedBaseline = loadEnvVarBaseline();

    // WU-2131: Compare before writes. Regression failure must not mutate baseline.
    if (savedBaseline !== null && currentCount > savedBaseline) {
      expect.fail(
        `LUMENFLOW_ env var literal ratchet FAILED: count increased from ${savedBaseline} to ${currentCount} ` +
          `(+${currentCount - savedBaseline}).\n\n` +
          `New raw LUMENFLOW_ env var literals detected. Use ENV_VARS constant from wu-context-constants.ts instead.\n` +
          `To intentionally update the baseline after a deliberate migration:\n` +
          `  UPDATE_BASELINE=true pnpm --filter @lumenflow/core exec vitest run src/__tests__/path-literal-guard.test.ts -t "LUMENFLOW_ env var ratcheting regression guard"\n\n` +
          `Violations:\n${formatViolationReport(allViolations)}`,
      );
    }

    if (savedBaseline !== null) {
      // Log ratchet status for visibility
      const delta = savedBaseline - currentCount;
      const status = delta > 0 ? `IMPROVED: reduced by ${delta}` : 'STABLE: no change';
      console.log(
        `LUMENFLOW_ env var ratchet: ${currentCount} (baseline: ${savedBaseline}) -- ${status}`,
      );
    } else {
      // First run: baseline established
      console.log(`LUMENFLOW_ env var ratchet: baseline established at ${currentCount} references`);
    }

    const isExplicitUpdate = process.env.UPDATE_BASELINE === 'true';
    if (shouldPersistRatchetingBaseline(savedBaseline, currentCount, isExplicitUpdate)) {
      persistEnvVarBaseline(currentCount);
      if (isExplicitUpdate && savedBaseline !== null && currentCount === savedBaseline) {
        console.log(`LUMENFLOW_ env var ratchet: baseline explicitly updated to ${currentCount}`);
      }
    }

    // The test itself passes as long as count does not increase
    expect(currentCount).toBeGreaterThanOrEqual(0);
  });

  it('would fail if a new raw LUMENFLOW_ env var literal were added', () => {
    const existingSource = "const safe = 'hello';";
    const newSource = [existingSource, 'const headless = process.env.LUMENFLOW_HEADLESS;'].join(
      '\n',
    );

    const existingViolations = scanSourceTextForEnvVarLiterals(
      existingSource,
      'fixtures/existing.ts',
    );
    const newViolations = scanSourceTextForEnvVarLiterals(newSource, 'fixtures/new.ts');

    // Adding a raw LUMENFLOW_ env var literal increases the count
    expect(newViolations.length).toBeGreaterThan(existingViolations.length);
  });
});

describe('WU-2131: path-literal ratchet baseline persistence policy', () => {
  it('persists on first run, improvement, or explicit update', () => {
    expect(shouldPersistRatchetingBaseline(null, 10, false)).toBe(true);
    expect(shouldPersistRatchetingBaseline(10, 9, false)).toBe(true);
    expect(shouldPersistRatchetingBaseline(10, 10, true)).toBe(true);
  });

  it('does not persist on unchanged or regressed counts without explicit update', () => {
    expect(shouldPersistRatchetingBaseline(10, 10, false)).toBe(false);
    expect(shouldPersistRatchetingBaseline(10, 11, false)).toBe(false);
  });

  it('keeps file extension regression check before baseline write in source order', () => {
    const sourceText = readFileSync(path.join(__dirname, 'path-literal-guard.test.ts'), 'utf-8');
    const failIndex = sourceText.indexOf('File extension literal ratchet FAILED');
    const persistAfterFailIndex = sourceText.indexOf(
      'persistFileExtBaseline(currentCount)',
      failIndex,
    );

    expect(failIndex).toBeGreaterThan(-1);
    expect(persistAfterFailIndex).toBeGreaterThan(failIndex);
  });

  it('keeps env-var regression check before baseline write in source order', () => {
    const sourceText = readFileSync(path.join(__dirname, 'path-literal-guard.test.ts'), 'utf-8');
    const failIndex = sourceText.indexOf('LUMENFLOW_ env var literal ratchet FAILED');
    const persistAfterFailIndex = sourceText.indexOf(
      'persistEnvVarBaseline(currentCount)',
      failIndex,
    );

    expect(failIndex).toBeGreaterThan(-1);
    expect(persistAfterFailIndex).toBeGreaterThan(failIndex);
  });
});

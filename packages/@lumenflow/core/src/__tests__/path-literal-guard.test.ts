// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @fileoverview AST-based regression guard for banned runtime path literals.
 *
 * WU-2093 hardening goals:
 * - Detect banned literals from AST string/template nodes (no line-regex scanning)
 * - Cover core, cli, mcp, memory, and initiatives runtime packages
 * - Keep explicit allowlists for constants/schema/template contexts
 */

import { describe, it, expect } from 'vitest';
import { glob } from 'glob';
import { readFileSync } from 'node:fs';
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

/**
 * Temporary explicit allowlist for known INIT-036 migration debt.
 * These files are being migrated by WU-2088..WU-2092 and should be removed from
 * this list as those WUs land.
 */
const INIT_036_PENDING_ALLOWLIST = new Set<string>([
  'packages/@lumenflow/cli/src/config-set.ts',
  'packages/@lumenflow/cli/src/docs-sync.ts',
  'packages/@lumenflow/cli/src/doctor.ts',
  'packages/@lumenflow/cli/src/gates-runners.ts',
  'packages/@lumenflow/cli/src/gates-utils.ts',
  'packages/@lumenflow/cli/src/hooks/enforcement-checks.ts',
  'packages/@lumenflow/cli/src/init-lane-validation.ts',
  'packages/@lumenflow/cli/src/mem-checkpoint.ts',
  'packages/@lumenflow/cli/src/workspace-init.ts',
  'packages/@lumenflow/cli/src/wu-block.ts',
  'packages/@lumenflow/cli/src/wu-claim-resume-handler.ts',
  'packages/@lumenflow/cli/src/wu-claim.ts',
  'packages/@lumenflow/cli/src/wu-done-auto-cleanup.ts',
  'packages/@lumenflow/cli/src/wu-edit-validators.ts',
  'packages/@lumenflow/cli/src/wu-edit.ts',
  'packages/@lumenflow/cli/src/wu-recover.ts',
  'packages/@lumenflow/cli/src/wu-release.ts',
  'packages/@lumenflow/cli/src/wu-spawn-strategy-resolver.ts',
  'packages/@lumenflow/cli/src/wu-unblock.ts',
  'packages/@lumenflow/mcp/src/runtime-tool-resolver.ts',
  'packages/@lumenflow/mcp/src/worktree-enforcement.ts',
  'packages/@lumenflow/memory/src/mem-create-core.ts',
  'packages/@lumenflow/memory/src/paths.ts',
]);

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
];

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function hasWorkspaceYamlToken(value: string): boolean {
  return /(?:^|[^A-Za-z0-9_.-])workspace\.yaml(?:$|[^A-Za-z0-9_.-])/.test(value);
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
  const repoRelative = normalizePath(path.relative(REPO_ROOT, filePath));
  if (INIT_036_PENDING_ALLOWLIST.has(repoRelative)) {
    return true;
  }

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

function scanFileForBannedPathLiterals(filePath: string): PathLiteralViolation[] {
  if (isAllowlistedFile(filePath)) {
    return [];
  }

  const sourceText = readFileSync(filePath, 'utf-8');
  return scanSourceTextForBannedPathLiterals(sourceText, filePath);
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

describe('WU-2093: AST path literal guard foundations', () => {
  it('detects banned literals in string and template literals', () => {
    const source = [
      "const docsPath = 'docs/04-operations/tasks/backlog.md';",
      'const worktreePath = `worktrees/${lane}`;',
      "const laneInference = '.lumenflow.lane-inference.yaml';",
    ].join('\n');

    const violations = scanSourceTextForBannedPathLiterals(source, 'fixtures/violation.ts');
    const tokens = violations.map((v) => v.token);

    expect(tokens).toContain('docs/04-operations');
    expect(tokens).toContain('worktrees/');
    expect(tokens).toContain('.lumenflow.lane-inference.yaml');
  });

  it('does not flag workspace.yaml boundary false positives', () => {
    const source = [
      "const pnpmWorkspace = 'pnpm-workspace.yaml';",
      "const configFile = 'workspace.yaml';",
    ].join('\n');

    const violations = scanSourceTextForBannedPathLiterals(
      source,
      'fixtures/workspace-boundary.ts',
    );
    const workspaceViolations = violations.filter((v) => v.token === 'workspace.yaml');

    expect(workspaceViolations).toHaveLength(1);
    expect(workspaceViolations[0]?.snippet).toContain("'workspace.yaml'");
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
});

describe('WU-2093: AST path literal regression guard', () => {
  it('scans core/cli/mcp/memory/initiatives runtime files for banned literals', async () => {
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

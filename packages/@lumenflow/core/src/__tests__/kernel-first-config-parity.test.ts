// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { glob } from 'glob';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LEGACY_CONFIG_FILE_NAME = '.lumenflow.config.yaml';

const GLOB_PATTERNS = {
  RUNTIME_TESTS: 'packages/@lumenflow/**/__tests__/**/*.{ts,tsx,js,mjs,cjs}',
  RUNTIME_E2E: 'packages/@lumenflow/**/e2e/**/*.{ts,tsx,js,mjs,cjs}',
  PUBLIC_DOCS: 'apps/docs/src/content/docs/**/*.{md,mdx}',
  INTERNAL_FRAMEWORK_DOCS: 'docs/04-operations/_frameworks/lumenflow/**/*.{md,mdx,yml,yaml}',
} as const;

const IGNORE_PATTERNS = ['**/dist/**', '**/node_modules/**', '**/__snapshots__/**'] as const;

const SOURCE_GROUPS = [
  {
    label: 'runtime-adjacent tests',
    patterns: [GLOB_PATTERNS.RUNTIME_TESTS, GLOB_PATTERNS.RUNTIME_E2E],
  },
  {
    label: 'public docs',
    patterns: [GLOB_PATTERNS.PUBLIC_DOCS],
  },
  {
    label: 'internal framework docs',
    patterns: [GLOB_PATTERNS.INTERNAL_FRAMEWORK_DOCS],
  },
] as const;

type Violation = {
  file: string;
  line: number;
  label: string;
  content: string;
};

function resolveRepoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..', '..', '..');
}

async function gatherFiles(repoRoot: string, patterns: readonly string[]): Promise<string[]> {
  const files = await Promise.all(
    patterns.map((pattern) =>
      glob(pattern, {
        cwd: repoRoot,
        absolute: true,
        ignore: [...IGNORE_PATTERNS],
      }),
    ),
  );

  return [...new Set(files.flat())];
}

function collectViolations(
  files: readonly string[],
  label: string,
  repoRoot: string,
  selfFilePath: string,
): Violation[] {
  const violations: Violation[] = [];

  for (const filePath of files) {
    if (path.resolve(filePath) === selfFilePath) {
      continue;
    }

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      if (!line.includes(LEGACY_CONFIG_FILE_NAME)) {
        return;
      }

      violations.push({
        file: path.relative(repoRoot, filePath),
        line: index + 1,
        label,
        content: line.trim(),
      });
    });
  }

  return violations;
}

function formatViolationReport(violations: readonly Violation[]): string {
  return violations
    .map(
      ({ file, line, label, content }) =>
        `- [${label}] ${file}:${line}\n  ${content}\n  Replace with workspace.yaml + software_delivery contract.`,
    )
    .join('\n');
}

describe('WU-2042: kernel-first config parity guard', () => {
  it('blocks legacy config references in active tests and docs', async () => {
    const repoRoot = resolveRepoRoot();
    const selfFilePath = path.resolve(fileURLToPath(import.meta.url));
    const violations: Violation[] = [];

    for (const group of SOURCE_GROUPS) {
      const files = await gatherFiles(repoRoot, group.patterns);
      violations.push(...collectViolations(files, group.label, repoRoot, selfFilePath));
    }

    if (violations.length > 0) {
      throw new Error(
        `Found ${violations.length} legacy config reference(s):\n${formatViolationReport(violations)}`,
      );
    }

    expect(violations).toHaveLength(0);
  });
});

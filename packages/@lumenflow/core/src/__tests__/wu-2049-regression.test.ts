// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';

const CORE_SRC_DIR = path.resolve(__dirname, '..');
const PACKAGES_DIR = path.resolve(__dirname, '..', '..', '..');
const CANONICAL_WU_PORTS_PATH = path.normalize('ports/wu-state.ports.ts');

const WU_STATE_INTERFACE_NAMES = [
  'WUStateEntry',
  'CheckpointOptions',
  'LockData',
  'RepairResult',
] as const;

function scanInterfaceDefinitions(content: string, interfaceName: string): number[] {
  const lines = content.split('\n');
  const pattern = new RegExp(`\\binterface\\s+${interfaceName}\\b`);
  const matches: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      matches.push(i + 1);
    }
  }

  return matches;
}

describe('WU-2049 regression guards', () => {
  it('keeps WU lock timeout naming disambiguated from lock-constants', () => {
    const lockManagerPath = path.join(CORE_SRC_DIR, 'wu-lock-manager.ts');
    const content = readFileSync(lockManagerPath, 'utf-8');

    expect(content).toMatch(/\bconst\s+WU_LOCK_STALE_TIMEOUT_MS\b/);
    expect(content).not.toMatch(/\bconst\s+LOCK_TIMEOUT_MS\b/);
  });

  it('consolidates WU state interfaces to ports/wu-state.ports.ts', async () => {
    const sourceFiles = await glob('**/*.ts', {
      cwd: CORE_SRC_DIR,
      absolute: true,
      ignore: ['**/__tests__/**', '**/dist/**', '**/node_modules/**', '**/e2e/**'],
    });

    for (const interfaceName of WU_STATE_INTERFACE_NAMES) {
      const definitions: Array<{ file: string; line: number }> = [];
      for (const file of sourceFiles) {
        const content = readFileSync(file, 'utf-8');
        const lines = scanInterfaceDefinitions(content, interfaceName);
        for (const line of lines) {
          definitions.push({ file: path.relative(CORE_SRC_DIR, file), line });
        }
      }

      expect(definitions, `${interfaceName} should have exactly one definition`).toHaveLength(1);
      expect(definitions[0].file).toBe(CANONICAL_WU_PORTS_PATH);
    }
  });

  it('keeps getErrorMessage defined in a single canonical module', async () => {
    const sourceFiles = await glob('{core,cli}/src/**/*.ts', {
      cwd: PACKAGES_DIR,
      absolute: true,
      ignore: ['**/__tests__/**', '**/dist/**', '**/node_modules/**', '**/e2e/**'],
    });

    const definitions: string[] = [];
    for (const file of sourceFiles) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/\bfunction\s+getErrorMessage\b/.test(line)) {
          definitions.push(`${path.relative(PACKAGES_DIR, file)}:${i + 1}`);
        }
      }
    }

    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toContain(path.normalize('core/src/error-handler.ts'));
  });

  it('removes spawn-lane-occupation module and import references', async () => {
    const removedModulePath = path.join(CORE_SRC_DIR, 'spawn', 'spawn-lane-occupation.ts');
    expect(existsSync(removedModulePath)).toBe(false);

    const sourceFiles = await glob('**/*.ts', {
      cwd: CORE_SRC_DIR,
      absolute: true,
      ignore: ['**/__tests__/**', '**/dist/**', '**/node_modules/**', '**/e2e/**'],
    });

    const importReferences: string[] = [];
    for (const file of sourceFiles) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (
          /from\s+['"][^'"]*spawn-lane-occupation/.test(line) ||
          /export\s+\*\s+from\s+['"][^'"]*spawn-lane-occupation/.test(line)
        ) {
          importReferences.push(`${path.relative(CORE_SRC_DIR, file)}:${i + 1}`);
        }
      }
    }

    expect(importReferences).toHaveLength(0);
  });

  it('avoids unsafe type assertions in updated WU state modules', () => {
    const eventSourcerPath = path.join(CORE_SRC_DIR, 'wu-event-sourcer.ts');
    const detectorPath = path.join(CORE_SRC_DIR, 'wu-consistency-detector.ts');
    const eventSourcerContent = readFileSync(eventSourcerPath, 'utf-8');
    const detectorContent = readFileSync(detectorPath, 'utf-8');

    expect(eventSourcerContent).not.toContain('as NodeJS.ErrnoException');
    expect(eventSourcerContent).not.toContain('as Error');
    expect(detectorContent).not.toMatch(/parseYAML\([^)]*\)\s+as\s+/);
  });
});

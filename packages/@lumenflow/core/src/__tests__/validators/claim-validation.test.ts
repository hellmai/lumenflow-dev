// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WORKSPACE_CONFIG_FILE_NAME } from '../../config-contract.js';
import { WORKSPACE_V2_KEYS } from '../../config-contract.js';
import {
  validateClaimValidation,
  CLAIM_VALIDATION_IDS,
  type ClaimValidationResult,
} from '../../validators/claim-validation.js';

const TEMP_DIR_PREFIX = 'lumenflow-claim-validation-';
const FIXTURE_WU_ID = 'WU-9000';
const FIXTURE_INIT_ID = 'INIT-9000';
const UTF8_ENCODING = 'utf8';
const LEGACY_CONFIG_FILE_NAME = ['.lumenflow', 'config', 'yaml'].join('.');

function createTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), TEMP_DIR_PREFIX));
}

function writeWorkspaceConfig(baseDir: string): void {
  const configPath = path.join(baseDir, WORKSPACE_CONFIG_FILE_NAME);
  const configContent = `${WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY}: {}\n`;
  writeFileSync(configPath, configContent, UTF8_ENCODING);
}

function writeSpecFiles(baseDir: string, options: { notes?: string[] } = {}): void {
  const wuDir = path.join(baseDir, 'docs', '04-operations', 'tasks', 'wu');
  const initiativesDir = path.join(baseDir, 'docs', '04-operations', 'tasks', 'initiatives');

  mkdirSync(wuDir, { recursive: true });
  mkdirSync(initiativesDir, { recursive: true });

  const notes = options.notes ?? [];
  const notesBlock =
    notes.length > 0 ? `\nnotes:\n${notes.map((note) => `  - '${note}'`).join('\n')}\n` : '';

  const wuContent = `id: ${FIXTURE_WU_ID}\ntitle: Claim validator fixture\nlane: 'Framework: Core Validation'\ntype: feature\nstatus: in_progress\ninitiative: ${FIXTURE_INIT_ID}\nacceptance:\n  - All CLI commands use runCLI(main).\n  - No process.exit in core library functions.${notesBlock}`;

  const initiativeContent = `id: ${FIXTURE_INIT_ID}\nslug: claim-validation-fixture\ntitle: Claim validation fixture\nstatus: in_progress\nsuccess_metrics:\n  - No runtime dependency on ${LEGACY_CONFIG_FILE_NAME}\n`;

  writeFileSync(path.join(wuDir, `${FIXTURE_WU_ID}.yaml`), wuContent, UTF8_ENCODING);
  writeFileSync(
    path.join(initiativesDir, `${FIXTURE_INIT_ID}.yaml`),
    initiativeContent,
    UTF8_ENCODING,
  );
}

function writeViolationFixtures(baseDir: string): void {
  const cliDir = path.join(baseDir, 'packages', '@lumenflow', 'cli', 'src');
  const coreDir = path.join(baseDir, 'packages', '@lumenflow', 'core', 'src');

  mkdirSync(cliDir, { recursive: true });
  mkdirSync(coreDir, { recursive: true });

  writeFileSync(
    path.join(cliDir, 'bad-entrypoint.ts'),
    `export async function main(): Promise<void> {\n  return;\n}\n\nif (import.meta.main) {\n  void main();\n}\n`,
    UTF8_ENCODING,
  );

  writeFileSync(
    path.join(coreDir, 'bad-process-exit.ts'),
    `export function fail(): never {\n  process.exit(1);\n}\n`,
    UTF8_ENCODING,
  );

  writeFileSync(
    path.join(coreDir, 'legacy-config-reader.ts'),
    `export const LEGACY_FILE = '${LEGACY_CONFIG_FILE_NAME}';\n`,
    UTF8_ENCODING,
  );
}

function writeCompliantFixtures(baseDir: string): void {
  const cliDir = path.join(baseDir, 'packages', '@lumenflow', 'cli', 'src');
  const coreDir = path.join(baseDir, 'packages', '@lumenflow', 'core', 'src');

  mkdirSync(cliDir, { recursive: true });
  mkdirSync(coreDir, { recursive: true });

  writeFileSync(
    path.join(cliDir, 'good-entrypoint.ts'),
    `import { runCLI } from './cli-entry-point.js';\n\nexport async function main(): Promise<void> {\n  return;\n}\n\nif (import.meta.main) {\n  void runCLI(main);\n}\n`,
    UTF8_ENCODING,
  );

  writeFileSync(
    path.join(coreDir, 'core-lib.ts'),
    `export function ok(): string {\n  return 'ok';\n}\n`,
    UTF8_ENCODING,
  );
}

function claimIds(result: ClaimValidationResult): string[] {
  return result.mismatches.map((mismatch) => mismatch.claimId);
}

describe('validateClaimValidation', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    writeWorkspaceConfig(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects claim drift with file/line evidence and remediation hints', async () => {
    writeSpecFiles(tempDir);
    writeViolationFixtures(tempDir);

    const result = await validateClaimValidation({ cwd: tempDir, wuId: FIXTURE_WU_ID });

    expect(result.ok).toBe(false);
    expect(result.scannedClaims).toBeGreaterThan(0);
    expect(result.checkedClaims).toBe(3);

    const ids = claimIds(result);
    expect(ids).toContain(CLAIM_VALIDATION_IDS.LEGACY_CONFIG_HARD_CUT);
    expect(ids).toContain(CLAIM_VALIDATION_IDS.RUNCLI_MAIN_REQUIRED);
    expect(ids).toContain(CLAIM_VALIDATION_IDS.CORE_NO_PROCESS_EXIT);

    for (const mismatch of result.mismatches) {
      expect(mismatch.evidence.length).toBeGreaterThan(0);
      expect(mismatch.remediationHint.length).toBeGreaterThan(0);
      expect(mismatch.specReference.line).toBeGreaterThan(0);
      for (const evidence of mismatch.evidence) {
        expect(evidence.line).toBeGreaterThan(0);
      }
    }
  });

  it('passes when code matches absolute claims', async () => {
    writeSpecFiles(tempDir);
    writeCompliantFixtures(tempDir);

    const result = await validateClaimValidation({ cwd: tempDir, wuId: FIXTURE_WU_ID });

    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it('supports allowlist overrides via documented notes directives', async () => {
    writeSpecFiles(tempDir, {
      notes: [
        'claim-validation:allow legacy-config-hard-cut packages/@lumenflow/core/src/legacy-config-reader.ts',
      ],
    });
    writeCompliantFixtures(tempDir);

    const coreDir = path.join(tempDir, 'packages', '@lumenflow', 'core', 'src');
    mkdirSync(coreDir, { recursive: true });
    writeFileSync(
      path.join(coreDir, 'legacy-config-reader.ts'),
      `export const LEGACY_FILE = '${LEGACY_CONFIG_FILE_NAME}';\n`,
      UTF8_ENCODING,
    );

    const result = await validateClaimValidation({ cwd: tempDir, wuId: FIXTURE_WU_ID });

    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
  });
});

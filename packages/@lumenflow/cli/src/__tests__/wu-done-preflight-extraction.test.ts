// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('wu:done preflight extraction (WU-2164)', () => {
  it('routes preflight ownership/mode/staged helpers through wu-done-preflight module', () => {
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const filePath = path.join(thisDir, '..', 'wu-done.ts');
    const content = readFileSync(filePath, 'utf-8');

    expect(content).toContain("from './wu-done-preflight.js'");
    expect(content).toContain('runWuDoneStagedValidation({');
    expect(content).not.toContain('async function checkOwnership(');
    expect(content).not.toContain('function auditOwnershipOverride(');
    expect(content).not.toContain('export function normalizeUsername(');
    expect(content).not.toContain('export function computeBranchOnlyFallback(');
  });
});

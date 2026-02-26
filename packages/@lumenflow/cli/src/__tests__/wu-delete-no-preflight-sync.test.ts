// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2194: Regression tests asserting ensureMainUpToDate is NOT called
 * in wu-delete.ts single and batch paths (withMicroWorktree handles origin sync).
 *
 * Follows the initiative-edit.test.ts pattern from WU-1497.
 */

import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('wu:delete should not call ensureMainUpToDate (WU-2194)', () => {
  it('should not call ensureMainUpToDate in deleteSingleWU (withMicroWorktree handles origin sync)', () => {
    const sourceFile = fs.readFileSync(new URL('../wu-delete.ts', import.meta.url), 'utf-8');

    // Extract the deleteSingleWU function body
    const singleFnMatch = sourceFile.match(/async function deleteSingleWU[\s\S]*?^}/m);
    expect(singleFnMatch).not.toBeNull();
    const singleBody = singleFnMatch![0];

    // Match actual function calls: await ensureMainUpToDate( or ensureMainUpToDate(
    expect(singleBody).not.toMatch(/(?:await\s+)?ensureMainUpToDate\s*\(/);
  });

  it('should not call ensureMainUpToDate in deleteBatchWUs (withMicroWorktree handles origin sync)', () => {
    const sourceFile = fs.readFileSync(new URL('../wu-delete.ts', import.meta.url), 'utf-8');

    // Extract the deleteBatchWUs function body
    const batchFnMatch = sourceFile.match(/async function deleteBatchWUs[\s\S]*?^}/m);
    expect(batchFnMatch).not.toBeNull();
    const batchBody = batchFnMatch![0];

    // Match actual function calls: await ensureMainUpToDate( or ensureMainUpToDate(
    expect(batchBody).not.toMatch(/(?:await\s+)?ensureMainUpToDate\s*\(/);
  });

  it('should not import ensureMainUpToDate from wu-helpers', () => {
    const sourceFile = fs.readFileSync(new URL('../wu-delete.ts', import.meta.url), 'utf-8');

    // Should not import ensureMainUpToDate at all (clean imports)
    expect(sourceFile).not.toMatch(/import.*ensureMainUpToDate.*from/);
  });
});

// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2194: Regression tests asserting ensureMainUpToDate is NOT called
 * in wu-edit.ts ready-WU path (withMicroWorktree handles origin sync).
 *
 * Follows the initiative-edit.test.ts pattern from WU-1497.
 */

import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('wu:edit should not call ensureMainUpToDate (WU-2194)', () => {
  it('should not call ensureMainUpToDate in main() body (withMicroWorktree handles origin sync)', () => {
    // Read the source file to verify it does not call ensureMainUpToDate
    // This is a structural test: wu-edit must not perform its own ensureMainUpToDate
    // because withMicroWorktree already handles origin sync internally
    const sourceFile = fs.readFileSync(new URL('../wu-edit.ts', import.meta.url), 'utf-8');

    // Extract the main() function body
    const mainFunctionMatch = sourceFile.match(/export async function main\(\)[\s\S]*?^}/m);
    expect(mainFunctionMatch).not.toBeNull();
    const mainBody = mainFunctionMatch![0];

    // Match actual function calls: await ensureMainUpToDate( or ensureMainUpToDate(
    // Comments mentioning it are fine; only actual call invocations are the bug
    expect(mainBody).not.toMatch(/(?:await\s+)?ensureMainUpToDate\s*\(/);
  });

  it('should not import ensureMainUpToDate from wu-helpers', () => {
    const sourceFile = fs.readFileSync(new URL('../wu-edit.ts', import.meta.url), 'utf-8');

    // Should not import ensureMainUpToDate at all (clean imports)
    expect(sourceFile).not.toMatch(/import.*ensureMainUpToDate.*from/);
  });
});

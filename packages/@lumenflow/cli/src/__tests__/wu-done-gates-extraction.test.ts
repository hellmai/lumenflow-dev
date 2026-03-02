// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('WU-2165: gate orchestration extraction', () => {
  it('routes wu:done gate orchestration through wu-done-gates module', async () => {
    const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');

    expect(source).toContain("from './wu-done-gates.js'");
    expect(source).not.toContain('async function executeGates(');
    expect(source).not.toContain('async function runGatesInWorktree(');
    expect(source).not.toContain('function checkNodeModulesStaleness(');
  });
});


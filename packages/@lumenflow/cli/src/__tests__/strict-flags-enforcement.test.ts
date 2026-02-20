// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';

interface TsConfigLike {
  compilerOptions?: Record<string, unknown>;
}

async function readTsConfig(relativePath: string): Promise<TsConfigLike> {
  const content = await readFile(new URL(relativePath, import.meta.url), 'utf-8');
  return JSON.parse(content) as TsConfigLike;
}

function expectNoLocalStrictDisable(tsconfig: TsConfigLike, label: string): void {
  const options = tsconfig.compilerOptions ?? {};

  expect(options.strict, `${label}: strict should stay enabled`).toBe(true);
  expect(
    Object.prototype.hasOwnProperty.call(options, 'strictNullChecks'),
    `${label}: strictNullChecks must not be locally overridden`,
  ).toBe(false);
  expect(
    Object.prototype.hasOwnProperty.call(options, 'noImplicitAny'),
    `${label}: noImplicitAny must not be locally overridden`,
  ).toBe(false);
}

describe('strict TypeScript flag enforcement', () => {
  it('does not locally disable strictNullChecks/noImplicitAny in CLI and Core packages', async () => {
    const [cliTsconfig, coreTsconfig] = await Promise.all([
      readTsConfig('../../tsconfig.json'),
      readTsConfig('../../../core/tsconfig.json'),
    ]);

    expectNoLocalStrictDisable(cliTsconfig, 'CLI tsconfig');
    expectNoLocalStrictDisable(coreTsconfig, 'Core tsconfig');
  });
});

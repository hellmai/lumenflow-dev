// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { ENV_VARS } from '../wu-constants.js';
import { getEnv, requireEnv } from '../env-accessors.js';

describe('env-accessors', () => {
  it('getEnv returns undefined for missing variables', () => {
    const value = getEnv(ENV_VARS.HEADLESS, { env: {} });
    expect(value).toBeUndefined();
  });

  it('getEnv trims values by default and treats empty as undefined', () => {
    const value = getEnv(ENV_VARS.HEADLESS, { env: { [ENV_VARS.HEADLESS]: '  1  ' } });
    const emptyValue = getEnv(ENV_VARS.HEADLESS, { env: { [ENV_VARS.HEADLESS]: '   ' } });

    expect(value).toBe('1');
    expect(emptyValue).toBeUndefined();
  });

  it('requireEnv throws actionable error when variable is missing', () => {
    expect(() =>
      requireEnv(ENV_VARS.PROJECT_ROOT, {
        env: {},
        context: '@lumenflow/mcp startup',
        remediation: `Set ${ENV_VARS.PROJECT_ROOT}=<path> and retry.`,
      }),
    ).toThrow(
      /@lumenflow\/mcp startup: Missing required environment variable LUMENFLOW_PROJECT_ROOT/,
    );
  });

  it('requireEnv returns value when variable is present', () => {
    const value = requireEnv(ENV_VARS.PROJECT_ROOT, {
      env: { [ENV_VARS.PROJECT_ROOT]: '/workspace' },
    });

    expect(value).toBe('/workspace');
  });
});

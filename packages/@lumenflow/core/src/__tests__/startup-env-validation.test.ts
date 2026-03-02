// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import { ENV_VARS } from '../wu-constants.js';
import {
  STARTUP_ENV_POLICY,
  parseEnumEnvValue,
  parseNonEmptyEnvValue,
  validateStartupEnvSchema,
} from '../startup-env-validation.js';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

describe('startup-env-validation', () => {
  it('fails fast with actionable diagnostics for missing required values', () => {
    expect(() =>
      validateStartupEnvSchema({
        context: '@lumenflow/mcp startup',
        policy: STARTUP_ENV_POLICY.ERROR,
        env: {},
        schema: {
          projectRoot: {
            envVar: ENV_VARS.PROJECT_ROOT,
            required: true,
            parse: parseNonEmptyEnvValue('path to a project directory'),
          },
        },
      }),
    ).toThrow(/LUMENFLOW_PROJECT_ROOT/);
  });

  it('parses valid enum and string values', () => {
    const values = validateStartupEnvSchema({
      context: '@lumenflow/mcp startup',
      policy: STARTUP_ENV_POLICY.ERROR,
      env: {
        [ENV_VARS.PROJECT_ROOT]: '/workspace',
        [ENV_VARS.MCP_LOG_LEVEL]: 'warn',
      },
      schema: {
        projectRoot: {
          envVar: ENV_VARS.PROJECT_ROOT,
          required: true,
          parse: parseNonEmptyEnvValue('path to a project directory'),
        },
        logLevel: {
          envVar: ENV_VARS.MCP_LOG_LEVEL,
          defaultValue: 'info',
          parse: parseEnumEnvValue(LOG_LEVELS),
        },
      },
    });

    expect(values.projectRoot).toBe('/workspace');
    expect(values.logLevel).toBe('warn');
  });

  it('warn policy reports diagnostics and falls back to defaults', () => {
    const onWarning = vi.fn();
    const values = validateStartupEnvSchema({
      context: '@lumenflow/mcp startup',
      policy: STARTUP_ENV_POLICY.WARN,
      onWarning,
      env: {
        [ENV_VARS.PROJECT_ROOT]: '/workspace',
        [ENV_VARS.MCP_LOG_LEVEL]: 'verbose',
      },
      schema: {
        projectRoot: {
          envVar: ENV_VARS.PROJECT_ROOT,
          required: true,
          parse: parseNonEmptyEnvValue('path to a project directory'),
        },
        logLevel: {
          envVar: ENV_VARS.MCP_LOG_LEVEL,
          defaultValue: 'info',
          parse: parseEnumEnvValue(LOG_LEVELS),
        },
      },
    });

    expect(onWarning).toHaveBeenCalledOnce();
    expect(onWarning.mock.calls[0]?.[0]).toContain('LUMENFLOW_MCP_LOG_LEVEL');
    expect(values.logLevel).toBe('info');
    expect(values.projectRoot).toBe('/workspace');
  });
});

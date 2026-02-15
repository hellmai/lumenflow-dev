/**
 * @file wu-lint-parity.test.ts
 *
 * Updated for Validator Layer V2 (WU-1680):
 * - parity is bin-diff-aware and enforced in reality phase
 * - lint phases (intent/structural) do not assume package.json implies bin changes
 */

import { describe, expect, it } from 'vitest';
import {
  CLI_COMMAND_PATTERNS,
  lintWUSpec,
  REGISTRATION_SURFACES,
  validateRegistrationParity,
  WU_LINT_ERROR_TYPES,
} from '../wu-lint.js';

describe('validateRegistrationParity adapter (WU-1680)', () => {
  it('returns advisory warning when bin change context is unavailable', () => {
    const result = validateRegistrationParity({
      id: 'WU-TEST',
      code_paths: ['packages/@lumenflow/cli/package.json'],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect((result.warnings || []).length).toBeGreaterThan(0);
  });

  it('fails when binChanged=true and registration surfaces are missing', () => {
    const result = validateRegistrationParity(
      {
        id: 'WU-TEST',
        code_paths: ['packages/@lumenflow/cli/package.json'],
      },
      { binChanged: true },
    );

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(2);
    expect(
      result.errors.every((e) => e.type === WU_LINT_ERROR_TYPES.REGISTRATION_PARITY_MISSING),
    ).toBe(true);
  });

  it('passes when binChanged=true and both registration surfaces are present', () => {
    const result = validateRegistrationParity(
      {
        id: 'WU-TEST',
        code_paths: [
          'packages/@lumenflow/cli/package.json',
          REGISTRATION_SURFACES.PUBLIC_MANIFEST,
          REGISTRATION_SURFACES.MCP_TOOLS,
        ],
      },
      { binChanged: true },
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('lintWUSpec phase-aware behavior', () => {
  it('does not force parity in structural phase for package.json-only scope', () => {
    const result = lintWUSpec(
      {
        id: 'WU-TEST',
        type: 'bug',
        status: 'ready',
        code_paths: ['packages/@lumenflow/cli/package.json'],
        tests: {
          manual: ['metadata validation'],
          unit: [],
          e2e: [],
          integration: [],
        },
        acceptance: ['Update CLI package metadata'],
      },
      { phase: 'structural' },
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('requires minimum test intent for non-doc work with code_paths', () => {
    const result = lintWUSpec(
      {
        id: 'WU-TEST',
        type: 'refactor',
        status: 'ready',
        code_paths: ['packages/@lumenflow/cli/src/wu-prep.ts'],
        tests: {
          manual: [],
          unit: [],
          e2e: [],
          integration: [],
        },
        acceptance: ['Refactor prep flow'],
      },
      { phase: 'intent' },
    );

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.type === WU_LINT_ERROR_TYPES.UNIT_TESTS_REQUIRED ||
          error.type === WU_LINT_ERROR_TYPES.MINIMUM_TEST_INTENT_REQUIRED,
      ),
    ).toBe(true);
  });

  it('accepts manual-only test intent in intent phase', () => {
    const result = lintWUSpec(
      {
        id: 'WU-TEST',
        type: 'refactor',
        status: 'ready',
        code_paths: ['packages/@lumenflow/cli/src/wu-prep.ts'],
        tests: {
          manual: ['manual verification only'],
          unit: [],
          e2e: [],
          integration: [],
        },
        acceptance: ['Refactor prep flow'],
      },
      { phase: 'intent' },
    );

    expect(result.valid).toBe(true);
  });
});

describe('exported constants', () => {
  it('exports registration surfaces', () => {
    expect(REGISTRATION_SURFACES.PUBLIC_MANIFEST).toBe(
      'packages/@lumenflow/cli/src/public-manifest.ts',
    );
    expect(REGISTRATION_SURFACES.MCP_TOOLS).toBe('packages/@lumenflow/mcp/src/tools.ts');
  });

  it('exports CLI command patterns', () => {
    expect(CLI_COMMAND_PATTERNS).toContain('packages/@lumenflow/cli/package.json');
  });
});

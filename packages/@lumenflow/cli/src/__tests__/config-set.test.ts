// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file config-set.test.ts
 * WU-1902: Tests for config:set and config:get CLI commands
 *
 * TDD RED phase: These tests are written before implementation.
 * Covers: set scalar, set array, get existing, get missing,
 * invalid value rejection, nested dotpath navigation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import YAML from 'yaml';
import { WORKSPACE_V2_KEYS } from '@lumenflow/core/config-schema';

// ---------------------------------------------------------------------------
// Module under test - imported after implementation exists
// ---------------------------------------------------------------------------

// We test the pure logic functions (no side effects)
import {
  parseConfigSetArgs,
  parseConfigGetArgs,
  applyConfigSet,
  getConfigValue,
  normalizeWorkspaceConfigKey,
  getSoftwareDeliveryConfigFromWorkspace,
  setSoftwareDeliveryConfigInWorkspace,
  type ConfigSetOptions,
} from '../config-set.js';

const SOFTWARE_DELIVERY_ROOT = WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY;

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Minimal valid config that passes Zod schema */
function createMinimalSoftwareDeliveryConfig(): Record<string, unknown> {
  return {
    version: '1.0.0',
    methodology: {
      testing: 'tdd',
      architecture: 'hexagonal',
    },
    gates: {
      maxEslintWarnings: 100,
      enableCoverage: true,
      minCoverage: 90,
    },
    directories: {
      wuDir: 'docs/04-operations/tasks/wu',
    },
  };
}

/** Minimal workspace document containing software_delivery config section */
function createMinimalWorkspace(): Record<string, unknown> {
  return {
    id: 'workspace-id',
    name: 'Workspace Name',
    [SOFTWARE_DELIVERY_ROOT]: createMinimalSoftwareDeliveryConfig(),
  };
}

// ---------------------------------------------------------------------------
// Workspace key helpers
// ---------------------------------------------------------------------------

describe('normalizeWorkspaceConfigKey', () => {
  it('returns empty key for software_delivery root path', () => {
    const result = normalizeWorkspaceConfigKey(SOFTWARE_DELIVERY_ROOT);
    expect(result).toBe('');
  });

  it('strips software_delivery prefix from canonical keys', () => {
    const result = normalizeWorkspaceConfigKey(`${SOFTWARE_DELIVERY_ROOT}.methodology.testing`);
    expect(result).toBe('methodology.testing');
  });

  it('keeps shorthand keys unchanged', () => {
    const result = normalizeWorkspaceConfigKey('methodology.testing');
    expect(result).toBe('methodology.testing');
  });
});

describe('workspace software_delivery section helpers', () => {
  it('extracts software_delivery config from workspace document', () => {
    const workspace = createMinimalWorkspace();
    const config = getSoftwareDeliveryConfigFromWorkspace(workspace);
    expect(getConfigValue(config, 'methodology.testing')).toBe('tdd');
  });

  it('returns empty object when software_delivery is missing', () => {
    const config = getSoftwareDeliveryConfigFromWorkspace({
      id: 'workspace-id',
      name: 'Workspace Name',
    });
    expect(config).toEqual({});
  });

  it('sets software_delivery config in workspace document', () => {
    const workspace = createMinimalWorkspace();
    const updated = setSoftwareDeliveryConfigInWorkspace(workspace, {
      methodology: { testing: 'test-after' },
    });
    expect(getConfigValue(updated, `${SOFTWARE_DELIVERY_ROOT}.methodology.testing`)).toBe(
      'test-after',
    );
    expect(getConfigValue(updated, 'id')).toBe('workspace-id');
    expect(getConfigValue(updated, 'name')).toBe('Workspace Name');
  });
});

// ---------------------------------------------------------------------------
// parseConfigSetArgs
// ---------------------------------------------------------------------------

describe('parseConfigSetArgs', () => {
  it('parses --key and --value for scalar set', () => {
    const result = parseConfigSetArgs(['--key', 'methodology.testing', '--value', 'test-after']);
    expect(result.key).toBe('methodology.testing');
    expect(result.value).toBe('test-after');
  });

  it('throws when --key is missing', () => {
    expect(() => parseConfigSetArgs(['--value', 'foo'])).toThrow('--key is required');
  });

  it('throws when --value is missing', () => {
    expect(() => parseConfigSetArgs(['--key', 'methodology.testing'])).toThrow(
      '--value is required',
    );
  });

  it('handles --help without throwing', () => {
    // --help exits the process; we mock process.exit
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(() => parseConfigSetArgs(['--help'])).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(0);

    exitSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('parses comma-separated values for array fields', () => {
    const result = parseConfigSetArgs([
      '--key',
      'methodology.work_classification.ui.lane_hints',
      '--value',
      'Experience,Frontend',
    ]);
    expect(result.key).toBe('methodology.work_classification.ui.lane_hints');
    expect(result.value).toBe('Experience,Frontend');
  });
});

// ---------------------------------------------------------------------------
// parseConfigGetArgs
// ---------------------------------------------------------------------------

describe('parseConfigGetArgs', () => {
  it('parses --key for get', () => {
    const result = parseConfigGetArgs(['--key', 'methodology.testing']);
    expect(result.key).toBe('methodology.testing');
  });

  it('throws when --key is missing', () => {
    expect(() => parseConfigGetArgs([])).toThrow('--key is required');
  });
});

// ---------------------------------------------------------------------------
// getConfigValue (pure function)
// ---------------------------------------------------------------------------

describe('getConfigValue', () => {
  it('reads a top-level scalar value', () => {
    const config = createMinimalSoftwareDeliveryConfig();
    const result = getConfigValue(config, 'version');
    expect(result).toBe('1.0.0');
  });

  it('reads a nested scalar value via dotpath', () => {
    const config = createMinimalSoftwareDeliveryConfig();
    const result = getConfigValue(config, 'methodology.testing');
    expect(result).toBe('tdd');
  });

  it('reads a deeply nested value', () => {
    const config = createMinimalSoftwareDeliveryConfig();
    const result = getConfigValue(config, 'gates.minCoverage');
    expect(result).toBe(90);
  });

  it('returns undefined for missing key', () => {
    const config = createMinimalSoftwareDeliveryConfig();
    const result = getConfigValue(config, 'nonexistent.path');
    expect(result).toBeUndefined();
  });

  it('returns undefined for partially matching path', () => {
    const config = createMinimalSoftwareDeliveryConfig();
    const result = getConfigValue(config, 'methodology.testing.deep');
    expect(result).toBeUndefined();
  });

  it('returns an object for intermediate path', () => {
    const config = createMinimalSoftwareDeliveryConfig();
    const result = getConfigValue(config, 'methodology');
    expect(result).toEqual({
      testing: 'tdd',
      architecture: 'hexagonal',
    });
  });
});

// ---------------------------------------------------------------------------
// applyConfigSet (pure function - validates via Zod)
// ---------------------------------------------------------------------------

describe('applyConfigSet', () => {
  it('sets a scalar value at a top-level dotpath', () => {
    const config = createMinimalSoftwareDeliveryConfig();
    const result = applyConfigSet(config, 'methodology.testing', 'test-after');
    expect(result.ok).toBe(true);
    expect(result.config).toBeDefined();
    expect(getConfigValue(result.config!, 'methodology.testing')).toBe('test-after');
  });

  it('sets a nested scalar value', () => {
    const config = createMinimalSoftwareDeliveryConfig();
    const result = applyConfigSet(config, 'gates.minCoverage', '85');
    expect(result.ok).toBe(true);
    // The value should be coerced to number by the Zod schema
    expect(getConfigValue(result.config!, 'gates.minCoverage')).toBe(85);
  });

  it('appends comma-separated values to an array field', () => {
    const config = createMinimalSoftwareDeliveryConfig();
    // methodology.principles is an array in the schema defaults
    (config as Record<string, unknown>).agents = {
      methodology: {
        principles: ['TDD', 'SOLID'],
      },
    };
    const result = applyConfigSet(config, 'agents.methodology.principles', 'Library-First,KISS');
    expect(result.ok).toBe(true);
    const principles = getConfigValue(result.config!, 'agents.methodology.principles');
    expect(principles).toContain('Library-First');
    expect(principles).toContain('KISS');
    // Should also retain existing values
    expect(principles).toContain('TDD');
    expect(principles).toContain('SOLID');
  });

  it('rejects invalid value with clear error', () => {
    const config = createMinimalSoftwareDeliveryConfig();
    // methodology.testing only accepts 'tdd' | 'test-after' | 'none'
    const result = applyConfigSet(config, 'methodology.testing', 'invalid-value');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('invalid');
  });

  it('rejects invalid numeric value', () => {
    const config = createMinimalSoftwareDeliveryConfig();
    // minCoverage must be 0-100
    const result = applyConfigSet(config, 'gates.minCoverage', '150');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('creates intermediate objects for new nested paths', () => {
    const config = createMinimalSoftwareDeliveryConfig();
    const result = applyConfigSet(config, 'experimental.context_validation', 'false');
    expect(result.ok).toBe(true);
    expect(getConfigValue(result.config!, 'experimental.context_validation')).toBe(false);
  });

  it('preserves other config values when setting one', () => {
    const config = createMinimalSoftwareDeliveryConfig();
    const result = applyConfigSet(config, 'methodology.testing', 'test-after');
    expect(result.ok).toBe(true);
    // Architecture should be unchanged
    expect(getConfigValue(result.config!, 'methodology.architecture')).toBe('hexagonal');
    // Version should be unchanged
    expect(getConfigValue(result.config!, 'version')).toBe('1.0.0');
  });

  it('handles boolean string conversion', () => {
    const config = createMinimalSoftwareDeliveryConfig();
    const result = applyConfigSet(config, 'gates.enableCoverage', 'false');
    expect(result.ok).toBe(true);
    expect(getConfigValue(result.config!, 'gates.enableCoverage')).toBe(false);
  });
});

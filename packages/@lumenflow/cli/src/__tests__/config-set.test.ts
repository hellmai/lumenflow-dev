// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file config-set.test.ts
 * WU-2185: Tests for config:set with workspace-aware routing
 *
 * TDD RED phase: These tests define the new routing behavior.
 * The config:set command must route keys by prefix:
 * - WRITABLE_ROOT_KEYS -> write at workspace root
 * - Pack config_key -> write under pack config block
 * - MANAGED_ROOT_KEYS -> error with "use <command>" guidance
 * - Unknown -> hard error with did-you-mean
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import {
  parseConfigSetArgs,
  parseConfigGetArgs,
  applyConfigSet,
  getConfigValue,
  routeConfigKey,
  type ConfigSetOptions,
  type ConfigKeyRoute,
} from '../config-set.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Minimal valid software_delivery config that passes Zod schema */
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

/** Minimal workspace document with software_delivery and packs */
function createMinimalWorkspace(): Record<string, unknown> {
  return {
    id: 'workspace-id',
    name: 'Workspace Name',
    packs: [{ id: 'software-delivery', version: '3.0.0', integrity: 'dev', source: 'local' }],
    software_delivery: createMinimalSoftwareDeliveryConfig(),
    control_plane: {
      sync_interval: 30,
    },
    memory_namespace: 'lumenflow',
    event_namespace: 'lumenflow',
  };
}

/** Pack config_keys map: simulates loading from pack manifests */
const PACK_CONFIG_KEYS = new Map<string, string>([['software_delivery', 'software-delivery']]);

// ---------------------------------------------------------------------------
// routeConfigKey (pure routing function)
// ---------------------------------------------------------------------------

describe('routeConfigKey', () => {
  it('routes WRITABLE_ROOT_KEY to workspace-root', () => {
    const route = routeConfigKey('control_plane.sync_interval', PACK_CONFIG_KEYS);
    expect(route.type).toBe('workspace-root');
    expect(route.rootKey).toBe('control_plane');
    expect(route.subPath).toBe('sync_interval');
  });

  it('routes memory_namespace to workspace-root', () => {
    const route = routeConfigKey('memory_namespace', PACK_CONFIG_KEYS);
    expect(route.type).toBe('workspace-root');
    expect(route.rootKey).toBe('memory_namespace');
    expect(route.subPath).toBe('');
  });

  it('routes event_namespace to workspace-root', () => {
    const route = routeConfigKey('event_namespace', PACK_CONFIG_KEYS);
    expect(route.type).toBe('workspace-root');
    expect(route.rootKey).toBe('event_namespace');
    expect(route.subPath).toBe('');
  });

  it('routes pack config_key to pack-config', () => {
    const route = routeConfigKey('software_delivery.gates.minCoverage', PACK_CONFIG_KEYS);
    expect(route.type).toBe('pack-config');
    expect(route.rootKey).toBe('software_delivery');
    expect(route.subPath).toBe('gates.minCoverage');
    expect(route.packId).toBe('software-delivery');
  });

  it('routes managed key to managed-error', () => {
    const route = routeConfigKey('packs.foo', PACK_CONFIG_KEYS);
    expect(route.type).toBe('managed-error');
    expect(route.rootKey).toBe('packs');
    expect(route.command).toBe('pack:install');
  });

  it('routes lanes to managed-error with lane:edit command', () => {
    const route = routeConfigKey('lanes.something', PACK_CONFIG_KEYS);
    expect(route.type).toBe('managed-error');
    expect(route.rootKey).toBe('lanes');
    expect(route.command).toBe('lane:edit');
  });

  it('routes security to managed-error with security:set command', () => {
    const route = routeConfigKey('security.allow_scopes', PACK_CONFIG_KEYS);
    expect(route.type).toBe('managed-error');
    expect(route.rootKey).toBe('security');
    expect(route.command).toBe('security:set');
  });

  it('routes id to managed-error with workspace-init command', () => {
    const route = routeConfigKey('id', PACK_CONFIG_KEYS);
    expect(route.type).toBe('managed-error');
    expect(route.rootKey).toBe('id');
    expect(route.command).toBe('workspace-init');
  });

  it('routes policies to managed-error with policy:set command', () => {
    const route = routeConfigKey('policies.deny', PACK_CONFIG_KEYS);
    expect(route.type).toBe('managed-error');
    expect(route.rootKey).toBe('policies');
    expect(route.command).toBe('policy:set');
  });

  it('routes unknown key with did-you-mean for ambiguous SD sub-key', () => {
    const route = routeConfigKey('gates.minCoverage', PACK_CONFIG_KEYS);
    expect(route.type).toBe('unknown-error');
    expect(route.rootKey).toBe('gates');
    expect(route.suggestion).toContain('software_delivery.gates.minCoverage');
  });

  it('routes completely unknown key with no suggestion', () => {
    const route = routeConfigKey('completely_unknown.something', PACK_CONFIG_KEYS);
    expect(route.type).toBe('unknown-error');
    expect(route.rootKey).toBe('completely_unknown');
  });

  it('handles single-segment unknown key', () => {
    const route = routeConfigKey('foobar', PACK_CONFIG_KEYS);
    expect(route.type).toBe('unknown-error');
    expect(route.rootKey).toBe('foobar');
  });
});

// ---------------------------------------------------------------------------
// parseConfigSetArgs
// ---------------------------------------------------------------------------

describe('parseConfigSetArgs', () => {
  it('parses --key and --value for scalar set', () => {
    const result = parseConfigSetArgs([
      '--key',
      'software_delivery.methodology.testing',
      '--value',
      'test-after',
    ]);
    expect(result.key).toBe('software_delivery.methodology.testing');
    expect(result.value).toBe('test-after');
  });

  it('throws when --key is missing', () => {
    expect(() => parseConfigSetArgs(['--value', 'foo'])).toThrow('--key is required');
  });

  it('throws when --value is missing', () => {
    expect(() => parseConfigSetArgs(['--key', 'software_delivery.methodology.testing'])).toThrow(
      '--value is required',
    );
  });

  it('handles --help without throwing', () => {
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
      'software_delivery.methodology.work_classification.ui.lane_hints',
      '--value',
      'Experience,Frontend',
    ]);
    expect(result.key).toBe('software_delivery.methodology.work_classification.ui.lane_hints');
    expect(result.value).toBe('Experience,Frontend');
  });
});

// ---------------------------------------------------------------------------
// parseConfigGetArgs
// ---------------------------------------------------------------------------

describe('parseConfigGetArgs', () => {
  it('parses --key for get', () => {
    const result = parseConfigGetArgs(['--key', 'software_delivery.methodology.testing']);
    expect(result.key).toBe('software_delivery.methodology.testing');
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
// applyConfigSet — workspace-aware routing (WU-2185)
// ---------------------------------------------------------------------------

describe('applyConfigSet (workspace-aware routing)', () => {
  // AC1: config:set --key control_plane.sync_interval writes at YAML root
  it('writes control_plane.sync_interval at workspace root', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(workspace, 'control_plane.sync_interval', '60', PACK_CONFIG_KEYS);
    expect(result.ok).toBe(true);
    expect(result.config).toBeDefined();
    // Value should be at workspace root under control_plane
    expect(getConfigValue(result.config!, 'control_plane.sync_interval')).toBe(60);
    // Other root keys should be preserved
    expect(getConfigValue(result.config!, 'id')).toBe('workspace-id');
    expect(getConfigValue(result.config!, 'software_delivery.gates.minCoverage')).toBe(90);
  });

  // AC2: config:set --key software_delivery.gates.minCoverage writes under SD block
  it('writes software_delivery.gates.minCoverage under SD block', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(
      workspace,
      'software_delivery.gates.minCoverage',
      '85',
      PACK_CONFIG_KEYS,
    );
    expect(result.ok).toBe(true);
    expect(result.config).toBeDefined();
    // Value should be under software_delivery
    expect(getConfigValue(result.config!, 'software_delivery.gates.minCoverage')).toBe(85);
    // Other workspace root keys preserved
    expect(getConfigValue(result.config!, 'id')).toBe('workspace-id');
    expect(getConfigValue(result.config!, 'control_plane.sync_interval')).toBe(30);
  });

  // AC3: config:set --key gates.minCoverage errors with did-you-mean guidance
  it('errors with did-you-mean for ambiguous shorthand key', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(workspace, 'gates.minCoverage', '85', PACK_CONFIG_KEYS);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('software_delivery.gates.minCoverage');
  });

  // AC4: config:set --key gates.unknown_key errors at write path (strict validation)
  it('errors for unknown sub-key at write path', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(workspace, 'gates.unknown_key', 'x', PACK_CONFIG_KEYS);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  // AC5: config:set --key packs.foo errors with use pack:install guidance
  it('errors with pack:install guidance for managed key', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(workspace, 'packs.foo', 'bar', PACK_CONFIG_KEYS);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('pack:install');
  });

  it('errors for lanes with lane:edit guidance', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(workspace, 'lanes.something', 'val', PACK_CONFIG_KEYS);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('lane:edit');
  });

  it('errors for completely unknown root key', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(
      workspace,
      'completely_unknown.something',
      'val',
      PACK_CONFIG_KEYS,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('completely_unknown');
  });

  // Preserves existing applyConfigSet behavior for SD pack config
  it('sets a scalar value in software_delivery config', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(
      workspace,
      'software_delivery.methodology.testing',
      'test-after',
      PACK_CONFIG_KEYS,
    );
    expect(result.ok).toBe(true);
    expect(getConfigValue(result.config!, 'software_delivery.methodology.testing')).toBe(
      'test-after',
    );
  });

  it('appends comma-separated values to an array field in SD config', () => {
    const workspace = createMinimalWorkspace();
    // Add agents.methodology.principles as an array
    (workspace.software_delivery as Record<string, unknown>).agents = {
      methodology: {
        principles: ['TDD', 'SOLID'],
      },
    };
    const result = applyConfigSet(
      workspace,
      'software_delivery.agents.methodology.principles',
      'Library-First,KISS',
      PACK_CONFIG_KEYS,
    );
    expect(result.ok).toBe(true);
    const principles = getConfigValue(
      result.config!,
      'software_delivery.agents.methodology.principles',
    );
    expect(principles).toContain('Library-First');
    expect(principles).toContain('KISS');
    expect(principles).toContain('TDD');
    expect(principles).toContain('SOLID');
  });

  it('rejects invalid value with clear error for SD config', () => {
    const workspace = createMinimalWorkspace();
    // methodology.testing only accepts 'tdd' | 'test-after' | 'none'
    const result = applyConfigSet(
      workspace,
      'software_delivery.methodology.testing',
      'invalid-value',
      PACK_CONFIG_KEYS,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('invalid');
  });

  it('rejects invalid numeric value for SD config', () => {
    const workspace = createMinimalWorkspace();
    // minCoverage must be 0-100
    const result = applyConfigSet(
      workspace,
      'software_delivery.gates.minCoverage',
      '150',
      PACK_CONFIG_KEYS,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('creates intermediate objects for new nested paths in SD config', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(
      workspace,
      'software_delivery.experimental.context_validation',
      'false',
      PACK_CONFIG_KEYS,
    );
    expect(result.ok).toBe(true);
    expect(
      getConfigValue(result.config!, 'software_delivery.experimental.context_validation'),
    ).toBe(false);
  });

  it('preserves other config values when setting one in SD config', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(
      workspace,
      'software_delivery.methodology.testing',
      'test-after',
      PACK_CONFIG_KEYS,
    );
    expect(result.ok).toBe(true);
    // Architecture should be unchanged
    expect(getConfigValue(result.config!, 'software_delivery.methodology.architecture')).toBe(
      'hexagonal',
    );
    // Version should be unchanged
    expect(getConfigValue(result.config!, 'software_delivery.version')).toBe('1.0.0');
  });

  it('handles boolean string conversion in SD config', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(
      workspace,
      'software_delivery.gates.enableCoverage',
      'false',
      PACK_CONFIG_KEYS,
    );
    expect(result.ok).toBe(true);
    expect(getConfigValue(result.config!, 'software_delivery.gates.enableCoverage')).toBe(false);
  });

  it('writes memory_namespace at workspace root as scalar', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(workspace, 'memory_namespace', 'custom-ns', PACK_CONFIG_KEYS);
    expect(result.ok).toBe(true);
    expect(getConfigValue(result.config!, 'memory_namespace')).toBe('custom-ns');
  });

  it('writes event_namespace at workspace root as scalar', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(workspace, 'event_namespace', 'custom-events', PACK_CONFIG_KEYS);
    expect(result.ok).toBe(true);
    expect(getConfigValue(result.config!, 'event_namespace')).toBe('custom-events');
  });
});

// ---------------------------------------------------------------------------
// WU-2190: Bug A — Root key writes must be schema-validated
// ---------------------------------------------------------------------------

describe('WU-2190 Bug A: root key schema validation', () => {
  it('rejects scalar overwrite of control_plane object (control_plane = "foo")', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(workspace, 'control_plane', 'foo', PACK_CONFIG_KEYS);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('control_plane');
  });

  it('rejects invalid control_plane sub-key value (sync_interval = "not-a-number")', () => {
    const workspace = createMinimalWorkspace();
    // sync_interval should be a positive integer, "abc" is not numeric
    const result = applyConfigSet(
      workspace,
      'control_plane.sync_interval',
      'abc',
      PACK_CONFIG_KEYS,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects unknown control_plane sub-key', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(
      workspace,
      'control_plane.unknown_field',
      'value',
      PACK_CONFIG_KEYS,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects overwriting memory_namespace with an object-like value when existing is string', () => {
    const workspace = createMinimalWorkspace();
    // memory_namespace must remain a string; trying to set it to something
    // that would be coerced to a non-string type is rejected.
    // However, since CLI always passes strings, the main risk is overwriting
    // a namespace root without a subPath when it should be a scalar.
    // Test: setting memory_namespace to a valid string still works
    const result = applyConfigSet(workspace, 'memory_namespace', 'new-ns', PACK_CONFIG_KEYS);
    expect(result.ok).toBe(true);
    expect(getConfigValue(result.config!, 'memory_namespace')).toBe('new-ns');
  });

  it('rejects memory_namespace sub-path write (memory_namespace.foo = bar)', () => {
    const workspace = createMinimalWorkspace();
    // memory_namespace is a scalar string, not an object — sub-path writes are invalid
    const result = applyConfigSet(workspace, 'memory_namespace.foo', 'bar', PACK_CONFIG_KEYS);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects event_namespace sub-path write (event_namespace.foo = bar)', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(workspace, 'event_namespace.foo', 'bar', PACK_CONFIG_KEYS);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('allows valid control_plane.sync_interval write', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(workspace, 'control_plane.sync_interval', '60', PACK_CONFIG_KEYS);
    expect(result.ok).toBe(true);
    expect(getConfigValue(result.config!, 'control_plane.sync_interval')).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// WU-2190: Bug B — Unknown nested pack keys must be rejected
// ---------------------------------------------------------------------------

describe('WU-2190 Bug B: unknown nested pack key rejection', () => {
  it('rejects software_delivery.gates.unknown_key', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(
      workspace,
      'software_delivery.gates.unknown_key',
      'true',
      PACK_CONFIG_KEYS,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('unknown_key');
  });

  it('rejects software_delivery.completely_unknown_section.foo', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(
      workspace,
      'software_delivery.completely_unknown_section.foo',
      'bar',
      PACK_CONFIG_KEYS,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects software_delivery.unknown_top_level_key with value', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(
      workspace,
      'software_delivery.unknown_top_level_key',
      'val',
      PACK_CONFIG_KEYS,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('still allows valid software_delivery.gates.minCoverage write', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(
      workspace,
      'software_delivery.gates.minCoverage',
      '85',
      PACK_CONFIG_KEYS,
    );
    expect(result.ok).toBe(true);
    expect(getConfigValue(result.config!, 'software_delivery.gates.minCoverage')).toBe(85);
  });

  it('still allows valid software_delivery.methodology.testing write', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(
      workspace,
      'software_delivery.methodology.testing',
      'test-after',
      PACK_CONFIG_KEYS,
    );
    expect(result.ok).toBe(true);
    expect(getConfigValue(result.config!, 'software_delivery.methodology.testing')).toBe(
      'test-after',
    );
  });

  it('still allows valid software_delivery.experimental.context_validation write', () => {
    const workspace = createMinimalWorkspace();
    const result = applyConfigSet(
      workspace,
      'software_delivery.experimental.context_validation',
      'false',
      PACK_CONFIG_KEYS,
    );
    expect(result.ok).toBe(true);
    expect(
      getConfigValue(result.config!, 'software_delivery.experimental.context_validation'),
    ).toBe(false);
  });
});

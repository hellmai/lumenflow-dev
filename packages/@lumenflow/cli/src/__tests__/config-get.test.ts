// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file config-get.test.ts
 * WU-2186: Tests for config:get — remove fallback-to-software_delivery behavior
 *
 * TDD RED phase: These tests define the new routing behavior.
 * config:get must use routeConfigKey for consistent routing with config:set.
 * No fallback to software_delivery when root key not found.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Module under test — import the new applyConfigGet + existing utilities
// ---------------------------------------------------------------------------

import { routeConfigKey, getConfigValue } from '../config-set.js';
import { applyConfigGet, type ConfigGetResult } from '../config-get.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Pack config_keys map: simulates loading from pack manifests */
const PACK_CONFIG_KEYS = new Map<string, string>([['software_delivery', 'software-delivery']]);

/** Minimal workspace with all root-level keys */
function createTestWorkspace(): Record<string, unknown> {
  return {
    id: 'test-workspace',
    name: 'Test Workspace',
    packs: [{ id: 'software-delivery', version: '3.0.0', integrity: 'dev', source: 'local' }],
    software_delivery: {
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
    },
    control_plane: {
      endpoint: 'https://api.example.com',
      sync_interval: 30,
    },
    memory_namespace: 'lumenflow',
    event_namespace: 'lumenflow-events',
  };
}

// ---------------------------------------------------------------------------
// applyConfigGet (pure function — WU-2186)
// ---------------------------------------------------------------------------

describe('applyConfigGet (WU-2186: no fallback to software_delivery)', () => {
  // AC1: config:get --key control_plane.endpoint reads from root only
  it('reads control_plane.endpoint from workspace root', () => {
    const workspace = createTestWorkspace();
    const result = applyConfigGet(workspace, 'control_plane.endpoint', PACK_CONFIG_KEYS);
    expect(result.ok).toBe(true);
    expect(result.value).toBe('https://api.example.com');
  });

  it('reads control_plane.sync_interval from workspace root', () => {
    const workspace = createTestWorkspace();
    const result = applyConfigGet(workspace, 'control_plane.sync_interval', PACK_CONFIG_KEYS);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(30);
  });

  // AC2: config:get --key software_delivery.gates.minCoverage reads from SD block
  it('reads software_delivery.gates.minCoverage from SD block', () => {
    const workspace = createTestWorkspace();
    const result = applyConfigGet(
      workspace,
      'software_delivery.gates.minCoverage',
      PACK_CONFIG_KEYS,
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(90);
  });

  it('reads software_delivery.methodology.testing from SD block', () => {
    const workspace = createTestWorkspace();
    const result = applyConfigGet(
      workspace,
      'software_delivery.methodology.testing',
      PACK_CONFIG_KEYS,
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe('tdd');
  });

  it('reads software_delivery.methodology as nested object', () => {
    const workspace = createTestWorkspace();
    const result = applyConfigGet(workspace, 'software_delivery.methodology', PACK_CONFIG_KEYS);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      testing: 'tdd',
      architecture: 'hexagonal',
    });
  });

  // AC3: config:get does NOT fall back to software_delivery when root key not found
  it('does NOT fall back to software_delivery for unqualified key "methodology.testing"', () => {
    const workspace = createTestWorkspace();
    const result = applyConfigGet(workspace, 'methodology.testing', PACK_CONFIG_KEYS);
    // Should error, NOT silently return 'tdd'
    expect(result.ok).toBe(false);
    expect(result.value).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  it('does NOT fall back for unqualified key "gates.minCoverage"', () => {
    const workspace = createTestWorkspace();
    const result = applyConfigGet(workspace, 'gates.minCoverage', PACK_CONFIG_KEYS);
    // Should error with did-you-mean, NOT return 90
    expect(result.ok).toBe(false);
    expect(result.error).toContain('software_delivery.gates.minCoverage');
  });

  // Managed keys should error with guidance
  it('errors for managed key "packs" with pack:install guidance', () => {
    const workspace = createTestWorkspace();
    const result = applyConfigGet(workspace, 'packs', PACK_CONFIG_KEYS);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('pack:install');
  });

  it('errors for managed key "lanes" with lane:edit guidance', () => {
    const workspace = createTestWorkspace();
    const result = applyConfigGet(workspace, 'lanes.something', PACK_CONFIG_KEYS);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('lane:edit');
  });

  // Completely unknown root key should error
  it('errors for completely unknown root key', () => {
    const workspace = createTestWorkspace();
    const result = applyConfigGet(workspace, 'completely_unknown.something', PACK_CONFIG_KEYS);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('completely_unknown');
  });

  // Scalar root keys
  it('reads memory_namespace scalar from workspace root', () => {
    const workspace = createTestWorkspace();
    const result = applyConfigGet(workspace, 'memory_namespace', PACK_CONFIG_KEYS);
    expect(result.ok).toBe(true);
    expect(result.value).toBe('lumenflow');
  });

  it('reads event_namespace scalar from workspace root', () => {
    const workspace = createTestWorkspace();
    const result = applyConfigGet(workspace, 'event_namespace', PACK_CONFIG_KEYS);
    expect(result.ok).toBe(true);
    expect(result.value).toBe('lumenflow-events');
  });

  // Undefined values under valid roots
  it('returns undefined for nonexistent key under valid writable root', () => {
    const workspace = createTestWorkspace();
    const result = applyConfigGet(workspace, 'control_plane.nonexistent', PACK_CONFIG_KEYS);
    expect(result.ok).toBe(true);
    expect(result.value).toBeUndefined();
  });

  it('returns undefined for nonexistent key under valid pack config', () => {
    const workspace = createTestWorkspace();
    const result = applyConfigGet(
      workspace,
      'software_delivery.nonexistent.deep',
      PACK_CONFIG_KEYS,
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Verify deprecated exports are removed from config-set.ts
// ---------------------------------------------------------------------------

describe('deprecated exports removed from config-set.ts (WU-2186 cleanup)', () => {
  it('does not export normalizeWorkspaceConfigKey', async () => {
    const configSet = await import('../config-set.js');
    expect('normalizeWorkspaceConfigKey' in configSet).toBe(false);
  });

  it('does not export WORKSPACE_CONFIG_PREFIX', async () => {
    const configSet = await import('../config-set.js');
    expect('WORKSPACE_CONFIG_PREFIX' in configSet).toBe(false);
  });

  it('does not export WORKSPACE_CONFIG_ROOT_KEY', async () => {
    const configSet = await import('../config-set.js');
    expect('WORKSPACE_CONFIG_ROOT_KEY' in configSet).toBe(false);
  });

  it('does not export getSoftwareDeliveryConfigFromWorkspace', async () => {
    const configSet = await import('../config-set.js');
    expect('getSoftwareDeliveryConfigFromWorkspace' in configSet).toBe(false);
  });

  it('does not export setSoftwareDeliveryConfigInWorkspace', async () => {
    const configSet = await import('../config-set.js');
    expect('setSoftwareDeliveryConfigInWorkspace' in configSet).toBe(false);
  });
});

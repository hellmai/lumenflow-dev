// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

describe('infra-ops pack manifest', () => {
  // Lazy-import so the test file compiles even before implementation exists.
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const loadManifest = async () =>
    (await import('../manifest.js')) as typeof import('../manifest.js');

  it('exports INFRA_OPS_MANIFEST with correct id and version', async () => {
    const { INFRA_OPS_MANIFEST } = await loadManifest();
    expect(INFRA_OPS_MANIFEST.id).toBe('infra-ops');
    expect(INFRA_OPS_MANIFEST.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('declares exactly 7 tools', async () => {
    const { INFRA_OPS_MANIFEST } = await loadManifest();
    expect(INFRA_OPS_MANIFEST.tools).toHaveLength(7);
  });

  it('declares the 7 required tool names', async () => {
    const { INFRA_OPS_MANIFEST } = await loadManifest();
    const toolNames = INFRA_OPS_MANIFEST.tools.map((t) => t.name);
    expect(toolNames).toEqual([
      'terraform:plan',
      'terraform:apply',
      'k8s:get',
      'k8s:apply',
      'dns:lookup',
      'dns:update',
      'cloud:describe',
    ]);
  });

  it('sets correct permissions for each tool', async () => {
    const { INFRA_OPS_MANIFEST } = await loadManifest();
    const permissionMap = Object.fromEntries(
      INFRA_OPS_MANIFEST.tools.map((t) => [t.name, t.permission]),
    );
    // Read-only tools
    expect(permissionMap['terraform:plan']).toBe('read');
    expect(permissionMap['k8s:get']).toBe('read');
    expect(permissionMap['dns:lookup']).toBe('read');
    expect(permissionMap['cloud:describe']).toBe('read');
    // Write tools
    expect(permissionMap['terraform:apply']).toBe('write');
    expect(permissionMap['k8s:apply']).toBe('write');
    expect(permissionMap['dns:update']).toBe('write');
  });

  it('all tools point to the pending-runtime-tools stub entry', async () => {
    const { INFRA_OPS_MANIFEST } = await loadManifest();
    for (const tool of INFRA_OPS_MANIFEST.tools) {
      expect(tool.entry).toBe('tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool');
    }
  });

  it('all tools have required_scopes with correct access level', async () => {
    const { INFRA_OPS_MANIFEST } = await loadManifest();
    for (const tool of INFRA_OPS_MANIFEST.tools) {
      expect(tool.required_scopes).toHaveLength(1);
      const scope = tool.required_scopes[0];
      expect(scope.type).toBe('path');
      expect(scope.pattern).toBe('**');
      expect(scope.access).toBe(tool.permission === 'read' ? 'read' : 'write');
    }
  });

  it('declares exactly 3 policies', async () => {
    const { INFRA_OPS_MANIFEST } = await loadManifest();
    expect(INFRA_OPS_MANIFEST.policies).toHaveLength(3);
  });

  it('declares change-window policy with on_completion trigger and deny decision', async () => {
    const { INFRA_OPS_MANIFEST } = await loadManifest();
    const policy = INFRA_OPS_MANIFEST.policies.find((p) => p.id === 'infra-ops.change-window');
    expect(policy).toBeDefined();
    expect(policy!.trigger).toBe('on_completion');
    expect(policy!.decision).toBe('deny');
  });

  it('declares blast-radius-limit policy with on_tool_request trigger and deny decision', async () => {
    const { INFRA_OPS_MANIFEST } = await loadManifest();
    const policy = INFRA_OPS_MANIFEST.policies.find((p) => p.id === 'infra-ops.blast-radius-limit');
    expect(policy).toBeDefined();
    expect(policy!.trigger).toBe('on_tool_request');
    expect(policy!.decision).toBe('deny');
  });

  it('declares approval-chain policy with on_claim trigger and deny decision', async () => {
    const { INFRA_OPS_MANIFEST } = await loadManifest();
    const policy = INFRA_OPS_MANIFEST.policies.find((p) => p.id === 'infra-ops.approval-chain');
    expect(policy).toBeDefined();
    expect(policy!.trigger).toBe('on_claim');
    expect(policy!.decision).toBe('deny');
  });

  it('declares task_types with infra-task', async () => {
    const { INFRA_OPS_MANIFEST } = await loadManifest();
    expect(INFRA_OPS_MANIFEST.task_types).toContain('infra-task');
  });

  it('validates against SoftwareDeliveryManifestSchema', async () => {
    const { INFRA_OPS_MANIFEST } = await loadManifest();
    const { SoftwareDeliveryManifestSchema } =
      await import('../../software-delivery/manifest-schema.js');
    // Should not throw
    const parsed = SoftwareDeliveryManifestSchema.parse(INFRA_OPS_MANIFEST);
    expect(parsed.id).toBe('infra-ops');
    expect(parsed.tools).toHaveLength(7);
    expect(parsed.policies).toHaveLength(3);
  });

  it('exports InfraOpsPackManifest type alias via index', async () => {
    const indexModule = await import('../index.js');
    expect(indexModule.INFRA_OPS_MANIFEST).toBeDefined();
    expect(indexModule.INFRA_OPS_MANIFEST.id).toBe('infra-ops');
  });
});

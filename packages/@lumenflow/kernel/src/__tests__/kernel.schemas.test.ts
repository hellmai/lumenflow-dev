// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  ToolScopeSchema,
  TaskSpecSchema,
  RunSchema,
  TaskStateSchema,
  KernelEventSchema,
  WorkspaceSpecSchema,
  LaneSpecSchema,
  PackPinSchema,
  ToolHandlerSchema,
  ToolCapabilitySchema,
  ToolTraceEntrySchema,
  canonical_json,
  toMcpJsonSchema,
  KERNEL_OWNED_ROOT_KEYS,
  validateWorkspaceRootKeys,
} from '../index.js';
import type { DomainPackManifest } from '../index.js';

describe('kernel schemas', () => {
  const writeScope = {
    type: 'path',
    pattern: 'packages/@lumenflow/kernel/**',
    access: 'write',
  } as const;

  const readScope = {
    type: 'path',
    pattern: 'docs/**',
    access: 'read',
  } as const;

  describe('ToolScopeSchema', () => {
    it('accepts path scopes with read/write access', () => {
      expect(ToolScopeSchema.safeParse(writeScope).success).toBe(true);
      expect(ToolScopeSchema.safeParse(readScope).success).toBe(true);
    });

    it('accepts network scope with posture', () => {
      const result = ToolScopeSchema.safeParse({
        type: 'network',
        posture: 'off',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid scope variants', () => {
      expect(
        ToolScopeSchema.safeParse({
          type: 'path',
          pattern: 'src/**',
          access: 'admin',
        }).success,
      ).toBe(false);

      expect(
        ToolScopeSchema.safeParse({
          type: 'network',
          posture: 'limited',
        }).success,
      ).toBe(false);
    });
  });

  describe('TaskSpecSchema', () => {
    it('accepts a domain-agnostic task with declared scopes', () => {
      const result = TaskSpecSchema.safeParse({
        id: 'WU-1725',
        workspace_id: 'workspace-default',
        lane_id: 'framework-core',
        domain: 'software-delivery',
        title: 'Kernel schema contracts',
        description: 'Create schema contracts and tests',
        acceptance: ['All schema tests pass'],
        declared_scopes: [writeScope, readScope],
        risk: 'medium',
        type: 'feature',
        priority: 'P0',
        created: '2026-02-16',
      });

      expect(result.success).toBe(true);
    });

    it('rejects task specs without typed declared scopes', () => {
      const result = TaskSpecSchema.safeParse({
        id: 'WU-1725',
        workspace_id: 'workspace-default',
        lane_id: 'framework-core',
        domain: 'software-delivery',
        title: 'Kernel schema contracts',
        description: 'Create schema contracts and tests',
        acceptance: ['All schema tests pass'],
        declared_scopes: ['packages/@lumenflow/kernel/**'],
        risk: 'medium',
        type: 'feature',
        priority: 'P0',
        created: '2026-02-16',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('RunSchema', () => {
    it('accepts a run primitive', () => {
      const result = RunSchema.safeParse({
        run_id: 'run-0001',
        task_id: 'WU-1725',
        status: 'executing',
        started_at: '2026-02-16T12:00:00.000Z',
        by: 'tom@hellm.ai',
        session_id: 'session-123',
      });

      expect(result.success).toBe(true);
    });

    it('rejects invalid run statuses', () => {
      const result = RunSchema.safeParse({
        run_id: 'run-0001',
        task_id: 'WU-1725',
        status: 'unknown',
        started_at: '2026-02-16T12:00:00.000Z',
        by: 'tom@hellm.ai',
        session_id: 'session-123',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('TaskStateSchema', () => {
    it('accepts projected task state', () => {
      const result = TaskStateSchema.safeParse({
        task_id: 'WU-1725',
        status: 'active',
        run_count: 1,
      });

      expect(result.success).toBe(true);
    });

    it('rejects invalid projection status values', () => {
      const result = TaskStateSchema.safeParse({
        task_id: 'WU-1725',
        status: 'in_progress',
        run_count: 1,
      });

      expect(result.success).toBe(false);
    });
  });

  describe('PackPinSchema + WorkspaceSpecSchema + LaneSpecSchema', () => {
    it('accepts valid pack pins including dev and sha256 integrity', () => {
      expect(
        PackPinSchema.safeParse({
          id: 'software-delivery',
          version: '1.0.0',
          integrity: 'dev',
          source: 'local',
        }).success,
      ).toBe(true);

      expect(
        PackPinSchema.safeParse({
          id: 'software-delivery',
          version: '1.0.0',
          integrity: `sha256:${'a'.repeat(64)}`,
          source: 'registry',
        }).success,
      ).toBe(true);
    });

    it('rejects invalid pack integrity format', () => {
      const result = PackPinSchema.safeParse({
        id: 'software-delivery',
        version: '1.0.0',
        integrity: 'sha1:abc',
        source: 'registry',
      });

      expect(result.success).toBe(false);
    });

    it('accepts a workspace spec with security.allowed_scopes, packs, and software_delivery', () => {
      const lane = {
        id: 'framework-core',
        title: 'Framework: Core Validation',
        allowed_scopes: [writeScope],
      };
      expect(LaneSpecSchema.safeParse(lane).success).toBe(true);

      const result = WorkspaceSpecSchema.safeParse({
        id: 'workspace-default',
        name: 'LumenFlow OS',
        packs: [
          {
            id: 'software-delivery',
            version: '1.0.0',
            integrity: 'dev',
            source: 'local',
          },
        ],
        lanes: [lane],
        security: {
          allowed_scopes: [writeScope, { type: 'network', posture: 'off' }],
          network_default: 'off',
          deny_overlays: ['~/.ssh/**'],
        },
        software_delivery: {},
        memory_namespace: 'memory-default',
        event_namespace: 'events-default',
      });

      expect(result.success).toBe(true);
    });

    it('accepts workspace spec when software_delivery is missing (optional field)', () => {
      const lane = {
        id: 'framework-core',
        title: 'Framework: Core Validation',
        allowed_scopes: [writeScope],
      };

      const result = WorkspaceSpecSchema.safeParse({
        id: 'workspace-default',
        name: 'LumenFlow OS',
        packs: [
          {
            id: 'software-delivery',
            version: '1.0.0',
            integrity: 'dev',
            source: 'local',
          },
        ],
        lanes: [lane],
        security: {
          allowed_scopes: [writeScope, { type: 'network', posture: 'off' }],
          network_default: 'off',
          deny_overlays: ['~/.ssh/**'],
        },
        memory_namespace: 'memory-default',
        event_namespace: 'events-default',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.software_delivery).toBeUndefined();
      }
    });

    it('accepts control_plane when all fields are valid', () => {
      const parsed = WorkspaceSpecSchema.parse({
        id: 'workspace-default',
        name: 'LumenFlow OS',
        packs: [
          {
            id: 'software-delivery',
            version: '1.0.0',
            integrity: 'dev',
            source: 'local',
          },
        ],
        lanes: [],
        security: {
          allowed_scopes: [{ type: 'network', posture: 'off' }],
          network_default: 'off',
          deny_overlays: [],
        },
        software_delivery: {},
        control_plane: {
          endpoint: 'https://control-plane.example',
          org_id: 'org-1',
          project_id: 'proj-1',
          sync_interval: 60,
          policy_mode: 'tighten-only',
          auth: {
            token_env: 'LUMENFLOW_CONTROL_PLANE_TOKEN',
          },
        },
        memory_namespace: 'memory-default',
        event_namespace: 'events-default',
      });

      expect(parsed.control_plane).toEqual({
        endpoint: 'https://control-plane.example',
        org_id: 'org-1',
        project_id: 'proj-1',
        sync_interval: 60,
        policy_mode: 'tighten-only',
        auth: {
          token_env: 'LUMENFLOW_CONTROL_PLANE_TOKEN',
        },
      });
    });

    it('rejects invalid control_plane fields when provided', () => {
      const result = WorkspaceSpecSchema.safeParse({
        id: 'workspace-default',
        name: 'LumenFlow OS',
        packs: [
          {
            id: 'software-delivery',
            version: '1.0.0',
            integrity: 'dev',
            source: 'local',
          },
        ],
        lanes: [],
        security: {
          allowed_scopes: [{ type: 'network', posture: 'off' }],
          network_default: 'off',
          deny_overlays: [],
        },
        software_delivery: {},
        control_plane: {
          endpoint: 'not-a-url',
          org_id: 'org-1',
          project_id: 'proj-1',
          sync_interval: 0,
          policy_mode: 'legacy',
          auth: {
            token_env: 'control_plane_token',
          },
        },
        memory_namespace: 'memory-default',
        event_namespace: 'events-default',
      });

      expect(result.success).toBe(false);
    });

    it('rejects control_plane when auth contract is missing', () => {
      const result = WorkspaceSpecSchema.safeParse({
        id: 'workspace-default',
        name: 'LumenFlow OS',
        packs: [],
        lanes: [],
        security: {
          allowed_scopes: [{ type: 'network', posture: 'off' }],
          network_default: 'off',
          deny_overlays: [],
        },
        software_delivery: {},
        control_plane: {
          endpoint: 'https://control-plane.example',
          org_id: 'org-1',
          project_id: 'proj-1',
          sync_interval: 60,
          policy_mode: 'authoritative',
        },
        memory_namespace: 'memory-default',
        event_namespace: 'events-default',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('ToolHandlerSchema + ToolCapabilitySchema', () => {
    it('accepts in-process and subprocess handlers', () => {
      expect(
        ToolHandlerSchema.safeParse({
          kind: 'in-process',
          fn: async () => ({ success: true }),
        }).success,
      ).toBe(true);

      expect(
        ToolHandlerSchema.safeParse({
          kind: 'subprocess',
          entry: 'software-delivery/git-commit',
        }).success,
      ).toBe(true);
    });

    it('rejects malformed handlers', () => {
      expect(
        ToolHandlerSchema.safeParse({
          kind: 'in-process',
          fn: 'not-a-function',
        }).success,
      ).toBe(false);
    });

    it('uses handler descriptors in ToolCapability', () => {
      const result = ToolCapabilitySchema.safeParse({
        name: 'fs:write',
        domain: 'file',
        version: '1.0.0',
        input_schema: z.object({
          path: z.string(),
          content: z.string(),
        }),
        output_schema: z.object({
          success: z.boolean(),
        }),
        permission: 'write',
        required_scopes: [writeScope],
        handler: {
          kind: 'subprocess',
          entry: 'kernel/fs-write',
        },
        description: 'Write file content',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('KernelEventSchema', () => {
    it('accepts task_created events with schema_version:1 and spec_hash', () => {
      const result = KernelEventSchema.safeParse({
        schema_version: 1,
        kind: 'task_created',
        task_id: 'WU-1725',
        timestamp: '2026-02-16T12:00:00.000Z',
        spec_hash: '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
      });

      expect(result.success).toBe(true);
    });

    it('rejects task_created events missing spec_hash', () => {
      const result = KernelEventSchema.safeParse({
        schema_version: 1,
        kind: 'task_created',
        task_id: 'WU-1725',
        timestamp: '2026-02-16T12:00:00.000Z',
      });

      expect(result.success).toBe(false);
    });

    it('rejects non-prefixed event kinds', () => {
      const result = KernelEventSchema.safeParse({
        schema_version: 1,
        kind: 'created',
        task_id: 'WU-1725',
        timestamp: '2026-02-16T12:00:00.000Z',
      });

      expect(result.success).toBe(false);
    });

    it('accepts run_, workspace_, and spec_ event kinds', () => {
      expect(
        KernelEventSchema.safeParse({
          schema_version: 1,
          kind: 'run_started',
          task_id: 'WU-1725',
          run_id: 'run-1',
          timestamp: '2026-02-16T12:00:00.000Z',
          by: 'tom@hellm.ai',
          session_id: 'session-1',
        }).success,
      ).toBe(true);

      expect(
        KernelEventSchema.safeParse({
          schema_version: 1,
          kind: 'workspace_updated',
          timestamp: '2026-02-16T12:00:00.000Z',
          config_hash: 'a'.repeat(64),
          changes_summary: 'Updated workspace defaults',
        }).success,
      ).toBe(true);

      expect(
        KernelEventSchema.safeParse({
          schema_version: 1,
          kind: 'spec_tampered',
          timestamp: '2026-02-16T12:00:00.000Z',
          spec: 'task',
          id: 'WU-1725',
          expected_hash: 'a'.repeat(64),
          actual_hash: 'b'.repeat(64),
        }).success,
      ).toBe(true);
    });
  });

  describe('ToolTraceEntrySchema', () => {
    it('accepts tool_call_started and tool_call_finished entries', () => {
      const started = ToolTraceEntrySchema.safeParse({
        schema_version: 1,
        kind: 'tool_call_started',
        receipt_id: 'receipt-1',
        run_id: 'run-1',
        task_id: 'WU-1725',
        session_id: 'session-1',
        timestamp: '2026-02-16T12:00:00.000Z',
        tool_name: 'fs:write',
        execution_mode: 'subprocess',
        scope_requested: [writeScope],
        scope_allowed: [writeScope],
        scope_enforced: [writeScope],
        input_hash: '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
        input_ref: '.lumenflow/evidence/inputs/43258cff',
        tool_version: '1.0.0',
        workspace_config_hash: 'f'.repeat(64),
        runtime_version: '0.1.0',
      });

      const finished = ToolTraceEntrySchema.safeParse({
        schema_version: 1,
        kind: 'tool_call_finished',
        receipt_id: 'receipt-1',
        timestamp: '2026-02-16T12:00:01.000Z',
        result: 'success',
        duration_ms: 1000,
        policy_decisions: [
          {
            policy_id: 'workspace.default',
            decision: 'allow',
          },
        ],
      });

      expect(started.success).toBe(true);
      expect(finished.success).toBe(true);
    });

    it('rejects malformed trace entries', () => {
      const result = ToolTraceEntrySchema.safeParse({
        schema_version: 1,
        kind: 'tool_call_finished',
        timestamp: '2026-02-16T12:00:01.000Z',
        result: 'success',
        duration_ms: 1000,
      });

      expect(result.success).toBe(false);
    });
  });

  describe('canonical_json()', () => {
    it('normalizes object key ordering into deterministic SHA-256 hash', () => {
      const hash = canonical_json({ b: 2, a: 1 });
      expect(hash).toBe('43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777');
    });

    it('produces identical hashes for equivalent YAML content', () => {
      const hash1 = canonical_json('b: 2\na: 1\n');
      const hash2 = canonical_json('a: 1\nb: 2\n');
      expect(hash1).toBe(hash2);
    });

    it('sorts nested object keys recursively', () => {
      const hash1 = canonical_json('a:\n  z: 2\n  y: 1\n');
      const hash2 = canonical_json('a:\n  y: 1\n  z: 2\n');
      expect(hash1).toBe(hash2);
    });
  });

  describe('KERNEL_OWNED_ROOT_KEYS', () => {
    it('contains exactly the kernel-owned keys without pack config keys', () => {
      expect(KERNEL_OWNED_ROOT_KEYS).toContain('id');
      expect(KERNEL_OWNED_ROOT_KEYS).toContain('name');
      expect(KERNEL_OWNED_ROOT_KEYS).toContain('packs');
      expect(KERNEL_OWNED_ROOT_KEYS).toContain('lanes');
      expect(KERNEL_OWNED_ROOT_KEYS).toContain('policies');
      expect(KERNEL_OWNED_ROOT_KEYS).toContain('security');
      expect(KERNEL_OWNED_ROOT_KEYS).toContain('control_plane');
      expect(KERNEL_OWNED_ROOT_KEYS).toContain('memory_namespace');
      expect(KERNEL_OWNED_ROOT_KEYS).toContain('event_namespace');
      // software_delivery is NOT a kernel root key -- it comes from pack manifests
      expect(KERNEL_OWNED_ROOT_KEYS).not.toContain('software_delivery');
    });
  });

  describe('validateWorkspaceRootKeys (two-phase validation)', () => {
    const baseWorkspaceData = {
      id: 'workspace-default',
      name: 'LumenFlow OS',
      packs: [],
      lanes: [],
      security: {
        allowed_scopes: [{ type: 'network', posture: 'off' }],
        network_default: 'off',
        deny_overlays: [],
      },
      memory_namespace: 'memory-default',
      event_namespace: 'events-default',
    };

    const sdPackManifest: DomainPackManifest = {
      id: 'software-delivery',
      version: '1.0.0',
      task_types: ['feature'],
      tools: [],
      policies: [],
      evidence_types: [],
      state_aliases: {},
      lane_templates: [],
      config_key: 'software_delivery',
    };

    it('accepts workspace without software_delivery when SD pack not pinned', () => {
      const result = validateWorkspaceRootKeys(baseWorkspaceData, []);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('accepts workspace with software_delivery when SD pack is pinned and declares config_key', () => {
      const data = {
        ...baseWorkspaceData,
        software_delivery: { gates: { minCoverage: 90 } },
      };
      const result = validateWorkspaceRootKeys(data, [sdPackManifest]);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('rejects workspace with unknown root key', () => {
      const data = {
        ...baseWorkspaceData,
        observability: { endpoint: 'https://example.com' },
      };
      const result = validateWorkspaceRootKeys(data, []);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('observability');
    });

    it('accepts workspace with declared pack config_key from a custom pack', () => {
      const observabilityPack: DomainPackManifest = {
        id: 'observability',
        version: '1.0.0',
        task_types: ['monitoring'],
        tools: [],
        policies: [],
        evidence_types: [],
        state_aliases: {},
        lane_templates: [],
        config_key: 'observability',
      };

      const data = {
        ...baseWorkspaceData,
        observability: { endpoint: 'https://example.com' },
      };
      const result = validateWorkspaceRootKeys(data, [observabilityPack]);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('rejects workspace with software_delivery when no pack declares that config_key', () => {
      const data = {
        ...baseWorkspaceData,
        software_delivery: { gates: {} },
      };
      // No packs pinned, so software_delivery is an unknown root key
      const result = validateWorkspaceRootKeys(data, []);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('software_delivery');
    });

    it('accepts all kernel root keys without needing pack manifests', () => {
      const data = {
        ...baseWorkspaceData,
        policies: { default: 'allow' },
        control_plane: {
          endpoint: 'https://example.com',
          org_id: 'org-1',
          project_id: 'proj-1',
          sync_interval: 60,
          policy_mode: 'tighten-only',
          auth: { token_env: 'TOKEN' },
        },
      };
      const result = validateWorkspaceRootKeys(data, []);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('reports all unknown root keys in errors', () => {
      const data = {
        ...baseWorkspaceData,
        unknown_one: {},
        unknown_two: 'value',
      };
      const result = validateWorkspaceRootKeys(data, []);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors.some((e: string) => e.includes('unknown_one'))).toBe(true);
      expect(result.errors.some((e: string) => e.includes('unknown_two'))).toBe(true);
    });

    it('accepts workspace with multiple pack config_keys', () => {
      const observabilityPack: DomainPackManifest = {
        id: 'observability',
        version: '1.0.0',
        task_types: ['monitoring'],
        tools: [],
        policies: [],
        evidence_types: [],
        state_aliases: {},
        lane_templates: [],
        config_key: 'observability',
      };

      const data = {
        ...baseWorkspaceData,
        software_delivery: { gates: {} },
        observability: { endpoint: 'https://example.com' },
      };
      const result = validateWorkspaceRootKeys(data, [sdPackManifest, observabilityPack]);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('ignores packs without config_key', () => {
      const noConfigPack: DomainPackManifest = {
        id: 'simple-pack',
        version: '1.0.0',
        task_types: ['task'],
        tools: [],
        policies: [],
        evidence_types: [],
        state_aliases: {},
        lane_templates: [],
        // no config_key
      };

      const result = validateWorkspaceRootKeys(baseWorkspaceData, [noConfigPack]);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('MCP JSON Schema export', () => {
    it('uses Zod v4 JSON schema export for MCP-compatible tool input definitions', () => {
      const schema = z.object({
        task_id: z.string(),
        declared_scopes: z.array(ToolScopeSchema),
      });

      const jsonSchema = toMcpJsonSchema(schema) as {
        type?: string;
        properties?: Record<string, unknown>;
      };

      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties?.task_id).toBeDefined();
      expect(jsonSchema.properties?.declared_scopes).toBeDefined();
    });
  });
});

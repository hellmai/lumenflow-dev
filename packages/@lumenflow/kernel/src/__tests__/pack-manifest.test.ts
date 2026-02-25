// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOFTWARE_DELIVERY_PACK_ID } from '../../../packs/software-delivery/constants.js';
import { WorkspaceSpecSchema } from '../kernel.schemas.js';
import { PACK_MANIFEST_FILE_NAME, UTF8_ENCODING } from '../shared-constants.js';
import { DomainPackManifestSchema, PackLoader } from '../pack/index.js';

// --- Helpers ---

function minimalManifestInput(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: SOFTWARE_DELIVERY_PACK_ID,
    version: '1.0.0',
    task_types: ['wu'],
    tools: [
      {
        name: 'fs:read',
        entry: 'tools/fs-read.ts',
        permission: 'read',
        required_scopes: [{ type: 'path', pattern: 'src/**', access: 'read' }],
      },
    ],
    policies: [{ id: 'workspace.default', trigger: 'on_tool_request', decision: 'allow' }],
    evidence_types: ['trace'],
    state_aliases: { active: 'in_progress' },
    lane_templates: [{ id: 'framework-core', title: 'Framework Core' }],
    ...overrides,
  };
}

function createWorkspaceSpec() {
  return WorkspaceSpecSchema.parse({
    id: 'workspace-test',
    name: 'Test Workspace',
    packs: [
      {
        id: SOFTWARE_DELIVERY_PACK_ID,
        version: '1.0.0',
        integrity: 'dev',
        source: 'local',
      },
    ],
    lanes: [
      {
        id: 'framework-core',
        title: 'Framework Core',
        allowed_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
      },
    ],
    security: {
      allowed_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
      network_default: 'off',
      deny_overlays: ['.env'],
    },
    software_delivery: {},
    memory_namespace: 'mem',
    event_namespace: 'evt',
  });
}

async function writeManifestFixture(
  packRoot: string,
  manifestOverrides?: Record<string, unknown>,
): Promise<void> {
  await mkdir(join(packRoot, 'tools'), { recursive: true });
  const manifestInput = minimalManifestInput(manifestOverrides);
  const lines: string[] = [
    `id: ${manifestInput.id}`,
    `version: ${manifestInput.version}`,
    'task_types:',
    '  - wu',
    'tools:',
    '  - name: fs:read',
    '    entry: tools/fs-read.ts',
    '    permission: read',
    '    required_scopes:',
    '      - type: path',
    '        pattern: "**"',
    '        access: read',
    'policies:',
    '  - id: workspace.default',
    '    trigger: on_tool_request',
    '    decision: allow',
    'evidence_types:',
    '  - trace',
    'state_aliases:',
    '  active: in_progress',
    'lane_templates:',
    '  - id: framework-core',
    '    title: Framework Core',
  ];

  if (manifestInput.config_key !== undefined) {
    lines.push(`config_key: ${manifestInput.config_key}`);
  }
  if (manifestInput.config_schema !== undefined) {
    lines.push(`config_schema: ${manifestInput.config_schema}`);
  }

  await writeFile(join(packRoot, PACK_MANIFEST_FILE_NAME), lines.join('\n'), UTF8_ENCODING);
  await writeFile(
    join(packRoot, 'tools', 'fs-read.ts'),
    ['import { readFile } from "node:fs/promises";', 'export const tool = readFile;'].join('\n'),
    UTF8_ENCODING,
  );
}

// --- Tests ---

describe('DomainPackManifestSchema config_key and config_schema fields', () => {
  // AC1: DomainPackManifestSchema includes config_key: z.string().min(1).optional()
  describe('config_key field', () => {
    it('accepts a manifest with config_key present', () => {
      const manifest = DomainPackManifestSchema.parse(
        minimalManifestInput({ config_key: 'software_delivery' }),
      );

      expect(manifest.config_key).toBe('software_delivery');
    });

    it('accepts a manifest without config_key (optional)', () => {
      const manifest = DomainPackManifestSchema.parse(minimalManifestInput());

      expect(manifest.config_key).toBeUndefined();
    });

    it('rejects config_key that is an empty string', () => {
      expect(() => DomainPackManifestSchema.parse(minimalManifestInput({ config_key: '' }))).toThrow();
    });

    it('rejects config_key that is not a string', () => {
      expect(() =>
        DomainPackManifestSchema.parse(minimalManifestInput({ config_key: 42 })),
      ).toThrow();
    });
  });

  // AC2: DomainPackManifestSchema includes config_schema: z.string().optional()
  describe('config_schema field', () => {
    it('accepts a manifest with config_schema present', () => {
      const manifest = DomainPackManifestSchema.parse(
        minimalManifestInput({ config_schema: 'schemas/config.json' }),
      );

      expect(manifest.config_schema).toBe('schemas/config.json');
    });

    it('accepts a manifest without config_schema (optional)', () => {
      const manifest = DomainPackManifestSchema.parse(minimalManifestInput());

      expect(manifest.config_schema).toBeUndefined();
    });

    it('rejects config_schema that is not a string', () => {
      expect(() =>
        DomainPackManifestSchema.parse(minimalManifestInput({ config_schema: 123 })),
      ).toThrow();
    });
  });

  // AC1 + AC2 combined: both fields present together
  it('accepts a manifest with both config_key and config_schema', () => {
    const manifest = DomainPackManifestSchema.parse(
      minimalManifestInput({
        config_key: 'software_delivery',
        config_schema: 'schemas/sd-config.json',
      }),
    );

    expect(manifest.config_key).toBe('software_delivery');
    expect(manifest.config_schema).toBe('schemas/sd-config.json');
  });
});

// AC4: Pack loader reads and exposes config_key from loaded manifests
describe('PackLoader exposes config_key from loaded manifests', () => {
  it('exposes config_key on the loaded manifest when declared in YAML', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-config-key-'));
    const packRoot = join(tempRoot, SOFTWARE_DELIVERY_PACK_ID);

    try {
      await writeManifestFixture(packRoot, { config_key: 'software_delivery' });

      const loader = new PackLoader({ packsRoot: tempRoot });
      const loaded = await loader.load({
        workspaceSpec: createWorkspaceSpec(),
        packId: SOFTWARE_DELIVERY_PACK_ID,
      });

      expect(loaded.manifest.config_key).toBe('software_delivery');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('exposes config_key as undefined when not declared in YAML', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-no-config-key-'));
    const packRoot = join(tempRoot, SOFTWARE_DELIVERY_PACK_ID);

    try {
      await writeManifestFixture(packRoot);

      const loader = new PackLoader({ packsRoot: tempRoot });
      const loaded = await loader.load({
        workspaceSpec: createWorkspaceSpec(),
        packId: SOFTWARE_DELIVERY_PACK_ID,
      });

      expect(loaded.manifest.config_key).toBeUndefined();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

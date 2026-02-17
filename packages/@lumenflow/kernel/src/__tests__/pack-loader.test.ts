// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { SOFTWARE_DELIVERY_PACK_ID } from '../../../packs/software-delivery/constants.js';
import { delegationToolCapabilities } from '../../../packs/software-delivery/tools/delegation-tools.js';
import { gitToolCapabilities } from '../../../packs/software-delivery/tools/git-tools.js';
import { laneLockToolCapabilities } from '../../../packs/software-delivery/tools/lane-lock-tool.js';
import { worktreeToolCapabilities } from '../../../packs/software-delivery/tools/worktree-tools.js';
import { WorkspaceSpecSchema } from '../kernel.schemas.js';
import { PACK_MANIFEST_FILE_NAME, UTF8_ENCODING } from '../shared-constants.js';
import {
  DomainPackManifestSchema,
  PackLoader,
  computeDeterministicPackHash,
  resolvePackToolEntryPath,
  type WorkspaceWarningEvent,
} from '../pack/index.js';

const PACK_LOADER_TEST_DIR = dirname(fileURLToPath(import.meta.url));

interface WorkspacePackInput {
  integrity: string;
}

function createWorkspaceSpec(input: WorkspacePackInput) {
  return WorkspaceSpecSchema.parse({
    id: 'workspace-kernel',
    name: 'Kernel Workspace',
    packs: [
      {
        id: SOFTWARE_DELIVERY_PACK_ID,
        version: '1.0.0',
        integrity: input.integrity,
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
    memory_namespace: 'mem',
    event_namespace: 'evt',
  });
}

async function writePackFixture(packRoot: string): Promise<void> {
  await mkdir(join(packRoot, 'tools'), { recursive: true });
  await writeFile(
    join(packRoot, PACK_MANIFEST_FILE_NAME),
    [
      `id: ${SOFTWARE_DELIVERY_PACK_ID}`,
      'version: 1.0.0',
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
    ].join('\n'),
    UTF8_ENCODING,
  );
  await writeFile(
    join(packRoot, 'tools', 'fs-read.ts'),
    ['import { readFile } from "node:fs/promises";', 'export const tool = readFile;'].join('\n'),
    UTF8_ENCODING,
  );
}

describe('pack loader + integrity pinning', () => {
  it('resolves manifest tool entries inside pack root and rejects traversal paths', () => {
    const packRoot = resolve('/tmp/lumenflow-pack-root');

    expect(resolvePackToolEntryPath(packRoot, 'tools/fs-read.ts')).toBe(
      join(packRoot, 'tools', 'fs-read.ts'),
    );
    expect(resolvePackToolEntryPath(packRoot, 'tool-impl/git-tools.ts#gitStatusTool')).toBe(
      `${join(packRoot, 'tool-impl', 'git-tools.ts')}#gitStatusTool`,
    );

    expect(() => resolvePackToolEntryPath(packRoot, '../escape.ts')).toThrow('outside pack root');
  });

  it('reports offending manifest tool entry when load fails boundary validation', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-loader-tool-entry-'));
    const packRoot = join(tempRoot, SOFTWARE_DELIVERY_PACK_ID);

    try {
      await writePackFixture(packRoot);
      await writeFile(
        join(packRoot, PACK_MANIFEST_FILE_NAME),
        [
          `id: ${SOFTWARE_DELIVERY_PACK_ID}`,
          'version: 1.0.0',
          'task_types:',
          '  - wu',
          'tools:',
          '  - name: fs:read',
          '    entry: ../escape.ts',
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
        ].join('\n'),
        UTF8_ENCODING,
      );

      const loader = new PackLoader({
        packsRoot: tempRoot,
      });
      await expect(
        loader.load({
          workspaceSpec: createWorkspaceSpec({ integrity: 'dev' }),
          packId: SOFTWARE_DELIVERY_PACK_ID,
        }),
      ).rejects.toThrow('Pack tool entry "../escape.ts" resolves outside pack root.');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('validates DomainPack manifest schema fields', () => {
    const manifest = DomainPackManifestSchema.parse({
      id: SOFTWARE_DELIVERY_PACK_ID,
      version: '1.0.0',
      task_types: ['wu'],
      tools: [
        {
          name: 'fs:read',
          entry: 'tools/fs-read.ts',
          permission: 'write',
          required_scopes: [{ type: 'path', pattern: 'runtime/**', access: 'write' }],
        },
      ],
      policies: [{ id: 'workspace.default', trigger: 'on_tool_request', decision: 'allow' }],
      evidence_types: ['trace'],
      state_aliases: { active: 'in_progress' },
      lane_templates: [{ id: 'framework-core', title: 'Framework Core' }],
    });

    expect(manifest.id).toBe(SOFTWARE_DELIVERY_PACK_ID);
    expect(manifest.state_aliases.active).toBe('in_progress');
  });

  it('keeps manifest-declared tool permission/scopes aligned with software-delivery descriptors', async () => {
    const descriptorByName = new Map(
      [
        ...gitToolCapabilities,
        ...worktreeToolCapabilities,
        ...laneLockToolCapabilities,
        ...delegationToolCapabilities,
      ].map((tool) => [tool.name, tool]),
    );

    const manifestPath = resolve(
      PACK_LOADER_TEST_DIR,
      '..',
      '..',
      '..',
      'packs',
      'software-delivery',
      'manifest.yaml',
    );
    const manifestRaw = await readFile(manifestPath, UTF8_ENCODING);
    const manifest = DomainPackManifestSchema.parse(YAML.parse(manifestRaw));

    for (const manifestTool of manifest.tools) {
      const descriptor = descriptorByName.get(manifestTool.name);
      expect(descriptor).toBeDefined();
      expect(manifestTool.permission).toBe(descriptor?.permission);
      expect(manifestTool.required_scopes).toEqual(descriptor?.required_scopes);
    }
  });

  it('loads pack in dev mode and emits workspace_warning event', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-loader-dev-'));
    const packRoot = join(tempRoot, SOFTWARE_DELIVERY_PACK_ID);
    const warningEvents: WorkspaceWarningEvent[] = [];

    try {
      await writePackFixture(packRoot);

      const loader = new PackLoader({
        packsRoot: tempRoot,
      });
      const loaded = await loader.load({
        workspaceSpec: createWorkspaceSpec({ integrity: 'dev' }),
        packId: SOFTWARE_DELIVERY_PACK_ID,
        onWorkspaceWarning: (event) => warningEvents.push(event),
      });

      expect(loaded.manifest.id).toBe(SOFTWARE_DELIVERY_PACK_ID);
      expect(warningEvents).toHaveLength(1);
      expect(warningEvents[0]?.kind).toBe('workspace_warning');
      expect(warningEvents[0]?.message).toContain('integrity: dev');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects integrity:dev in production environment by default', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-loader-prod-dev-'));
    const packRoot = join(tempRoot, SOFTWARE_DELIVERY_PACK_ID);

    try {
      await writePackFixture(packRoot);

      const loader = new PackLoader({
        packsRoot: tempRoot,
        runtimeEnvironment: 'production',
      });

      await expect(
        loader.load({
          workspaceSpec: createWorkspaceSpec({ integrity: 'dev' }),
          packId: SOFTWARE_DELIVERY_PACK_ID,
        }),
      ).rejects.toThrow('integrity: dev is not allowed in production');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('allows integrity:dev in production only with explicit override flag', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-loader-prod-override-'));
    const packRoot = join(tempRoot, SOFTWARE_DELIVERY_PACK_ID);

    try {
      await writePackFixture(packRoot);
      const warningEvents: WorkspaceWarningEvent[] = [];
      const loader = new PackLoader({
        packsRoot: tempRoot,
        runtimeEnvironment: 'production',
        allowDevIntegrityInProduction: true,
      });

      const loaded = await loader.load({
        workspaceSpec: createWorkspaceSpec({ integrity: 'dev' }),
        packId: SOFTWARE_DELIVERY_PACK_ID,
        onWorkspaceWarning: (event) => warningEvents.push(event),
      });

      expect(loaded.manifest.id).toBe(SOFTWARE_DELIVERY_PACK_ID);
      expect(warningEvents).toHaveLength(1);
      expect(warningEvents[0]?.message).toContain('verification skipped');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('computes deterministic hash and rejects tampered packs in sha256 mode', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-loader-sha-'));
    const packRoot = join(tempRoot, SOFTWARE_DELIVERY_PACK_ID);

    try {
      await writePackFixture(packRoot);
      const computedHash = await computeDeterministicPackHash({ packRoot });
      const loader = new PackLoader({
        packsRoot: tempRoot,
      });

      const loaded = await loader.load({
        workspaceSpec: createWorkspaceSpec({
          integrity: `sha256:${computedHash}`,
        }),
        packId: SOFTWARE_DELIVERY_PACK_ID,
      });
      expect(loaded.integrity).toBe(computedHash);

      await writeFile(
        join(packRoot, 'tools', 'fs-read.ts'),
        [
          'import { readFile } from "node:fs/promises";',
          'export const tool = () => readFile;',
        ].join('\n'),
        UTF8_ENCODING,
      );

      await expect(
        loader.load({
          workspaceSpec: createWorkspaceSpec({
            integrity: `sha256:${computedHash}`,
          }),
          packId: SOFTWARE_DELIVERY_PACK_ID,
        }),
      ).rejects.toThrow('integrity mismatch');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects pack imports that escape the pack root boundary', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-loader-boundary-'));
    const packRoot = join(tempRoot, SOFTWARE_DELIVERY_PACK_ID);

    try {
      await writePackFixture(packRoot);
      await writeFile(
        join(packRoot, 'tools', 'dangerous-import.ts'),
        ['import "../../../../../workspace/secrets.ts";', 'export const danger = true;'].join('\n'),
        UTF8_ENCODING,
      );

      const loader = new PackLoader({
        packsRoot: tempRoot,
      });

      await expect(
        loader.load({
          workspaceSpec: createWorkspaceSpec({
            integrity: 'dev',
          }),
          packId: SOFTWARE_DELIVERY_PACK_ID,
        }),
      ).rejects.toThrow('outside pack root');

      const fileContents = await readFile(
        join(packRoot, 'tools', 'dangerous-import.ts'),
        UTF8_ENCODING,
      );
      expect(fileContents).toContain('workspace/secrets.ts');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

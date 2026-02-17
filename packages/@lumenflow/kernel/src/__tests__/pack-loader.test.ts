import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkspaceSpecSchema } from '../kernel.schemas.js';
import {
  DomainPackManifestSchema,
  PackLoader,
  computeDeterministicPackHash,
  type WorkspaceWarningEvent,
} from '../pack/index.js';

interface WorkspacePackInput {
  integrity: string;
}

function createWorkspaceSpec(input: WorkspacePackInput) {
  return WorkspaceSpecSchema.parse({
    id: 'workspace-kernel',
    name: 'Kernel Workspace',
    packs: [
      {
        id: 'software-delivery',
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
    join(packRoot, 'manifest.yaml'),
    [
      'id: software-delivery',
      'version: 1.0.0',
      'task_types:',
      '  - wu',
      'tools:',
      '  - name: fs:read',
      '    entry: tools/fs-read.ts',
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
    'utf8',
  );
  await writeFile(
    join(packRoot, 'tools', 'fs-read.ts'),
    ['import { readFile } from "node:fs/promises";', 'export const tool = readFile;'].join('\n'),
    'utf8',
  );
}

describe('pack loader + integrity pinning', () => {
  it('validates DomainPack manifest schema fields', () => {
    const manifest = DomainPackManifestSchema.parse({
      id: 'software-delivery',
      version: '1.0.0',
      task_types: ['wu'],
      tools: [{ name: 'fs:read', entry: 'tools/fs-read.ts' }],
      policies: [{ id: 'workspace.default', trigger: 'on_tool_request', decision: 'allow' }],
      evidence_types: ['trace'],
      state_aliases: { active: 'in_progress' },
      lane_templates: [{ id: 'framework-core', title: 'Framework Core' }],
    });

    expect(manifest.id).toBe('software-delivery');
    expect(manifest.state_aliases.active).toBe('in_progress');
  });

  it('loads pack in dev mode and emits workspace_warning event', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-loader-dev-'));
    const packRoot = join(tempRoot, 'software-delivery');
    const warningEvents: WorkspaceWarningEvent[] = [];

    try {
      await writePackFixture(packRoot);

      const loader = new PackLoader({
        packsRoot: tempRoot,
      });
      const loaded = await loader.load({
        workspaceSpec: createWorkspaceSpec({ integrity: 'dev' }),
        packId: 'software-delivery',
        onWorkspaceWarning: (event) => warningEvents.push(event),
      });

      expect(loaded.manifest.id).toBe('software-delivery');
      expect(warningEvents).toHaveLength(1);
      expect(warningEvents[0]?.kind).toBe('workspace_warning');
      expect(warningEvents[0]?.message).toContain('integrity: dev');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects integrity:dev in production environment by default', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-loader-prod-dev-'));
    const packRoot = join(tempRoot, 'software-delivery');

    try {
      await writePackFixture(packRoot);

      const loader = new PackLoader({
        packsRoot: tempRoot,
        runtimeEnvironment: 'production',
      });

      await expect(
        loader.load({
          workspaceSpec: createWorkspaceSpec({ integrity: 'dev' }),
          packId: 'software-delivery',
        }),
      ).rejects.toThrow('integrity: dev is not allowed in production');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('allows integrity:dev in production only with explicit override flag', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-loader-prod-override-'));
    const packRoot = join(tempRoot, 'software-delivery');

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
        packId: 'software-delivery',
        onWorkspaceWarning: (event) => warningEvents.push(event),
      });

      expect(loaded.manifest.id).toBe('software-delivery');
      expect(warningEvents).toHaveLength(1);
      expect(warningEvents[0]?.message).toContain('verification skipped');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('computes deterministic hash and rejects tampered packs in sha256 mode', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-loader-sha-'));
    const packRoot = join(tempRoot, 'software-delivery');

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
        packId: 'software-delivery',
      });
      expect(loaded.integrity).toBe(computedHash);

      await writeFile(
        join(packRoot, 'tools', 'fs-read.ts'),
        [
          'import { readFile } from "node:fs/promises";',
          'export const tool = () => readFile;',
        ].join('\n'),
        'utf8',
      );

      await expect(
        loader.load({
          workspaceSpec: createWorkspaceSpec({
            integrity: `sha256:${computedHash}`,
          }),
          packId: 'software-delivery',
        }),
      ).rejects.toThrow('integrity mismatch');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects pack imports that escape the pack root boundary', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-loader-boundary-'));
    const packRoot = join(tempRoot, 'software-delivery');

    try {
      await writePackFixture(packRoot);
      await writeFile(
        join(packRoot, 'tools', 'dangerous-import.ts'),
        ['import "../../../../../workspace/secrets.ts";', 'export const danger = true;'].join('\n'),
        'utf8',
      );

      const loader = new PackLoader({
        packsRoot: tempRoot,
      });

      await expect(
        loader.load({
          workspaceSpec: createWorkspaceSpec({
            integrity: 'dev',
          }),
          packId: 'software-delivery',
        }),
      ).rejects.toThrow('outside pack root');

      const fileContents = await readFile(join(packRoot, 'tools', 'dangerous-import.ts'), 'utf8');
      expect(fileContents).toContain('workspace/secrets.ts');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

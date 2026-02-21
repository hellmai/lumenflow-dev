// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { SOFTWARE_DELIVERY_PACK_ID } from '../../../packs/software-delivery/constants.js';
import { SOFTWARE_DELIVERY_MANIFEST } from '../../../packs/software-delivery/manifest.js';
import { PackPinSchema, WorkspaceSpecSchema } from '../kernel.schemas.js';
import { PACK_MANIFEST_FILE_NAME, UTF8_ENCODING } from '../shared-constants.js';
import {
  DomainPackManifestSchema,
  PackLoader,
  computeDeterministicPackHash,
  hasUnsafeScopePattern,
  isBroadWildcardScopePattern,
  resolvePackToolEntryPath,
  validateDomainPackToolSafety,
  type GitClient,
  type RegistryClient,
  type WorkspaceWarningEvent,
} from '../pack/index.js';

const PACK_LOADER_TEST_DIR = dirname(fileURLToPath(import.meta.url));
const EXPECTED_MCP_SHELL_OUT_TOOL_MINIMUM = 70;
const IN_PROCESS_MCP_COMMANDS = new Set(['context:get', 'wu:list']);
const REQUIRED_MANIFEST_TOOL_DOMAINS = [
  'wu',
  'mem',
  'initiative',
  'lane',
  'flow',
  'gate',
  'file',
  'git',
  'agent',
  'orchestrate',
  'state',
  'plan',
  'setup',
] as const;

interface WorkspacePackInput {
  integrity: string;
  version?: string;
}

function normalizeToolDomain(toolName: string): string {
  if (toolName === 'gates' || toolName.startsWith('gates:')) {
    return 'gate';
  }
  if (
    toolName.startsWith('backlog:') ||
    toolName.startsWith('delegation:') ||
    toolName.startsWith('docs:') ||
    toolName.startsWith('init:') ||
    toolName.startsWith('lumenflow') ||
    toolName.startsWith('metrics') ||
    toolName.startsWith('signal:') ||
    toolName.startsWith('sync:') ||
    toolName.startsWith('validate')
  ) {
    return 'setup';
  }
  const separator = toolName.indexOf(':');
  if (separator > 0) {
    return toolName.slice(0, separator);
  }
  return toolName;
}

async function collectMcpShellOutCommands(): Promise<string[]> {
  const mcpSrcRoot = resolve(PACK_LOADER_TEST_DIR, '..', '..', '..', 'mcp', 'src');
  const toolsRoot = join(mcpSrcRoot, 'tools');
  const toolFiles = (await readdir(toolsRoot)).filter((entry) => entry.endsWith('.ts'));

  // WU-1851: Import CliCommands for constant→value resolution instead of
  // regex-parsing mcp-constants.ts. Dynamic import lets vitest handle TS
  // compilation — no brittle regex on constant declarations.
  const constantsPath = join(mcpSrcRoot, 'mcp-constants.ts');
  const { CliCommands } = (await import(constantsPath)) as { CliCommands: Record<string, string> };

  // Scan tool files for command usage across both legacy and runtime-first
  // styles:
  // 1) runCliCommand(...)
  // 2) executeViaPack(...)
  // 3) fallback.command: ...
  // Resolve CliCommands.XXX references via imported constants to avoid brittle
  // string matching.
  const directRawPatterns = [
    /runCliCommand\(\s*['"]([^'"]+)['"]/g,
    /executeViaPack\(\s*['"]([^'"]+)['"]/g,
  ] as const;
  const directConstPatterns = [
    /runCliCommand\(\s*CliCommands\.(\w+)/g,
    /executeViaPack\(\s*CliCommands\.(\w+)/g,
  ] as const;
  const fallbackRawPattern = /command:\s*['"]([^'"]+)['"]/g;
  const fallbackConstPattern = /command:\s*CliCommands\.(\w+)/g;
  const commands = new Set<string>();

  for (const toolFile of toolFiles) {
    const source = await readFile(join(toolsRoot, toolFile), UTF8_ENCODING);

    for (const pattern of directRawPatterns) {
      pattern.lastIndex = 0;
      let match = pattern.exec(source);
      while (match) {
        if (match[1]) commands.add(match[1]);
        match = pattern.exec(source);
      }
    }

    for (const pattern of directConstPatterns) {
      pattern.lastIndex = 0;
      let cRef = pattern.exec(source);
      while (cRef) {
        const resolved = cRef[1] ? CliCommands[cRef[1]] : undefined;
        if (resolved) commands.add(resolved);
        cRef = pattern.exec(source);
      }
    }

    fallbackRawPattern.lastIndex = 0;
    let fallbackRaw = fallbackRawPattern.exec(source);
    while (fallbackRaw) {
      if (fallbackRaw[1]) commands.add(fallbackRaw[1]);
      fallbackRaw = fallbackRawPattern.exec(source);
    }

    fallbackConstPattern.lastIndex = 0;
    let fallbackConst = fallbackConstPattern.exec(source);
    while (fallbackConst) {
      const resolved = fallbackConst[1] ? CliCommands[fallbackConst[1]] : undefined;
      if (resolved) commands.add(resolved);
      fallbackConst = fallbackConstPattern.exec(source);
    }
  }

  return [...commands].filter((commandName) => !IN_PROCESS_MCP_COMMANDS.has(commandName)).sort();
}

interface GitWorkspacePackInput extends WorkspacePackInput {
  source?: 'local' | 'git' | 'registry';
  url?: string;
  registry_url?: string;
}

function createWorkspaceSpec(input: GitWorkspacePackInput) {
  const packPin: Record<string, unknown> = {
    id: SOFTWARE_DELIVERY_PACK_ID,
    version: input.version ?? '1.0.0',
    integrity: input.integrity,
    source: input.source ?? 'local',
  };
  if (input.url) {
    packPin.url = input.url;
  }
  if (input.registry_url) {
    packPin.registry_url = input.registry_url;
  }
  return WorkspaceSpecSchema.parse({
    id: 'workspace-kernel',
    name: 'Kernel Workspace',
    packs: [packPin],
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

  it('accepts optional input_schema and output_schema on pack manifest tools', () => {
    const manifest = DomainPackManifestSchema.parse({
      id: SOFTWARE_DELIVERY_PACK_ID,
      version: '1.0.0',
      task_types: ['wu'],
      tools: [
        {
          name: 'fs:read',
          entry: 'tools/fs-read.ts',
          permission: 'read',
          required_scopes: [{ type: 'path', pattern: 'src/**', access: 'read' }],
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
          output_schema: {
            type: 'object',
            properties: { content: { type: 'string' } },
          },
        },
        {
          name: 'fs:write',
          entry: 'tools/fs-write.ts',
          permission: 'write',
          required_scopes: [{ type: 'path', pattern: 'src/**', access: 'write' }],
          // No schemas - should still be valid
        },
      ],
      policies: [],
    });

    expect(manifest.tools[0].input_schema).toEqual({
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    });
    expect(manifest.tools[0].output_schema).toEqual({
      type: 'object',
      properties: { content: { type: 'string' } },
    });
    expect(manifest.tools[1].input_schema).toBeUndefined();
    expect(manifest.tools[1].output_schema).toBeUndefined();
  });

  it('reports unsafe wildcard write scopes and non-object schema types via helper', () => {
    const issues = validateDomainPackToolSafety({
      name: 'fs:write-anywhere',
      entry: 'tool-impl/fs-write-anywhere.ts#fsWriteAnywhereTool',
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: '**', access: 'write' }],
      input_schema: { type: 'string' },
      output_schema: { type: 'array' },
    });

    expect(issues.length).toBeGreaterThanOrEqual(3);
    expect(issues.join('\n')).toContain('too broad');
    expect(issues.join('\n')).toContain('input_schema.type must be "object"');
    expect(issues.join('\n')).toContain('output_schema.type must be "object"');
  });

  it('exposes explicit helpers for scope safety checks', () => {
    expect(hasUnsafeScopePattern('../secrets/**')).toBe(true);
    expect(hasUnsafeScopePattern('docs/**/*.md')).toBe(false);
    expect(isBroadWildcardScopePattern('**')).toBe(true);
    expect(isBroadWildcardScopePattern('reports/**/*.md')).toBe(false);
  });

  it('keeps software-delivery manifest.yaml and programmatic manifest in sync', async () => {
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
    expect(SOFTWARE_DELIVERY_MANIFEST).toEqual(manifest);
  });

  it('declares all remaining MCP shell-out commands in the software-delivery manifest', async () => {
    const mcpShellOutCommands = await collectMcpShellOutCommands();
    expect(mcpShellOutCommands.length).toBeGreaterThanOrEqual(EXPECTED_MCP_SHELL_OUT_TOOL_MINIMUM);

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
    const toolNames = new Set(manifest.tools.map((tool) => tool.name));

    for (const commandName of mcpShellOutCommands) {
      expect(toolNames.has(commandName)).toBe(true);
    }

    const toolDomains = new Set(manifest.tools.map((tool) => normalizeToolDomain(tool.name)));
    for (const domain of REQUIRED_MANIFEST_TOOL_DOMAINS) {
      expect(toolDomains.has(domain)).toBe(true);
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

  it('loads software-delivery pack when workspace pin uses computed sha256 integrity', async () => {
    const packsRoot = resolve(PACK_LOADER_TEST_DIR, '..', '..', '..', 'packs');
    const packRoot = join(packsRoot, SOFTWARE_DELIVERY_PACK_ID);
    const computedHash = await computeDeterministicPackHash({ packRoot });

    const loader = new PackLoader({
      packsRoot,
    });

    const loaded = await loader.load({
      workspaceSpec: createWorkspaceSpec({
        version: '0.1.0',
        integrity: `sha256:${computedHash}`,
      }),
      packId: SOFTWARE_DELIVERY_PACK_ID,
    });

    expect(loaded.integrity).toBe(computedHash);
    expect(loaded.pin.integrity).toBe(`sha256:${computedHash}`);
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

  it('rejects bare npm package imports in pack sources', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-loader-bare-import-'));
    const packRoot = join(tempRoot, SOFTWARE_DELIVERY_PACK_ID);

    try {
      await writePackFixture(packRoot);
      await writeFile(
        join(packRoot, 'tools', 'bare-import.ts'),
        ['import lodash from "lodash";', 'export const noop = lodash.noop;'].join('\n'),
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
      ).rejects.toThrow('Bare package import');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects @lumenflow/kernel-prefixed packages that are not @lumenflow/kernel', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-loader-prefix-match-'));
    const packRoot = join(tempRoot, SOFTWARE_DELIVERY_PACK_ID);

    try {
      await writePackFixture(packRoot);
      await writeFile(
        join(packRoot, 'tools', 'kernel-prefix-import.ts'),
        ['import { helper } from "@lumenflow/kernel-utils";', 'export const noop = helper;'].join(
          '\n',
        ),
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
      ).rejects.toThrow('@lumenflow/kernel and Node built-ins are permitted');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('PackPin schema with url field', () => {
  it('accepts url field for git source packs', () => {
    const pin = PackPinSchema.parse({
      id: 'my-pack',
      version: '1.0.0',
      integrity: 'dev',
      source: 'git',
      url: 'https://github.com/example/my-pack.git',
    });
    expect(pin.url).toBe('https://github.com/example/my-pack.git');
    expect(pin.source).toBe('git');
  });

  it('allows omitting url for local source packs', () => {
    const pin = PackPinSchema.parse({
      id: 'my-pack',
      version: '1.0.0',
      integrity: 'dev',
      source: 'local',
    });
    expect(pin.url).toBeUndefined();
  });

  it('includes url in workspace spec round-trip', () => {
    const spec = createWorkspaceSpec({
      integrity: 'dev',
      source: 'git',
      url: 'https://github.com/example/pack.git',
    });
    const gitPack = spec.packs.find((p) => p.source === 'git');
    expect(gitPack).toBeDefined();
    expect(gitPack!.url).toBe('https://github.com/example/pack.git');
  });
});

describe('git-based pack resolution', () => {
  function createMockGitClient(packRoot: string): GitClient {
    return {
      clone: vi.fn(async () => {
        await writePackFixture(packRoot);
      }),
      pull: vi.fn(async () => {}),
      checkout: vi.fn(async () => {}),
      isRepo: vi.fn(async () => false),
    };
  }

  function createMockGitClientWithExistingRepo(packRoot: string): GitClient {
    return {
      clone: vi.fn(async () => {}),
      pull: vi.fn(async () => {}),
      checkout: vi.fn(async () => {}),
      isRepo: vi.fn(async () => {
        // Simulate existing repo: write the fixture so loading succeeds
        await writePackFixture(packRoot);
        return true;
      }),
    };
  }

  it('clones git repo to pack cache and loads pack', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-git-clone-'));
    const cacheDir = join(tempRoot, 'pack-cache');
    const packCachePath = join(cacheDir, `${SOFTWARE_DELIVERY_PACK_ID}@1.0.0`);

    try {
      const gitClient = createMockGitClient(packCachePath);
      const loader = new PackLoader({
        packsRoot: tempRoot,
        packCacheDir: cacheDir,
        gitClient,
      });

      const loaded = await loader.load({
        workspaceSpec: createWorkspaceSpec({
          integrity: 'dev',
          source: 'git',
          url: 'https://github.com/example/my-pack.git',
        }),
        packId: SOFTWARE_DELIVERY_PACK_ID,
      });

      expect(loaded.manifest.id).toBe(SOFTWARE_DELIVERY_PACK_ID);
      expect(loaded.packRoot).toBe(packCachePath);
      expect(gitClient.clone).toHaveBeenCalledWith(
        'https://github.com/example/my-pack.git',
        packCachePath,
      );
      expect(gitClient.checkout).toHaveBeenCalledWith(packCachePath, 'v1.0.0');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('pulls existing cached git repo instead of re-cloning', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-git-pull-'));
    const cacheDir = join(tempRoot, 'pack-cache');
    const packCachePath = join(cacheDir, `${SOFTWARE_DELIVERY_PACK_ID}@1.0.0`);

    try {
      const gitClient = createMockGitClientWithExistingRepo(packCachePath);
      const loader = new PackLoader({
        packsRoot: tempRoot,
        packCacheDir: cacheDir,
        gitClient,
      });

      const loaded = await loader.load({
        workspaceSpec: createWorkspaceSpec({
          integrity: 'dev',
          source: 'git',
          url: 'https://github.com/example/my-pack.git',
        }),
        packId: SOFTWARE_DELIVERY_PACK_ID,
      });

      expect(loaded.manifest.id).toBe(SOFTWARE_DELIVERY_PACK_ID);
      expect(gitClient.clone).not.toHaveBeenCalled();
      expect(gitClient.pull).toHaveBeenCalledWith(packCachePath);
      expect(gitClient.checkout).toHaveBeenCalledWith(packCachePath, 'v1.0.0');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('caches git packs in the configured pack-cache directory', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-git-cache-'));
    const cacheDir = join(tempRoot, 'custom-cache');
    const packCachePath = join(cacheDir, `${SOFTWARE_DELIVERY_PACK_ID}@1.0.0`);

    try {
      const gitClient = createMockGitClient(packCachePath);
      const loader = new PackLoader({
        packsRoot: tempRoot,
        packCacheDir: cacheDir,
        gitClient,
      });

      await loader.load({
        workspaceSpec: createWorkspaceSpec({
          integrity: 'dev',
          source: 'git',
          url: 'https://github.com/example/my-pack.git',
        }),
        packId: SOFTWARE_DELIVERY_PACK_ID,
      });

      expect(gitClient.clone).toHaveBeenCalledWith(
        'https://github.com/example/my-pack.git',
        packCachePath,
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('checks out version tag matching pack pin version', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-git-tag-'));
    const cacheDir = join(tempRoot, 'pack-cache');
    const packCachePath = join(cacheDir, `${SOFTWARE_DELIVERY_PACK_ID}@2.3.1`);

    try {
      const gitClient: GitClient = {
        clone: vi.fn(async () => {
          await mkdir(join(packCachePath, 'tools'), { recursive: true });
          await writeFile(
            join(packCachePath, PACK_MANIFEST_FILE_NAME),
            [
              `id: ${SOFTWARE_DELIVERY_PACK_ID}`,
              'version: 2.3.1',
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
            join(packCachePath, 'tools', 'fs-read.ts'),
            ['import { readFile } from "node:fs/promises";', 'export const tool = readFile;'].join(
              '\n',
            ),
            UTF8_ENCODING,
          );
        }),
        pull: vi.fn(async () => {}),
        checkout: vi.fn(async () => {}),
        isRepo: vi.fn(async () => false),
      };

      const loader = new PackLoader({
        packsRoot: tempRoot,
        packCacheDir: cacheDir,
        gitClient,
      });

      const loaded = await loader.load({
        workspaceSpec: createWorkspaceSpec({
          integrity: 'dev',
          version: '2.3.1',
          source: 'git',
          url: 'https://github.com/example/my-pack.git',
        }),
        packId: SOFTWARE_DELIVERY_PACK_ID,
      });

      expect(loaded.manifest.version).toBe('2.3.1');
      expect(gitClient.checkout).toHaveBeenCalledWith(packCachePath, 'v2.3.1');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('runs integrity verification on git-fetched pack', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-git-integrity-'));
    const cacheDir = join(tempRoot, 'pack-cache');
    const packCachePath = join(cacheDir, `${SOFTWARE_DELIVERY_PACK_ID}@1.0.0`);

    try {
      const gitClient = createMockGitClient(packCachePath);
      const loader = new PackLoader({
        packsRoot: tempRoot,
        packCacheDir: cacheDir,
        gitClient,
      });

      // First load to compute the hash
      const warningEvents: WorkspaceWarningEvent[] = [];
      const loaded = await loader.load({
        workspaceSpec: createWorkspaceSpec({
          integrity: 'dev',
          source: 'git',
          url: 'https://github.com/example/my-pack.git',
        }),
        packId: SOFTWARE_DELIVERY_PACK_ID,
        onWorkspaceWarning: (event) => warningEvents.push(event),
      });

      // Loaded with dev integrity should emit a warning
      expect(warningEvents).toHaveLength(1);
      expect(warningEvents[0]?.message).toContain('integrity: dev');

      // Now create a fresh loader and load with sha256 integrity
      const correctHash = loaded.integrity;
      const gitClient2: GitClient = {
        clone: vi.fn(async () => {}),
        pull: vi.fn(async () => {}),
        checkout: vi.fn(async () => {}),
        isRepo: vi.fn(async () => true),
      };
      const loader2 = new PackLoader({
        packsRoot: tempRoot,
        packCacheDir: cacheDir,
        gitClient: gitClient2,
      });

      const loaded2 = await loader2.load({
        workspaceSpec: createWorkspaceSpec({
          integrity: `sha256:${correctHash}`,
          source: 'git',
          url: 'https://github.com/example/my-pack.git',
        }),
        packId: SOFTWARE_DELIVERY_PACK_ID,
      });

      expect(loaded2.integrity).toBe(correctHash);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects git source packs without url field', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-git-no-url-'));
    const cacheDir = join(tempRoot, 'pack-cache');

    try {
      const gitClient: GitClient = {
        clone: vi.fn(async () => {}),
        pull: vi.fn(async () => {}),
        checkout: vi.fn(async () => {}),
        isRepo: vi.fn(async () => false),
      };
      const loader = new PackLoader({
        packsRoot: tempRoot,
        packCacheDir: cacheDir,
        gitClient,
      });

      await expect(
        loader.load({
          workspaceSpec: createWorkspaceSpec({
            integrity: 'dev',
            source: 'git',
          }),
          packId: SOFTWARE_DELIVERY_PACK_ID,
        }),
      ).rejects.toThrow('url');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects integrity mismatch on git-fetched pack with sha256 pin', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-git-mismatch-'));
    const cacheDir = join(tempRoot, 'pack-cache');
    const packCachePath = join(cacheDir, `${SOFTWARE_DELIVERY_PACK_ID}@1.0.0`);

    try {
      const gitClient = createMockGitClient(packCachePath);
      const loader = new PackLoader({
        packsRoot: tempRoot,
        packCacheDir: cacheDir,
        gitClient,
      });

      await expect(
        loader.load({
          workspaceSpec: createWorkspaceSpec({
            integrity: 'sha256:' + '0'.repeat(64),
            source: 'git',
            url: 'https://github.com/example/my-pack.git',
          }),
          packId: SOFTWARE_DELIVERY_PACK_ID,
        }),
      ).rejects.toThrow('integrity mismatch');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('PackPin schema with registry_url field', () => {
  it('accepts registry_url field for registry source packs', () => {
    const pin = PackPinSchema.parse({
      id: 'my-pack',
      version: '1.0.0',
      integrity: 'dev',
      source: 'registry',
      registry_url: 'https://custom-registry.example.com',
    });
    expect(pin.registry_url).toBe('https://custom-registry.example.com');
    expect(pin.source).toBe('registry');
  });

  it('allows omitting registry_url (uses default)', () => {
    const pin = PackPinSchema.parse({
      id: 'my-pack',
      version: '1.0.0',
      integrity: 'dev',
      source: 'registry',
    });
    expect(pin.registry_url).toBeUndefined();
  });

  it('includes registry_url in workspace spec round-trip', () => {
    const spec = createWorkspaceSpec({
      integrity: 'dev',
      source: 'registry',
      registry_url: 'https://custom-registry.example.com',
    });
    const registryPack = spec.packs.find((p) => p.source === 'registry');
    expect(registryPack).toBeDefined();
    expect(registryPack!.registry_url).toBe('https://custom-registry.example.com');
  });
});

describe('registry-based pack resolution', () => {
  function createMockRegistryClient(extractDir: string): RegistryClient {
    return {
      fetchMetadata: vi.fn(async () => ({
        tarball_url: 'https://registry.lumenflow.dev/packs/software-delivery/1.0.0.tar.gz',
        integrity: 'sha256:' + '0'.repeat(64),
      })),
      downloadTarball: vi.fn(async () => {
        // Simulate tarball download by writing fixture to extract dir
        await writePackFixture(extractDir);
      }),
    };
  }

  it('fetches metadata and downloads tarball from registry', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-registry-fetch-'));
    const cacheDir = join(tempRoot, 'pack-cache');
    const packCachePath = join(cacheDir, `${SOFTWARE_DELIVERY_PACK_ID}@1.0.0`);

    try {
      const registryClient = createMockRegistryClient(packCachePath);
      const loader = new PackLoader({
        packsRoot: tempRoot,
        packCacheDir: cacheDir,
        registryClient,
      });

      const loaded = await loader.load({
        workspaceSpec: createWorkspaceSpec({
          integrity: 'dev',
          source: 'registry',
        }),
        packId: SOFTWARE_DELIVERY_PACK_ID,
      });

      expect(loaded.manifest.id).toBe(SOFTWARE_DELIVERY_PACK_ID);
      expect(loaded.packRoot).toBe(packCachePath);
      expect(registryClient.fetchMetadata).toHaveBeenCalledWith(
        SOFTWARE_DELIVERY_PACK_ID,
        '1.0.0',
        'https://registry.lumenflow.dev',
      );
      expect(registryClient.downloadTarball).toHaveBeenCalledWith(
        'https://registry.lumenflow.dev/packs/software-delivery/1.0.0.tar.gz',
        packCachePath,
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('uses custom registry_url from PackPin when provided', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-registry-custom-url-'));
    const cacheDir = join(tempRoot, 'pack-cache');
    const packCachePath = join(cacheDir, `${SOFTWARE_DELIVERY_PACK_ID}@1.0.0`);

    try {
      const registryClient = createMockRegistryClient(packCachePath);
      const loader = new PackLoader({
        packsRoot: tempRoot,
        packCacheDir: cacheDir,
        registryClient,
      });

      const loaded = await loader.load({
        workspaceSpec: createWorkspaceSpec({
          integrity: 'dev',
          source: 'registry',
          registry_url: 'https://custom-registry.example.com',
        }),
        packId: SOFTWARE_DELIVERY_PACK_ID,
      });

      expect(loaded.manifest.id).toBe(SOFTWARE_DELIVERY_PACK_ID);
      expect(registryClient.fetchMetadata).toHaveBeenCalledWith(
        SOFTWARE_DELIVERY_PACK_ID,
        '1.0.0',
        'https://custom-registry.example.com',
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('uses default registry URL configured on PackLoader', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-registry-default-url-'));
    const cacheDir = join(tempRoot, 'pack-cache');
    const packCachePath = join(cacheDir, `${SOFTWARE_DELIVERY_PACK_ID}@1.0.0`);

    try {
      const registryClient = createMockRegistryClient(packCachePath);
      const loader = new PackLoader({
        packsRoot: tempRoot,
        packCacheDir: cacheDir,
        registryClient,
        defaultRegistryUrl: 'https://my-company-registry.example.com',
      });

      await loader.load({
        workspaceSpec: createWorkspaceSpec({
          integrity: 'dev',
          source: 'registry',
        }),
        packId: SOFTWARE_DELIVERY_PACK_ID,
      });

      expect(registryClient.fetchMetadata).toHaveBeenCalledWith(
        SOFTWARE_DELIVERY_PACK_ID,
        '1.0.0',
        'https://my-company-registry.example.com',
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('skips download when pack is already cached', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-registry-cached-'));
    const cacheDir = join(tempRoot, 'pack-cache');
    const packCachePath = join(cacheDir, `${SOFTWARE_DELIVERY_PACK_ID}@1.0.0`);

    try {
      // Pre-populate cache
      await writePackFixture(packCachePath);

      const registryClient = createMockRegistryClient(packCachePath);
      const loader = new PackLoader({
        packsRoot: tempRoot,
        packCacheDir: cacheDir,
        registryClient,
      });

      const loaded = await loader.load({
        workspaceSpec: createWorkspaceSpec({
          integrity: 'dev',
          source: 'registry',
        }),
        packId: SOFTWARE_DELIVERY_PACK_ID,
      });

      expect(loaded.manifest.id).toBe(SOFTWARE_DELIVERY_PACK_ID);
      expect(registryClient.fetchMetadata).not.toHaveBeenCalled();
      expect(registryClient.downloadTarball).not.toHaveBeenCalled();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('runs integrity verification on registry-fetched pack', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-registry-integrity-'));
    const cacheDir = join(tempRoot, 'pack-cache');
    const packCachePath = join(cacheDir, `${SOFTWARE_DELIVERY_PACK_ID}@1.0.0`);

    try {
      const registryClient = createMockRegistryClient(packCachePath);
      const warningEvents: WorkspaceWarningEvent[] = [];
      const loader = new PackLoader({
        packsRoot: tempRoot,
        packCacheDir: cacheDir,
        registryClient,
      });

      // First load with dev to compute correct hash
      const loaded = await loader.load({
        workspaceSpec: createWorkspaceSpec({
          integrity: 'dev',
          source: 'registry',
        }),
        packId: SOFTWARE_DELIVERY_PACK_ID,
        onWorkspaceWarning: (event) => warningEvents.push(event),
      });
      expect(warningEvents).toHaveLength(1);

      // Now verify with correct sha256
      const correctHash = loaded.integrity;
      const loader2 = new PackLoader({
        packsRoot: tempRoot,
        packCacheDir: cacheDir,
        registryClient: createMockRegistryClient(packCachePath),
      });

      const loaded2 = await loader2.load({
        workspaceSpec: createWorkspaceSpec({
          integrity: `sha256:${correctHash}`,
          source: 'registry',
        }),
        packId: SOFTWARE_DELIVERY_PACK_ID,
      });

      expect(loaded2.integrity).toBe(correctHash);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects integrity mismatch on registry-fetched pack', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-registry-mismatch-'));
    const cacheDir = join(tempRoot, 'pack-cache');
    const packCachePath = join(cacheDir, `${SOFTWARE_DELIVERY_PACK_ID}@1.0.0`);

    try {
      const registryClient = createMockRegistryClient(packCachePath);
      const loader = new PackLoader({
        packsRoot: tempRoot,
        packCacheDir: cacheDir,
        registryClient,
      });

      await expect(
        loader.load({
          workspaceSpec: createWorkspaceSpec({
            integrity: 'sha256:' + '0'.repeat(64),
            source: 'registry',
          }),
          packId: SOFTWARE_DELIVERY_PACK_ID,
        }),
      ).rejects.toThrow('integrity mismatch');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects registry source packs when no registryClient is provided', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-registry-no-client-'));

    try {
      const loader = new PackLoader({
        packsRoot: tempRoot,
      });

      await expect(
        loader.load({
          workspaceSpec: createWorkspaceSpec({
            integrity: 'dev',
            source: 'registry',
          }),
          packId: SOFTWARE_DELIVERY_PACK_ID,
        }),
      ).rejects.toThrow('registryClient');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('PackPin registry_url takes priority over PackLoader defaultRegistryUrl', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-pack-registry-priority-'));
    const cacheDir = join(tempRoot, 'pack-cache');
    const packCachePath = join(cacheDir, `${SOFTWARE_DELIVERY_PACK_ID}@1.0.0`);

    try {
      const registryClient = createMockRegistryClient(packCachePath);
      const loader = new PackLoader({
        packsRoot: tempRoot,
        packCacheDir: cacheDir,
        registryClient,
        defaultRegistryUrl: 'https://default-registry.example.com',
      });

      await loader.load({
        workspaceSpec: createWorkspaceSpec({
          integrity: 'dev',
          source: 'registry',
          registry_url: 'https://per-pack-registry.example.com',
        }),
        packId: SOFTWARE_DELIVERY_PACK_ID,
      });

      expect(registryClient.fetchMetadata).toHaveBeenCalledWith(
        SOFTWARE_DELIVERY_PACK_ID,
        '1.0.0',
        'https://per-pack-registry.example.com',
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

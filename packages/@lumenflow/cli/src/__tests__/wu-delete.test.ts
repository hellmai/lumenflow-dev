/**
 * Regression tests for wu:delete consistency cleanup (WU-1511)
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const WU_ID_DELETE = 'WU-1007';
const WU_ID_KEEP = 'WU-2000';

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

// Mock dist imports so source tests can run without building workspace dist outputs.
vi.mock('@lumenflow/core/dist/git-adapter.js', () => ({
  getGitForCwd: () => ({
    getStatus: async () => '',
    fetch: async () => undefined,
  }),
}));

vi.mock('@lumenflow/core/dist/error-handler.js', () => ({
  die: (msg: string) => {
    throw new Error(msg);
  },
}));

vi.mock('@lumenflow/core/dist/wu-yaml.js', () => ({
  parseYAML: (_text: string) => ({ status: 'ready' }),
}));

vi.mock('@lumenflow/core/dist/arg-parser.js', () => ({
  createWUParser: () => ({}),
  WU_OPTIONS: { id: {}, batch: {} },
}));

vi.mock('@lumenflow/core/dist/wu-paths.js', () => ({
  WU_PATHS: {
    WU: (id: string) => `docs/04-operations/tasks/wu/${id}.yaml`,
    WU_DIR: () => 'docs/04-operations/tasks/wu',
    STATUS: () => 'docs/04-operations/tasks/status.md',
    BACKLOG: () => 'docs/04-operations/tasks/backlog.md',
    STAMPS_DIR: () => '.lumenflow/stamps',
  },
}));

vi.mock('@lumenflow/core/dist/backlog-generator.js', () => ({
  generateBacklog: async () => '# Backlog\n\n- [WU-2000 — Keep me](wu/WU-2000.yaml)\n',
  generateStatus: async () =>
    '# Work Unit Status\n\n## In Progress\n\n- [WU-2000 — Keep me](wu/WU-2000.yaml)\n',
}));

vi.mock('@lumenflow/core/dist/wu-state-store.js', () => ({
  WUStateStore: class {
    async load(): Promise<void> {
      return;
    }
  },
}));

vi.mock('@lumenflow/core/dist/wu-constants.js', () => ({
  FILE_SYSTEM: { ENCODING: 'utf-8' },
  EXIT_CODES: { SUCCESS: 0, ERROR: 1 },
  MICRO_WORKTREE_OPERATIONS: { WU_DELETE: 'wu-delete' },
  LOG_PREFIX: { DELETE: '[wu:delete]' },
  WU_STATUS: { IN_PROGRESS: 'in_progress' },
  LUMENFLOW_PATHS: { WU_EVENTS: '.lumenflow/state/wu-events.jsonl' },
}));

vi.mock('@lumenflow/core/dist/wu-helpers.js', () => ({
  ensureOnMain: async () => undefined,
  ensureMainUpToDate: async () => undefined,
  validateWUIDFormat: (_id: string) => undefined,
}));

vi.mock('@lumenflow/core/dist/micro-worktree.js', () => ({
  withMicroWorktree: async ({
    execute,
  }: {
    execute: (ctx: {
      worktreePath: string;
      gitWorktree: { add: () => Promise<void> };
    }) => Promise<void>;
  }) => {
    await execute({ worktreePath: process.cwd(), gitWorktree: { add: async () => undefined } });
  },
}));

vi.mock('@lumenflow/initiatives/dist/initiative-paths.js', () => ({
  INIT_PATHS: {
    INITIATIVES_DIR: () => 'docs/04-operations/tasks/initiatives',
    INITIATIVE: (id: string) => `docs/04-operations/tasks/initiatives/${id}.yaml`,
  },
}));

vi.mock('@lumenflow/initiatives/dist/initiative-constants.js', () => ({
  INIT_PATTERNS: {
    INIT_ID: /^INIT-[A-Z0-9-]+$/,
  },
}));

vi.mock('@lumenflow/initiatives/dist/initiative-yaml.js', () => ({
  readInitiative: (path: string, id: string) => {
    const text = readFileSync(path, 'utf-8');
    const lines = text.split('\n');
    const wus = lines
      .filter((line) => line.trim().startsWith('- '))
      .map((line) => line.trim().replace(/^-\s+/, ''));
    return { id, wus };
  },
  writeInitiative: (path: string, doc: { id?: string; wus?: string[] }) => {
    const id = doc.id || 'INIT-001';
    const lines = [`id: ${id}`, 'wus:'];
    for (const wuId of doc.wus || []) {
      lines.push(`  - ${wuId}`);
    }
    writeFileSync(path, `${lines.join('\n')}\n`, 'utf-8');
  },
}));

vi.mock('../cli-entry-point.js', () => ({
  runCLI: async () => undefined,
}));

describe('wu-delete consistency cleanup', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wu-delete-test-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);

    // Seed minimal WU docs
    write(
      join(tempDir, 'docs/04-operations/tasks/wu/WU-1007.yaml'),
      'id: WU-1007\ntitle: Delete me\nlane: Framework: CLI WU Commands\nstatus: blocked\n',
    );
    write(
      join(tempDir, 'docs/04-operations/tasks/wu/WU-2000.yaml'),
      'id: WU-2000\ntitle: Keep me\nlane: Framework: CLI WU Commands\nstatus: ready\n',
    );

    // Seed initiative with both WUs
    write(
      join(tempDir, 'docs/04-operations/tasks/initiatives/INIT-001.yaml'),
      [
        'id: INIT-001',
        'title: Test Initiative',
        'status: open',
        'wus:',
        '  - WU-1007',
        '  - WU-2000',
      ].join('\n') + '\n',
    );

    // Seed state with events for both WUs
    write(
      join(tempDir, '.lumenflow/state/wu-events.jsonl'),
      [
        JSON.stringify({
          type: 'claim',
          wuId: WU_ID_DELETE,
          lane: 'Framework: CLI WU Commands',
          title: 'Delete me',
          timestamp: '2026-02-07T00:00:00.000Z',
        }),
        JSON.stringify({
          type: 'claim',
          wuId: WU_ID_KEEP,
          lane: 'Framework: CLI WU Commands',
          title: 'Keep me',
          timestamp: '2026-02-07T00:00:01.000Z',
        }),
      ].join('\n') + '\n',
    );

    // Seed stale projections that still reference WU-1007
    write(
      join(tempDir, 'docs/04-operations/tasks/backlog.md'),
      '# Backlog\n\n- [WU-1007 — Delete me](wu/WU-1007.yaml)\n- [WU-2000 — Keep me](wu/WU-2000.yaml)\n',
    );
    write(
      join(tempDir, 'docs/04-operations/tasks/status.md'),
      '# Work Unit Status\n\n## Blocked\n\n- [WU-1007 — Delete me](wu/WU-1007.yaml)\n',
    );

    // Seed stamp for deleted WU
    write(join(tempDir, '.lumenflow/stamps/WU-1007.done'), '# done\n');
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('removes deleted WU from initiative links, state events, backlog, and status', async () => {
    const { cleanupDeletedWUsInWorktree } = await import('../wu-delete.js');

    await cleanupDeletedWUsInWorktree({ worktreePath: tempDir, ids: [WU_ID_DELETE] });

    // Initiative no longer references deleted WU
    const initContent = readFileSync(
      join(tempDir, 'docs/04-operations/tasks/initiatives/INIT-001.yaml'),
      'utf-8',
    );
    expect(initContent).not.toContain('WU-1007');
    expect(initContent).toContain('WU-2000');

    // State events remove deleted WU but keep others
    const events = readFileSync(join(tempDir, '.lumenflow/state/wu-events.jsonl'), 'utf-8');
    expect(events).not.toContain('"wuId":"WU-1007"');
    expect(events).toContain('"wuId":"WU-2000"');

    // Generated projections should not include deleted WU
    const backlog = readFileSync(join(tempDir, 'docs/04-operations/tasks/backlog.md'), 'utf-8');
    const status = readFileSync(join(tempDir, 'docs/04-operations/tasks/status.md'), 'utf-8');
    expect(backlog).not.toContain('WU-1007');
    expect(status).not.toContain('WU-1007');
  });

  it('removes deleted WU stamps and YAML while preserving other WUs', async () => {
    const { cleanupDeletedWUsInWorktree } = await import('../wu-delete.js');

    await cleanupDeletedWUsInWorktree({ worktreePath: tempDir, ids: [WU_ID_DELETE] });

    expect(existsSync(join(tempDir, 'docs/04-operations/tasks/wu/WU-1007.yaml'))).toBe(false);
    expect(existsSync(join(tempDir, '.lumenflow/stamps/WU-1007.done'))).toBe(false);
    expect(existsSync(join(tempDir, 'docs/04-operations/tasks/wu/WU-2000.yaml'))).toBe(true);
  });

  it('purges pre-existing orphaned event streams while deleting a WU', async () => {
    // Add an orphaned event for a WU spec that does not exist in the repo
    writeFileSync(
      join(tempDir, '.lumenflow/state/wu-events.jsonl'),
      [
        JSON.stringify({
          type: 'claim',
          wuId: WU_ID_DELETE,
          lane: 'Framework: CLI WU Commands',
          title: 'Delete me',
          timestamp: '2026-02-07T00:00:00.000Z',
        }),
        JSON.stringify({
          type: 'claim',
          wuId: WU_ID_KEEP,
          lane: 'Framework: CLI WU Commands',
          title: 'Keep me',
          timestamp: '2026-02-07T00:00:01.000Z',
        }),
        JSON.stringify({
          type: 'claim',
          wuId: 'WU-9999',
          lane: 'Framework: CLI WU Commands',
          title: 'Orphaned',
          timestamp: '2026-02-07T00:00:02.000Z',
        }),
      ].join('\n') + '\n',
      'utf-8',
    );

    const { cleanupDeletedWUsInWorktree } = await import('../wu-delete.js');
    await cleanupDeletedWUsInWorktree({ worktreePath: tempDir, ids: [WU_ID_DELETE] });

    const events = readFileSync(join(tempDir, '.lumenflow/state/wu-events.jsonl'), 'utf-8');
    expect(events).not.toContain('"wuId":"WU-1007"');
    expect(events).not.toContain('"wuId":"WU-9999"');
    expect(events).toContain('"wuId":"WU-2000"');
  });
});

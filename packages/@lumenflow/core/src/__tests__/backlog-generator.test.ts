import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WUStateStore } from '../wu-state-store.js';
import { generateBacklog } from '../backlog-generator.js';

describe('generateBacklog', () => {
  let tempDir: string;
  let stateDir: string;
  let wuDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wu-1147-backlog-'));
    stateDir = join(tempDir, '.lumenflow', 'state');
    wuDir = join(tempDir, 'docs', '04-operations', 'tasks', 'wu');
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(wuDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('merges YAML-only WUs and prefers state store metadata when present', async () => {
    const events =
      [
        JSON.stringify({
          type: 'create',
          wuId: 'WU-100',
          timestamp: '2026-01-27T10:00:00.000Z',
          lane: 'Framework: Core',
          title: 'Store Title',
        }),
        JSON.stringify({
          type: 'claim',
          wuId: 'WU-100',
          timestamp: '2026-01-27T10:01:00.000Z',
          lane: 'Framework: Core',
          assignee: 'tester',
          title: 'Store Title',
        }),
      ].join('\n') + '\n';

    writeFileSync(join(stateDir, 'wu-events.jsonl'), events);

    writeFileSync(
      join(wuDir, 'WU-100.yaml'),
      [
        'id: WU-100',
        'title: YAML Title',
        "lane: 'Framework: CLI'",
        'status: ready',
      ].join('\n'),
    );

    writeFileSync(
      join(wuDir, 'WU-200.yaml'),
      [
        'id: WU-200',
        'title: YAML Ready',
        "lane: 'Framework: Ops'",
        'status: ready',
      ].join('\n'),
    );

    writeFileSync(
      join(wuDir, 'WU-300.yaml'),
      [
        'id: WU-300',
        'title: YAML Cancelled',
        "lane: 'Framework: Core'",
        'status: cancelled',
      ].join('\n'),
    );

    const store = new WUStateStore(stateDir);
    await store.load();

    const backlog = await generateBacklog(store, { wuDir });

    expect(backlog).toContain('- [WU-100 — Store Title](wu/WU-100.yaml) — Framework: Core');
    expect(backlog).toContain('- [WU-200 — YAML Ready](wu/WU-200.yaml) — Framework: Ops');
    expect(backlog).toContain('- [WU-300 — YAML Cancelled](wu/WU-300.yaml)');

    expect(backlog).not.toContain('YAML Title');
    const entryMatches = backlog.match(/- \[WU-100/g) ?? [];
    expect(entryMatches).toHaveLength(1);
  });
});

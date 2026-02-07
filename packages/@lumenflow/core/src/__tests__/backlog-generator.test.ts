import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WUStateStore } from '../wu-state-store.js';
import { generateBacklog, generateStatus } from '../backlog-generator.js';

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
      ['id: WU-100', 'title: YAML Title', "lane: 'Framework: CLI'", 'status: ready'].join('\n'),
    );

    writeFileSync(
      join(wuDir, 'WU-200.yaml'),
      ['id: WU-200', 'title: YAML Ready', "lane: 'Framework: Ops'", 'status: ready'].join('\n'),
    );

    writeFileSync(
      join(wuDir, 'WU-300.yaml'),
      ['id: WU-300', 'title: YAML Cancelled', "lane: 'Framework: Core'", 'status: cancelled'].join(
        '\n',
      ),
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

/**
 * WU-1523: Tests that backlog.md and status.md render correctly from wu-events.jsonl
 * in local-only mode after wu:done and wu:claim lifecycle operations.
 */

/** Strip YAML frontmatter (--- ... ---) from markdown so section splits hit body headings, not frontmatter strings. */
function stripFrontmatter(md: string): string {
  if (!md.startsWith('---')) return md;
  const end = md.indexOf('---', 3);
  return end === -1 ? md : md.slice(end + 3);
}

describe('WU-1523: Render backlog and status from state events', () => {
  let tempDir: string;
  let stateDir: string;
  let wuDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wu-1523-render-'));
    stateDir = join(tempDir, '.lumenflow', 'state');
    wuDir = join(tempDir, 'docs', 'tasks', 'wu');
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(wuDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('AC1: after wu:done, backlog.md shows the completed WU in the Done section', async () => {
    // Simulate 3 WUs completed via events (mirrors Haven test scenario)
    const events = [
      { type: 'create', wuId: 'WU-1', timestamp: '2026-02-01T10:00:00.000Z', lane: 'Framework: Core', title: 'First WU' },
      { type: 'claim', wuId: 'WU-1', timestamp: '2026-02-01T10:01:00.000Z', lane: 'Framework: Core', title: 'First WU' },
      { type: 'complete', wuId: 'WU-1', timestamp: '2026-02-01T11:00:00.000Z' },
      { type: 'create', wuId: 'WU-2', timestamp: '2026-02-01T12:00:00.000Z', lane: 'Framework: CLI', title: 'Second WU' },
      { type: 'claim', wuId: 'WU-2', timestamp: '2026-02-01T12:01:00.000Z', lane: 'Framework: CLI', title: 'Second WU' },
      { type: 'complete', wuId: 'WU-2', timestamp: '2026-02-01T13:00:00.000Z' },
      { type: 'create', wuId: 'WU-3', timestamp: '2026-02-01T14:00:00.000Z', lane: 'Framework: Memory', title: 'Third WU' },
      { type: 'claim', wuId: 'WU-3', timestamp: '2026-02-01T14:01:00.000Z', lane: 'Framework: Memory', title: 'Third WU' },
      { type: 'complete', wuId: 'WU-3', timestamp: '2026-02-01T15:00:00.000Z' },
    ];

    writeFileSync(
      join(stateDir, 'wu-events.jsonl'),
      events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    );

    const store = new WUStateStore(stateDir);
    await store.load();

    const backlog = stripFrontmatter(await generateBacklog(store, { wuDir }));

    // All 3 WUs should appear in the Done section
    const doneSection = backlog.split('## ✅ Done')[1] || '';
    expect(doneSection).toContain('WU-1');
    expect(doneSection).toContain('WU-2');
    expect(doneSection).toContain('WU-3');

    // No items should be in the Ready or In Progress sections
    const readySection = backlog.split('## 🚀 Ready')[1]?.split('##')[0] || '';
    const inProgressSection = backlog.split('## 🔧 In progress')[1]?.split('##')[0] || '';
    expect(readySection).not.toContain('WU-1');
    expect(inProgressSection).not.toContain('WU-1');
  });

  it('AC2: after wu:claim, status.md shows the claimed WU in the In Progress section', async () => {
    // Simulate a single claim event
    const events = [
      { type: 'create', wuId: 'WU-42', timestamp: '2026-02-01T10:00:00.000Z', lane: 'Framework: Core', title: 'Claimed WU' },
      { type: 'claim', wuId: 'WU-42', timestamp: '2026-02-01T10:01:00.000Z', lane: 'Framework: Core', title: 'Claimed WU' },
    ];

    writeFileSync(
      join(stateDir, 'wu-events.jsonl'),
      events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    );

    const store = new WUStateStore(stateDir);
    await store.load();

    const status = await generateStatus(store);

    // WU should appear in the In Progress section
    const inProgressSection = status.split('## In Progress')[1]?.split('## ')[0] || '';
    expect(inProgressSection).toContain('WU-42');
    expect(inProgressSection).toContain('Claimed WU');
  });

  it('AC3: both files render correctly from wu-events.jsonl in local-only mode', async () => {
    // Simulate a mix of states: 1 in_progress, 1 done
    const events = [
      { type: 'create', wuId: 'WU-10', timestamp: '2026-02-01T10:00:00.000Z', lane: 'Framework: Core', title: 'Active WU' },
      { type: 'claim', wuId: 'WU-10', timestamp: '2026-02-01T10:01:00.000Z', lane: 'Framework: Core', title: 'Active WU' },
      { type: 'create', wuId: 'WU-20', timestamp: '2026-02-01T11:00:00.000Z', lane: 'Framework: CLI', title: 'Done WU' },
      { type: 'claim', wuId: 'WU-20', timestamp: '2026-02-01T11:01:00.000Z', lane: 'Framework: CLI', title: 'Done WU' },
      { type: 'complete', wuId: 'WU-20', timestamp: '2026-02-01T12:00:00.000Z' },
    ];

    writeFileSync(
      join(stateDir, 'wu-events.jsonl'),
      events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    );

    const store = new WUStateStore(stateDir);
    await store.load();

    // Verify backlog (strip frontmatter so section splits hit body headings)
    const backlog = stripFrontmatter(await generateBacklog(store, { wuDir }));
    const backlogInProgress = backlog.split('## 🔧 In progress')[1]?.split('##')[0] || '';
    const backlogDone = backlog.split('## ✅ Done')[1] || '';

    expect(backlogInProgress).toContain('WU-10');
    expect(backlogInProgress).not.toContain('WU-20');
    expect(backlogDone).toContain('WU-20');
    expect(backlogDone).not.toContain('WU-10');

    // Verify status
    const status = await generateStatus(store);
    const statusInProgress = status.split('## In Progress')[1]?.split('## ')[0] || '';
    const statusCompleted = status.split('## Completed')[1] || '';

    expect(statusInProgress).toContain('WU-10');
    expect(statusInProgress).not.toContain('WU-20');
    expect(statusCompleted).toContain('WU-20');
    expect(statusCompleted).not.toContain('WU-10');
  });
});

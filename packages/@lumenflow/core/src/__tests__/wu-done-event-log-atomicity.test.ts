import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { WUTransaction } from '../wu-transaction.js';
import { collectMetadataToTransaction } from '../wu-done-validators.js';

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
}

function readText(filePath) {
  return readFileSync(filePath, 'utf-8');
}

describe('WU-1752: wu:done event log atomicity', () => {
  const originalCwd = process.cwd();
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wu-1752-'));
    process.chdir(tempDir);

    await writeFile(
      path.join('docs', '04-operations', 'tasks', 'status.md'),
      [
        '# Work Unit Status',
        '',
        '## In Progress',
        '',
        '- [WU-123 — Test WU](wu/WU-123.yaml) — 2025-12-17',
        '',
        '## Blocked',
        '',
        '(No items currently blocked)',
        '',
        '## Completed',
        '',
        '(No completed items)',
        '',
      ].join('\n'),
    );

    await writeFile(
      path.join('docs', '04-operations', 'tasks', 'backlog.md'),
      ['# Backlog', '', '(fixture)'].join('\n'),
    );

    await writeFile(
      path.join('.beacon', 'state', 'wu-events.jsonl'),
      [
        JSON.stringify({
          type: 'claim',
          wuId: 'WU-123',
          lane: 'Operations: Tooling',
          title: 'Test WU',
          timestamp: '2025-12-17T00:00:00.000Z',
        }),
        '',
      ].join('\n'),
    );
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('collectMetadataToTransaction does not mutate wu-events.jsonl before tx.commit()', async () => {
    const transaction = new WUTransaction('WU-123');

    const doc = {
      id: 'WU-123',
      title: 'Test WU',
      lane: 'Operations: Tooling',
      status: 'in_progress',
    };

    const before = readText(path.join('.beacon', 'state', 'wu-events.jsonl'));

    await collectMetadataToTransaction({
      id: 'WU-123',
      title: 'Test WU',
      doc,
      wuPath: path.join('docs', '04-operations', 'tasks', 'wu', 'WU-123.yaml'),
      statusPath: path.join('docs', '04-operations', 'tasks', 'status.md'),
      backlogPath: path.join('docs', '04-operations', 'tasks', 'backlog.md'),
      stampPath: path.join('.beacon', 'stamps', 'WU-123.done'),
      transaction,
    });

    const afterCollect = readText(path.join('.beacon', 'state', 'wu-events.jsonl'));
    expect(afterCollect).toBe(before);

    const commitResult = transaction.commit();
    expect(commitResult.success).toBe(true);

    const afterCommit = readText(path.join('.beacon', 'state', 'wu-events.jsonl'));
    expect(afterCommit).toContain('"type":"complete"');
    expect(afterCommit).toContain('"wuId":"WU-123"');
  });

  it('repeat collection is idempotent when wu-events.jsonl already contains complete', async () => {
    await writeFile(
      path.join('.beacon', 'state', 'wu-events.jsonl'),
      [
        JSON.stringify({
          type: 'claim',
          wuId: 'WU-123',
          lane: 'Operations: Tooling',
          title: 'Test WU',
          timestamp: '2025-12-17T00:00:00.000Z',
        }),
        JSON.stringify({
          type: 'complete',
          wuId: 'WU-123',
          timestamp: '2025-12-17T00:01:00.000Z',
        }),
        '',
      ].join('\n'),
    );

    const transaction = new WUTransaction('WU-123');
    const doc = {
      id: 'WU-123',
      title: 'Test WU',
      lane: 'Operations: Tooling',
      status: 'in_progress',
    };

    await collectMetadataToTransaction({
      id: 'WU-123',
      title: 'Test WU',
      doc,
      wuPath: path.join('docs', '04-operations', 'tasks', 'wu', 'WU-123.yaml'),
      statusPath: path.join('docs', '04-operations', 'tasks', 'status.md'),
      backlogPath: path.join('docs', '04-operations', 'tasks', 'backlog.md'),
      stampPath: path.join('.beacon', 'stamps', 'WU-123.done'),
      transaction,
    });

    const commitResult = transaction.commit();
    expect(commitResult.success).toBe(true);

    const afterCommit = readText(path.join('.beacon', 'state', 'wu-events.jsonl'));
    const completeCount = afterCommit.split('"type":"complete"').length - 1;
    expect(completeCount).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { validatePostMutation } from '../wu-done-validation.js';

function writeDoneWUFile(wuPath: string) {
  writeFileSync(
    wuPath,
    `id: WU-9000
title: Post mutation validation test
lane: 'Operations: Tooling'
type: bug
status: done
locked: true
created: 2026-02-10
completed_at: 2026-02-10T02:00:00.000Z
completed: 2026-02-10
code_paths: []
tests:
  manual: []
  unit: []
  e2e: []
`,
  );
}

describe('validatePostMutation state consistency', () => {
  it('fails when events do not derive to done', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wu-post-mutation-'));
    try {
      const wuPath = path.join(root, 'docs/04-operations/tasks/wu/WU-9000.yaml');
      const stampPath = path.join(root, '.lumenflow/stamps/WU-9000.done');
      const eventsPath = path.join(root, '.lumenflow/state/wu-events.jsonl');

      mkdirSync(path.dirname(wuPath), { recursive: true });
      mkdirSync(path.dirname(stampPath), { recursive: true });
      mkdirSync(path.dirname(eventsPath), { recursive: true });
      writeDoneWUFile(wuPath);
      writeFileSync(stampPath, 'stamp');
      writeFileSync(
        eventsPath,
        JSON.stringify({
          type: 'claim',
          wuId: 'WU-9000',
          lane: 'Operations: Tooling',
          title: 'Post mutation validation test',
          timestamp: '2026-02-10T01:00:00.000Z',
        }) + '\n',
      );

      const result = validatePostMutation({ id: 'WU-9000', wuPath, stampPath, eventsPath });
      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('state store'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes when YAML, stamp, and events all indicate done', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wu-post-mutation-'));
    try {
      const wuPath = path.join(root, 'docs/04-operations/tasks/wu/WU-9000.yaml');
      const stampPath = path.join(root, '.lumenflow/stamps/WU-9000.done');
      const eventsPath = path.join(root, '.lumenflow/state/wu-events.jsonl');

      mkdirSync(path.dirname(wuPath), { recursive: true });
      mkdirSync(path.dirname(stampPath), { recursive: true });
      mkdirSync(path.dirname(eventsPath), { recursive: true });
      writeDoneWUFile(wuPath);
      writeFileSync(stampPath, 'stamp');
      writeFileSync(
        eventsPath,
        [
          JSON.stringify({
            type: 'claim',
            wuId: 'WU-9000',
            lane: 'Operations: Tooling',
            title: 'Post mutation validation test',
            timestamp: '2026-02-10T01:00:00.000Z',
          }),
          JSON.stringify({
            type: 'complete',
            wuId: 'WU-9000',
            timestamp: '2026-02-10T02:00:00.000Z',
          }),
          '',
        ].join('\n'),
      );

      const result = validatePostMutation({ id: 'WU-9000', wuPath, stampPath, eventsPath });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

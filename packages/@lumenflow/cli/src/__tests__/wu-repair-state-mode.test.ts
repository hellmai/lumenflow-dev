import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runStateRepairMode } from '../wu-repair.js';

describe('wu:repair --repair-state', () => {
  let tempDir = '';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wu-repair-state-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('repairs merge-marker corruption in wu-events.jsonl via state repair mode', async () => {
    const filePath = join(tempDir, 'wu-events.jsonl');
    const claimEvent = JSON.stringify({
      type: 'claim',
      wuId: 'WU-1673',
      lane: 'Framework: Core Lifecycle',
      title: 'Repair state mode test',
      timestamp: '2026-02-14T12:00:00.000Z',
    });
    const completeEvent = JSON.stringify({
      type: 'complete',
      wuId: 'WU-1672',
      timestamp: '2026-02-14T11:59:00.000Z',
    });

    writeFileSync(
      filePath,
      [
        claimEvent,
        '<<<<<<< HEAD',
        completeEvent,
        '=======',
        claimEvent,
        '>>>>>>> origin/main',
      ].join('\n'),
      'utf-8',
    );

    const result = await runStateRepairMode({ path: filePath });
    const repaired = readFileSync(filePath, 'utf-8');

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(repaired).not.toContain('<<<<<<<');
    expect(repaired).not.toContain('=======');
    expect(repaired).not.toContain('>>>>>>>');
    expect(repaired).toContain('"type":"claim"');
    expect(repaired).toContain('"type":"complete"');
  });
});

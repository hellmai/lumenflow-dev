// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSignal, loadSignals } from '../mem-signal-core.js';

const SIGNALS_RELATIVE_PATH = path.join('.lumenflow', 'memory', 'signals.jsonl');

async function writeSignals(baseDir: string, records: unknown[]): Promise<void> {
  const signalsPath = path.join(baseDir, SIGNALS_RELATIVE_PATH);
  await fs.mkdir(path.dirname(signalsPath), { recursive: true });
  const lines = records.map((record) => JSON.stringify(record)).join('\n');
  await fs.writeFile(signalsPath, `${lines}${lines ? '\n' : ''}`, 'utf-8');
}

describe('signal schema extension (WU-2146)', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('parses legacy signals without the new metadata fields', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'signal-schema-extension-'));
    tempRoots.push(root);

    await writeSignals(root, [
      {
        id: 'sig-legacy1',
        message: 'legacy signal',
        created_at: '2026-03-01T12:00:00.000Z',
        read: false,
        wu_id: 'WU-2146',
      },
    ]);

    const signals = await loadSignals(root, { wuId: 'WU-2146' });

    expect(signals).toHaveLength(1);
    expect(signals[0]?.id).toBe('sig-legacy1');
    expect(signals[0]?.message).toBe('legacy signal');
  });

  it('round-trips extended metadata fields through create/load JSONL flow', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'signal-schema-extension-'));
    tempRoots.push(root);

    const created = await createSignal(root, {
      message: 'handoff to remote agent',
      wuId: 'WU-2146',
      type: 'handoff',
      sender: 'agent-alpha',
      target_agent: 'agent-beta',
      origin: 'mcp',
      remote_id: 'remote-123',
    });

    expect(created.signal.type).toBe('handoff');
    expect(created.signal.sender).toBe('agent-alpha');
    expect(created.signal.target_agent).toBe('agent-beta');
    expect(created.signal.origin).toBe('mcp');
    expect(created.signal.remote_id).toBe('remote-123');

    const loaded = await loadSignals(root, { wuId: 'WU-2146' });

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.type).toBe('handoff');
    expect(loaded[0]?.sender).toBe('agent-alpha');
    expect(loaded[0]?.target_agent).toBe('agent-beta');
    expect(loaded[0]?.origin).toBe('mcp');
    expect(loaded[0]?.remote_id).toBe('remote-123');
  });
});

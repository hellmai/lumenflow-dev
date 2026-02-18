// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionManager } from '../src/session/session-manager.js';

describe('runtime session manager', () => {
  let tempRoot: string;
  let manager: SessionManager;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-session-manager-'));
    manager = new SessionManager({ checkpointsDir: join(tempRoot, 'checkpoints') });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('creates sessions concurrently with unique IDs and persisted checkpoints', async () => {
    const created = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        manager.createSession({ agent_id: `agent-${index}` }),
      ),
    );

    const ids = new Set(created.map((session) => session.session_id));
    expect(ids.size).toBe(created.length);

    for (const session of created) {
      const stored = await readFile(
        join(tempRoot, 'checkpoints', `${session.session_id}.json`),
        'utf8',
      );
      expect(JSON.parse(stored)).toMatchObject({
        session_id: session.session_id,
        agent_id: session.agent_id,
      });
    }
  });

  it('closeSession clears in-memory cache and allows restore from persisted file', async () => {
    const session = await manager.createSession({ agent_id: 'agent-close' });
    await manager.checkpoint(session.session_id, { phase: 'before-close' });
    await manager.closeSession(session.session_id);

    await writeFile(
      join(tempRoot, 'checkpoints', `${session.session_id}.json`),
      JSON.stringify({
        ...session,
        updated_at: '2030-01-01T00:00:00.000Z',
        state: { phase: 'after-close' },
      }),
      'utf8',
    );

    const restored = await manager.restore(session.session_id);
    expect(restored?.state).toEqual({ phase: 'after-close' });
    expect(restored?.updated_at).toBe('2030-01-01T00:00:00.000Z');
  });

  it('returns null for missing sessions and throws on checkpoint for unknown session', async () => {
    await expect(manager.restore('missing-session')).resolves.toBeNull();
    await expect(manager.checkpoint('missing-session', { step: 'x' })).rejects.toThrow(
      'Session not found: missing-session',
    );
  });

  it('propagates non-ENOENT restore errors for corrupted checkpoint files', async () => {
    const invalidSessionId = 'broken-session';
    await mkdir(join(tempRoot, 'checkpoints'), { recursive: true });
    await writeFile(join(tempRoot, 'checkpoints', `${invalidSessionId}.json`), '{', 'utf8');

    await expect(manager.restore(invalidSessionId)).rejects.toThrow();
  });
});

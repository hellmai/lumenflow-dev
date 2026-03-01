// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enrichToolResultWithSignals,
  resetSignalEnrichmentStateForTests,
} from '../signal-enrichment.js';

describe('signal enrichment (WU-2148)', () => {
  beforeEach(() => {
    resetSignalEnrichmentStateForTests();
  });

  it('adds _signals payload and marks surfaced signals as read', async () => {
    const loadUnreadSignals = vi.fn().mockResolvedValue([
      {
        id: 'sig-1',
        message: 'please unblock WU-2148',
        created_at: '2026-03-01T10:00:00.000Z',
        read: false,
        wu_id: 'WU-2148',
      },
      {
        id: 'sig-2',
        message: 'handoff from codex',
        created_at: '2026-03-01T10:01:00.000Z',
        read: false,
        lane: 'Framework: MCP',
      },
    ]);
    const markRead = vi.fn().mockResolvedValue({ markedCount: 2 });

    const result = await enrichToolResultWithSignals(
      { success: true, payload: { ok: true } },
      {
        projectRoot: '/workspace',
        loadUnreadSignals,
        markRead,
      },
    );

    expect(loadUnreadSignals).toHaveBeenCalledWith('/workspace');
    expect(markRead).toHaveBeenCalledWith('/workspace', ['sig-1', 'sig-2']);
    expect(result).toMatchObject({
      success: true,
      payload: { ok: true },
      _signals: {
        count: 2,
      },
    });
  });

  it('throttles signal checks to once every 5 seconds per process', async () => {
    const loadUnreadSignals = vi.fn().mockResolvedValue([]);
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(4_000);

    await enrichToolResultWithSignals(
      { success: true },
      {
        projectRoot: '/workspace',
        loadUnreadSignals,
        now,
      },
    );

    await enrichToolResultWithSignals(
      { success: true },
      {
        projectRoot: '/workspace',
        loadUnreadSignals,
        now,
      },
    );

    expect(loadUnreadSignals).toHaveBeenCalledTimes(1);
  });

  it('returns original tool result when no signals are pending', async () => {
    const loadUnreadSignals = vi.fn().mockResolvedValue([]);
    const markRead = vi.fn();

    const result = await enrichToolResultWithSignals(
      { success: true, payload: { ok: true } },
      {
        projectRoot: '/workspace',
        loadUnreadSignals,
        markRead,
      },
    );

    expect(result).toEqual({ success: true, payload: { ok: true } });
    expect(markRead).not.toHaveBeenCalled();
  });

  it('fails open when signal loading throws', async () => {
    const loadUnreadSignals = vi.fn().mockRejectedValue(new Error('disk unavailable'));

    await expect(
      enrichToolResultWithSignals(
        { success: true, payload: { ok: true } },
        {
          projectRoot: '/workspace',
          loadUnreadSignals,
        },
      ),
    ).resolves.toEqual({ success: true, payload: { ok: true } });
  });

  it('fails open when remote acknowledger throws', async () => {
    const loadUnreadSignals = vi.fn().mockResolvedValue([
      {
        id: 'sig-1',
        message: 'coordination signal',
        created_at: '2026-03-01T10:00:00.000Z',
        read: false,
      },
    ]);
    const markRead = vi.fn().mockResolvedValue({ markedCount: 1 });
    const acknowledgeRemote = vi.fn().mockRejectedValue(new Error('remote timeout'));

    const result = await enrichToolResultWithSignals(
      { success: true, payload: { ok: true } },
      {
        projectRoot: '/workspace',
        loadUnreadSignals,
        markRead,
        acknowledgeRemote,
      },
    );

    expect(result).toMatchObject({
      success: true,
      payload: { ok: true },
      _signals: { count: 1 },
    });
    expect(markRead).toHaveBeenCalledWith('/workspace', ['sig-1']);
    expect(acknowledgeRemote).toHaveBeenCalledTimes(1);
  });
});

// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Unit tests for WUEventSourcer (WU-2043)
 *
 * Tests the event sourcer in isolation:
 * - Event append with validation
 * - Events file creation (directory creation)
 * - Load and replay from JSONL
 * - Error handling: missing file, malformed JSON, invalid events, empty lines
 * - appendAndApply (combined disk write + indexer update)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  WUEventSourcer,
  WU_EVENTS_FILE_NAME,
  WU_BRIEF_EVIDENCE_NOTE_PREFIX,
  findLatestWuBriefEvidence,
} from '../wu-event-sourcer.js';
import type { WUStateIndexer } from '../wu-state-indexer.js';
import type { WUEvent } from '../wu-state-schema.js';

// Mock node:fs/promises
vi.mock('node:fs/promises');

// Mock validateWUEvent to control validation behavior
vi.mock('../wu-state-schema.js', () => ({
  validateWUEvent: vi.fn(),
}));

import { validateWUEvent } from '../wu-state-schema.js';

// Helper to create a mock indexer
function createMockIndexer(): WUStateIndexer {
  return {
    clear: vi.fn(),
    applyEvent: vi.fn(),
    getWUState: vi.fn(),
    getByStatus: vi.fn(),
    getByLane: vi.fn(),
    getChildWUs: vi.fn(),
  } as unknown as WUStateIndexer;
}

// Helper to create a valid claim event
function makeClaimEvent(wuId = 'WU-100'): WUEvent {
  return {
    type: 'claim',
    wuId,
    timestamp: '2026-02-22T10:00:00.000Z',
    lane: 'Framework: Core',
    title: 'Test WU',
  } as WUEvent;
}

describe('WUEventSourcer', () => {
  const baseDir = '/tmp/test-state';
  const eventsPath = path.join(baseDir, WU_EVENTS_FILE_NAME);
  let indexer: WUStateIndexer;
  let sourcer: WUEventSourcer;

  beforeEach(() => {
    vi.clearAllMocks();
    indexer = createMockIndexer();
    sourcer = new WUEventSourcer(baseDir, indexer);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor and getEventsFilePath', () => {
    it('should compute events file path from baseDir', () => {
      expect(sourcer.getEventsFilePath()).toBe(eventsPath);
    });
  });

  describe('findLatestWuBriefEvidence', () => {
    it('should return null when no wu:brief evidence exists for target WU', () => {
      const events = [
        makeClaimEvent('WU-100'),
        {
          type: 'checkpoint',
          wuId: 'WU-100',
          timestamp: '2026-02-24T10:00:00.000Z',
          note: 'regular checkpoint',
        },
      ] as WUEvent[];

      const result = findLatestWuBriefEvidence(events, 'WU-100');
      expect(result).toBeNull();
    });

    it('should return latest wu:brief checkpoint evidence for target WU', () => {
      const events = [
        {
          type: 'checkpoint',
          wuId: 'WU-100',
          timestamp: '2026-02-24T10:00:00.000Z',
          note: `${WU_BRIEF_EVIDENCE_NOTE_PREFIX} initial`,
        },
        {
          type: 'checkpoint',
          wuId: 'WU-100',
          timestamp: '2026-02-24T11:00:00.000Z',
          note: `${WU_BRIEF_EVIDENCE_NOTE_PREFIX} refreshed`,
        },
      ] as WUEvent[];

      const result = findLatestWuBriefEvidence(events, 'WU-100');
      expect(result).toEqual(
        expect.objectContaining({
          wuId: 'WU-100',
          timestamp: '2026-02-24T11:00:00.000Z',
          note: `${WU_BRIEF_EVIDENCE_NOTE_PREFIX} refreshed`,
        }),
      );
    });

    it('should ignore evidence from other WUs', () => {
      const events = [
        {
          type: 'checkpoint',
          wuId: 'WU-200',
          timestamp: '2026-02-24T10:00:00.000Z',
          note: `${WU_BRIEF_EVIDENCE_NOTE_PREFIX} evidence`,
        },
      ] as WUEvent[];

      const result = findLatestWuBriefEvidence(events, 'WU-100');
      expect(result).toBeNull();
    });
  });

  describe('appendEvent', () => {
    it('should validate the event before appending', async () => {
      const event = makeClaimEvent();
      vi.mocked(validateWUEvent).mockReturnValue({
        success: true,
        data: event,
      } as ReturnType<typeof validateWUEvent>);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.appendFile).mockResolvedValue(undefined);

      await sourcer.appendEvent(event);

      expect(validateWUEvent).toHaveBeenCalledWith(event);
      expect(fs.mkdir).toHaveBeenCalledWith(baseDir, { recursive: true });
      expect(fs.appendFile).toHaveBeenCalledWith(eventsPath, `${JSON.stringify(event)}\n`, 'utf-8');
    });

    it('should throw validation error when event is invalid', async () => {
      vi.mocked(validateWUEvent).mockReturnValue({
        success: false,
        error: {
          issues: [{ path: ['type'], message: 'Invalid event type' }],
        },
      } as ReturnType<typeof validateWUEvent>);

      const badEvent = { type: 'invalid' } as unknown as WUEvent;

      await expect(sourcer.appendEvent(badEvent)).rejects.toThrow('Validation error');
    });

    it('should create directories recursively when they do not exist', async () => {
      const event = makeClaimEvent();
      vi.mocked(validateWUEvent).mockReturnValue({
        success: true,
        data: event,
      } as ReturnType<typeof validateWUEvent>);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.appendFile).mockResolvedValue(undefined);

      await sourcer.appendEvent(event);

      expect(fs.mkdir).toHaveBeenCalledWith(baseDir, { recursive: true });
    });
  });

  describe('load', () => {
    it('should clear indexer before loading', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      );

      await sourcer.load();

      expect(indexer.clear).toHaveBeenCalled();
    });

    it('should return empty state when file does not exist (ENOENT)', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      );

      await sourcer.load();

      expect(indexer.applyEvent).not.toHaveBeenCalled();
    });

    it('should rethrow non-ENOENT errors', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(
        Object.assign(new Error('EACCES'), { code: 'EACCES' }),
      );

      await expect(sourcer.load()).rejects.toThrow('EACCES');
    });

    it('should skip empty lines gracefully', async () => {
      const event = makeClaimEvent();
      const content = `${JSON.stringify(event)}\n\n  \n${JSON.stringify(event)}\n`;
      vi.mocked(fs.readFile).mockResolvedValue(content);
      vi.mocked(validateWUEvent).mockReturnValue({
        success: true,
        data: event,
      } as ReturnType<typeof validateWUEvent>);

      await sourcer.load();

      // Should apply exactly 2 events (skipping 2 empty lines)
      expect(indexer.applyEvent).toHaveBeenCalledTimes(2);
    });

    it('should throw on malformed JSON with line number', async () => {
      const content = '{"valid": true}\n{bad json}\n';
      vi.mocked(fs.readFile).mockResolvedValue(content);
      vi.mocked(validateWUEvent).mockReturnValue({
        success: true,
        data: makeClaimEvent(),
      } as ReturnType<typeof validateWUEvent>);

      await expect(sourcer.load()).rejects.toThrow(/Malformed JSON on line 2/);
    });

    it('should include non-Error parse failure details in malformed JSON errors', async () => {
      const content = '{"valid": true}\n';
      vi.mocked(fs.readFile).mockResolvedValue(content);
      const parseSpy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
        throw 'parse-failed';
      });

      await expect(sourcer.load()).rejects.toThrow(/Malformed JSON on line 1: parse-failed/);

      parseSpy.mockRestore();
    });

    it('should throw validation error with line number for invalid events', async () => {
      const event = makeClaimEvent();
      const content = `${JSON.stringify(event)}\n`;
      vi.mocked(fs.readFile).mockResolvedValue(content);
      vi.mocked(validateWUEvent).mockReturnValue({
        success: false,
        error: {
          issues: [{ path: ['wuId'], message: 'Invalid WU ID' }],
        },
      } as ReturnType<typeof validateWUEvent>);

      await expect(sourcer.load()).rejects.toThrow(
        /Validation error on line 1.*wuId: Invalid WU ID/,
      );
    });

    it('should replay valid events through the indexer', async () => {
      const event1 = makeClaimEvent('WU-100');
      const event2 = makeClaimEvent('WU-200');
      const content = `${JSON.stringify(event1)}\n${JSON.stringify(event2)}\n`;
      vi.mocked(fs.readFile).mockResolvedValue(content);
      vi.mocked(validateWUEvent).mockImplementation(
        (data) =>
          ({
            success: true,
            data: data as WUEvent,
          }) as ReturnType<typeof validateWUEvent>,
      );

      await sourcer.load();

      expect(indexer.applyEvent).toHaveBeenCalledTimes(2);
    });

    it('should handle empty file gracefully', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('');

      await sourcer.load();

      expect(indexer.applyEvent).not.toHaveBeenCalled();
    });
  });

  describe('appendAndApply', () => {
    it('should append event to disk and apply to indexer', async () => {
      const event = makeClaimEvent();
      vi.mocked(validateWUEvent).mockReturnValue({
        success: true,
        data: event,
      } as ReturnType<typeof validateWUEvent>);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.appendFile).mockResolvedValue(undefined);

      await sourcer.appendAndApply(event);

      expect(fs.appendFile).toHaveBeenCalled();
      expect(indexer.applyEvent).toHaveBeenCalledWith(event);
    });
  });
});

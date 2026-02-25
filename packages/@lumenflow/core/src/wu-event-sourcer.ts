// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Event Sourcer (WU-2013)
 *
 * Handles event sourcing operations for WU lifecycle:
 * - Loading and replaying events from JSONL file
 * - Appending new events with validation
 *
 * Single responsibility: event file I/O and replay.
 *
 * @see {@link ./wu-state-store.ts} - Facade that delegates to this service
 * @see {@link ./wu-state-indexer.ts} - Applies events to in-memory state
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { validateWUEvent, type WUEvent } from './wu-state-schema.js';
import type { WUStateIndexer } from './wu-state-indexer.js';
import { getErrorMessage, createError, ErrorCodes } from './error-handler.js';

/**
 * WU events file name constant
 */
export const WU_EVENTS_FILE_NAME = 'wu-events.jsonl';
export const WU_BRIEF_EVIDENCE_NOTE_PREFIX = '[wu:brief]';

export interface WuBriefEvidence {
  wuId: string;
  timestamp: string;
  note: string;
}

const FILE_NOT_FOUND_ERROR_CODE = 'ENOENT';

function getErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  if (!('code' in error)) {
    return null;
  }

  const { code } = error;
  return typeof code === 'string' ? code : null;
}

function parseValidatedEvents(content: string): WUEvent[] {
  const events: WUEvent[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (typeof rawLine !== 'string') {
      continue;
    }
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw createError(
        ErrorCodes.PARSE_ERROR,
        `Malformed JSON on line ${i + 1}: ${getErrorMessage(error)}`,
      );
    }

    const validation = validateWUEvent(parsed);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw createError(
        ErrorCodes.VALIDATION_ERROR,
        `Validation error on line ${i + 1}: ${issues}`,
      );
    }

    events.push(validation.data);
  }

  return events;
}

async function readEventsFileSafely(eventsFilePath: string): Promise<string> {
  try {
    return await fs.readFile(eventsFilePath, 'utf-8');
  } catch (error) {
    if (getErrorCode(error) === FILE_NOT_FOUND_ERROR_CODE) {
      return '';
    }
    throw error;
  }
}

/**
 * Find the latest wu:brief checkpoint evidence in a list of validated events.
 */
export function findLatestWuBriefEvidence(
  events: readonly WUEvent[],
  wuId: string,
): WuBriefEvidence | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event || event.type !== 'checkpoint') {
      continue;
    }

    if (
      event.wuId === wuId &&
      typeof event.note === 'string' &&
      event.note.startsWith(WU_BRIEF_EVIDENCE_NOTE_PREFIX)
    ) {
      return { wuId: event.wuId, timestamp: event.timestamp, note: event.note };
    }
  }

  return null;
}

/**
 * Read wu-events and return latest wu:brief evidence for a WU (if any).
 */
export async function getLatestWuBriefEvidence(
  baseDir: string,
  wuId: string,
): Promise<WuBriefEvidence | null> {
  const eventsFilePath = path.join(baseDir, WU_EVENTS_FILE_NAME);
  const content = await readEventsFileSafely(eventsFilePath);
  if (!content.trim()) {
    return null;
  }

  return findLatestWuBriefEvidence(parseValidatedEvents(content), wuId);
}

/**
 * WU Event Sourcer
 *
 * Manages event file I/O: loading events from JSONL, replaying them
 * into a WUStateIndexer and appending new validated events.
 */
export class WUEventSourcer {
  private readonly baseDir: string;
  private readonly eventsFilePath: string;
  private readonly indexer: WUStateIndexer;

  constructor(baseDir: string, indexer: WUStateIndexer) {
    this.baseDir = baseDir;
    this.eventsFilePath = path.join(baseDir, WU_EVENTS_FILE_NAME);
    this.indexer = indexer;
  }

  /** Get the events file path (used by facade for external consumers). */
  getEventsFilePath(): string {
    return this.eventsFilePath;
  }

  /**
   * Load and replay events from JSONL file into the indexer.
   *
   * Handles:
   * - Missing file: returns empty state
   * - Empty file: returns empty state
   * - Empty lines: skipped gracefully
   * - Malformed JSON: throws error with line info
   * - Invalid events: throws validation error
   *
   * @throws Error If file contains malformed JSON or invalid events
   */
  async load(): Promise<void> {
    this.indexer.clear();

    const content = await readEventsFileSafely(this.eventsFilePath);
    if (!content.trim()) {
      return;
    }

    const events = parseValidatedEvents(content);
    for (const event of events) {
      this.indexer.applyEvent(event);
    }
  }

  /**
   * Append an event to the events file.
   * Validates event before appending. Creates directories if needed.
   *
   * @throws Error If event fails validation
   */
  async appendEvent(event: WUEvent): Promise<void> {
    const validation = validateWUEvent(event);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw createError(ErrorCodes.VALIDATION_ERROR, `Validation error: ${issues}`);
    }

    const line = `${JSON.stringify(event)}\n`;
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.appendFile(this.eventsFilePath, line, 'utf-8');
  }

  /** Append an event to disk and apply it to the indexer. */
  async appendAndApply(event: WUEvent): Promise<void> {
    await this.appendEvent(event);
    this.indexer.applyEvent(event);
  }
}

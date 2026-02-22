// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Event Sourcer (WU-2013)
 *
 * Handles event sourcing operations for WU lifecycle:
 * - Loading and replaying events from JSONL file
 * - Appending new events with validation
 * - Delegation cutover migration (delegated to wu-delegation-cutover.ts)
 *
 * Single responsibility: event file I/O and replay.
 *
 * @see {@link ./wu-state-store.ts} - Facade that delegates to this service
 * @see {@link ./wu-state-indexer.ts} - Applies events to in-memory state
 * @see {@link ./wu-delegation-cutover.ts} - Legacy migration logic
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { validateWUEvent, type WUEvent } from './wu-state-schema.js';
import type { WUStateIndexer } from './wu-state-indexer.js';
import { runDelegationCutoverIfNeeded } from './wu-delegation-cutover.js';

/**
 * WU events file name constant
 */
export const WU_EVENTS_FILE_NAME = 'wu-events.jsonl';

/**
 * WU Event Sourcer
 *
 * Manages event file I/O: loading events from JSONL, replaying them
 * into a WUStateIndexer, appending new validated events, and running
 * the delegation cutover migration on first load.
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

    await runDelegationCutoverIfNeeded(this.baseDir, this.eventsFilePath);

    let content: string;
    try {
      content = await fs.readFile(this.eventsFilePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }

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
        throw new Error(`Malformed JSON on line ${i + 1}: ${(error as Error).message}`, {
          cause: error,
        });
      }

      const validation = validateWUEvent(parsed);
      if (!validation.success) {
        const issues = validation.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', ');
        throw new Error(`Validation error on line ${i + 1}: ${issues}`);
      }

      this.indexer.applyEvent(validation.data);
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
      throw new Error(`Validation error: ${issues}`);
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

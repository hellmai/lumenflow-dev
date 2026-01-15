/**
 * Spawn Registry Store (WU-1944)
 *
 * Event-sourced state store for tracking sub-agent spawns.
 * Stores events in .beacon/state/spawn-registry.jsonl (append-only, git-friendly).
 *
 * Features:
 * - Event sourcing with replay for current state
 * - Atomic append operations
 * - O(1) queries by parent WU, target WU, and status
 *
 * @see {@link tools/lib/__tests__/spawn-registry-store.test.mjs} - Tests
 * @see {@link tools/lib/spawn-registry-schema.mjs} - Schema definitions
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { validateSpawnEvent, generateSpawnId, SpawnStatus } from './spawn-registry-schema.js';

/**
 * Spawn registry file name constant
 */
export const SPAWN_REGISTRY_FILE_NAME = 'spawn-registry.jsonl';

/**
 * Spawn Registry Store class
 *
 * Manages spawn registry state via event sourcing pattern.
 * Events are appended to JSONL file, state is rebuilt by replaying events.
 */
export class SpawnRegistryStore {
  /**
   * @param {string} baseDir - Directory containing .beacon/state/
   */
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.registryFilePath = path.join(baseDir, SPAWN_REGISTRY_FILE_NAME);

    // In-memory state (rebuilt from events)
    /** @type {Map<string, import('./spawn-registry-schema.js').SpawnEvent>} */
    this.spawns = new Map();

    /** @type {Map<string, string[]>} - Index: parentWuId -> spawnIds[] */
    this.byParent = new Map();

    /** @type {Map<string, string>} - Index: targetWuId -> spawnId */
    this.byTarget = new Map();
  }

  /**
   * Loads and replays events from JSONL file into current state.
   *
   * Handles:
   * - Missing file: returns empty state
   * - Empty file: returns empty state
   * - Empty lines: skipped gracefully
   * - Malformed JSON: throws error with line info
   * - Invalid events: throws validation error
   *
   * @returns {Promise<void>}
   * @throws {Error} If file contains malformed JSON or invalid events
   *
   * @example
   * const store = new SpawnRegistryStore('/path/to/project');
   * await store.load();
   * const pending = store.getPending();
   */
  async load() {
    // Reset state
    this.spawns.clear();
    this.byParent.clear();
    this.byTarget.clear();

    // Check if file exists
    let content;
    try {
      content = await fs.readFile(this.registryFilePath, 'utf-8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist - return empty state
        return;
      }
      throw error;
    }

    // Parse JSONL content
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines
      if (!line) {
        continue;
      }

      // Parse JSON line
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        throw new Error(`Malformed JSON on line ${i + 1}: ${error.message}`);
      }

      // Validate against schema
      const validation = validateSpawnEvent(parsed);
      if (!validation.success) {
        const issues = validation.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', ');
        throw new Error(`Validation error on line ${i + 1}: ${issues}`);
      }

      const event = validation.data;

      // Apply event to state (latest event for same ID wins)
      this._applyEvent(event);
    }
  }

  /**
   * Applies an event to the in-memory state.
   * If event for same spawn ID exists, updates it (latest wins).
   *
   * @private
   * @param {import('./spawn-registry-schema.js').SpawnEvent} event - Event to apply
   */
  _applyEvent(event) {
    const { id, parentWuId, targetWuId } = event;

    // Update main state map
    this.spawns.set(id, event);

    // Update parent index
    if (!this.byParent.has(parentWuId)) {
      this.byParent.set(parentWuId, []);
    }
    const parentSpawns = this.byParent.get(parentWuId);
    if (!parentSpawns.includes(id)) {
      parentSpawns.push(id);
    }

    // Update target index
    this.byTarget.set(targetWuId, id);
  }

  /**
   * Appends an event to the registry file.
   *
   * Uses append mode to avoid full file rewrite.
   * Creates file and parent directories if they don't exist.
   * Validates event before appending.
   *
   * @private
   * @param {import('./spawn-registry-schema.js').SpawnEvent} event - Event to append
   * @returns {Promise<void>}
   * @throws {Error} If event fails validation
   */
  async _appendEvent(event) {
    // Validate event before appending
    const validation = validateSpawnEvent(event);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw new Error(`Validation error: ${issues}`);
    }

    const line = JSON.stringify(event) + '\n';

    // Ensure parent directory exists before appending
    await fs.mkdir(this.baseDir, { recursive: true });

    // Use append flag to avoid rewriting the file
    await fs.appendFile(this.registryFilePath, line, 'utf-8');
  }

  /**
   * Records a new spawn event with pending status.
   *
   * @param {string} parentWuId - Parent WU ID (orchestrator)
   * @param {string} targetWuId - Target WU ID (spawned work)
   * @param {string} lane - Lane for the spawned work
   * @returns {Promise<string>} The generated spawn ID
   * @throws {Error} If validation fails
   *
   * @example
   * const spawnId = await store.record('WU-1000', 'WU-1001', 'Operations: Tooling');
   */
  async record(parentWuId, targetWuId, lane) {
    const id = generateSpawnId(parentWuId, targetWuId);

    const event = {
      id,
      parentWuId,
      targetWuId,
      lane,
      spawnedAt: new Date().toISOString(),
      status: SpawnStatus.PENDING,
      completedAt: null,
    };

    await this._appendEvent(event);
    this._applyEvent(event);

    return id;
  }

  /**
   * Updates the status of a spawn.
   *
   * @param {string} spawnId - Spawn ID to update
   * @param {'completed' | 'timeout' | 'crashed'} status - New status
   * @returns {Promise<void>}
   * @throws {Error} If spawn ID not found
   *
   * @example
   * await store.updateStatus('spawn-a1b2', 'completed');
   */
  async updateStatus(spawnId, status) {
    const existing = this.spawns.get(spawnId);
    if (!existing) {
      throw new Error(`Spawn ID ${spawnId} not found`);
    }

    const event = {
      ...existing,
      status,
      completedAt: new Date().toISOString(),
    };

    await this._appendEvent(event);
    this._applyEvent(event);
  }

  /**
   * Gets all spawns for a parent WU.
   *
   * @param {string} parentWuId - Parent WU ID
   * @returns {import('./spawn-registry-schema.js').SpawnEvent[]} Array of spawn events
   *
   * @example
   * const spawns = store.getByParent('WU-1000');
   */
  getByParent(parentWuId) {
    const spawnIds = this.byParent.get(parentWuId) ?? [];
    return spawnIds.map((id) => this.spawns.get(id)).filter(Boolean);
  }

  /**
   * Gets spawn for a target WU.
   *
   * @param {string} targetWuId - Target WU ID
   * @returns {import('./spawn-registry-schema.js').SpawnEvent | null} Spawn event or null
   *
   * @example
   * const spawn = store.getByTarget('WU-1001');
   */
  getByTarget(targetWuId) {
    const spawnId = this.byTarget.get(targetWuId);
    if (!spawnId) {
      return null;
    }
    return this.spawns.get(spawnId) ?? null;
  }

  /**
   * Gets all pending spawns.
   *
   * @returns {import('./spawn-registry-schema.js').SpawnEvent[]} Array of pending spawn events
   *
   * @example
   * const pending = store.getPending();
   */
  getPending() {
    return Array.from(this.spawns.values()).filter(
      (spawn) => spawn.status === SpawnStatus.PENDING
    );
  }
}

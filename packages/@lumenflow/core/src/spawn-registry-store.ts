/**
 * Spawn Registry Store (WU-1944)
 *
 * Event-sourced state store for tracking sub-agent spawns.
 * Stores events in .lumenflow/state/spawn-registry.jsonl (append-only, git-friendly).
 *
 * Features:
 * - Event sourcing with replay for current state
 * - Atomic append operations
 * - O(1) queries by parent WU, target WU, and status
 *
 * @see {@link packages/@lumenflow/cli/src/lib/__tests__/spawn-registry-store.test.ts} - Tests
 * @see {@link packages/@lumenflow/cli/src/lib/spawn-registry-schema.ts} - Schema definitions
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  validateSpawnEvent,
  generateSpawnId,
  SpawnStatus,
  type SpawnEvent,
  type SpawnIntentValue,
} from './spawn-registry-schema.js';

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
  private readonly baseDir: string;
  private readonly registryFilePath: string;
  private readonly spawns: Map<string, SpawnEvent>;
  private readonly byParent: Map<string, string[]>;
  private readonly byTarget: Map<string, string>;

  /**
   * @param {string} baseDir - Directory containing .lumenflow/state/
   */
  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.registryFilePath = path.join(baseDir, SPAWN_REGISTRY_FILE_NAME);

    // In-memory state (rebuilt from events)
    this.spawns = new Map();

    // Index: parentWuId -> spawnIds[]
    this.byParent = new Map();

    // Index: targetWuId -> spawnId
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
  async load(): Promise<void> {
    // Reset state
    this.spawns.clear();
    this.byParent.clear();
    this.byTarget.clear();

    // Check if file exists
    let content: string;
    try {
      content = await fs.readFile(this.registryFilePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
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
   */
  private _applyEvent(event: SpawnEvent): void {
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
   * @throws {Error} If event fails validation
   */
  private async _appendEvent(event: SpawnEvent): Promise<void> {
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
   * @param {SpawnIntentValue} [intent] - Optional intent source (e.g., delegation)
   * @returns {Promise<string>} The generated spawn ID
   * @throws {Error} If validation fails
   *
   * @example
   * const spawnId = await store.record('WU-1000', 'WU-1001', 'Operations: Tooling');
   */
  async record(
    parentWuId: string,
    targetWuId: string,
    lane: string,
    intent?: SpawnIntentValue,
  ): Promise<string> {
    const id = generateSpawnId(parentWuId, targetWuId);

    const event = {
      id,
      parentWuId,
      targetWuId,
      lane,
      ...(intent ? { intent } : {}),
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
   * @param {string} status - New status
   * @returns {Promise<void>}
   * @throws {Error} If spawn ID not found
   *
   * @example
   * await store.updateStatus('spawn-a1b2', 'completed');
   */
  async updateStatus(spawnId: string, status: string): Promise<void> {
    const existing = this.spawns.get(spawnId);
    if (!existing) {
      throw new Error(`Spawn ID ${spawnId} not found`);
    }

    const event: SpawnEvent = {
      ...existing,
      status: status as SpawnEvent['status'],
      completedAt: new Date().toISOString(),
    };

    await this._appendEvent(event);
    this._applyEvent(event);
  }

  /**
   * Records claim-time pickup evidence for a spawn entry.
   *
   * WU-1605: This distinguishes intent-only delegation records from
   * delegated work that was actually picked up via wu:claim.
   *
   * @param {string} spawnId - Spawn ID to update
   * @param {string} pickedUpBy - Agent identity that claimed the target WU
   * @param {string} [pickedUpAt] - Optional ISO timestamp (defaults to now)
   * @returns {Promise<void>}
   * @throws {Error} If spawn ID not found
   */
  async recordPickup(spawnId: string, pickedUpBy: string, pickedUpAt?: string): Promise<void> {
    const existing = this.spawns.get(spawnId);
    if (!existing) {
      throw new Error(`Spawn ID ${spawnId} not found`);
    }

    const event: SpawnEvent = {
      ...existing,
      pickedUpBy,
      pickedUpAt: pickedUpAt ?? new Date().toISOString(),
    };

    await this._appendEvent(event);
    this._applyEvent(event);
  }

  /**
   * Gets all spawns for a parent WU.
   *
   * @param {string} parentWuId - Parent WU ID
   * @returns {SpawnEvent[]} Array of spawn events
   *
   * @example
   * const spawns = store.getByParent('WU-1000');
   */
  getByParent(parentWuId: string): SpawnEvent[] {
    const spawnIds = this.byParent.get(parentWuId) ?? [];
    return spawnIds
      .map((id) => this.spawns.get(id))
      .filter((event): event is SpawnEvent => event !== undefined);
  }

  /**
   * Gets spawn for a target WU.
   *
   * @param {string} targetWuId - Target WU ID
   * @returns {SpawnEvent | null} Spawn event or null
   *
   * @example
   * const spawn = store.getByTarget('WU-1001');
   */
  getByTarget(targetWuId: string): SpawnEvent | null {
    const spawnId = this.byTarget.get(targetWuId);
    if (!spawnId) {
      return null;
    }
    return this.spawns.get(spawnId) ?? null;
  }

  /**
   * Gets all pending spawns.
   *
   * @returns {SpawnEvent[]} Array of pending spawn events
   *
   * @example
   * const pending = store.getPending();
   */
  getPending(): SpawnEvent[] {
    return Array.from(this.spawns.values()).filter((spawn) => spawn.status === SpawnStatus.PENDING);
  }

  /**
   * Gets all spawns as an array.
   *
   * @returns {SpawnEvent[]} Array of all spawn events
   *
   * @example
   * const allSpawns = store.getAllSpawns();
   */
  getAllSpawns(): SpawnEvent[] {
    return Array.from(this.spawns.values());
  }

  /**
   * Gets spawn by ID.
   *
   * @param {string} spawnId - Spawn ID
   * @returns {SpawnEvent | null} Spawn event or null
   *
   * @example
   * const spawn = store.getById('spawn-a1b2');
   */
  getById(spawnId: string): SpawnEvent | null {
    return this.spawns.get(spawnId) ?? null;
  }
}

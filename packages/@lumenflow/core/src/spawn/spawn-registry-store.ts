/**
 * Spawn Registry Store (WU-2539)
 *
 * Event-sourced state store for tracking sub-agent spawns.
 * Stores events in JSONL format (append-only, git-friendly).
 *
 * @module @lumenflow/core/spawn
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { validateSpawnEvent, generateSpawnId, SpawnStatus } from './spawn-registry-schema.js';
import type { SpawnEvent } from './spawn-registry-schema.js';

export const SPAWN_REGISTRY_FILE_NAME = 'spawn-registry.jsonl';

/**
 * Spawn Registry Store class.
 */
export class SpawnRegistryStore {
  private readonly baseDir: string;
  private readonly registryFilePath: string;

  public readonly spawns: Map<string, SpawnEvent> = new Map();
  public readonly byParent: Map<string, string[]> = new Map();
  public readonly byTarget: Map<string, string> = new Map();

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.registryFilePath = path.join(baseDir, SPAWN_REGISTRY_FILE_NAME);
  }

  async load(): Promise<void> {
    this.spawns.clear();
    this.byParent.clear();
    this.byTarget.clear();

    let content: string;
    try {
      content = await fs.readFile(this.registryFilePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim();

      if (!line) {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        throw new Error(`Malformed JSON on line ${i + 1}: ${(error as Error).message}`);
      }

      const validation = validateSpawnEvent(parsed);
      if (!validation.success) {
        const issues = validation.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', ');
        throw new Error(`Validation error on line ${i + 1}: ${issues}`);
      }

      this.applyEvent(validation.data);
    }
  }

  private applyEvent(event: SpawnEvent): void {
    const { id, parentWuId, targetWuId } = event;

    this.spawns.set(id, event);

    if (!this.byParent.has(parentWuId)) {
      this.byParent.set(parentWuId, []);
    }
    const parentSpawns = this.byParent.get(parentWuId) ?? [];
    if (!parentSpawns.includes(id)) {
      parentSpawns.push(id);
    }

    this.byTarget.set(targetWuId, id);
  }

  private async appendEvent(event: SpawnEvent): Promise<void> {
    const validation = validateSpawnEvent(event);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw new Error(`Validation error: ${issues}`);
    }

    const line = JSON.stringify(event) + '\n';

    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.appendFile(this.registryFilePath, line, 'utf-8');
  }

  async record(parentWuId: string, targetWuId: string, lane: string): Promise<string> {
    const id = generateSpawnId(parentWuId, targetWuId);

    const event: SpawnEvent = {
      id,
      parentWuId,
      targetWuId,
      lane,
      spawnedAt: new Date().toISOString(),
      status: SpawnStatus.PENDING,
      completedAt: null,
    };

    await this.appendEvent(event);
    this.applyEvent(event);

    return id;
  }

  async updateStatus(
    spawnId: string,
    status: (typeof SpawnStatus)[keyof typeof SpawnStatus],
  ): Promise<void> {
    const existing = this.spawns.get(spawnId);
    if (!existing) {
      throw new Error(`Spawn ID ${spawnId} not found`);
    }

    const event: SpawnEvent = {
      ...existing,
      status,
      completedAt: new Date().toISOString(),
    };

    await this.appendEvent(event);
    this.applyEvent(event);
  }

  getByParent(parentWuId: string): SpawnEvent[] {
    const spawnIds = this.byParent.get(parentWuId) ?? [];
    return spawnIds
      .map((id) => this.spawns.get(id))
      .filter((s): s is SpawnEvent => s !== undefined);
  }

  getByTarget(targetWuId: string): SpawnEvent | null {
    const spawnId = this.byTarget.get(targetWuId);
    if (!spawnId) {
      return null;
    }
    return this.spawns.get(spawnId) ?? null;
  }

  getPending(): SpawnEvent[] {
    return Array.from(this.spawns.values()).filter((spawn) => spawn.status === SpawnStatus.PENDING);
  }
}

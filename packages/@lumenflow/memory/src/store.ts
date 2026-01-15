/**
 * Memory Store (WU-2541)
 *
 * File-based store for memory nodes.
 *
 * @module @lumenflow/memory/store
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { type MemoryNode, type Relationship, validateMemoryNode, validateRelationship } from './schema.js';

export interface MemoryStoreConfig {
  basePath: string;
}

export class MemoryStore {
  private readonly basePath: string;

  constructor(config: MemoryStoreConfig) {
    this.basePath = config.basePath;
  }

  private nodesDir(): string {
    return join(this.basePath, 'nodes');
  }

  private relationsFile(): string {
    return join(this.basePath, 'relations.yaml');
  }

  ensureDir(): void {
    const dir = this.nodesDir();
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  saveNode(node: MemoryNode): void {
    const result = validateMemoryNode(node);
    if (!result.success) {
      throw new Error('Invalid memory node: ' + JSON.stringify(result.error.issues));
    }
    this.ensureDir();
    const filePath = join(this.nodesDir(), node.id + '.yaml');
    writeFileSync(filePath, stringifyYaml(node));
  }

  loadNode(id: string): MemoryNode | null {
    const filePath = join(this.nodesDir(), id + '.yaml');
    if (!existsSync(filePath)) {
      return null;
    }
    const content = readFileSync(filePath, 'utf-8');
    const data = parseYaml(content);
    const result = validateMemoryNode(data);
    if (!result.success) {
      throw new Error('Invalid memory node in store: ' + JSON.stringify(result.error.issues));
    }
    return result.data;
  }

  listNodes(): MemoryNode[] {
    const dir = this.nodesDir();
    if (!existsSync(dir)) {
      return [];
    }
    const files = require('node:fs').readdirSync(dir) as string[];
    return files
      .filter((f: string) => f.endsWith('.yaml'))
      .map((f: string) => this.loadNode(f.replace('.yaml', '')))
      .filter((n): n is MemoryNode => n !== null);
  }

  saveRelationship(rel: Relationship): void {
    const result = validateRelationship(rel);
    if (!result.success) {
      throw new Error('Invalid relationship: ' + JSON.stringify(result.error.issues));
    }
    this.ensureDir();
    const relations = this.loadRelationships();
    relations.push(result.data);
    writeFileSync(this.relationsFile(), stringifyYaml(relations));
  }

  loadRelationships(): Relationship[] {
    const filePath = this.relationsFile();
    if (!existsSync(filePath)) {
      return [];
    }
    const content = readFileSync(filePath, 'utf-8');
    const data = parseYaml(content);
    if (!Array.isArray(data)) {
      return [];
    }
    return data
      .map((item) => validateRelationship(item))
      .filter((r) => r.success)
      .map((r) => r.data as Relationship);
  }
}

export function createMemoryStore(basePath: string): MemoryStore {
  return new MemoryStore({ basePath });
}

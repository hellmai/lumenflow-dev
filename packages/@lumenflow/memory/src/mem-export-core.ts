// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Memory Export Core (WU-1137)
 *
 * Render memory.jsonl as markdown or JSON with basic filters.
 * Designed for human-readable inspection without changing storage format.
 */

import path from 'node:path';
import { loadMemory } from './memory-store.js';
import type { MemoryNode } from './memory-schema.js';
import { LUMENFLOW_MEMORY_PATHS } from './paths.js';

/** Supported output formats for export */
export type ExportFormat = 'markdown' | 'json';

/** Export filters */
export interface ExportOptions {
  /** WU ID filter (e.g., WU-1234) */
  wuId?: string;
  /** Node type filter (e.g., discovery, checkpoint) */
  type?: string;
  /** Lifecycle filter (ephemeral, session, wu, project) */
  lifecycle?: string;
  /** Output format (markdown or json) */
  format?: ExportFormat;
}

/** Export result */
export interface ExportResult {
  format: ExportFormat;
  nodes: MemoryNode[];
  output: string;
}

function applyFilters(nodes: MemoryNode[], options: ExportOptions): MemoryNode[] {
  const { wuId, type, lifecycle } = options;
  return nodes.filter((node) => {
    if (wuId && node.wu_id !== wuId) return false;
    if (type && node.type !== type) return false;
    if (lifecycle && node.lifecycle !== lifecycle) return false;
    return true;
  });
}

function formatFilters(options: ExportOptions): string {
  const parts: string[] = [];
  if (options.wuId) parts.push(`wu=${options.wuId}`);
  if (options.type) parts.push(`type=${options.type}`);
  if (options.lifecycle) parts.push(`lifecycle=${options.lifecycle}`);
  return parts.length === 0 ? 'none' : parts.join(', ');
}

function formatMarkdown(nodes: MemoryNode[], options: ExportOptions): string {
  const lines: string[] = [];
  lines.push('# Memory Export');
  lines.push(`Filters: ${formatFilters(options)}`);
  lines.push(`Total: ${nodes.length}`);
  lines.push('');

  if (nodes.length === 0) {
    lines.push('No matching nodes.');
    return lines.join('\n');
  }

  for (const node of nodes) {
    lines.push(`## ${node.id} (${node.type})`);
    lines.push(`- Created: ${node.created_at}`);
    lines.push(`- Lifecycle: ${node.lifecycle}`);
    if (node.wu_id) {
      lines.push(`- WU: ${node.wu_id}`);
    }
    lines.push(`- Content: ${node.content}`);

    if (node.tags && node.tags.length > 0) {
      lines.push(`- Tags: ${node.tags.join(', ')}`);
    }

    if (node.metadata && Object.keys(node.metadata).length > 0) {
      lines.push(`- Metadata: ${JSON.stringify(node.metadata)}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

function formatJson(nodes: MemoryNode[], options: ExportOptions): string {
  const payload = {
    count: nodes.length,
    filters: {
      wuId: options.wuId ?? null,
      type: options.type ?? null,
      lifecycle: options.lifecycle ?? null,
    },
    nodes,
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Export memory nodes in the requested format.
 *
 * @param baseDir - Project base directory
 * @param options - Export options
 */
export async function exportMemory(
  baseDir: string,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const memoryDir = path.join(baseDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR);
  const memory = await loadMemory(memoryDir);
  const nodes = applyFilters(memory.nodes, options);
  const format: ExportFormat = options.format ?? 'markdown';
  const output = format === 'json' ? formatJson(nodes, options) : formatMarkdown(nodes, options);

  return {
    format,
    nodes,
    output,
  };
}

// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Feedback Review Core Logic (WU-1598)
 *
 * Aggregates .lumenflow/incidents/*.ndjson and .lumenflow/memory/memory.jsonl,
 * clusters by title similarity, scores patterns (frequency x severity x recency),
 * and outputs prioritised patterns for human review.
 *
 * @see {@link packages/@lumenflow/cli/src/__tests__/feedback-review.test.ts} - Tests
 * @see {@link packages/@lumenflow/cli/src/feedback-review.ts} - CLI entry point
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { INCIDENT_SEVERITY, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import {
  MS_PER_MINUTE,
  MS_PER_HOUR,
  MS_PER_DAY,
} from '@lumenflow/core/constants/duration-constants';

/**
 * Severity weights for scoring
 *
 * Higher severity = higher weight in scoring formula
 */
export const SEVERITY_WEIGHTS = {
  [INCIDENT_SEVERITY.BLOCKER]: 4,
  [INCIDENT_SEVERITY.MAJOR]: 3,
  [INCIDENT_SEVERITY.MINOR]: 2,
  [INCIDENT_SEVERITY.INFO]: 1,
};

/**
 * Default similarity threshold for title clustering
 *
 * Titles with similarity >= this threshold are grouped together.
 * Range: 0-1 where 1 = exact match
 */
const SIMILARITY_THRESHOLD = 0.7;

/**
 * Recency decay factor (in milliseconds)
 *
 * Patterns older than this are weighted less.
 * Default: 30 days
 */
const RECENCY_DECAY_MS = 30 * MS_PER_DAY;

/**
 * Duration multipliers
 */
const DURATION_MULTIPLIERS: Record<string, number> = {
  m: MS_PER_MINUTE, // minutes
  h: MS_PER_HOUR, // hours
  d: MS_PER_DAY, // days
  w: 7 * MS_PER_DAY, // weeks
};

/**
 * Parse duration string to milliseconds
 *
 * Supports: 1d (day), 1w (week), 1h (hour), 1m (minute)
 *
 * @param duration - Duration string like "7d", "1w"
 * @returns Milliseconds
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([dwhmDWHM])$/);
  if (!match) {
    throw createError(
      ErrorCodes.INVALID_DURATION,
      `Invalid duration format: ${duration}. Use format like "7d", "1w", "24h"`,
    );
  }

  const value = Number.parseInt(match[1] as string, 10);
  const unit = (match[2] as string).toLowerCase();

  // eslint-disable-next-line security/detect-object-injection -- unit is validated by regex
  return value * (DURATION_MULTIPLIERS[unit] as number);
}

/**
 * Generic record type for NDJSON parsing
 */
type NdjsonRecord = Record<string, unknown>;

/**
 * Load NDJSON file and parse lines
 *
 * @param filePath - Path to NDJSON file
 * @returns Parsed objects
 */
async function loadNdjson(filePath: string): Promise<NdjsonRecord[]> {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool reads known paths
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines
      .map((line) => {
        try {
          return JSON.parse(line) as NdjsonRecord;
        } catch {
          // Skip malformed lines
          return null;
        }
      })
      .filter((item): item is NdjsonRecord => item !== null);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * Load all incidents from .lumenflow/incidents/*.ndjson
 *
 * @param baseDir - Base directory
 * @returns All incident objects
 */
async function loadIncidents(baseDir: string): Promise<NdjsonRecord[]> {
  const incidentsDir = path.join(baseDir, LUMENFLOW_PATHS.INCIDENTS);
  let files: string[];

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool reads known paths
    files = await fs.readdir(incidentsDir);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const ndjsonFiles = files.filter((f) => f.endsWith('.ndjson'));
  const incidents: NdjsonRecord[] = [];

  for (const file of ndjsonFiles) {
    const items = await loadNdjson(path.join(incidentsDir, file));
    incidents.push(...items);
  }

  return incidents;
}

/**
 * Load memory nodes from .lumenflow/memory/memory.jsonl
 *
 * @param baseDir - Base directory
 * @returns Memory node objects
 */
async function loadMemoryNodes(baseDir: string): Promise<NdjsonRecord[]> {
  const memoryFile = path.join(baseDir, LUMENFLOW_PATHS.MEMORY_JSONL);
  return loadNdjson(memoryFile);
}

/**
 * Calculate simple Jaccard similarity between two strings
 *
 * Uses word-level comparison for better semantic matching.
 *
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Similarity score 0-1
 */
function calculateSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;

  // Normalize and tokenize
  const normalize = (s: string): string[] =>
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

  const words1 = new Set(normalize(str1));
  const words2 = new Set(normalize(str2));

  if (words1.size === 0 || words2.size === 0) return 0;

  // Jaccard similarity: intersection / union
  const intersection = new Set([...words1].filter((w) => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

/**
 * Node with ID and optional title/content
 */
interface NodeWithTitle {
  id: string;
  title?: string;
  content?: string;
  category?: string;
  severity?: string;
  created_at?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  type?: string;
  tags?: string[];
}

/**
 * Cluster of nodes grouped by title similarity
 */
interface Cluster {
  title: string;
  nodes: NodeWithTitle[];
  category: string;
}

/**
 * Get display title for a node
 *
 * Falls back to content if title not present.
 *
 * @param node - Node object
 * @returns Title or content
 */
function getNodeTitle(node: NodeWithTitle): string {
  return node.title ?? node.content ?? '';
}

/**
 * Cluster nodes by title similarity
 *
 * Uses simple greedy clustering with Jaccard similarity.
 *
 * @param nodes - Nodes to cluster
 * @param threshold - Similarity threshold
 * @returns Array of cluster objects
 */
export function clusterByTitle(
  nodes: NodeWithTitle[],
  threshold: number = SIMILARITY_THRESHOLD,
): Cluster[] {
  if (!nodes || nodes.length === 0) {
    return [];
  }

  const clusters: Cluster[] = [];
  const assigned = new Set<string>();

  for (const node of nodes) {
    if (assigned.has(node.id)) continue;

    const title = getNodeTitle(node);
    if (!title) {
      // Skip nodes without title/content
      assigned.add(node.id);
      continue;
    }

    // Find or create cluster
    let bestCluster: Cluster | null = null;
    let bestSimilarity = 0;

    for (const cluster of clusters) {
      const similarity = calculateSimilarity(title, cluster.title);
      if (similarity >= threshold && similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestCluster = cluster;
      }
    }

    if (bestCluster) {
      bestCluster.nodes.push(node);
    } else {
      clusters.push({
        title,
        nodes: [node],
        category: node.category ?? 'uncategorized',
      });
    }

    assigned.add(node.id);
  }

  return clusters;
}

/**
 * Score a pattern cluster
 *
 * Formula: frequency x average_severity x recency_factor
 *
 * @param cluster - Cluster with nodes
 * @returns Score value
 */
export function scorePattern(cluster: Cluster): number {
  if (!cluster.nodes || cluster.nodes.length === 0) {
    return 0;
  }

  const frequency = cluster.nodes.length;

  // Average severity weight
  const severitySum = cluster.nodes.reduce((sum, node) => {
    const severity = node.severity as keyof typeof SEVERITY_WEIGHTS | undefined;
    const defaultWeight = SEVERITY_WEIGHTS[INCIDENT_SEVERITY.INFO] ?? 0;
    const weight = severity ? (SEVERITY_WEIGHTS[severity] ?? defaultWeight) : defaultWeight;
    return sum + weight;
  }, 0);
  const avgSeverity = severitySum / cluster.nodes.length;

  // Recency factor: most recent occurrence weighted higher
  const now = Date.now();
  const timestamps = cluster.nodes
    .map((n) => (n.created_at ? new Date(n.created_at).getTime() : 0))
    .filter((t) => t > 0);

  let recencyFactor = 1;
  if (timestamps.length > 0) {
    const mostRecent = Math.max(...timestamps);
    const age = now - mostRecent;
    // Exponential decay: recent = ~1, old (30+ days) = ~0.37
    recencyFactor = Math.exp(-age / RECENCY_DECAY_MS);
    // Clamp to minimum 0.1 so old patterns still count
    recencyFactor = Math.max(0.1, recencyFactor);
  }

  return frequency * avgSeverity * recencyFactor;
}

/**
 * Options for reviewing feedback
 */
interface ReviewOptions {
  since?: string;
  minFrequency?: number;
  category?: string;
  json?: boolean;
}

/**
 * Pattern example for output
 */
interface PatternExample {
  id: string;
  severity: string | undefined;
  source: string | undefined;
}

/**
 * Pattern in review result
 */
interface ReviewPattern {
  title: string;
  frequency: number;
  category: string;
  score: number;
  firstSeen: string | undefined;
  lastSeen: string | undefined;
  examples: PatternExample[];
}

/**
 * Review result
 */
interface ReviewResult {
  success: boolean;
  patterns: ReviewPattern[];
  summary: {
    totalNodes: number;
    totalClusters: number;
    topCategory: string | null;
  };
}

/**
 * Review feedback from incidents and memory nodes
 *
 * Main entry point for feedback review logic.
 *
 * @param baseDir - Base directory containing .lumenflow
 * @param options - Review options
 * @returns Review result
 */
export async function reviewFeedback(
  baseDir: string,
  options: ReviewOptions = {},
): Promise<ReviewResult> {
  const { since, minFrequency, category } = options;

  // Load all data
  const [incidents, memoryNodes] = await Promise.all([
    loadIncidents(baseDir),
    loadMemoryNodes(baseDir),
  ]);

  // Merge into unified nodes format
  let nodes: NodeWithTitle[] = [
    ...incidents.map((inc) => ({
      id: String(inc.id ?? ''),
      source: 'incident',
      title: String(inc.title ?? inc.content ?? ''),
      content: String(inc.content ?? ''),
      category: String(inc.category ?? 'uncategorized'),
      severity: String(inc.severity ?? 'info'),
      created_at: inc.created_at ? String(inc.created_at) : undefined,
    })),
    ...memoryNodes.map((mem) => {
      const metadata = mem.metadata as Record<string, unknown> | undefined;
      const tags = mem.tags as string[] | undefined;
      return {
        id: String(mem.id ?? ''),
        source: 'memory',
        title: String(mem.content ?? ''), // Memory nodes use content as title
        content: String(mem.content ?? ''),
        severity: String(metadata?.severity ?? 'info'),
        category: String(mem.type ?? tags?.[0] ?? 'uncategorized'),
        created_at: mem.created_at ? String(mem.created_at) : undefined,
      };
    }),
  ];

  // Filter by since
  if (since) {
    const cutoffMs = Date.now() - parseDuration(since);
    nodes = nodes.filter((n) => {
      const timestamp = n.created_at ? new Date(n.created_at).getTime() : 0;
      return timestamp >= cutoffMs;
    });
  }

  // Filter by category
  if (category) {
    nodes = nodes.filter((n) => n.category === category);
  }

  const totalNodes = nodes.length;

  // Cluster by title similarity
  let clusters = clusterByTitle(nodes);

  // Filter by minimum frequency
  if (minFrequency && minFrequency > 0) {
    clusters = clusters.filter((c) => c.nodes.length >= minFrequency);
  }

  // Score and sort patterns
  const patterns: ReviewPattern[] = clusters
    .map((cluster) => ({
      title: cluster.title,
      frequency: cluster.nodes.length,
      category: cluster.category,
      score: scorePattern(cluster),
      firstSeen: cluster.nodes
        .map((n) => n.created_at)
        .filter((c): c is string => c !== undefined)
        .sort()[0],
      lastSeen: cluster.nodes
        .map((n) => n.created_at)
        .filter((c): c is string => c !== undefined)
        .sort()
        .slice(-1)[0],
      examples: cluster.nodes.slice(0, 3).map((n) => ({
        id: n.id,
        severity: n.severity,
        source: n.source,
      })),
    }))
    .sort((a, b) => b.score - a.score);

  // Calculate summary
  const categoryCounts = new Map<string, number>();
  for (const p of patterns) {
    const cat = p.category ?? 'uncategorized';
    categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + p.frequency);
  }
  const topCategory = [...categoryCounts.entries()].sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;

  return {
    success: true,
    patterns,
    summary: {
      totalNodes,
      totalClusters: patterns.length,
      topCategory,
    },
  };
}

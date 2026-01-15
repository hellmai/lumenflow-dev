/**
 * Feedback Review Core Logic (WU-1598)
 *
 * Aggregates .beacon/incidents/*.ndjson and .beacon/memory/memory.jsonl,
 * clusters by title similarity, scores patterns (frequency x severity x recency),
 * and outputs prioritised patterns for human review.
 *
 * @see {@link tools/__tests__/feedback-review.test.mjs} - Tests
 * @see {@link tools/feedback-review.mjs} - CLI entry point
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { INCIDENT_SEVERITY } from '@lumenflow/core/lib/wu-constants.js';

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
const RECENCY_DECAY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Parse duration string to milliseconds
 *
 * Supports: 1d (day), 1w (week), 1h (hour), 1m (minute)
 *
 * @param {string} duration - Duration string like "7d", "1w"
 * @returns {number} Milliseconds
 */
function parseDuration(duration) {
  const match = duration.match(/^(\d+)([dwhmDWHM])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Use format like "7d", "1w", "24h"`);
  }

  const value = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  const multipliers = {
    m: 60 * 1000, // minutes
    h: 60 * 60 * 1000, // hours
    d: 24 * 60 * 60 * 1000, // days
    w: 7 * 24 * 60 * 60 * 1000, // weeks
  };

  // eslint-disable-next-line security/detect-object-injection -- unit is validated by regex
  return value * multipliers[unit];
}

/**
 * Load NDJSON file and parse lines
 *
 * @param {string} filePath - Path to NDJSON file
 * @returns {Promise<object[]>} Parsed objects
 */
async function loadNdjson(filePath) {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool reads known paths
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          // Skip malformed lines
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * Load all incidents from .beacon/incidents/*.ndjson
 *
 * @param {string} baseDir - Base directory
 * @returns {Promise<object[]>} All incident objects
 */
async function loadIncidents(baseDir) {
  const incidentsDir = path.join(baseDir, '.beacon', 'incidents');
  let files;

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool reads known paths
    files = await fs.readdir(incidentsDir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const ndjsonFiles = files.filter((f) => f.endsWith('.ndjson'));
  const incidents = [];

  for (const file of ndjsonFiles) {
    const items = await loadNdjson(path.join(incidentsDir, file));
    incidents.push(...items);
  }

  return incidents;
}

/**
 * Load memory nodes from .beacon/memory/memory.jsonl
 *
 * @param {string} baseDir - Base directory
 * @returns {Promise<object[]>} Memory node objects
 */
async function loadMemoryNodes(baseDir) {
  const memoryFile = path.join(baseDir, '.beacon', 'memory', 'memory.jsonl');
  return loadNdjson(memoryFile);
}

/**
 * Calculate simple Jaccard similarity between two strings
 *
 * Uses word-level comparison for better semantic matching.
 *
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Similarity score 0-1
 */
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;

  // Normalize and tokenize
  const normalize = (s) =>
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
 * Get display title for a node
 *
 * Falls back to content if title not present.
 *
 * @param {object} node - Node object
 * @returns {string} Title or content
 */
function getNodeTitle(node) {
  return node.title || node.content || '';
}

/**
 * Cluster nodes by title similarity
 *
 * Uses simple greedy clustering with Jaccard similarity.
 *
 * @param {object[]} nodes - Nodes to cluster
 * @param {number} [threshold=SIMILARITY_THRESHOLD] - Similarity threshold
 * @returns {object[]} Array of cluster objects
 */
export function clusterByTitle(nodes, threshold = SIMILARITY_THRESHOLD) {
  if (!nodes || nodes.length === 0) {
    return [];
  }

  const clusters = [];
  const assigned = new Set();

  for (const node of nodes) {
    if (assigned.has(node.id)) continue;

    const title = getNodeTitle(node);
    if (!title) {
      // Skip nodes without title/content
      assigned.add(node.id);
      continue;
    }

    // Find or create cluster
    let bestCluster = null;
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
        category: node.category || 'uncategorized',
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
 * @param {object} cluster - Cluster with nodes
 * @returns {number} Score value
 */
export function scorePattern(cluster) {
  if (!cluster.nodes || cluster.nodes.length === 0) {
    return 0;
  }

  const frequency = cluster.nodes.length;

  // Average severity weight
  const severitySum = cluster.nodes.reduce((sum, node) => {
    const weight = SEVERITY_WEIGHTS[node.severity] || SEVERITY_WEIGHTS.info;
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
 * Review feedback from incidents and memory nodes
 *
 * Main entry point for feedback review logic.
 *
 * @param {string} baseDir - Base directory containing .beacon
 * @param {object} options - Review options
 * @param {string} [options.since] - Filter to items since duration (e.g., "7d")
 * @param {number} [options.minFrequency] - Minimum cluster frequency
 * @param {string} [options.category] - Filter by category
 * @param {boolean} [options.json] - Return JSON-compatible output
 * @returns {Promise<object>} Review result
 */
export async function reviewFeedback(baseDir, options = {}) {
  const { since, minFrequency, category } = options;

  // Load all data
  const [incidents, memoryNodes] = await Promise.all([
    loadIncidents(baseDir),
    loadMemoryNodes(baseDir),
  ]);

  // Merge into unified nodes format
  let nodes = [
    ...incidents.map((inc) => ({
      ...inc,
      source: 'incident',
      title: inc.title || inc.content,
    })),
    ...memoryNodes.map((mem) => ({
      ...mem,
      source: 'memory',
      title: mem.content, // Memory nodes use content as title
      severity: mem.metadata?.severity || 'info',
      category: mem.type || mem.tags?.[0] || 'uncategorized',
    })),
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
  const patterns = clusters
    .map((cluster) => ({
      title: cluster.title,
      frequency: cluster.nodes.length,
      category: cluster.category,
      score: scorePattern(cluster),
      firstSeen: cluster.nodes
        .map((n) => n.created_at)
        .filter(Boolean)
        .sort()[0],
      lastSeen: cluster.nodes
        .map((n) => n.created_at)
        .filter(Boolean)
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
  const categoryCounts = new Map();
  for (const p of patterns) {
    const cat = p.category || 'uncategorized';
    categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + p.frequency);
  }
  const topCategory =
    [...categoryCounts.entries()].sort(([, a], [, b]) => b - a)[0]?.[0] || null;

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

/**
 * Memory Index Core (WU-1235)
 *
 * Scans predictable project sources and produces project-lifecycle summary nodes.
 * Creates memory nodes tagged with index:architecture, index:conventions,
 * index:commands, index:invariants for agent context awareness.
 *
 * Features:
 * - Scans README.md, LUMENFLOW.md, package.json, .lumenflow.config.yaml
 * - Creates summary nodes with lifecycle=project
 * - Includes provenance metadata (source_path, source_hash, indexed_at)
 * - Idempotent: re-running updates/skips existing nodes
 *
 * @see {@link packages/@lumenflow/cli/src/mem-index.ts} - CLI wrapper
 * @see {@link packages/@lumenflow/memory/__tests__/mem-index-core.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { generateMemId } from './mem-id.js';
import { loadMemory, appendNode } from './memory-store.js';
import type { MemoryNode } from './memory-schema.js';
import { LUMENFLOW_MEMORY_PATHS } from './paths.js';

/**
 * Source definition for indexing
 */
interface SourceDefinition {
  /** File path relative to project root */
  path: string;
  /** Tags to apply to nodes created from this source */
  tags: string[];
  /** Description of what this source contains */
  description: string;
}

/**
 * Default sources to scan for project conventions
 */
const DEFAULT_SOURCES: SourceDefinition[] = [
  {
    path: 'README.md',
    tags: ['index:architecture'],
    description: 'Project overview and structure',
  },
  {
    path: 'LUMENFLOW.md',
    tags: ['index:conventions'],
    description: 'Workflow conventions and guidelines',
  },
  {
    path: 'package.json',
    tags: ['index:architecture'],
    description: 'Monorepo structure and dependencies',
  },
  {
    path: '.lumenflow.config.yaml',
    tags: ['index:commands', 'index:conventions'],
    description: 'Workflow configuration and lane definitions',
  },
  {
    path: '.lumenflow/constraints.md',
    tags: ['index:invariants'],
    description: 'Non-negotiable project constraints',
  },
];

/**
 * Options for indexing a project
 */
export interface IndexOptions {
  /** Run in dry-run mode (no writes) */
  dryRun?: boolean;
  /** Additional sources to scan */
  additionalSources?: SourceDefinition[];
}

/**
 * Result of indexing a project
 */
export interface IndexResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Number of nodes created */
  nodesCreated: number;
  /** Number of nodes updated */
  nodesUpdated: number;
  /** Number of sources skipped (unchanged) */
  nodesSkipped: number;
  /** List of sources that were scanned */
  sourcesScanned: string[];
  /** List of sources that were not found */
  sourcesMissing: string[];
  /** Any error message */
  error?: string;
}

/** Maximum summary length in characters */
const MAX_SUMMARY_LENGTH = 2000;

/**
 * Computes SHA-256 hash of content
 *
 * @param content - Content to hash
 * @returns Hex-encoded hash
 */
function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Extracts summary from package.json content
 *
 * @param content - Raw JSON content
 * @returns Summarized package info or null if parse fails
 */
function extractPackageJsonSummary(content: string): string | null {
  try {
    const pkg = JSON.parse(content);
    const summary: string[] = [];

    if (pkg.name) {
      summary.push(`Project: ${pkg.name}`);
    }
    if (pkg.description) {
      summary.push(`Description: ${pkg.description}`);
    }
    if (pkg.workspaces) {
      const workspaces = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : pkg.workspaces.packages || [];
      summary.push(`Workspaces: ${workspaces.join(', ')}`);
    }
    if (pkg.scripts) {
      const scripts = Object.keys(pkg.scripts).slice(0, 10);
      summary.push(`Key scripts: ${scripts.join(', ')}`);
    }

    return summary.join('\n');
  } catch {
    return null;
  }
}

/**
 * Extracts summary from Markdown content
 *
 * @param content - Raw Markdown content
 * @returns Summarized content with headings and paragraphs
 */
function extractMarkdownSummary(content: string): string {
  const lines = content.split('\n');
  const summary: string[] = [];
  let currentLength = 0;

  for (const line of lines) {
    if (currentLength + line.length > MAX_SUMMARY_LENGTH) {
      break;
    }

    // Include headings
    if (line.startsWith('#')) {
      summary.push(line);
      currentLength += line.length + 1;
      continue;
    }

    // Include non-empty lines until we hit length limit
    if (line.trim()) {
      summary.push(line);
      currentLength += line.length + 1;
    } else if (summary.length > 0) {
      // Preserve paragraph breaks
      summary.push('');
    }
  }

  return summary.join('\n').trim();
}

/**
 * Extracts summary content from a source file
 *
 * @param sourcePath - Path of the source file
 * @param content - Raw file content
 * @returns Summarized content for memory node
 */
function extractSummary(sourcePath: string, content: string): string {
  // For package.json, extract key fields
  if (sourcePath === 'package.json') {
    const pkgSummary = extractPackageJsonSummary(content);
    if (pkgSummary) {
      return pkgSummary;
    }
  }

  // For YAML files, preserve structure
  if (sourcePath.endsWith('.yaml') || sourcePath.endsWith('.yml')) {
    return content.slice(0, MAX_SUMMARY_LENGTH);
  }

  // For Markdown files, extract headings and first paragraphs
  if (sourcePath.endsWith('.md')) {
    return extractMarkdownSummary(content);
  }

  // Default: truncate
  return content.slice(0, MAX_SUMMARY_LENGTH);
}

/**
 * Finds existing index nodes for a source
 *
 * @param nodes - All memory nodes
 * @param sourcePath - Source path to find
 * @returns Existing node or undefined
 */
function findExistingNode(nodes: MemoryNode[], sourcePath: string): MemoryNode | undefined {
  return nodes.find((n) => {
    const metadata = n.metadata as { source_path?: string } | undefined;
    return metadata?.source_path === sourcePath;
  });
}

/**
 * Context for processing a single source
 */
interface ProcessSourceContext {
  memoryDir: string;
  indexedAt: string;
  dryRun: boolean;
  existingNodes: MemoryNode[];
}

/**
 * Result of processing a single source
 */
type ProcessSourceResult = 'created' | 'updated' | 'skipped';

/**
 * Creates a memory node for a source
 *
 * @param source - Source definition
 * @param content - File content
 * @param contentHash - Content hash
 * @param indexedAt - Timestamp
 * @param existingNodeId - ID of existing node being replaced (if update)
 * @returns Memory node
 */
function createSourceNode(
  source: SourceDefinition,
  content: string,
  contentHash: string,
  indexedAt: string,
  existingNodeId?: string,
): MemoryNode {
  const node: MemoryNode = {
    id: generateMemId(`${source.path}-${indexedAt}`),
    type: 'summary',
    lifecycle: 'project',
    content: extractSummary(source.path, content),
    created_at: indexedAt,
    tags: source.tags,
    metadata: {
      source_path: source.path,
      source_hash: contentHash,
      indexed_at: indexedAt,
      description: source.description,
    },
  };

  if (existingNodeId) {
    node.updated_at = indexedAt;
    (node.metadata as Record<string, unknown>).replaces = existingNodeId;
  }

  return node;
}

/**
 * Processes a single source file and creates/updates memory node
 *
 * @param source - Source definition
 * @param content - File content
 * @param ctx - Processing context
 * @returns Result indicating what action was taken
 */
async function processSource(
  source: SourceDefinition,
  content: string,
  ctx: ProcessSourceContext,
): Promise<ProcessSourceResult> {
  const contentHash = computeHash(content);
  const existingNode = findExistingNode(ctx.existingNodes, source.path);

  // Check if content unchanged
  if (existingNode) {
    const existingHash = (existingNode.metadata as { source_hash?: string })?.source_hash;
    if (existingHash === contentHash) {
      return 'skipped';
    }
  }

  // Write node (unless dry-run)
  if (!ctx.dryRun) {
    const node = createSourceNode(source, content, contentHash, ctx.indexedAt, existingNode?.id);
    await appendNode(ctx.memoryDir, node);
  }

  return existingNode ? 'updated' : 'created';
}

/**
 * Loads existing memory nodes from memory directory
 *
 * @param memoryDir - Memory directory path
 * @returns Array of existing memory nodes
 */
async function loadExistingNodes(memoryDir: string): Promise<MemoryNode[]> {
  try {
    const memory = await loadMemory(memoryDir);
    return memory.nodes;
  } catch {
    return [];
  }
}

/**
 * Indexes project sources and creates/updates memory nodes
 *
 * @param baseDir - Project base directory
 * @param options - Indexing options
 * @returns Index result
 *
 * @example
 * const result = await indexProject('/path/to/project');
 * console.log(`Created: ${result.nodesCreated}, Updated: ${result.nodesUpdated}`);
 *
 * @example
 * // Dry-run mode
 * const result = await indexProject('/path/to/project', { dryRun: true });
 * console.log('Would create:', result.nodesCreated);
 */
export async function indexProject(
  baseDir: string,
  options: IndexOptions = {},
): Promise<IndexResult> {
  const { dryRun = false, additionalSources = [] } = options;

  const result: IndexResult = {
    success: true,
    nodesCreated: 0,
    nodesUpdated: 0,
    nodesSkipped: 0,
    sourcesScanned: [],
    sourcesMissing: [],
  };

  const sources = [...DEFAULT_SOURCES, ...additionalSources];
  const memoryDir = path.join(baseDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR);
  const indexedAt = new Date().toISOString();

  // Ensure memory directory exists (unless dry-run)
  if (!dryRun) {
    await fs.mkdir(memoryDir, { recursive: true });
  }

  const existingNodes = await loadExistingNodes(memoryDir);
  const ctx: ProcessSourceContext = { memoryDir, indexedAt, dryRun, existingNodes };

  // Process each source
  for (const source of sources) {
    const sourcePath = path.join(baseDir, source.path);

    // Try to read file content
    let content: string;
    try {
      content = await fs.readFile(sourcePath, 'utf-8');
    } catch {
      result.sourcesMissing.push(source.path);
      continue;
    }

    result.sourcesScanned.push(source.path);

    // Process the source
    const action = await processSource(source, content, ctx);
    if (action === 'created') {
      result.nodesCreated++;
    } else if (action === 'updated') {
      result.nodesUpdated++;
    } else {
      result.nodesSkipped++;
    }
  }

  return result;
}

/**
 * Gets the default sources that will be scanned
 *
 * @returns Array of source definitions
 */
export function getDefaultSources(): SourceDefinition[] {
  return [...DEFAULT_SOURCES];
}

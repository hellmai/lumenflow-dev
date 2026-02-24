// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Feedback Promote Core Logic (WU-1599)
 *
 * Generates draft WU specs from feedback patterns and promotes them to actual WUs.
 * Tracks incident-to-WU mappings in feedback-index.ndjson.
 *
 * @see {@link packages/@lumenflow/cli/src/__tests__/feedback-promote.test.ts} - Tests
 * @see {@link packages/@lumenflow/cli/src/feedback-promote.ts} - CLI entry point
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { stringifyYAML, parseYAML } from '@lumenflow/core/wu-yaml';
import { LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';

/**
 * Directory for draft WU specs
 * @deprecated Use LUMENFLOW_PATHS.FEEDBACK_DRAFTS instead
 */
export const DRAFT_DIRECTORY = LUMENFLOW_PATHS.FEEDBACK_DRAFTS;

/**
 * Path to feedback index (incident-to-WU mappings)
 * @deprecated Use LUMENFLOW_PATHS.FEEDBACK_INDEX instead
 */
export const FEEDBACK_INDEX_PATH = LUMENFLOW_PATHS.FEEDBACK_INDEX;

/**
 * Feedback index entry status
 */
export const FEEDBACK_STATUS = {
  PENDING_RESOLUTION: 'pending_resolution',
  RESOLVED: 'resolved',
  WONT_FIX: 'wont_fix',
};

/**
 * Lane constants for DRY compliance
 */
const LANES = {
  OPERATIONS_TOOLING: 'Operations: Tooling',
  OPERATIONS_DOCUMENTATION: 'Operations: Documentation',
  OPERATIONS_SECURITY: 'Operations: Security',
  OPERATIONS_COMPLIANCE: 'Operations: Compliance',
  OPERATIONS: 'Operations',
  CORE_SYSTEMS: 'Core Systems',
  EXPERIENCE: 'Experience',
  INTELLIGENCE: 'Intelligence',
};

/**
 * Lane inference mapping from category to suggested lane
 */
const CATEGORY_TO_LANE: Record<string, string> = {
  test: LANES.OPERATIONS_TOOLING,
  tooling: LANES.OPERATIONS_TOOLING,
  docs: LANES.OPERATIONS_DOCUMENTATION,
  documentation: LANES.OPERATIONS_DOCUMENTATION,
  infrastructure: LANES.CORE_SYSTEMS,
  database: LANES.CORE_SYSTEMS,
  api: LANES.CORE_SYSTEMS,
  ui: LANES.EXPERIENCE,
  frontend: LANES.EXPERIENCE,
  ux: LANES.EXPERIENCE,
  llm: LANES.INTELLIGENCE,
  prompt: LANES.INTELLIGENCE,
  ai: LANES.INTELLIGENCE,
  security: LANES.OPERATIONS_SECURITY,
  compliance: LANES.OPERATIONS_COMPLIANCE,
  uncategorized: LANES.OPERATIONS,
};

/**
 * Pattern example structure
 */
interface PatternExample {
  id: string;
  [key: string]: unknown;
}

/**
 * Pattern structure from feedback:review
 */
interface Pattern {
  title: string;
  category?: string;
  frequency?: number;
  score?: number;
  firstSeen?: string;
  lastSeen?: string;
  examples?: PatternExample[];
}

/**
 * Draft WU spec structure
 */
interface DraftSpec {
  title: string;
  lane: string;
  description: string;
  acceptance: string[];
  source_incidents: string[];
  pattern_metadata: {
    frequency: number | undefined;
    category: string | undefined;
    score: number | undefined;
    firstSeen: string | undefined;
    lastSeen: string | undefined;
  };
  filePath?: string;
}

/**
 * Infer lane from pattern category
 *
 * @param category - Pattern category
 * @returns Suggested lane
 */
function inferLane(category: string | undefined): string {
  const normalizedCategory = (category ?? 'uncategorized').toLowerCase();
  // Safe lookup using Object.hasOwn to prevent prototype pollution
  if (Object.hasOwn(CATEGORY_TO_LANE, normalizedCategory)) {
    // eslint-disable-next-line security/detect-object-injection -- Safe: hasOwn validates key exists
    return CATEGORY_TO_LANE[normalizedCategory] as string;
  }
  return CATEGORY_TO_LANE.uncategorized as string;
}

/**
 * Generate description from pattern
 *
 * @param pattern - Pattern object
 * @returns Description with Context/Problem/Solution structure
 */
function generateDescription(pattern: Pattern): string {
  const frequency = pattern.frequency ?? 1;
  const category = pattern.category ?? 'uncategorized';
  const firstSeen = pattern.firstSeen
    ? new Date(pattern.firstSeen).toISOString().slice(0, 10)
    : 'unknown';
  const lastSeen = pattern.lastSeen
    ? new Date(pattern.lastSeen).toISOString().slice(0, 10)
    : 'unknown';

  return [
    `Context: Pattern detected from ${frequency} incident(s) in category "${category}". First seen: ${firstSeen}, last seen: ${lastSeen}.`,
    '',
    `Problem: ${pattern.title}`,
    '',
    'Solution: [To be defined by implementer]',
  ].join('\n');
}

/**
 * Generate acceptance criteria from pattern
 *
 * @param pattern - Pattern object
 * @returns Acceptance criteria
 */
function generateAcceptance(pattern: Pattern): string[] {
  return [
    'Root cause identified and documented',
    'Fix implemented',
    'Tests pass (pnpm gates)',
    `No recurrence of "${pattern.title}" pattern`,
  ];
}

/**
 * Options for generating a draft
 */
interface GenerateDraftOptions {
  writeFile?: boolean;
}

/**
 * Generate draft WU spec from a pattern
 *
 * @param baseDir - Base directory
 * @param pattern - Pattern from feedback:review
 * @param options - Options
 * @returns Draft WU spec
 */
export async function generateDraft(
  baseDir: string,
  pattern: Pattern,
  options: GenerateDraftOptions = {},
): Promise<DraftSpec> {
  const { writeFile: shouldWrite = false } = options;

  const draft: DraftSpec = {
    title: pattern.title,
    lane: inferLane(pattern.category),
    description: generateDescription(pattern),
    acceptance: generateAcceptance(pattern),
    source_incidents: (pattern.examples ?? []).map((e) => e.id),
    pattern_metadata: {
      frequency: pattern.frequency,
      category: pattern.category,
      score: pattern.score,
      firstSeen: pattern.firstSeen,
      lastSeen: pattern.lastSeen,
    },
  };

  if (shouldWrite) {
    const draftsDir = path.join(baseDir, DRAFT_DIRECTORY);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool creates known directory
    await fs.mkdir(draftsDir, { recursive: true });

    const timestamp = Date.now();
    const filename = `draft-${timestamp}.yaml`;
    const filePath = path.join(draftsDir, filename);

    const yamlContent = stringifyYAML(draft, { lineWidth: 100 });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool writes draft file
    await fs.writeFile(filePath, yamlContent, 'utf8');

    draft.filePath = path.join(DRAFT_DIRECTORY, filename);
  }

  return draft;
}

/**
 * Load all draft files from .lumenflow/feedback-drafts/
 *
 * @param baseDir - Base directory
 * @returns Array of draft objects with filePath
 */
export async function loadDrafts(baseDir: string): Promise<DraftSpec[]> {
  const draftsDir = path.join(baseDir, DRAFT_DIRECTORY);

  let files: string[];
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool reads known directory
    files = await fs.readdir(draftsDir);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const yamlFiles = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  const drafts: DraftSpec[] = [];

  for (const file of yamlFiles) {
    const filePath = path.join(draftsDir, file);
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool reads draft files
      const content = await fs.readFile(filePath, 'utf8');
      // Parse YAML or JSON content
      let draft: DraftSpec;
      try {
        // Try JSON first (for test files that might use JSON.stringify)
        draft = JSON.parse(content) as DraftSpec;
      } catch {
        // Fall back to YAML parsing
        draft = parseYAML(content) as unknown as DraftSpec;
      }
      draft.filePath = path.join(DRAFT_DIRECTORY, file);
      drafts.push(draft);
    } catch (err) {
      // Skip malformed files
      const errorMessage = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console -- CLI tool warning for malformed draft files
      console.warn(`Warning: Could not load draft ${file}: ${errorMessage}`);
    }
  }

  return drafts;
}

/**
 * Options for promoting a draft
 */
interface PromoteDraftOptions {
  dryRun?: boolean;
  wuIdOverride?: string;
  removeDraft?: boolean;
}

/**
 * Result of promoting a draft
 */
interface PromoteDraftResult {
  success: boolean;
  wuId: string;
  command: string;
  draft?: DraftSpec;
  error?: string;
  draftRemoved?: boolean;
}

/**
 * Promote a draft to a WU via wu:create
 *
 * @param baseDir - Base directory
 * @param draft - Draft object
 * @param options - Options
 * @returns Result with success, wuId, command
 */
export async function promoteDraft(
  baseDir: string,
  draft: DraftSpec,
  options: PromoteDraftOptions = {},
): Promise<PromoteDraftResult> {
  const { dryRun = false, wuIdOverride, removeDraft = false } = options;

  // Generate WU ID if not provided
  const wuId = wuIdOverride ?? `WU-${Date.now()}`;

  // Build wu:create command
  const command = buildWuCreateCommand(wuId, draft);

  const result: PromoteDraftResult = {
    success: true,
    wuId,
    command,
    draft,
  };

  if (!dryRun) {
    // Execute wu:create command
    const { execSync } = await import('node:child_process');
    try {
      execSync(command, { cwd: baseDir, stdio: 'pipe' });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        wuId,
        command,
        error: errorMessage,
      };
    }

    // Update feedback index with incident mappings
    if (draft.source_incidents && draft.source_incidents.length > 0) {
      await updateFeedbackIndex(baseDir, wuId, draft.source_incidents);
    }
  }

  // Remove draft file if requested
  if (removeDraft && draft.filePath) {
    const absolutePath = draft.filePath.startsWith('/')
      ? draft.filePath
      : path.join(baseDir, draft.filePath);

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool removes draft file
      await fs.unlink(absolutePath);
      result.draftRemoved = true;
    } catch (err) {
      // Ignore errors if file doesn't exist
      if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
        // eslint-disable-next-line no-console -- CLI tool warning for draft removal failure
        console.warn(`Warning: Could not remove draft ${draft.filePath}: ${err.message}`);
      }
      result.draftRemoved = true; // Mark as removed even if it didn't exist
    }
  }

  return result;
}

/**
 * Build wu:create command from draft
 *
 * @param wuId - WU ID
 * @param draft - Draft object
 * @returns Command string
 */
function buildWuCreateCommand(wuId: string, draft: DraftSpec): string {
  const parts = ['pnpm wu:create'];
  parts.push(`--id ${wuId}`);
  parts.push(`--lane "${draft.lane}"`);
  parts.push(`--title "${draft.title.replace(/"/g, '\\"')}"`);

  if (draft.description) {
    parts.push(`--description "${draft.description.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`);
  }

  if (draft.acceptance && draft.acceptance.length > 0) {
    for (const criterion of draft.acceptance) {
      parts.push(`--acceptance "${criterion.replace(/"/g, '\\"')}"`);
    }
  }

  return parts.join(' ');
}

/**
 * Feedback index entry
 */
interface FeedbackIndexEntry {
  incident_id: string;
  wu_id: string;
  status: string;
  timestamp: string;
}

/**
 * Update feedback index with incident-to-WU mappings
 *
 * @param baseDir - Base directory
 * @param wuId - WU ID
 * @param incidentIds - Array of incident IDs
 */
export async function updateFeedbackIndex(
  baseDir: string,
  wuId: string,
  incidentIds: string[],
): Promise<void> {
  const indexPath = path.join(baseDir, FEEDBACK_INDEX_PATH);
  const timestamp = new Date().toISOString();

  // Ensure directory exists
  const indexDir = path.dirname(indexPath);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool creates known directory
  await fs.mkdir(indexDir, { recursive: true });

  // Build NDJSON entries
  const entries: FeedbackIndexEntry[] = incidentIds.map((incidentId) => ({
    incident_id: incidentId,
    wu_id: wuId,
    status: FEEDBACK_STATUS.PENDING_RESOLUTION,
    timestamp,
  }));

  const content = `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`;

  // Append to index file
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool writes index file
  await fs.appendFile(indexPath, content, 'utf8');
}

/**
 * Load feedback index entries
 *
 * @param baseDir - Base directory
 * @returns Array of index entries
 */
export async function loadFeedbackIndex(baseDir: string): Promise<FeedbackIndexEntry[]> {
  const indexPath = path.join(baseDir, FEEDBACK_INDEX_PATH);

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool reads index file
    const content = await fs.readFile(indexPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines
      .map((line) => {
        try {
          return JSON.parse(line) as FeedbackIndexEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is FeedbackIndexEntry => entry !== null);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

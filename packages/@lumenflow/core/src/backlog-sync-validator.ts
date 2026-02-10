/**
 * Backlog Sync Validator (WU-672, WU-1065, WU-1137, WU-1303)
 * Detects WUs present in multiple sections (Done+Ready, Done+InProgress, etc.)
 * Uses frontmatter-driven section detection (WU-1065) instead of brittle string matching
 * Flags parent-only WUs in Ready section (WU-1137) - sub-lane format is preferred
 * Supports --fix mode to automatically remove duplicates (WU-1303)
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { parseYAML } from './wu-yaml.js';
import { parseBacklogFrontmatter, getSectionHeadings } from './backlog-parser.js';
import { extractParent } from './lane-checker.js';
import {
  CONFIG_FILES,
  PATTERNS,
  FILE_SYSTEM,
  STRING_LITERALS,
  WU_STATUS,
  getProjectRoot,
} from './wu-constants.js';

/**
 * Check if parent lane has sub-lane taxonomy in .lumenflow.lane-inference.yaml
 * @param {string} parent - Parent lane name
 * @param {string} projectRoot - Path to project root
 * @returns {boolean} True if parent has sub-lanes defined
 */
function hasSubLaneTaxonomy(parent, projectRoot) {
  const taxonomyPath = path.join(projectRoot, CONFIG_FILES.LANE_INFERENCE);
  if (!existsSync(taxonomyPath)) {
    return false;
  }

  try {
    const taxonomyContent = readFileSync(taxonomyPath, { encoding: 'utf-8' });
    const taxonomy = parseYAML(taxonomyContent);

    const normalizedParent = parent.trim().toLowerCase();
    return Object.keys(taxonomy).some((key) => key.toLowerCase().trim() === normalizedParent);
  } catch {
    // If taxonomy file is malformed, assume no taxonomy (fail safe)
    return false;
  }
}

export function validateBacklogSync(backlogPath) {
  // Parse frontmatter to get configured section headings
  let frontmatter, markdown;
  try {
    ({ frontmatter, markdown } = parseBacklogFrontmatter(backlogPath));
  } catch (err) {
    return { valid: false, errors: [err.message] };
  }

  // If no frontmatter, fall back to empty sections (backlog without frontmatter is valid)
  const headings = frontmatter ? getSectionHeadings(frontmatter) : {};
  const lines = markdown.split(/\r?\n/);

  // Parse sections using frontmatter headings
  const sections = {
    ready: new Set(),
    in_progress: new Set(),
    blocked: new Set(),
    done: new Set(),
  };

  let currentSection = null;

  // Build heading-to-section map for efficient lookup
  const headingMap = new Map();
  for (const [sectionName, heading] of Object.entries(headings)) {
    headingMap.set(heading, sectionName);
  }

  // WU-1334: Pattern to match WU IDs only in backlog list items
  // Matches lines starting with:
  // - `- WU-123` (bullet list)
  // - `* WU-123` (asterisk list)
  // - `- [ ] WU-123` (unchecked checkbox)
  // - `- [x] WU-123` (checked checkbox)
  // - `- [WU-123 - title](...)` (markdown link)
  // Does NOT match prose like "See WU-123 for details" or "WU-123 → WU-124"
  // eslint-disable-next-line security/detect-unsafe-regex -- static backlog pattern; input is line-bounded markdown
  const BACKLOG_ITEM_PATTERN = /^\s*[-*]\s*(?:\[[ x]\]\s*)?\[?(WU-\d+)/i;

  for (const line of lines) {
    // Check if line matches any configured section heading (exact match)
    if (headingMap.has(line)) {
      currentSection = headingMap.get(line);
      continue;
    }

    // Reset section when encountering other ## headings (not subsections ###)
    if (line.trim().startsWith('## ') && !line.trim().startsWith('### ')) {
      currentSection = null;
      continue;
    }

    if (currentSection) {
      const match = line.match(BACKLOG_ITEM_PATTERN);
      if (match) {
        sections[currentSection].add(match[1].toUpperCase());
      }
    }
  }

  // Detect duplicates
  const errors = [];

  // Done + Ready
  const doneAndReady = [...sections.done].filter((wu) => sections.ready.has(wu));
  if (doneAndReady.length > 0) {
    errors.push(
      `❌ ${doneAndReady.length} WU(s) are in BOTH Done and Ready sections:${STRING_LITERALS.NEWLINE}${doneAndReady
        .map((wu) => `   - ${wu}`)
        .join(STRING_LITERALS.NEWLINE)}${STRING_LITERALS.DOUBLE_NEWLINE}` +
        `   Fix: Remove from Ready section (they are already complete)${STRING_LITERALS.NEWLINE}` +
        `   Command: Edit docs/04-operations/tasks/backlog.md and remove duplicate entries`,
    );
  }

  // Done + In Progress (should never happen, but check anyway)
  const doneAndInProgress = [...sections.done].filter((wu) => sections.in_progress.has(wu));
  if (doneAndInProgress.length > 0) {
    errors.push(
      `❌ ${doneAndInProgress.length} WU(s) are in BOTH Done and In Progress sections:${STRING_LITERALS.NEWLINE}${doneAndInProgress
        .map((wu) => `   - ${wu}`)
        .join(STRING_LITERALS.NEWLINE)}${STRING_LITERALS.DOUBLE_NEWLINE}` +
        `   Fix: Remove from In Progress section (they are already complete)${STRING_LITERALS.NEWLINE}` +
        `   Or: If reopened, remove from Done and update WU YAML status to in_progress`,
    );
  }

  // Ready + In Progress (legitimate during claim, but flag for awareness)
  const readyAndInProgress = [...sections.ready].filter((wu) => sections.in_progress.has(wu));
  if (readyAndInProgress.length > 0) {
    errors.push(
      `⚠️  ${readyAndInProgress.length} WU(s) are in BOTH Ready and In Progress sections:${STRING_LITERALS.NEWLINE}${readyAndInProgress
        .map((wu) => `   - ${wu}`)
        .join(STRING_LITERALS.NEWLINE)}${STRING_LITERALS.DOUBLE_NEWLINE}` +
        `   This is normal during wu:claim before commit.${STRING_LITERALS.NEWLINE}` +
        `   If you see this error after commit, wu:claim did not remove from Ready.${STRING_LITERALS.NEWLINE}` +
        `   Fix: Remove from Ready section`,
    );
  }

  // WU-1137: Check for parent-only WUs in Ready section (sub-lane format preferred)
  const projectRoot = getProjectRoot(import.meta.url);
  const wuDir = path.join(path.dirname(backlogPath), 'wu');
  const parentOnlyWUs = [];

  for (const wuId of sections.ready) {
    const wuPath = path.join(wuDir, `${wuId}.yaml`);
    if (!existsSync(wuPath)) {
      continue; // Skip missing WU files (handled by other validators)
    }

    try {
      const wuContent = readFileSync(wuPath, { encoding: 'utf-8' });
      const wuDoc = parseYAML(wuContent) as { lane?: string } | null;

      if (wuDoc && wuDoc.lane) {
        const lane = wuDoc.lane.toString().trim();
        const hasColon = lane.includes(':');

        // If parent-only format (no colon) and parent has sub-lane taxonomy, flag it
        if (!hasColon) {
          const parent = extractParent(lane);
          if (hasSubLaneTaxonomy(parent, projectRoot)) {
            parentOnlyWUs.push({ wuId, lane, parent });
          }
        }
      }
    } catch {
      // Skip WU files that can't be parsed (handled by other validators)
      continue;
    }
  }

  if (parentOnlyWUs.length > 0) {
    errors.push(
      `⚠️  ${parentOnlyWUs.length} WU(s) in Ready section use parent-only lane format (sub-lane format preferred):${STRING_LITERALS.NEWLINE}${parentOnlyWUs
        .map((wu) => `   - ${wu.wuId}: "${wu.lane}" (parent has sub-lanes)`)
        .join(STRING_LITERALS.NEWLINE)}${STRING_LITERALS.DOUBLE_NEWLINE}` +
        `   Fix: Migrate to sub-lane format using:${STRING_LITERALS.NEWLINE}` +
        `        pnpm wu:infer-lane --id WU-123     # Suggest a sub-lane${STRING_LITERALS.NEWLINE}` +
        `        pnpm wu:edit --id WU-123 --lane "Parent: Sub"${STRING_LITERALS.NEWLINE}` +
        `   See: https://lumenflow.dev/reference/sub-lanes/`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      ready: sections.ready.size,
      inProgress: sections.in_progress.size,
      blocked: sections.blocked.size,
      done: sections.done.size,
      duplicates: doneAndReady.length + doneAndInProgress.length + readyAndInProgress.length,
      parentOnlyInReady: parentOnlyWUs.length,
    },
  };
}

/**
 * Options for fixing backlog duplicates
 */
export interface FixBacklogDuplicatesOptions {
  /** If true, report changes without writing */
  dryRun?: boolean;
  /** If true, return fixed content without writing (WU-1506) */
  returnContent?: boolean;
}

/**
 * Fix backlog duplicates by removing WUs from non-authoritative sections
 * - If WU in Done AND Ready: remove from Ready (Done is authoritative)
 * - If WU in Done AND InProgress: remove from InProgress (Done is authoritative)
 *
 * Part of WU-1303: Backlog duplicate entries after rebase conflicts
 * WU-1506: Added returnContent option for atomic in-memory validation
 *
 * @param {string} backlogPath - Path to backlog.md file
 * @param {FixBacklogDuplicatesOptions} options - Fix options
 * @returns {{fixed: boolean, removed: Array<{wu: string, section: string}>, backupPath?: string, content?: string}}
 */
export function fixBacklogDuplicates(backlogPath, options: FixBacklogDuplicatesOptions = {}) {
  const { dryRun = false, returnContent = false } = options;

  // Parse frontmatter to get configured section headings
  let frontmatter, markdown;
  try {
    ({ frontmatter, markdown } = parseBacklogFrontmatter(backlogPath));
  } catch (err) {
    return { fixed: false, removed: [], error: err.message };
  }

  const headings = frontmatter ? getSectionHeadings(frontmatter) : {};
  const lines = markdown.split(/\r?\n/);

  // Track section boundaries and WU locations
  const sections = {
    ready: { wus: new Set(), lineNumbers: new Map() },
    in_progress: { wus: new Set(), lineNumbers: new Map() },
    blocked: { wus: new Set(), lineNumbers: new Map() },
    done: { wus: new Set(), lineNumbers: new Map() },
  };

  let currentSection = null;

  // Build heading-to-section map
  const headingMap = new Map();
  for (const [sectionName, heading] of Object.entries(headings)) {
    headingMap.set(heading, sectionName);
  }

  // WU-1334: Same pattern as validateBacklogSync - only match list items
  // eslint-disable-next-line security/detect-unsafe-regex -- static backlog pattern; input is line-bounded markdown
  const BACKLOG_ITEM_PATTERN = /^\s*[-*]\s*(?:\[[ x]\]\s*)?\[?(WU-\d+)/i;

  // Parse sections and track line numbers for each WU
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (headingMap.has(line)) {
      currentSection = headingMap.get(line);
      continue;
    }

    // Reset section on other ## headings
    if (line.trim().startsWith('## ') && !line.trim().startsWith('### ')) {
      currentSection = null;
      continue;
    }

    if (currentSection && sections[currentSection]) {
      const match = line.match(BACKLOG_ITEM_PATTERN);
      if (match) {
        const wuId = match[1].toUpperCase();
        sections[currentSection].wus.add(wuId);
        // Store line number (can have multiple lines per WU, but we just need one to identify the entry)
        if (!sections[currentSection].lineNumbers.has(wuId)) {
          sections[currentSection].lineNumbers.set(wuId, i);
        }
      }
    }
  }

  // Find duplicates that need removal
  const linesToRemove = new Set();
  const removed = [];

  // Done + Ready: remove from Ready
  for (const wu of sections.done.wus) {
    if (sections.ready.wus.has(wu)) {
      const lineNum = sections.ready.lineNumbers.get(wu);
      if (lineNum !== undefined) {
        linesToRemove.add(lineNum);
        removed.push({ wu, section: WU_STATUS.READY });
      }
    }
  }

  // Done + InProgress: remove from InProgress
  for (const wu of sections.done.wus) {
    if (sections.in_progress.wus.has(wu)) {
      const lineNum = sections.in_progress.lineNumbers.get(wu);
      if (lineNum !== undefined) {
        linesToRemove.add(lineNum);
        removed.push({ wu, section: WU_STATUS.IN_PROGRESS });
      }
    }
  }

  // No duplicates to fix
  if (removed.length === 0) {
    return { fixed: false, removed: [], message: 'No duplicates found' };
  }

  // Remove duplicate lines (filter out the lines to remove)
  const newLines = lines.filter((_, index) => !linesToRemove.has(index));

  // Reconstruct file with frontmatter
  const originalContent = readFileSync(backlogPath, { encoding: 'utf-8' });
  const frontmatterMatch = originalContent.match(/^---\n[\s\S]*?\n---\n/);
  const frontmatterContent = frontmatterMatch ? frontmatterMatch[0] : STRING_LITERALS.EMPTY;

  const newContent = frontmatterContent + newLines.join(STRING_LITERALS.NEWLINE);

  // WU-1506: Return content without writing when returnContent is true
  if (returnContent) {
    return {
      fixed: true,
      removed,
      content: newContent,
      message: `Would remove ${removed.length} duplicate(s)`,
    };
  }

  // Dry run - report what would change
  if (dryRun) {
    return {
      fixed: false,
      removed,
      dryRun: true,
      message: `Would remove ${removed.length} duplicate(s)`,
    };
  }

  // Create backup before modifying
  const backupPath = `${backlogPath}.bak`;
  copyFileSync(backlogPath, backupPath);

  writeFileSync(backlogPath, newContent, { encoding: 'utf-8' });

  return {
    fixed: true,
    removed,
    backupPath,
    message: `Removed ${removed.length} duplicate(s). Backup at ${backupPath}`,
  };
}

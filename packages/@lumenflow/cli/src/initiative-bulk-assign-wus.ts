#!/usr/bin/env node
/**
 * Initiative Bulk Assign WUs CLI (WU-1018)
 *
 * Bulk-assigns orphaned WUs to initiatives based on lane prefix rules.
 * Uses micro-worktree isolation for race-safe commits.
 *
 * Usage:
 *   pnpm initiative:bulk-assign                              # Dry-run (default)
 *   LUMENFLOW_ADMIN=1 pnpm initiative:bulk-assign --apply    # Apply changes
 *   pnpm initiative:bulk-assign --config custom-config.yaml  # Custom config
 *   pnpm initiative:bulk-assign --reconcile-initiative INIT-001
 *
 * @module initiative-bulk-assign-wus
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { die } from '@lumenflow/core/error-handler';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { createWuPaths } from '@lumenflow/core/wu-paths';
import { runCLI } from './cli-entry-point.js';

/** Log prefix for console output */
const LOG_PREFIX = '[initiative:bulk-assign]';

/** Default lane bucket configuration path */
const DEFAULT_CONFIG_PATH = 'tools/config/initiative-lane-buckets.yaml';

const wuPaths = createWuPaths();

/** WU directory relative to repo root */
const WU_DIR = wuPaths.WU_DIR();

/** Initiative directory relative to repo root */
const INIT_DIR = wuPaths.INITIATIVES_DIR();

/** Environment variable required for apply mode */
const ADMIN_ENV_VAR = 'LUMENFLOW_ADMIN';

/** Micro-worktree operation name */
const OPERATION_NAME = 'initiative-bulk-assign';

interface LaneBucketRule {
  lane_prefix: string;
  initiative: string;
}

interface LaneBucketConfig {
  rules: LaneBucketRule[];
}

interface WUMeta {
  id: string;
  lane: string;
  initiative?: string;
  filePath: string;
  laneLineIndex: number;
  rawContent: string;
}

interface Change {
  wuId: string;
  type: 'sync' | 'assign' | 'reconcile';
  initiative: string;
  filePath: string;
  newContent?: string;
}

/**
 * Load lane bucket configuration
 */
async function loadConfig(configPath: string): Promise<LaneBucketConfig> {
  const fullPath = join(process.cwd(), configPath);

  if (!existsSync(fullPath)) {
    console.log(`${LOG_PREFIX} Config not found: ${configPath}`);
    console.log(`${LOG_PREFIX} Using empty rules (no auto-assignment)`);
    return { rules: [] };
  }

  const content = await readFile(fullPath, { encoding: 'utf-8' });
  return parseYaml(content) as LaneBucketConfig;
}

/**
 * Scan top-level meta from WU YAML content (text-based to preserve formatting)
 */
function scanTopLevelMeta(text: string, filePath: string): WUMeta | null {
  const lines = text.split('\n');
  let id: string | undefined;
  let lane: string | undefined;
  let initiative: string | undefined;
  let laneLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '' || trimmed === '---') {
      continue;
    }

    // Extract id
    if (trimmed.startsWith('id:')) {
      id = trimmed.replace('id:', '').trim();
    }

    // Extract lane
    if (trimmed.startsWith('lane:')) {
      lane = trimmed.replace('lane:', '').trim();
      laneLineIndex = i;
    }

    // Extract initiative
    if (trimmed.startsWith('initiative:')) {
      initiative = trimmed.replace('initiative:', '').trim();
    }
  }

  if (!id || !lane || laneLineIndex === -1) {
    return null;
  }

  return {
    id,
    lane,
    initiative,
    filePath,
    laneLineIndex,
    rawContent: text,
  };
}

/**
 * Insert initiative line after lane line (text-based)
 */
function insertInitiativeLine(text: string, laneLineIndex: number, initiativeId: string): string {
  const lines = text.split('\n');
  const initLine = `initiative: ${initiativeId}`;

  // Insert after lane line
  lines.splice(laneLineIndex + 1, 0, initLine);

  return lines.join('\n');
}

/**
 * Match lane against rules to find initiative
 */
function pickInitiativeForLane(lane: string, rules: LaneBucketRule[]): string | null {
  for (const rule of rules) {
    if (lane.toLowerCase().startsWith(rule.lane_prefix.toLowerCase())) {
      return rule.initiative;
    }
  }
  return null;
}

/**
 * List all WU files
 */
async function listWUFiles(): Promise<string[]> {
  const wuDir = join(process.cwd(), WU_DIR);
  return fg('WU-*.yaml', { cwd: wuDir, absolute: true });
}

/**
 * List all initiative files
 */
async function listInitiativeFiles(): Promise<string[]> {
  const initDir = join(process.cwd(), INIT_DIR);
  if (!existsSync(initDir)) {
    return [];
  }
  return fg('INIT-*.yaml', { cwd: initDir, absolute: true });
}

/**
 * Load WU IDs from initiative files
 */
async function loadInitiativeWUs(): Promise<Map<string, string[]>> {
  const initFiles = await listInitiativeFiles();
  const initWUs = new Map<string, string[]>();

  for (const file of initFiles) {
    try {
      const content = await readFile(file, { encoding: 'utf-8' });
      const init = parseYaml(content) as { id?: string; wus?: string[] };
      if (init.id && Array.isArray(init.wus)) {
        initWUs.set(init.id, init.wus);
      }
    } catch {
      // Skip invalid initiative files
    }
  }

  return initWUs;
}

/**
 * Compute all changes without writing
 */
async function computeChanges(config: LaneBucketConfig): Promise<{
  changes: Change[];
  stats: {
    total: number;
    alreadyAssigned: number;
    newlyAssigned: number;
    synced: number;
    skipped: number;
  };
}> {
  const wuFiles = await listWUFiles();
  const initWUs = await loadInitiativeWUs();
  const changes: Change[] = [];
  const stats = {
    total: wuFiles.length,
    alreadyAssigned: 0,
    newlyAssigned: 0,
    synced: 0,
    skipped: 0,
  };

  // Build reverse lookup: WU ID -> Initiative ID
  const wuToInit = new Map<string, string>();
  for (const [initId, wuList] of initWUs.entries()) {
    for (const wuId of wuList) {
      wuToInit.set(wuId, initId);
    }
  }

  for (const file of wuFiles) {
    try {
      const content = await readFile(file, { encoding: 'utf-8' });
      const meta = scanTopLevelMeta(content, file);

      if (!meta) {
        stats.skipped++;
        continue;
      }

      // Check if already assigned
      if (meta.initiative) {
        stats.alreadyAssigned++;
        continue;
      }

      // Check if initiative assigns this WU
      const assignedInit = wuToInit.get(meta.id);
      if (assignedInit) {
        // Sync from initiative
        const newContent = insertInitiativeLine(content, meta.laneLineIndex, assignedInit);
        changes.push({
          wuId: meta.id,
          type: 'sync',
          initiative: assignedInit,
          filePath: file,
          newContent,
        });
        stats.synced++;
        continue;
      }

      // Try to auto-assign by lane prefix
      const matchedInit = pickInitiativeForLane(meta.lane, config.rules);
      if (matchedInit) {
        const newContent = insertInitiativeLine(content, meta.laneLineIndex, matchedInit);
        changes.push({
          wuId: meta.id,
          type: 'assign',
          initiative: matchedInit,
          filePath: file,
          newContent,
        });
        stats.newlyAssigned++;
      } else {
        stats.skipped++;
      }
    } catch {
      stats.skipped++;
    }
  }

  return { changes, stats };
}

/**
 * Print summary of changes
 */
function printSummary(stats: {
  total: number;
  alreadyAssigned: number;
  newlyAssigned: number;
  synced: number;
  skipped: number;
}): void {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  BULK ASSIGNMENT SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total WUs scanned:       ${stats.total}`);
  console.log(`  Already assigned:        ${stats.alreadyAssigned}`);
  console.log(`  Synced from initiatives: ${stats.synced}`);
  console.log(`  Newly assigned by lane:  ${stats.newlyAssigned}`);
  console.log(`  Skipped (no match):      ${stats.skipped}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
}

/**
 * Main function
 */
async function main() {
  const args = createWUParser({
    name: 'initiative-bulk-assign-wus',
    description: 'Bulk-assign orphaned WUs to initiatives based on lane prefix rules',
    options: [WU_OPTIONS.config, WU_OPTIONS.apply, WU_OPTIONS.syncFromInitiative],
    required: [],
  });

  const configPath = args.config || DEFAULT_CONFIG_PATH;
  const applyMode = args.apply === true;

  console.log(`${LOG_PREFIX} Bulk assign WUs to initiatives`);
  console.log(`${LOG_PREFIX} Config: ${configPath}`);
  console.log(`${LOG_PREFIX} Mode: ${applyMode ? 'APPLY' : 'dry-run'}`);

  // Check admin mode for apply
  if (applyMode && process.env[ADMIN_ENV_VAR] !== '1') {
    die(
      `Apply mode requires ${ADMIN_ENV_VAR}=1 environment variable.\n\n` +
        `This prevents accidental use by agents.\n\n` +
        `Usage: ${ADMIN_ENV_VAR}=1 pnpm initiative:bulk-assign --apply`,
    );
  }

  // Load configuration
  const config = await loadConfig(configPath);
  console.log(`${LOG_PREFIX} Loaded ${config.rules.length} lane assignment rules`);

  // Compute changes
  console.log(`${LOG_PREFIX} Scanning WUs...`);
  const { changes, stats } = await computeChanges(config);

  // Print summary
  printSummary(stats);

  if (changes.length === 0) {
    console.log(`${LOG_PREFIX} No changes to apply.`);
    return;
  }

  // Show changes
  console.log(`${LOG_PREFIX} Changes to apply (${changes.length}):`);
  for (const change of changes) {
    const icon = change.type === 'sync' ? '↻' : '→';
    console.log(`  ${icon} ${change.wuId} ${change.type} ${change.initiative}`);
  }

  if (!applyMode) {
    console.log('');
    console.log(`${LOG_PREFIX} Dry-run complete. Use --apply to write changes.`);
    console.log(`${LOG_PREFIX}   ${ADMIN_ENV_VAR}=1 pnpm initiative:bulk-assign --apply`);
    return;
  }

  // Apply changes via micro-worktree
  console.log('');
  console.log(`${LOG_PREFIX} Applying changes via micro-worktree...`);

  await withMicroWorktree({
    operation: OPERATION_NAME,
    id: `bulk-${Date.now()}`,
    logPrefix: LOG_PREFIX,
    execute: async ({ worktreePath }) => {
      const filesChanged: string[] = [];

      for (const change of changes) {
        if (!change.newContent) continue;

        // Calculate relative path from repo root
        const relativePath = change.filePath.replace(process.cwd() + '/', '');
        const worktreeFilePath = join(worktreePath, relativePath);

        await writeFile(worktreeFilePath, change.newContent, { encoding: 'utf-8' });
        filesChanged.push(relativePath);
      }

      const commitMessage = `chore: bulk-assign ${changes.length} WUs to initiatives\n\nAuto-assigned by initiative-bulk-assign-wus`;

      return {
        commitMessage,
        files: filesChanged,
      };
    },
  });

  console.log(`${LOG_PREFIX} ✅ Successfully applied ${changes.length} changes`);
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  runCLI(main);
}

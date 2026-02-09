#!/usr/bin/env node
/**
 * State Bootstrap Command
 *
 * One-time migration utility from WU YAMLs to event-sourced state store.
 * Reads all WU YAML files and generates corresponding events in the state store.
 *
 * WU-1107: INIT-003 Phase 3c - Migrate state-bootstrap.ts from ExampleApp
 *
 * Usage:
 *   pnpm state:bootstrap           # Dry-run mode (shows what would be done)
 *   pnpm state:bootstrap --execute # Apply changes
 */

import { readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readFileSync } from 'node:fs';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { CLI_FLAGS, EXIT_CODES, EMOJI, STRING_LITERALS } from '@lumenflow/core/wu-constants';

/** Log prefix for consistent output */
const LOG_PREFIX = '[state-bootstrap]';

/**
 * Default configuration for state bootstrap
 * WU-1301: Uses config-based paths instead of hardcoded values
 */
export const STATE_BOOTSTRAP_DEFAULTS = {
  /** Default WU directory path (from config) */
  wuDir: WU_PATHS.WU_DIR(),
  /** Default state directory path (from config) */
  stateDir: WU_PATHS.STATE_DIR(),
};

/**
 * Arguments for state-bootstrap command
 */
export interface StateBootstrapArgs {
  dryRun: boolean;
  wuDir: string;
  stateDir: string;
  force: boolean;
  help?: boolean;
}

/**
 * Minimal WU information needed for bootstrap event generation
 */
export interface WuBootstrapInfo {
  id: string;
  status: string;
  lane: string;
  title: string;
  created?: string;
  claimed_at?: string;
  completed_at?: string;
}

/**
 * Bootstrap event to be written to state store
 */
export interface BootstrapEvent {
  type: 'claim' | 'complete' | 'block' | 'unblock' | 'release';
  wuId: string;
  timestamp: string;
  lane?: string;
  title?: string;
  reason?: string;
}

/**
 * Result of bootstrap operation
 */
export interface BootstrapResult {
  success: boolean;
  eventsGenerated: number;
  eventsWritten: number;
  skipped: number;
  warnings: string[];
  error?: string;
}

/**
 * Parse command line arguments for state-bootstrap
 */
export function parseStateBootstrapArgs(argv: string[]): StateBootstrapArgs {
  const args: StateBootstrapArgs = {
    dryRun: true,
    wuDir: STATE_BOOTSTRAP_DEFAULTS.wuDir,
    stateDir: STATE_BOOTSTRAP_DEFAULTS.stateDir,
    force: false,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === CLI_FLAGS.EXECUTE) {
      args.dryRun = false;
    } else if (arg === CLI_FLAGS.DRY_RUN) {
      args.dryRun = true;
    } else if (arg === CLI_FLAGS.HELP || arg === CLI_FLAGS.HELP_SHORT) {
      args.help = true;
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--wu-dir' && argv[i + 1]) {
      args.wuDir = argv[++i];
    } else if (arg === '--state-dir' && argv[i + 1]) {
      args.stateDir = argv[++i];
    }
  }

  return args;
}

/**
 * Convert a date string to ISO timestamp
 * Falls back to start of day if only date is provided
 */
function toTimestamp(dateStr: string | undefined, fallback?: string): string {
  if (!dateStr) {
    if (fallback) {
      return toTimestamp(fallback);
    }
    return new Date().toISOString();
  }

  // If already ISO format, return as-is
  if (dateStr.includes('T')) {
    return dateStr;
  }

  // Convert date-only to ISO timestamp at midnight UTC
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  return date.toISOString();
}

/**
 * Infer events from a WU based on its current status
 *
 * Event generation rules:
 * - ready: No events (WU not yet claimed)
 * - in_progress: Generate claim event
 * - blocked: Generate claim + block events
 * - done/completed: Generate claim + complete events
 */
export function inferEventsFromWu(wu: WuBootstrapInfo): BootstrapEvent[] {
  const events: BootstrapEvent[] = [];

  // Ready WUs have no events (not yet in the lifecycle)
  if (wu.status === 'ready' || wu.status === 'backlog' || wu.status === 'todo') {
    return events;
  }

  // All other states start with a claim event
  const claimTimestamp = toTimestamp(wu.claimed_at, wu.created);
  events.push({
    type: 'claim',
    wuId: wu.id,
    lane: wu.lane,
    title: wu.title,
    timestamp: claimTimestamp,
  });

  // Handle completed/done status
  if (wu.status === 'done' || wu.status === 'completed') {
    const completeTimestamp = toTimestamp(wu.completed_at, wu.created);
    events.push({
      type: 'complete',
      wuId: wu.id,
      timestamp: completeTimestamp,
    });
    return events;
  }

  // Handle blocked status
  if (wu.status === 'blocked') {
    // Block event timestamp should be after claim
    // We don't have exact block time, so use claim time + 1 second
    const claimDate = new Date(claimTimestamp);
    claimDate.setSeconds(claimDate.getSeconds() + 1);
    events.push({
      type: 'block',
      wuId: wu.id,
      timestamp: claimDate.toISOString(),
      reason: 'Bootstrapped from WU YAML (original reason unknown)',
    });
    return events;
  }

  // in_progress status already has claim event
  return events;
}

/**
 * Generate all bootstrap events from a list of WUs, ordered chronologically
 */
export function generateBootstrapEvents(wus: WuBootstrapInfo[]): BootstrapEvent[] {
  const allEvents: BootstrapEvent[] = [];

  for (const wu of wus) {
    const events = inferEventsFromWu(wu);
    allEvents.push(...events);
  }

  // Sort events chronologically
  allEvents.sort((a, b) => {
    const dateA = new Date(a.timestamp).getTime();
    const dateB = new Date(b.timestamp).getTime();
    return dateA - dateB;
  });

  return allEvents;
}

/**
 * Load a WU YAML file and extract bootstrap info
 */
function loadWuYaml(filePath: string): WuBootstrapInfo | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const doc = parseYaml(content) as Record<string, unknown>;

    if (!doc || typeof doc !== 'object' || !doc.id) {
      return null;
    }

    return {
      id: String(doc.id),
      status: String(doc.status || 'ready'),
      lane: String(doc.lane || 'Unknown'),
      title: String(doc.title || 'Untitled'),
      created: doc.created ? String(doc.created) : undefined,
      claimed_at: doc.claimed_at ? String(doc.claimed_at) : undefined,
      completed_at: doc.completed_at ? String(doc.completed_at) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Run the state bootstrap migration
 */
export async function runStateBootstrap(args: StateBootstrapArgs): Promise<BootstrapResult> {
  const result: BootstrapResult = {
    success: true,
    eventsGenerated: 0,
    eventsWritten: 0,
    skipped: 0,
    warnings: [],
  };

  // Check if WU directory exists
  if (!existsSync(args.wuDir)) {
    result.warnings.push('WU directory not found');
    return result;
  }

  // Check if state file already exists
  const stateFilePath = path.join(args.stateDir, 'wu-events.jsonl');
  if (existsSync(stateFilePath) && !args.force && !args.dryRun) {
    result.success = false;
    result.error = `State file already exists: ${stateFilePath}. Use --force to overwrite.`;
    return result;
  }

  // Load all WU YAML files
  const wus: WuBootstrapInfo[] = [];
  const files = readdirSync(args.wuDir).filter((f) => f.endsWith('.yaml'));

  for (const file of files) {
    const filePath = path.join(args.wuDir, file);
    const wu = loadWuYaml(filePath);
    if (wu) {
      wus.push(wu);
    } else {
      result.skipped++;
    }
  }

  // Generate events
  const events = generateBootstrapEvents(wus);
  result.eventsGenerated = events.length;

  // In dry-run mode, don't write anything
  if (args.dryRun) {
    return result;
  }

  // Ensure state directory exists
  mkdirSync(args.stateDir, { recursive: true });

  // Write events to state file
  const lines = events.map((event) => JSON.stringify(event));
  const content = lines.length > 0 ? `${lines.join('\n')}\n` : '';

  writeFileSync(stateFilePath, content, 'utf-8');
  result.eventsWritten = events.length;

  return result;
}

/**
 * Print help text
 */
export function printHelp(): void {
  console.log(`
${LOG_PREFIX} State Bootstrap - One-time migration utility

Usage:
  pnpm state:bootstrap           # Dry-run mode (default, shows what would be done)
  pnpm state:bootstrap --execute # Apply changes

Options:
  --execute                      Execute migration (default is dry-run)
  --dry-run                      Show what would be done without making changes
  --wu-dir <path>                WU YAML directory (default: ${STATE_BOOTSTRAP_DEFAULTS.wuDir})
  --state-dir <path>             State store directory (default: ${STATE_BOOTSTRAP_DEFAULTS.stateDir})
  --force                        Overwrite existing state file
  --help, -h                     Show this help message

This tool:
  ${EMOJI.SUCCESS} Reads all WU YAML files from the WU directory
  ${EMOJI.SUCCESS} Generates events based on WU status (claim, complete, block)
  ${EMOJI.SUCCESS} Writes events to .lumenflow/state/wu-events.jsonl
  ${EMOJI.WARNING} One-time migration - run only when setting up event-sourced state

Supported WU statuses:
  ready     -> No events (WU not yet claimed)
  in_progress -> claim event
  blocked   -> claim + block events
  done      -> claim + complete events
`);
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const args = parseStateBootstrapArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(EXIT_CODES.SUCCESS);
  }

  console.log(`${LOG_PREFIX} State Bootstrap Migration`);
  console.log(`${LOG_PREFIX} =========================${STRING_LITERALS.NEWLINE}`);

  if (args.dryRun) {
    console.log(
      `${LOG_PREFIX} ${EMOJI.INFO} DRY-RUN MODE (use --execute to apply changes)${STRING_LITERALS.NEWLINE}`,
    );
  }

  console.log(`${LOG_PREFIX} WU directory: ${args.wuDir}`);
  console.log(`${LOG_PREFIX} State directory: ${args.stateDir}${STRING_LITERALS.NEWLINE}`);

  const result = await runStateBootstrap(args);

  if (!result.success) {
    console.error(`${LOG_PREFIX} ${EMOJI.FAILURE} ${result.error}`);
    process.exit(EXIT_CODES.ERROR);
  }

  // Report warnings
  for (const warning of result.warnings) {
    console.log(`${LOG_PREFIX} ${EMOJI.WARNING} ${warning}`);
  }

  // Summary
  console.log(`${STRING_LITERALS.NEWLINE}${LOG_PREFIX} Summary`);
  console.log(`${LOG_PREFIX} ========`);
  console.log(`${LOG_PREFIX} Events generated: ${result.eventsGenerated}`);
  console.log(`${LOG_PREFIX} Events written: ${result.eventsWritten}`);
  console.log(`${LOG_PREFIX} Files skipped: ${result.skipped}`);

  if (args.dryRun && result.eventsGenerated > 0) {
    console.log(
      `${STRING_LITERALS.NEWLINE}${LOG_PREFIX} ${EMOJI.INFO} This was a dry-run. Use --execute to apply changes.`,
    );
  } else if (result.eventsWritten > 0) {
    console.log(
      `${STRING_LITERALS.NEWLINE}${LOG_PREFIX} ${EMOJI.SUCCESS} State bootstrap complete!`,
    );
  }

  process.exit(EXIT_CODES.SUCCESS);
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  runCLI(main);
}

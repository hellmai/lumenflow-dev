#!/usr/bin/env node
/**
 * Session Coordinator CLI Command
 *
 * Manages agent sessions - starting, stopping, status, and handoffs.
 * Sessions track which agent is working on which WU and facilitate
 * coordination between multiple agents.
 *
 * WU-1112: INIT-003 Phase 6 - Migrate remaining Tier 1 tools
 *
 * Usage:
 *   pnpm session:start --wu WU-1112 --agent claude-code
 *   pnpm session:stop --reason "Completed work"
 *   pnpm session:status
 *   pnpm session:handoff --wu WU-1112 --agent cursor
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { EXIT_CODES, LUMENFLOW_PATHS, FILE_SYSTEM } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';

/** Log prefix for console output */
const LOG_PREFIX = '[session]';

/**
 * Session subcommands
 */
export enum SessionCommand {
  START = 'start',
  STOP = 'stop',
  STATUS = 'status',
  HANDOFF = 'handoff',
}

/**
 * Arguments for session-coordinator command
 */
export interface SessionArgs {
  /** Subcommand to run */
  command?: SessionCommand | string;
  /** WU ID for the session */
  wuId?: string;
  /** Agent type (e.g., claude-code, cursor, aider) */
  agent?: string;
  /** Reason for stopping session */
  reason?: string;
  /** Show help */
  help?: boolean;
}

/**
 * Validation result for session command
 */
export interface SessionValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Session state stored in current.json
 */
export interface SessionState {
  /** WU being worked on */
  wuId: string;
  /** Agent working on the WU */
  agent: string;
  /** Session start timestamp */
  startedAt: string;
  /** Last activity timestamp */
  lastActivity: string;
}

/**
 * Parse command line arguments for session-coordinator
 *
 * @param argv - Process argv array
 * @returns Parsed arguments
 */
export function parseSessionArgs(argv: string[]): SessionArgs {
  const args: SessionArgs = {};

  // Skip node and script name
  const cliArgs = argv.slice(2);

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--wu' || arg === '-w') {
      args.wuId = cliArgs[++i];
    } else if (arg === '--agent' || arg === '-a') {
      args.agent = cliArgs[++i];
    } else if (arg === '--reason' || arg === '-r') {
      args.reason = cliArgs[++i];
    } else if (!arg.startsWith('-')) {
      // Subcommand
      if (Object.values(SessionCommand).includes(arg as SessionCommand)) {
        args.command = arg as SessionCommand;
      }
    }
  }

  // Default to status if no command given
  if (!args.command && !args.help) {
    args.command = SessionCommand.STATUS;
  }

  return args;
}

/**
 * Validate session command arguments
 *
 * @param args - Parsed session arguments
 * @returns Validation result
 */
export function validateSessionCommand(args: SessionArgs): SessionValidationResult {
  const { command, wuId } = args;

  switch (command) {
    case SessionCommand.START:
      if (!wuId) {
        return {
          valid: false,
          error: 'session start requires --wu <id> to specify which WU to work on',
        };
      }
      break;

    case SessionCommand.HANDOFF:
      if (!wuId) {
        return {
          valid: false,
          error: 'session handoff requires --wu <id> to specify which WU to hand off',
        };
      }
      break;

    case SessionCommand.STOP:
    case SessionCommand.STATUS:
      // No required arguments
      break;

    default:
      return {
        valid: false,
        error: `Unknown command: ${command}`,
      };
  }

  return { valid: true };
}

/**
 * Get path to current session file
 */
function getSessionPath(): string {
  return join(process.cwd(), LUMENFLOW_PATHS.SESSION_CURRENT);
}

/**
 * Read current session state
 */
function readCurrentSession(): SessionState | null {
  const path = getSessionPath();
  if (!existsSync(path)) {
    return null;
  }

  try {
    const content = readFileSync(path, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });
    return JSON.parse(content) as SessionState;
  } catch {
    return null;
  }
}

/**
 * Write session state
 */
function writeSession(session: SessionState | null): void {
  const path = getSessionPath();
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (session === null) {
    // Remove session file if clearing
    if (existsSync(path)) {
      const { unlinkSync } = require('node:fs');
      unlinkSync(path);
    }
  } else {
    writeFileSync(path, JSON.stringify(session, null, 2), {
      encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
    });
  }
}

/**
 * Print help message for session-coordinator
 */
/* istanbul ignore next -- CLI entry point */
function printHelp(): void {
  console.log(`
Usage: session <command> [options]

Manage agent sessions for WU work coordination.

Commands:
  start     Start a new session
  stop      Stop current session
  status    Show current session status
  handoff   Hand off session to another agent

Options:
  -w, --wu <id>       WU ID to work on (required for start/handoff)
  -a, --agent <type>  Agent type (e.g., claude-code, cursor, aider)
  -r, --reason <msg>  Reason for stopping session
  -h, --help          Show this help message

Examples:
  session start --wu WU-1112 --agent claude-code
  session stop --reason "Completed acceptance criteria"
  session status
  session handoff --wu WU-1112 --agent cursor

Session files are stored in: ${LUMENFLOW_PATHS.SESSION_CURRENT}
`);
}

/**
 * Handle start command
 */
/* istanbul ignore next -- CLI entry point */
function handleStart(args: SessionArgs): void {
  const current = readCurrentSession();

  if (current) {
    console.log(`${LOG_PREFIX} Active session already exists:`);
    console.log(`  WU: ${current.wuId}`);
    console.log(`  Agent: ${current.agent}`);
    console.log(`  Started: ${current.startedAt}`);
    console.log(`\n${LOG_PREFIX} Stop current session first with: session stop`);
    process.exit(EXIT_CODES.ERROR);
  }

  const session: SessionState = {
    wuId: args.wuId!,
    agent: args.agent || 'unknown',
    startedAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };

  writeSession(session);

  console.log(`${LOG_PREFIX} ✅ Session started`);
  console.log(`  WU: ${session.wuId}`);
  console.log(`  Agent: ${session.agent}`);
  console.log(`  Started: ${session.startedAt}`);
}

/**
 * Handle stop command
 */
/* istanbul ignore next -- CLI entry point */
function handleStop(args: SessionArgs): void {
  const current = readCurrentSession();

  if (!current) {
    console.log(`${LOG_PREFIX} No active session to stop.`);
    process.exit(EXIT_CODES.SUCCESS);
  }

  const duration = Date.now() - new Date(current.startedAt).getTime();
  const durationMin = Math.round(duration / 60000);

  console.log(`${LOG_PREFIX} ✅ Session stopped`);
  console.log(`  WU: ${current.wuId}`);
  console.log(`  Agent: ${current.agent}`);
  console.log(`  Duration: ${durationMin} minutes`);
  if (args.reason) {
    console.log(`  Reason: ${args.reason}`);
  }

  writeSession(null);
}

/**
 * Handle status command
 */
/* istanbul ignore next -- CLI entry point */
function handleStatus(): void {
  const current = readCurrentSession();

  if (!current) {
    console.log(`${LOG_PREFIX} No active session.`);
    console.log(`\n${LOG_PREFIX} Start a session with: session start --wu WU-XXXX`);
    return;
  }

  const duration = Date.now() - new Date(current.startedAt).getTime();
  const durationMin = Math.round(duration / 60000);

  console.log(`${LOG_PREFIX} Active session:`);
  console.log(`  WU: ${current.wuId}`);
  console.log(`  Agent: ${current.agent}`);
  console.log(`  Started: ${current.startedAt}`);
  console.log(`  Duration: ${durationMin} minutes`);
  console.log(`  Last activity: ${current.lastActivity}`);
}

/**
 * Handle handoff command
 */
/* istanbul ignore next -- CLI entry point */
function handleHandoff(args: SessionArgs): void {
  const current = readCurrentSession();

  if (current) {
    console.log(`${LOG_PREFIX} Stopping current session...`);
    handleStop({ reason: `Handoff to ${args.agent || 'another agent'}` });
  }

  console.log(`\n${LOG_PREFIX} Starting new session for handoff...`);
  handleStart(args);
}

/**
 * Main entry point for session-coordinator command
 */
/* istanbul ignore next -- CLI entry point */
async function main(): Promise<void> {
  const args = parseSessionArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(EXIT_CODES.SUCCESS);
  }

  const validation = validateSessionCommand(args);
  if (!validation.valid) {
    console.error(`${LOG_PREFIX} Error: ${validation.error}`);
    printHelp();
    process.exit(EXIT_CODES.ERROR);
  }

  switch (args.command) {
    case SessionCommand.START:
      handleStart(args);
      break;
    case SessionCommand.STOP:
      handleStop(args);
      break;
    case SessionCommand.STATUS:
      handleStatus();
      break;
    case SessionCommand.HANDOFF:
      handleHandoff(args);
      break;
    default:
      console.error(`${LOG_PREFIX} Unknown command: ${args.command}`);
      printHelp();
      process.exit(EXIT_CODES.ERROR);
  }
}

// Run main if executed directly
if (import.meta.main) {
  void runCLI(main);
}

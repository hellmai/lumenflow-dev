/**
 * Logs Library (WU-2064)
 *
 * Core library for unified log aggregation following Anthropic's agent logging patterns.
 * Aggregates logs from multiple sources:
 * - .logs/web.log (structured JSON from Next.js)
 * - .beacon/commands.log (git command audit trail)
 * - .beacon/flow.log (WU flow events)
 * - .logs/tool-audit.ndjson (Claude Code tool usage audit)
 *
 * LIBRARY-FIRST: No general-purpose library exists for project-specific log
 * aggregation across custom log locations. Uses native JSON.parse like existing
 * tail-logs.mjs in the codebase.
 *
 * @see docs/02-technical/standards/logging.md
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Log source configurations
 * Each source has a path relative to project root and a source identifier
 */
export const LOG_SOURCES = [
  { path: '.logs/web.log', source: 'web.log' },
  { path: '.beacon/commands.log', source: 'commands.log' },
  { path: '.beacon/flow.log', source: 'flow.log' },
  { path: '.logs/tool-audit.ndjson', source: 'tool-audit.ndjson' },
];

/**
 * Parse a single log line (NDJSON format)
 *
 * @param {string} line - JSON log line
 * @returns {object|null} Parsed log object or null if invalid
 */
export function parseLogLine(line) {
  if (!line || typeof line !== 'string') {
    return null;
  }

  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Filter log entries by criteria
 *
 * @param {object[]} logs - Array of log objects
 * @param {object} options - Filter options
 * @param {string} [options.level] - Filter by log level (info, warn, error)
 * @param {string} [options.service] - Filter by service/message prefix
 * @param {string} [options.filter] - Arbitrary text filter (searches in JSON)
 * @param {number} [options.last] - Return only last N entries
 * @returns {object[]} Filtered logs
 */
export function filterLogs(logs, options = {}) {
  const { level, service, filter, last } = options;

  let result = logs;

  // Filter by level
  if (level) {
    result = result.filter((log) => log.level === level);
  }

  // Filter by service (message prefix)
  if (service) {
    result = result.filter((log) => {
      const msg = log.msg || log.message || '';
      const pattern = '.' + service + '.';
      return msg.startsWith(service) || msg.includes(pattern);
    });
  }

  // Filter by arbitrary text pattern
  if (filter) {
    result = result.filter((log) => {
      const jsonStr = JSON.stringify(log);
      return jsonStr.includes(filter);
    });
  }

  // Limit to last N entries
  if (last && last > 0) {
    result = result.slice(-last);
  }

  return result;
}

/**
 * Read and parse a single log file
 *
 * @param {string} filePath - Path to log file
 * @param {string} source - Source identifier for tagging
 * @returns {object[]} Parsed log entries with _source field
 */
function readLogFile(filePath, source) {
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const logs = [];

    for (const line of lines) {
      const parsed = parseLogLine(line);
      if (parsed) {
        parsed._source = source;
        logs.push(parsed);
      }
    }

    return logs;
  } catch {
    return [];
  }
}

/**
 * Aggregate logs from all configured sources
 *
 * @param {object} options - Options
 * @param {string} [options.cwd] - Working directory (defaults to process.cwd())
 * @returns {Promise<object[]>} Aggregated and sorted log entries
 */
export async function aggregateLogs(options = {}) {
  const { cwd = process.cwd() } = options;

  const allLogs = [];

  for (const { path: logPath, source } of LOG_SOURCES) {
    const fullPath = path.join(cwd, logPath);
    const logs = readLogFile(fullPath, source);
    allLogs.push(...logs);
  }

  // Sort by time (oldest first)
  allLogs.sort((a, b) => {
    const timeA = new Date(a.time || 0).getTime();
    const timeB = new Date(b.time || 0).getTime();
    return timeA - timeB;
  });

  return allLogs;
}

/**
 * Parse command line arguments for logs command
 *
 * @param {string[]} args - Command line arguments (without node and script)
 * @returns {object} Parsed options
 */
export function parseLogsArgs(args) {
  const result = {};
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === '--last') {
      i++;
      result.last = parseInt(args[i], 10);
    } else if (arg === '--level') {
      i++;
      result.level = args[i];
    } else if (arg === '--service') {
      i++;
      result.service = args[i];
    } else if (arg === '--filter') {
      i++;
      result.filter = args[i];
    } else if (arg === '--json') {
      result.json = true;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    }
    // Ignore unknown flags
    i++;
  }

  return result;
}

/**
 * Format a log entry for console display
 *
 * @param {object} log - Log object
 * @returns {string} Formatted log line
 */
export function formatLogEntry(log) {
  const levelColors = {
    debug: '\x1b[36m', // cyan
    info: '\x1b[32m', // green
    warn: '\x1b[33m', // yellow
    error: '\x1b[31m', // red
  };
  const reset = '\x1b[0m';
  const dim = '\x1b[2m';

  const level = log.level || 'info';
  const color = levelColors[level] || reset;
  const time = log.time
    ? new Date(log.time).toLocaleTimeString('en-GB', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '??:??:??';

  const msg = log.msg || log.message || log.event || 'unknown';
  const source = log._source ? (dim + '[' + log._source + ']' + reset) : '';

  // Build metadata string excluding known fields
  const knownFields = ['time', 'level', 'msg', 'message', 'event', '_source'];
  const meta = {};
  for (const [key, value] of Object.entries(log)) {
    if (!knownFields.includes(key)) {
      meta[key] = value;
    }
  }
  const metaStr = Object.keys(meta).length > 0 ? (' ' + JSON.stringify(meta)) : '';

  const levelStr = level.toUpperCase().padEnd(5);
  return color + '[' + time + '] ' + levelStr + reset + ' ' + source + ' ' + msg + metaStr;
}

/**
 * Agent Logging (WU-2541)
 *
 * Logging infrastructure for LumenFlow agents.
 *
 * @module @lumenflow/agent/logging
 */

import { z } from 'zod';

/**
 * Log levels
 */
export const LOG_LEVELS = [
  'debug',
  'info',
  'warn',
  'error',
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Log entry schema
 */
export const LogEntrySchema = z.object({
  timestamp: z.string().datetime(),
  level: z.enum(LOG_LEVELS),
  message: z.string().min(1),
  sessionId: z.string().optional(),
  wuId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type LogEntry = z.infer<typeof LogEntrySchema>;

/**
 * Log file paths
 */
export const LOG_FILES = {
  WEB: 'web.log',
  COMMANDS: 'commands.log',
  FLOW: 'flow.log',
  TOOL_AUDIT: 'tool-audit.ndjson',
} as const;

export type LogFile = (typeof LOG_FILES)[keyof typeof LOG_FILES];

export function validateLogEntry(data: unknown): z.SafeParseReturnType<LogEntry, LogEntry> {
  return LogEntrySchema.safeParse(data);
}

export function createLogEntry(
  level: LogLevel,
  message: string,
  options?: { sessionId?: string; wuId?: string; metadata?: Record<string, unknown> }
): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(options?.sessionId && { sessionId: options.sessionId }),
    ...(options?.wuId && { wuId: options.wuId }),
    ...(options?.metadata && { metadata: options.metadata }),
  };
}

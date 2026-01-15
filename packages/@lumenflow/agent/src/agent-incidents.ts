import { z } from 'zod';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { VALIDATION_LIMITS, INCIDENT_CATEGORIES } from '@lumenflow/core/lib/wu-validation-constants.js';
import {
  BEACON_PATHS,
  FILE_EXTENSIONS,
  INCIDENT_SEVERITY,
  FILE_SYSTEM,
  STRING_LITERALS,
} from '@lumenflow/core/lib/wu-constants.js';

/**
 * IncidentLog schema for structured issue tracking
 * Stored as NDJSON in .beacon/incidents/<category>.ndjson
 */
export const IncidentLogSchema = z.object({
  timestamp: z.string().datetime(), // ISO 8601 with timezone
  session_id: z.string().uuid(),
  wu_id: z.string().regex(/^WU-\d+$/, 'Must match WU-XXX format'),
  lane: z.string().min(1),
  category: z.enum(INCIDENT_CATEGORIES),
  severity: z.enum(Object.values(INCIDENT_SEVERITY)),
  title: z.string().min(VALIDATION_LIMITS.TITLE_MIN).max(VALIDATION_LIMITS.TITLE_MAX),
  description: z
    .string()
    .min(VALIDATION_LIMITS.DESCRIPTION_MIN)
    .max(VALIDATION_LIMITS.DESCRIPTION_MAX),
  resolution: z.string().optional(),
  tags: z.array(z.string()).default([]),
  context: z
    .object({
      git_branch: z.string().optional(),
      current_step: z.string().optional(),
      related_files: z.array(z.string()).optional(),
    })
    .optional()
    .default({}),
});

/**
 * @typedef {z.infer<typeof IncidentLogSchema>} IncidentLog
 */

/**
 * Append an incident to the appropriate NDJSON log file
 * @param {IncidentLog} incident - Incident data (will be validated)
 * @param {string} incidentsDir - Optional directory override (for testing)
 * @throws {z.ZodError} if incident data is invalid
 */
export function appendIncident(incident, incidentsDir = BEACON_PATHS.INCIDENTS) {
  // Validate against schema
  const validated = IncidentLogSchema.parse(incident);

  // Ensure incidents directory exists
  if (!existsSync(incidentsDir)) {
    mkdirSync(incidentsDir, { recursive: true });
  }

  // Append to category-specific file
  const logFile = join(incidentsDir, `${validated.category}${FILE_EXTENSIONS.NDJSON}`);
  appendFileSync(logFile, `${JSON.stringify(validated)}\n`, FILE_SYSTEM.UTF8);
}

/**
 * Read and parse incidents from NDJSON files
 * @param {string[]|null} categories - Categories to read (default: all)
 * @param {Date|null} since - Filter incidents after this date
 * @param {string} incidentsDir - Optional directory override (for testing)
 * @returns {IncidentLog[]} Parsed and validated incidents
 */
export function readIncidents(
  categories = null,
  since = null,
  incidentsDir = BEACON_PATHS.INCIDENTS
) {
  if (!existsSync(incidentsDir)) return [];

  const categoriesToRead = categories || INCIDENT_CATEGORIES;
  const incidents = [];

  for (const category of categoriesToRead) {
    const logFile = join(incidentsDir, `${category}${FILE_EXTENSIONS.NDJSON}`);
    if (!existsSync(logFile)) continue;

    const lines = readFileSync(logFile, FILE_SYSTEM.UTF8)
      .split(STRING_LITERALS.NEWLINE)
      .filter(Boolean);
    for (const line of lines) {
      try {
        const incident = IncidentLogSchema.parse(JSON.parse(line));
        if (since && new Date(incident.timestamp) < since) continue;
        incidents.push(incident);
      } catch (err) {
        console.warn(`Skipping malformed incident in ${logFile}: ${err.message}`);
      }
    }
  }

  return incidents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

import { z } from 'zod';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { VALIDATION_LIMITS } from '@lumenflow/core/wu-validation-constants';
import { LUMENFLOW_PATHS, FILE_EXTENSIONS, STRING_LITERALS } from '@lumenflow/core/wu-constants';

/**
 * Incident severity values as a const tuple for z.enum
 */
const SEVERITY_VALUES = ['blocker', 'major', 'minor', 'info'] as const;

/**
 * Incident categories values as a const tuple for z.enum
 */
const CATEGORY_VALUES = ['workflow', 'tooling', 'confusion', 'violation', 'error'] as const;

/**
 * IncidentLog schema for structured issue tracking
 * Stored as NDJSON in .lumenflow/incidents/<category>.ndjson
 */
export const IncidentLogSchema = z.object({
  timestamp: z.string().datetime(), // ISO 8601 with timezone
  session_id: z.string().uuid(),
  wu_id: z.string().regex(/^WU-\d+$/, 'Must match WU-XXX format'),
  lane: z.string().min(1),
  category: z.enum(CATEGORY_VALUES),
  severity: z.enum(SEVERITY_VALUES),
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
    .default(() => ({})),
});

/**
 * @typedef {z.infer<typeof IncidentLogSchema>} IncidentLog
 */

/**
 * Inferred type from IncidentLogSchema
 */
export type IncidentLog = z.infer<typeof IncidentLogSchema>;

/**
 * Append an incident to the appropriate NDJSON log file
 * @param incident - Incident data (will be validated)
 * @param incidentsDir - Optional directory override (for testing)
 * @throws {z.ZodError} if incident data is invalid
 */
export function appendIncident(
  incident: unknown,
  incidentsDir: string = LUMENFLOW_PATHS.INCIDENTS,
): void {
  // Validate against schema
  const validated = IncidentLogSchema.parse(incident);

  // Ensure incidents directory exists
  if (!existsSync(incidentsDir)) {
    mkdirSync(incidentsDir, { recursive: true });
  }

  // Append to category-specific file
  const logFile = join(incidentsDir, `${validated.category}${FILE_EXTENSIONS.NDJSON}`);
  appendFileSync(logFile, `${JSON.stringify(validated)}\n`, { encoding: 'utf-8' });
}

/**
 * Read and parse incidents from NDJSON files
 * @param categories - Categories to read (default: all)
 * @param since - Filter incidents after this date
 * @param incidentsDir - Optional directory override (for testing)
 * @returns Parsed and validated incidents
 */
export function readIncidents(
  categories: readonly string[] | null = null,
  since: Date | null = null,
  incidentsDir: string = LUMENFLOW_PATHS.INCIDENTS,
): IncidentLog[] {
  if (!existsSync(incidentsDir)) return [];

  const categoriesToRead = categories ?? CATEGORY_VALUES;
  const incidents: IncidentLog[] = [];

  for (const category of categoriesToRead) {
    const logFile = join(incidentsDir, `${category}${FILE_EXTENSIONS.NDJSON}`);
    if (!existsSync(logFile)) continue;

    const lines = readFileSync(logFile, { encoding: 'utf-8' })
      .split(STRING_LITERALS.NEWLINE)
      .filter(Boolean);
    for (const line of lines) {
      try {
        const incident = IncidentLogSchema.parse(JSON.parse(line));
        if (since && new Date(incident.timestamp) < since) continue;
        incidents.push(incident);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console -- Agent infra uses stderr for diagnostics
        console.warn(`Skipping malformed incident in ${logFile}: ${errorMessage}`);
      }
    }
  }

  return incidents.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

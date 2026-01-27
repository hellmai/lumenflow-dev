/**
 * Spawn Prompt Schema (WU-1142)
 *
 * Zod schema for truncation-resistant spawn prompts.
 * Implements a YAML envelope format with:
 * - SHA256 checksums for integrity validation
 * - Sentinel values for truncation detection
 * - Schema validation for agent consumers
 *
 * Three-Layer Defense:
 * 1. YAML Envelope - head/tail truncation breaks YAML parse
 * 2. Checksum - validates content integrity
 * 3. Sentinel - confirms complete transmission
 *
 * @module spawn-prompt-schema
 */

import { z } from 'zod';
import { createHash } from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/**
 * Sentinel value that marks complete spawn prompt transmission
 */
export const SPAWN_SENTINEL = 'LUMENFLOW_SPAWN_COMPLETE';

/**
 * Current schema version
 */
export const SPAWN_PROMPT_VERSION = '1.0.0';

/**
 * Zod schema for spawn prompt envelope
 */
export const SpawnPromptSchema = z.object({
  /** WU ID for this spawn prompt */
  wu_id: z.string().regex(/^WU-\d+$/i, 'Invalid WU ID format'),

  /** Schema version */
  version: z.string().default(SPAWN_PROMPT_VERSION),

  /** SHA256 checksum of content field */
  checksum: z.string().length(64, 'Checksum must be 64 hex characters'),

  /** The actual spawn prompt content */
  content: z.string().min(1, 'Content cannot be empty'),

  /** Sentinel value confirming complete transmission */
  sentinel: z.literal(SPAWN_SENTINEL),
});

/**
 * Type for a valid spawn prompt
 */
export type SpawnPrompt = z.infer<typeof SpawnPromptSchema>;

/**
 * Compute SHA256 checksum of content
 *
 * @param content - Content to checksum
 * @returns Hex-encoded SHA256 hash
 */
export function computeChecksum(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Create a spawn prompt envelope with computed checksum
 *
 * @param wuId - WU ID for the spawn prompt
 * @param content - The spawn prompt content
 * @returns Valid spawn prompt envelope
 */
export function createSpawnPrompt(wuId: string, content: string): SpawnPrompt {
  const checksum = computeChecksum(content);

  return {
    wu_id: wuId,
    version: SPAWN_PROMPT_VERSION,
    checksum,
    content,
    sentinel: SPAWN_SENTINEL,
  };
}

/**
 * Spawn prompt validation result type
 */
export interface SpawnPromptValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a spawn prompt, checking both schema and checksum
 *
 * @param data - Data to validate
 * @returns Validation result with error message if invalid
 */
export function validateSpawnPrompt(data: unknown): SpawnPromptValidationResult {
  // First, validate schema
  const schemaResult = SpawnPromptSchema.safeParse(data);

  if (!schemaResult.success) {
    // Zod v4: use schemaResult.error.issues instead of .errors
    const errorMessages = schemaResult.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ');
    return {
      valid: false,
      error: `Schema validation failed: ${errorMessages}`,
    };
  }

  // Then, validate checksum matches content
  const prompt = schemaResult.data;
  const computedChecksum = computeChecksum(prompt.content);

  if (computedChecksum !== prompt.checksum) {
    return {
      valid: false,
      error: `Checksum mismatch: expected ${prompt.checksum}, computed ${computedChecksum}. Content may be corrupted or truncated.`,
    };
  }

  return { valid: true };
}

/**
 * Parse result type
 */
export interface ParseResult {
  success: boolean;
  data?: SpawnPrompt;
  error?: string;
}

/**
 * Parse a YAML spawn prompt string
 *
 * This function handles:
 * 1. YAML parsing (head/tail truncation breaks parse)
 * 2. Schema validation
 * 3. Checksum validation (detects content corruption)
 *
 * @param yamlString - YAML string to parse
 * @returns Parse result with data or error
 */
export function parseSpawnPrompt(yamlString: string): ParseResult {
  // Step 1: Parse YAML
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlString);
  } catch (e) {
    return {
      success: false,
      error: `YAML parse failed: ${e instanceof Error ? e.message : 'Unknown error'}. Output may be truncated.`,
    };
  }

  // Step 2: Validate schema and checksum
  const validationResult = validateSpawnPrompt(parsed);

  if (!validationResult.valid) {
    return {
      success: false,
      error: validationResult.error,
    };
  }

  // Safe cast since validation passed
  return {
    success: true,
    data: parsed as SpawnPrompt,
  };
}

/**
 * Serialize a spawn prompt to YAML format
 *
 * @param prompt - Spawn prompt to serialize
 * @returns YAML string
 */
export function serializeSpawnPrompt(prompt: SpawnPrompt): string {
  return stringifyYaml(prompt, {
    lineWidth: 0, // Don't wrap lines
  });
}

/**
 * Quick validation check for truncated output
 *
 * This is a fast check that can be used before full parsing:
 * - Checks if sentinel appears at the end of the string
 * - Does not validate checksum (use parseSpawnPrompt for full validation)
 *
 * @param yamlString - String to check
 * @returns true if sentinel found near end, false otherwise
 */
export function checkSentinel(yamlString: string): boolean {
  const trimmed = yamlString.trim();
  return trimmed.endsWith(SPAWN_SENTINEL) || trimmed.includes(`sentinel: ${SPAWN_SENTINEL}`);
}

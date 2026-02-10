/**
 * Template Loader (WU-1253)
 *
 * Loads, parses, and assembles prompt templates from .lumenflow/templates/
 * with YAML frontmatter support. Enables extraction of hardcoded templates
 * from wu-spawn.ts into maintainable markdown files.
 *
 * Features:
 * - YAML frontmatter parsing via gray-matter
 * - Manifest-driven assembly order
 * - Client-specific overrides (templates.claude/, templates.cursor/)
 * - Token replacement ({WU_ID}, {LANE}, etc.)
 * - Conditional template inclusion
 *
 * @see {@link https://lumenflow.dev/reference/template-system/} - Template documentation
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import yaml from 'yaml';
import { createError, ErrorCodes } from './error-handler.js';
import { LUMENFLOW_PATHS } from './wu-constants.js';

/**
 * Template frontmatter parsed from YAML.
 * All templates must include these fields in their frontmatter block.
 */
export interface TemplateFrontmatter {
  /** Unique identifier matching manifest entry (e.g., 'tdd-directive') */
  id: string;
  /** Human-readable name for debugging and documentation */
  name: string;
  /** Whether this template must be present for assembly to succeed */
  required: boolean;
  /** Assembly position - lower numbers appear first in output */
  order: number;
  /** Token names for replacement (e.g., ['WU_ID', 'LANE']) */
  tokens?: string[];
  /** Conditional expression for inclusion (e.g., "type === 'feature'") */
  condition?: string;
}

/**
 * Loaded template with content and metadata.
 * Returned by loadTemplate() after parsing.
 */
export interface LoadedTemplate {
  /** Parsed frontmatter fields */
  frontmatter: TemplateFrontmatter;
  /** Markdown content after frontmatter block */
  content: string;
  /** Original file path for debugging */
  sourcePath: string;
}

/**
 * Manifest entry defining a template's inclusion in assembly.
 */
export interface ManifestEntry {
  /** Template identifier matching frontmatter id */
  id: string;
  /** Relative path within templates/spawn-prompt/ */
  path: string;
  /** Must be present for assembly to succeed */
  required: boolean;
  /** Assembly position (ascending order) */
  order: number;
  /** Optional condition expression */
  condition?: string;
}

/**
 * Complete manifest structure parsed from manifest.yaml.
 */
export interface TemplateManifest {
  /** Manifest format version */
  version: string;
  /** Default settings for template processing */
  defaults: {
    /** Token format: '{TOKEN}' or '{{TOKEN}}' */
    tokenFormat: string;
  };
  /** Ordered list of template entries */
  templates: ManifestEntry[];
}

/**
 * Context for token replacement during assembly.
 * Values are substituted for {TOKEN} placeholders.
 */
export interface TemplateContext {
  /** Work Unit identifier (e.g., 'WU-1253') */
  WU_ID: string;
  /** Lane name (e.g., 'Framework: Core') */
  LANE: string;
  /** WU type (e.g., 'feature', 'bug', 'documentation') */
  TYPE: string;
  /** Optional WU title */
  TITLE?: string;
  /** Optional WU description */
  DESCRIPTION?: string;
  /** Optional worktree path */
  WORKTREE_PATH?: string;
  /** Optional parent lane extracted from LANE */
  laneParent?: string;
  /** Allow additional context properties */
  [key: string]: string | undefined;
}

/** WU-1430: Use centralized constants for template paths */
const MANIFEST_PATH = LUMENFLOW_PATHS.TEMPLATE_MANIFEST;
const TEMPLATES_DIR = LUMENFLOW_PATHS.SPAWN_PROMPT_DIR;

/**
 * Validate a template entry from the manifest.
 * @throws If entry is missing required fields
 */
function validateTemplateEntry(
  entry: unknown,
  manifestPath: string,
): asserts entry is { id: string; path: string; required: boolean; order: number } {
  if (!entry || typeof entry !== 'object') {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      `manifest.yaml: Each template entry must be an object`,
      { path: manifestPath },
    );
  }

  const templateEntry = entry as Record<string, unknown>;
  const missingFields: string[] = [];

  if (!templateEntry.id) missingFields.push('id');
  if (!templateEntry.path) missingFields.push('path');
  if (typeof templateEntry.required !== 'boolean') missingFields.push('required');
  if (typeof templateEntry.order !== 'number') missingFields.push('order');

  if (missingFields.length > 0) {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      `manifest.yaml: Template entry '${templateEntry.id || 'unknown'}' is missing required fields: ${missingFields.join(', ')}`,
      { path: manifestPath, entry: templateEntry },
    );
  }
}

/**
 * Load and parse the template manifest.
 *
 * @param baseDir - Project root directory containing .lumenflow/
 * @returns Parsed manifest with validated structure
 * @throws If manifest is missing or has invalid structure
 */
export function loadManifest(baseDir: string): TemplateManifest {
  const manifestPath = join(baseDir, MANIFEST_PATH);

  if (!existsSync(manifestPath)) {
    throw createError(
      ErrorCodes.FILE_NOT_FOUND,
      `Template manifest.yaml not found at ${manifestPath}. ` +
        `Create .lumenflow/templates/manifest.yaml to define template assembly order.`,
      { path: manifestPath },
    );
  }

  const content = readFileSync(manifestPath, 'utf-8');

  let parsed: unknown;
  try {
    parsed = yaml.parse(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw createError(ErrorCodes.YAML_PARSE_ERROR, `Failed to parse manifest.yaml: ${message}`, {
      path: manifestPath,
      originalError: message,
    });
  }

  // Validate manifest structure
  if (!parsed || typeof parsed !== 'object') {
    throw createError(ErrorCodes.VALIDATION_ERROR, `manifest.yaml must be a valid YAML object`, {
      path: manifestPath,
    });
  }

  const manifest = parsed as Record<string, unknown>;

  if (!manifest.version || typeof manifest.version !== 'string') {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      `manifest.yaml: 'version' field is required and must be a string`,
      { path: manifestPath },
    );
  }

  if (!Array.isArray(manifest.templates)) {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      `manifest.yaml: 'templates' field is required and must be an array`,
      { path: manifestPath },
    );
  }

  // Validate each template entry using extracted helper
  for (const entry of manifest.templates) {
    validateTemplateEntry(entry, manifestPath);
  }

  // Build validated manifest
  const defaults = (manifest.defaults as Record<string, unknown>) || {};

  return {
    version: manifest.version as string,
    defaults: {
      tokenFormat: (defaults.tokenFormat as string) || '{TOKEN}',
    },
    templates: manifest.templates.map((entry) => {
      const e = entry as Record<string, unknown>;
      return {
        id: e.id as string,
        path: e.path as string,
        required: e.required as boolean,
        order: e.order as number,
        condition: e.condition as string | undefined,
      };
    }),
  };
}

/**
 * Load a single template file with frontmatter parsing.
 *
 * Uses gray-matter with the yaml engine for robust parsing,
 * matching the pattern established in backlog-parser.ts.
 *
 * @param templatePath - Absolute path to template file
 * @returns Parsed template with frontmatter and content
 * @throws If file is missing or frontmatter is invalid
 */
export function loadTemplate(templatePath: string): LoadedTemplate {
  if (!existsSync(templatePath)) {
    throw createError(ErrorCodes.FILE_NOT_FOUND, `Template not found: ${templatePath}`, {
      path: templatePath,
    });
  }

  const fileContent = readFileSync(templatePath, 'utf-8');

  // Parse frontmatter using gray-matter with modern yaml engine
  // Pattern from backlog-parser.ts (WU-1065)
  const { data, content } = matter(fileContent, {
    engines: {
      yaml: {
        parse: yaml.parse.bind(yaml),
        stringify: yaml.stringify.bind(yaml),
      },
    },
  });

  // Validate required frontmatter fields
  const frontmatter = data as Record<string, unknown>;

  if (!frontmatter.id || typeof frontmatter.id !== 'string') {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      `Template ${templatePath}: 'id' field is required in frontmatter`,
      { path: templatePath },
    );
  }

  if (!frontmatter.name || typeof frontmatter.name !== 'string') {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      `Template ${templatePath}: 'name' field is required in frontmatter`,
      { path: templatePath },
    );
  }

  if (typeof frontmatter.required !== 'boolean') {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      `Template ${templatePath}: 'required' field must be a boolean`,
      { path: templatePath },
    );
  }

  if (typeof frontmatter.order !== 'number') {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      `Template ${templatePath}: 'order' field must be a number`,
      { path: templatePath },
    );
  }

  return {
    frontmatter: {
      id: frontmatter.id as string,
      name: frontmatter.name as string,
      required: frontmatter.required as boolean,
      order: frontmatter.order as number,
      tokens: Array.isArray(frontmatter.tokens) ? (frontmatter.tokens as string[]) : undefined,
      condition: typeof frontmatter.condition === 'string' ? frontmatter.condition : undefined,
    },
    content: content.trim(),
    sourcePath: templatePath,
  };
}

/**
 * Load all templates from a directory, respecting client overrides.
 *
 * Override resolution order:
 * 1. .lumenflow/templates.{client}/spawn-prompt/{template}.md (highest priority)
 * 2. .lumenflow/templates/spawn-prompt/{template}.md (fallback)
 *
 * @param baseDir - Project root directory
 * @param clientName - Client name for overrides (e.g., 'claude', 'cursor')
 * @returns Map of template id to loaded template
 */
export function loadTemplatesWithOverrides(
  baseDir: string,
  clientName: string,
): Map<string, LoadedTemplate> {
  const templates = new Map<string, LoadedTemplate>();
  const baseTemplatesDir = join(baseDir, TEMPLATES_DIR);
  // WU-1430: Construct client templates path from constants
  const clientTemplatesDir = join(
    baseDir,
    `${LUMENFLOW_PATHS.BASE}/templates.${clientName}/spawn-prompt`,
  );

  // Load base templates first
  if (existsSync(baseTemplatesDir)) {
    loadTemplatesFromDir(baseTemplatesDir, templates);
  }

  // Override with client-specific templates
  if (existsSync(clientTemplatesDir)) {
    loadTemplatesFromDir(clientTemplatesDir, templates);
  }

  return templates;
}

/**
 * Load all templates from a directory into the provided map.
 * Templates are keyed by their frontmatter id.
 */
function loadTemplatesFromDir(dirPath: string, templates: Map<string, LoadedTemplate>): void {
  const entries = readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // Recursively load from subdirectories (e.g., lane-guidance/)
      loadTemplatesFromDir(fullPath, templates);
    } else if (entry.name.endsWith('.md')) {
      try {
        const template = loadTemplate(fullPath);
        templates.set(template.frontmatter.id, template);
      } catch {
        // Silently skip templates that fail to load (intentional - optional templates)
      }
    }
  }
}

/**
 * Normalize context for condition evaluation.
 *
 * Adds lowercase aliases for common fields so conditions can use
 * natural syntax like `type === 'feature'` instead of `TYPE === 'feature'`.
 *
 * Token replacement still uses uppercase keys (WU_ID, LANE).
 */
function normalizeContextForConditions(context: TemplateContext): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...context };

  // Add lowercase aliases for condition evaluation
  if (context.TYPE !== undefined) normalized.type = context.TYPE;
  if (context.LANE !== undefined) normalized.lane = context.LANE;
  if (context.WU_ID !== undefined) normalized.wuId = context.WU_ID;
  if (context.TITLE !== undefined) normalized.title = context.TITLE;
  if (context.DESCRIPTION !== undefined) normalized.description = context.DESCRIPTION;
  if (context.WORKTREE_PATH !== undefined) normalized.worktreePath = context.WORKTREE_PATH;

  return normalized;
}

/**
 * Assemble templates in manifest order with token replacement.
 *
 * @param templates - Map of loaded templates by id
 * @param manifest - Manifest defining assembly order
 * @param context - Token values for replacement
 * @returns Assembled content with all tokens replaced
 * @throws If required template is missing
 */
export function assembleTemplates(
  templates: Map<string, LoadedTemplate>,
  manifest: TemplateManifest,
  context: TemplateContext,
): string {
  // Sort manifest entries by order (ascending)
  const sortedEntries = [...manifest.templates].sort((a, b) => a.order - b.order);

  // Normalize context for condition evaluation (add lowercase aliases)
  // Conditions use lowercase (type, lane) while tokens use uppercase (WU_ID, LANE)
  const conditionContext = normalizeContextForConditions(context);

  const sections: string[] = [];

  for (const entry of sortedEntries) {
    const template = templates.get(entry.id);

    // Handle missing templates
    if (!template) {
      if (entry.required) {
        throw createError(
          ErrorCodes.VALIDATION_ERROR,
          `Required template '${entry.id}' is missing. ` + `Expected at: ${entry.path}`,
          { templateId: entry.id, path: entry.path },
        );
      }
      // Skip optional missing templates
      continue;
    }

    // Evaluate condition if present (using normalized context)
    const condition = entry.condition || template.frontmatter.condition;
    if (condition && !evaluateCondition(condition, conditionContext)) {
      continue;
    }

    // Replace tokens and add to output
    const content = replaceTokens(template.content, context);
    sections.push(content);
  }

  return sections.join('\n\n');
}

/**
 * Replace {TOKEN} placeholders with context values.
 *
 * @param content - Template content with placeholders
 * @param tokens - Token name to value mapping
 * @returns Content with tokens replaced
 */
export function replaceTokens(content: string, tokens: Record<string, string | undefined>): string {
  let result = content;

  for (const [key, value] of Object.entries(tokens)) {
    if (value !== undefined) {
      // Use global replace with escaped regex for safety
      // eslint-disable-next-line security/detect-non-literal-regexp -- key is from internal token map, not user input
      const pattern = new RegExp(`\\{${escapeRegex(key)}\\}`, 'g');
      result = result.replace(pattern, value);
    }
  }

  return result;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Get a value from a nested path in an object.
 * Supports both flat keys (e.g., 'type') and dotted paths (e.g., 'policy.testing').
 *
 * @param obj - Object to get value from
 * @param path - Key path (may contain dots for nested access)
 * @returns Value at path, or undefined if not found
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  // First try direct key lookup (for keys like 'policy.testing' stored as flat keys)
  if (path in obj) {
    return obj[path];
  }

  // Then try nested path traversal
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Evaluate a simple condition expression against context.
 *
 * Supports:
 * - Equality: type === 'feature'
 * - Inequality: type !== 'documentation'
 * - Truthy: worktreePath
 * - AND: type === 'feature' && lane === 'Core'
 * - OR: type === 'feature' || type === 'bug'
 * - Dotted paths: policy.testing === 'tdd' (WU-1260)
 *
 * @param condition - Condition expression string
 * @param context - Context values for evaluation
 * @returns Whether condition evaluates to true
 */
export function evaluateCondition(
  condition: string | undefined,
  context: Record<string, unknown>,
): boolean {
  // Empty/undefined conditions always pass
  if (!condition || condition.trim() === '') {
    return true;
  }

  // Handle OR conditions first (lower precedence)
  if (condition.includes('||')) {
    const parts = condition.split('||').map((p) => p.trim());
    return parts.some((part) => evaluateCondition(part, context));
  }

  // Handle AND conditions
  if (condition.includes('&&')) {
    const parts = condition.split('&&').map((p) => p.trim());
    return parts.every((part) => evaluateCondition(part, context));
  }

  // Handle equality: key === 'value' (supports dotted paths like policy.testing)
  const eqRegex = /^([\w.]+)\s*===\s*['"](.+)['"]$/;
  const eqMatch = eqRegex.exec(condition);
  if (eqMatch) {
    const [, key, value] = eqMatch;
    return getNestedValue(context, key) === value;
  }

  // Handle inequality: key !== 'value' (supports dotted paths like policy.testing)
  const neqRegex = /^([\w.]+)\s*!==\s*['"](.+)['"]$/;
  const neqMatch = neqRegex.exec(condition);
  if (neqMatch) {
    const [, key, value] = neqMatch;
    return getNestedValue(context, key) !== value;
  }

  // Handle truthy check: key (supports dotted paths)
  const truthyRegex = /^([\w.]+)$/;
  const truthyMatch = truthyRegex.exec(condition);
  if (truthyMatch) {
    const key = truthyMatch[1];
    return Boolean(getNestedValue(context, key));
  }

  // Unknown condition format - pass by default
  return true;
}

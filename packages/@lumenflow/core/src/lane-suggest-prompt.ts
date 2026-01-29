/**
 * Lane Suggestion Prompt Module (WU-1189)
 *
 * Generates prompts for LLM-driven lane suggestions based on codebase context.
 * This module gathers project context and generates structured prompts for
 * the LLM to analyze and suggest appropriate lane definitions.
 *
 * Design decisions:
 * - Uses LLM for semantic understanding (not hardcoded heuristics)
 * - Gathers context from docs, structure, and existing config
 * - Returns structured JSON for easy parsing
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';

/**
 * Schema for a single lane suggestion from the LLM
 */
export const LaneSuggestionSchema = z.object({
  lane: z.string().describe('Lane name in "Parent: Sublane" format'),
  description: z.string().describe('Brief description of what this lane covers'),
  rationale: z.string().describe('Why this lane was suggested based on the codebase'),
  code_paths: z.array(z.string()).describe('Glob patterns for files in this lane'),
  keywords: z.array(z.string()).describe('Keywords that indicate work belongs to this lane'),
});

export type LaneSuggestion = z.infer<typeof LaneSuggestionSchema>;

/**
 * Schema for the complete LLM response
 */
export const LaneSuggestResponseSchema = z.object({
  suggestions: z.array(LaneSuggestionSchema),
});

export type LaneSuggestResponse = z.infer<typeof LaneSuggestResponseSchema>;

/**
 * Project context gathered for LLM analysis
 */
export interface ProjectContext {
  /** Names of packages found (for monorepos) */
  packageNames: string[];
  /** Top-level directory structure */
  directoryStructure: string[];
  /** Content of README.md if present */
  readme: string | null;
  /** Content of package.json if present */
  packageJson: {
    name?: string;
    description?: string;
    workspaces?: string[];
  } | null;
  /** Existing lane definitions if any */
  existingLanes: string[];
  /** Whether docs directory exists */
  hasDocsDir: boolean;
  /** Whether apps directory exists (common in monorepos) */
  hasAppsDir: boolean;
  /** Whether packages directory exists (monorepo indicator) */
  hasPackagesDir: boolean;
  /** Whether it's a monorepo */
  isMonorepo: boolean;
}

/**
 * Result of lane suggestion including suggestions and metadata
 */
export interface LaneSuggestResult {
  suggestions: LaneSuggestion[];
  context: {
    packageCount: number;
    docsFound: boolean;
    existingConfig: boolean;
  };
}

/**
 * Read directory structure from project root
 */
function readDirectoryStructure(projectRoot: string): string[] {
  try {
    const entries = readdirSync(projectRoot, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => !name.startsWith('.') && name !== 'node_modules');
  } catch {
    return [];
  }
}

/**
 * Read README.md content
 */
function readReadme(projectRoot: string): string | null {
  const readmePath = path.join(projectRoot, 'README.md');
  if (!existsSync(readmePath)) return null;

  try {
    return readFileSync(readmePath, 'utf-8').slice(0, 2000);
  } catch {
    return null;
  }
}

/**
 * Read package.json and detect monorepo
 */
function readPackageJson(projectRoot: string): {
  packageJson: ProjectContext['packageJson'];
  isMonorepo: boolean;
} {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return { packageJson: null, isMonorepo: false };
  }

  try {
    const content = readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    const hasWorkspaces = !!pkg.workspaces;
    const hasPnpmWorkspace = existsSync(path.join(projectRoot, 'pnpm-workspace.yaml'));

    return {
      packageJson: {
        name: pkg.name,
        description: pkg.description,
        workspaces: pkg.workspaces,
      },
      isMonorepo: hasWorkspaces || hasPnpmWorkspace,
    };
  } catch {
    return { packageJson: null, isMonorepo: false };
  }
}

/**
 * Gather package names from packages/ directory
 */
function gatherPackageNames(projectRoot: string): string[] {
  const packagesDir = path.join(projectRoot, 'packages');
  if (!existsSync(packagesDir)) return [];

  try {
    const packageDirs = readdirSync(packagesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    const names: string[] = [];
    for (const pkgDir of packageDirs) {
      const pkgPath = path.join(packagesDir, pkgDir);

      if (pkgDir.startsWith('@')) {
        // Scoped packages
        const scopePackages = readdirSync(pkgPath, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => `${pkgDir}/${e.name}`);
        names.push(...scopePackages);
      } else if (existsSync(path.join(pkgPath, 'package.json'))) {
        names.push(pkgDir);
      }
    }
    return names;
  } catch {
    return [];
  }
}

/**
 * Read existing lane configuration
 */
function readExistingLanes(projectRoot: string): string[] {
  const laneConfigPath = path.join(projectRoot, '.lumenflow.lane-inference.yaml');
  if (!existsSync(laneConfigPath)) return [];

  try {
    const content = readFileSync(laneConfigPath, 'utf-8');
    const config = YAML.parse(content);
    const lanes: string[] = [];

    for (const [parent, sublanes] of Object.entries(config)) {
      if (typeof sublanes === 'object' && sublanes !== null) {
        for (const sublane of Object.keys(sublanes)) {
          lanes.push(`${parent}: ${sublane}`);
        }
      }
    }
    return lanes;
  } catch {
    return [];
  }
}

/**
 * Gather project context from the filesystem
 */
export function gatherProjectContext(projectRoot: string): ProjectContext {
  const directoryStructure = readDirectoryStructure(projectRoot);
  const { packageJson, isMonorepo: isMonorepoPkg } = readPackageJson(projectRoot);
  const hasPnpmWorkspace = existsSync(path.join(projectRoot, 'pnpm-workspace.yaml'));

  const hasPackagesDir = directoryStructure.includes('packages');

  return {
    directoryStructure,
    hasDocsDir: directoryStructure.includes('docs'),
    hasAppsDir: directoryStructure.includes('apps'),
    hasPackagesDir,
    readme: readReadme(projectRoot),
    packageJson,
    isMonorepo: isMonorepoPkg || hasPnpmWorkspace,
    packageNames: hasPackagesDir ? gatherPackageNames(projectRoot) : [],
    existingLanes: readExistingLanes(projectRoot),
  };
}

/**
 * Generate the system prompt for lane suggestion
 */
export function generateSystemPrompt(): string {
  return `You are an expert software architect helping configure a LumenFlow workflow project.

LumenFlow uses "lanes" to organize work. Each lane has:
- A name in "Parent: Sublane" format (e.g., "Framework: Core", "Operations: CI/CD")
- code_paths: Glob patterns for files that belong to this lane
- keywords: Terms that indicate work belongs to this lane
- description: Brief explanation of what the lane covers

Lane naming conventions:
- Parent categories: Framework, Operations, Content, Experience, Intelligence, Quality
- Sublane names should be specific and descriptive
- Use "/" for sublanes that are further subdivisions (e.g., "Operations: CI/CD")

Your task is to analyze the provided project context and suggest appropriate lane definitions.

Respond with a JSON object containing an array of lane suggestions. Each suggestion must include:
- lane: The lane name in "Parent: Sublane" format
- description: Brief description of what this lane covers
- rationale: Why you're suggesting this lane based on the project structure
- code_paths: Array of glob patterns for files in this lane
- keywords: Array of keywords that indicate work belongs to this lane

Example response:
{
  "suggestions": [
    {
      "lane": "Framework: Core",
      "description": "Core library with shared utilities and base functionality",
      "rationale": "Found packages/core with TypeScript source files and utility modules",
      "code_paths": ["packages/core/**"],
      "keywords": ["core", "utilities", "shared", "base"]
    }
  ]
}`;
}

/**
 * Generate the user prompt with project context
 */
export function generateUserPrompt(context: ProjectContext): string {
  const sections: string[] = [];

  sections.push('# Project Analysis Request\n');
  sections.push('Please analyze this project structure and suggest appropriate LumenFlow lanes.\n');

  // Project type
  sections.push(`## Project Type`);
  sections.push(`- Monorepo: ${context.isMonorepo ? 'Yes' : 'No'}`);
  sections.push(`- Has packages/: ${context.hasPackagesDir ? 'Yes' : 'No'}`);
  sections.push(`- Has apps/: ${context.hasAppsDir ? 'Yes' : 'No'}`);
  sections.push(`- Has docs/: ${context.hasDocsDir ? 'Yes' : 'No'}`);
  sections.push('');

  // Directory structure
  if (context.directoryStructure.length > 0) {
    sections.push('## Top-Level Directories');
    sections.push(context.directoryStructure.map((d) => `- ${d}/`).join('\n'));
    sections.push('');
  }

  // Package names
  if (context.packageNames.length > 0) {
    sections.push('## Packages Found');
    sections.push(context.packageNames.map((p) => `- ${p}`).join('\n'));
    sections.push('');
  }

  // Package.json info
  if (context.packageJson) {
    sections.push('## Package Info');
    if (context.packageJson.name) {
      sections.push(`- Name: ${context.packageJson.name}`);
    }
    if (context.packageJson.description) {
      sections.push(`- Description: ${context.packageJson.description}`);
    }
    sections.push('');
  }

  // README excerpt
  if (context.readme) {
    sections.push('## README Excerpt');
    sections.push('```');
    sections.push(context.readme.slice(0, 1000));
    sections.push('```');
    sections.push('');
  }

  // Existing lanes
  if (context.existingLanes.length > 0) {
    sections.push('## Existing Lanes (for reference)');
    sections.push('The project already has these lanes configured:');
    sections.push(context.existingLanes.map((l) => `- ${l}`).join('\n'));
    sections.push('');
    sections.push('Consider these when making suggestions to maintain consistency.');
    sections.push('');
  }

  sections.push('## Instructions');
  sections.push(
    'Based on this context, suggest lanes that would help organize work on this project.',
  );
  sections.push('Consider:');
  sections.push('- The types of packages/modules present');
  sections.push('- Common development patterns for this project type');
  sections.push('- Standard lanes for documentation, CI/CD, and operations');
  sections.push('');
  sections.push('Respond with JSON only, no markdown code fences or explanation.');

  return sections.join('\n');
}

/**
 * Parse and validate LLM response
 */
export function parseLLMResponse(response: string): LaneSuggestResponse {
  // Try to extract JSON from response (LLMs sometimes add markdown code fences)
  let jsonStr = response.trim();

  // Remove markdown code fences if present
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.slice(7);
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith('```')) {
    jsonStr = jsonStr.slice(0, -3);
  }
  jsonStr = jsonStr.trim();

  // Parse JSON
  const parsed = JSON.parse(jsonStr);

  // Validate with schema
  return LaneSuggestResponseSchema.parse(parsed);
}

/**
 * Validate that a lane name follows the "Parent: Sublane" format
 */
export function isValidLaneFormat(lane: string): boolean {
  // Format: "Parent: Sublane" where both start with uppercase
  return /^[A-Z][a-zA-Z]+: [A-Z][a-zA-Z/]+$/.test(lane);
}

/**
 * Generate a dry-run preview of what would be sent to the LLM
 */
export function generateDryRunPreview(projectRoot: string): {
  context: ProjectContext;
  systemPrompt: string;
  userPrompt: string;
} {
  const context = gatherProjectContext(projectRoot);
  const systemPrompt = generateSystemPrompt();
  const userPrompt = generateUserPrompt(context);

  return {
    context,
    systemPrompt,
    userPrompt,
  };
}

/**
 * Get default lane suggestions for a minimal project
 * Used when LLM is not available or for dry-run
 */
export function getDefaultSuggestions(context: ProjectContext): LaneSuggestion[] {
  const suggestions: LaneSuggestion[] = [];

  // Always suggest documentation lane if docs exist
  if (context.hasDocsDir) {
    suggestions.push({
      lane: 'Content: Documentation',
      description: 'Project documentation and guides',
      rationale: 'Found docs/ directory',
      code_paths: ['docs/**', 'README.md', '*.md'],
      keywords: ['docs', 'documentation', 'readme', 'guide'],
    });
  }

  // Suggest operations lane for CI/CD
  if (context.directoryStructure.some((d) => d === '.github' || d === '.gitlab-ci')) {
    suggestions.push({
      lane: 'Operations: CI/CD',
      description: 'Continuous integration and deployment',
      rationale: 'Found CI/CD configuration directory',
      code_paths: ['.github/**', '.gitlab-ci.yml'],
      keywords: ['ci', 'cd', 'workflow', 'pipeline', 'actions'],
    });
  }

  // For monorepos, suggest lanes based on package names
  if (context.isMonorepo && context.packageNames.length > 0) {
    for (const pkg of context.packageNames) {
      const pkgName = pkg.split('/').pop() || pkg;
      const capitalizedName = pkgName.charAt(0).toUpperCase() + pkgName.slice(1);

      suggestions.push({
        lane: `Framework: ${capitalizedName}`,
        description: `${capitalizedName} package functionality`,
        rationale: `Found package: ${pkg}`,
        code_paths: [`packages/${pkg}/**`],
        keywords: [pkgName.toLowerCase()],
      });
    }
  }

  // Fallback: suggest a core development lane
  if (suggestions.length === 0) {
    suggestions.push({
      lane: 'Development: Core',
      description: 'Main application code',
      rationale: 'Default lane for project source code',
      code_paths: ['src/**', 'lib/**'],
      keywords: ['source', 'core', 'main'],
    });
  }

  return suggestions;
}

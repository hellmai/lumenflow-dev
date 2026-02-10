#!/usr/bin/env npx tsx
/**
 * CLI Documentation Generator
 *
 * Generates MDX documentation from CLI source code.
 * Single source of truth: docs generated from code, not manually maintained.
 *
 * Uses proper imports from built packages - no regex parsing.
 *
 * Usage:
 *   pnpm docs:generate          # Generate all docs
 *   pnpm docs:validate          # Check for drift (exit 1 if out of sync)
 *
 * @module tools/generate-cli-docs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import * as ts from 'typescript';
// Note: Using Zod 4's native .toJSONSchema() instead of zod-to-json-schema library
// which doesn't support Zod 4

// Import from @lumenflow/core via subpath exports (WU-1545)
import {
  WU_OPTIONS,
  WU_CREATE_OPTIONS,
  type WUOption,
  DirectoriesSchema,
  StatePathsSchema,
  GitConfigSchema,
  WuConfigSchema,
  GatesConfigSchema,
  MemoryConfigSchema,
  ProgressSignalsConfigSchema,
  UiConfigSchema,
  YamlConfigSchema,
  MethodologyDefaultsSchema,
  AgentsConfigSchema,
  ClientConfigSchema,
} from '@lumenflow/core';
import { PUBLIC_MANIFEST } from '../packages/@lumenflow/cli/src/public-manifest.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

// ============================================================================
// Types
// ============================================================================

interface CommandMetadata {
  name: string;
  binName: string;
  pnpmCommand: string;
  category: string;
  description: string;
  options: WUOption[];
  required: string[];
}

interface ConfigField {
  name: string;
  type: string;
  default: string;
  description: string;
}

interface ConfigSection {
  name: string;
  description: string;
  fields: ConfigField[];
}

function pickExampleFlag(opt: WUOption): string {
  const parts = opt.flags.split(',').map((part) => part.trim());
  const longFlag = parts.find((part) => part.startsWith('--'));
  return longFlag || parts[0];
}

function buildExampleCommand(cmd: CommandMetadata): string {
  if (!cmd.required.length) {
    return `pnpm ${cmd.pnpmCommand}`;
  }

  const requiredFlags = cmd.required
    .map((name) => cmd.options.find((opt) => opt.name === name))
    .filter(Boolean)
    .map((opt) => pickExampleFlag(opt as WUOption));

  const suffix = requiredFlags.length ? ` ${requiredFlags.join(' ')}` : '';
  return `pnpm ${cmd.pnpmCommand}${suffix}`;
}

// ============================================================================
// WU-1358: AST-based option extraction
//
// Uses TypeScript compiler API to statically extract inline option objects
// (e.g., EDIT_OPTIONS in wu-edit.ts) without runtime execution.
// ============================================================================

/**
 * Extract inline option objects from a TypeScript source file using AST parsing.
 *
 * This function parses TypeScript source code and extracts option definitions
 * from const declarations like:
 *
 *   const EDIT_OPTIONS = {
 *     specFile: { name: 'specFile', flags: '--spec-file <path>', description: '...' },
 *     ...
 *   }
 *
 * WU-1358 requirement: No runtime execution - pure AST/static analysis only.
 *
 * @param srcContent - TypeScript source code content
 * @returns Array of extracted WUOption objects
 */
function extractOptionsFromAST(srcContent: string): WUOption[] {
  const options: WUOption[] = [];

  // Create a source file from the content
  const sourceFile = ts.createSourceFile(
    'temp.ts',
    srcContent,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  // Helper to extract string value from a string literal or template literal
  function getStringValue(node: ts.Node | undefined): string | undefined {
    if (!node) return undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return node.text;
    }
    return undefined;
  }

  // Helper to extract boolean value
  function getBooleanValue(node: ts.Node | undefined): boolean | undefined {
    if (!node) return undefined;
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    return undefined;
  }

  // Helper to extract option properties from an object literal
  function extractOptionFromObject(obj: ts.ObjectLiteralExpression): WUOption | null {
    const option: Partial<WUOption> = {};

    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;

      const propName = prop.name.getText(sourceFile);
      const value = prop.initializer;

      switch (propName) {
        case 'name':
          option.name = getStringValue(value);
          break;
        case 'flags':
          option.flags = getStringValue(value);
          break;
        case 'description':
          option.description = getStringValue(value);
          break;
        case 'isRepeatable':
          option.isRepeatable = getBooleanValue(value);
          break;
        case 'isNegated':
          option.isNegated = getBooleanValue(value);
          break;
      }
    }

    // Validate required fields
    if (option.name && option.flags && option.description) {
      return option as WUOption;
    }
    return null;
  }

  // Visit all nodes to find option object declarations
  function visit(node: ts.Node) {
    // Look for const declarations like: const EDIT_OPTIONS = { ... }
    // or const XXX_OPTIONS = { ... }
    if (ts.isVariableStatement(node) && node.declarationList.declarations.length > 0) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text.endsWith('_OPTIONS') &&
          !decl.name.text.startsWith('WU_') && // Skip WU_OPTIONS - handled via import
          decl.initializer &&
          ts.isObjectLiteralExpression(decl.initializer)
        ) {
          // Found an inline options object like EDIT_OPTIONS
          for (const prop of decl.initializer.properties) {
            if (ts.isPropertyAssignment(prop) && ts.isObjectLiteralExpression(prop.initializer)) {
              const option = extractOptionFromObject(prop.initializer);
              if (option) {
                options.push(option);
              }
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return options;
}

/**
 * Extract option references from createWUParser options array, including
 * both WU_OPTIONS references and inline option object references.
 *
 * Handles patterns like:
 *   options: [
 *     WU_OPTIONS.id,
 *     EDIT_OPTIONS.specFile,
 *     EDIT_OPTIONS.description,
 *   ]
 *
 * @param srcContent - TypeScript source code content
 * @param inlineOptions - Map of inline option objects extracted via AST
 * @returns Array of option names found in the options array
 */
function extractOptionRefsFromAST(
  srcContent: string,
  inlineOptions: WUOption[],
): { wuOptionsRefs: string[]; inlineOptionsRefs: WUOption[] } {
  const wuOptionsRefs: string[] = [];
  const inlineOptionsRefs: WUOption[] = [];

  const sourceFile = ts.createSourceFile(
    'temp.ts',
    srcContent,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  // Build a map of inline options by name for quick lookup
  const inlineOptionsMap = new Map<string, WUOption>();
  for (const opt of inlineOptions) {
    inlineOptionsMap.set(opt.name, opt);
  }

  function visit(node: ts.Node) {
    // Look for createWUParser({ options: [...] })
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'createWUParser' &&
      node.arguments.length > 0 &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const configObj = node.arguments[0] as ts.ObjectLiteralExpression;

      for (const prop of configObj.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          ts.isIdentifier(prop.name) &&
          prop.name.text === 'options' &&
          ts.isArrayLiteralExpression(prop.initializer)
        ) {
          // Found the options array
          for (const element of prop.initializer.elements) {
            if (ts.isPropertyAccessExpression(element)) {
              const objName = element.expression.getText(sourceFile);
              const propName = element.name.getText(sourceFile);

              if (objName === 'WU_OPTIONS' || objName === 'WU_CREATE_OPTIONS') {
                wuOptionsRefs.push(propName);
              } else if (objName.endsWith('_OPTIONS')) {
                // Inline options like EDIT_OPTIONS.specFile
                const inlineOpt = inlineOptionsMap.get(propName);
                if (inlineOpt) {
                  inlineOptionsRefs.push(inlineOpt);
                }
              }
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { wuOptionsRefs, inlineOptionsRefs };
}

// ============================================================================
// Extract command metadata from package.json and source files
// ============================================================================

function extractCommandMetadata(): CommandMetadata[] {
  const cliPackageJson = JSON.parse(
    readFileSync(join(ROOT, 'packages/@lumenflow/cli/package.json'), 'utf-8'),
  );

  const binEntries = cliPackageJson.bin as Record<string, string>;
  const commands: CommandMetadata[] = [];
  const extractedByBin = new Map<
    string,
    { options: WUOption[]; required: string[]; category: string; sourceDescription: string }
  >();

  // Command categories based on prefix
  const categories: Record<string, string> = {
    wu: 'Work Units',
    mem: 'Memory Layer',
    initiative: 'Initiatives',
    agent: 'Agent Lifecycle',
    orchestrate: 'Orchestration',
    spawn: 'Sub-Agents',
    flow: 'Flow Metrics',
    metrics: 'Metrics',
    gates: 'Quality Gates',
    lumenflow: 'Setup',
  };

  const manifestCategoryOverrides: Record<string, string> = {
    'Gates & Quality': 'Quality Gates',
    'Setup & Development': 'Setup',
  };

  // Manual options for commands that do not use createWUParser (Commander-only)
  const manualOptions: Record<string, WUOption[]> = {
    'agent-session': [
      {
        name: 'wu',
        flags: '--wu <wuId>',
        description: 'WU ID to work on (e.g., WU-1234)',
      },
      {
        name: 'tier',
        flags: '--tier <tier>',
        description: 'Context tier (1, 2, or 3)',
      },
      {
        name: 'agentType',
        flags: '--agent-type <type>',
        description: 'Agent type (default: claude-code)',
      },
    ],
    'agent-log-issue': [
      {
        name: 'category',
        flags: '--category <cat>',
        description: 'Issue category (workflow|tooling|confusion|violation|error)',
      },
      {
        name: 'severity',
        flags: '--severity <sev>',
        description: 'Severity level (blocker|major|minor|info)',
      },
      {
        name: 'title',
        flags: '--title <title>',
        description: 'Short description (5-100 chars)',
      },
      {
        name: 'description',
        flags: '--description <desc>',
        description: 'Detailed context (10-2000 chars)',
      },
      {
        name: 'resolution',
        flags: '--resolution <res>',
        description: 'How the issue was resolved',
      },
      {
        name: 'tag',
        flags: '--tag <tag>',
        description: 'Tag for categorization (repeatable)',
      },
      {
        name: 'step',
        flags: '--step <step>',
        description: 'Current workflow step (e.g., wu:done, gates)',
      },
      {
        name: 'file',
        flags: '--file <file>',
        description: 'Related file path (repeatable)',
      },
    ],
  };

  const manualRequired: Record<string, string[]> = {
    'agent-session': ['wu', 'tier'],
    'agent-log-issue': ['category', 'severity', 'title', 'description'],
  };

  function extractFromBin(binName: string, binPath: string) {
    const cached = extractedByBin.get(binName);
    if (cached) return cached;

    // Derive source file path from bin path
    const srcFileName = binPath.replace('./dist/', '').replace('.js', '.ts');
    const srcPath = join(ROOT, 'packages/@lumenflow/cli/src', srcFileName);

    const prefix = binName.split('-')[0];
    const category = categories[prefix] || 'Other';

    let options: WUOption[] = [];
    let required: string[] = [];
    let sourceDescription = `Run ${binName}`;

    if (existsSync(srcPath)) {
      const srcContent = readFileSync(srcPath, 'utf-8');

      // Extract description from createWUParser
      const descMatch = srcContent.match(
        /createWUParser\s*\(\s*\{[\s\S]*?description:\s*['"`]([^'"`]+)['"`]/,
      );
      if (descMatch) {
        sourceDescription = descMatch[1];
      } else {
        // Fall back to JSDoc at top of file
        const jsdocMatch = srcContent.match(/\/\*\*\s*\n\s*\*\s*([^\n*@]+)/);
        if (jsdocMatch) {
          sourceDescription = jsdocMatch[1].trim();
        }
      }

      // WU-1358: Extract inline option objects via AST (e.g., EDIT_OPTIONS)
      const inlineOptions = extractOptionsFromAST(srcContent);

      // WU-1358: Extract option references from createWUParser using AST
      const { wuOptionsRefs, inlineOptionsRefs } = extractOptionRefsFromAST(
        srcContent,
        inlineOptions,
      );

      // Add WU_OPTIONS and WU_CREATE_OPTIONS references
      for (const optName of wuOptionsRefs) {
        if (WU_OPTIONS[optName]) {
          options.push(WU_OPTIONS[optName]);
        } else if (WU_CREATE_OPTIONS[optName]) {
          options.push(WU_CREATE_OPTIONS[optName]);
        }
      }

      // Add inline option references (e.g., EDIT_OPTIONS.specFile)
      options.push(...inlineOptionsRefs);

      // Extract required options
      const requiredMatch = srcContent.match(/required:\s*\[\s*([\s\S]*?)\s*\]/);
      if (requiredMatch) {
        required = requiredMatch[1]
          .split(',')
          .map((s) => s.trim().replace(/['"]/g, ''))
          .filter(Boolean);
      }
    }

    if (manualOptions[binName]) {
      options = manualOptions[binName];
      required = manualRequired[binName] || required;
    }

    const extracted = {
      options,
      required,
      category,
      sourceDescription,
    };
    extractedByBin.set(binName, extracted);
    return extracted;
  }

  for (const manifestCommand of PUBLIC_MANIFEST) {
    const binPath = binEntries[manifestCommand.binName] ?? manifestCommand.binPath;
    const extracted = extractFromBin(manifestCommand.binName, binPath);
    const category =
      manifestCategoryOverrides[manifestCommand.category] ||
      categories[manifestCommand.name.split(':')[0]] ||
      extracted.category;

    commands.push({
      name: manifestCommand.name,
      binName: manifestCommand.binName,
      pnpmCommand: manifestCommand.name,
      category,
      description: manifestCommand.description || extracted.sourceDescription,
      options: extracted.options,
      required: extracted.required,
    });

    // Commander-only commands require explicit option metadata.
    if (manualOptions[manifestCommand.binName]) {
      commands[commands.length - 1].options = manualOptions[manifestCommand.binName];
      commands[commands.length - 1].required =
        manualRequired[manifestCommand.binName] || extracted.required;
    }
  }

  return commands.sort((a, b) => {
    // Sort by category, then by name
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    return a.pnpmCommand.localeCompare(b.pnpmCommand);
  });
}

// ============================================================================
// Extract config schema using Zod 4's native toJSONSchema() method
// ============================================================================

interface ZodSchemaWithJsonSchema {
  toJSONSchema(): Record<string, unknown>;
}

interface SchemaDefinition {
  name: string;
  description: string;
  schema: ZodSchemaWithJsonSchema;
}

const SCHEMA_DEFINITIONS: SchemaDefinition[] = [
  {
    name: 'directories',
    description: 'Directory paths configuration',
    schema: DirectoriesSchema,
  },
  {
    name: 'state',
    description: 'State paths configuration (.lumenflow directory structure)',
    schema: StatePathsSchema,
  },
  {
    name: 'git',
    description: 'Git configuration',
    schema: GitConfigSchema,
  },
  {
    name: 'wu',
    description: 'WU (Work Unit) configuration',
    schema: WuConfigSchema,
  },
  {
    name: 'gates',
    description: 'Quality gates configuration',
    schema: GatesConfigSchema,
  },
  {
    name: 'memory',
    description: 'Memory layer configuration',
    schema: MemoryConfigSchema,
  },
  {
    name: 'memory.progress_signals',
    description: 'Progress signals configuration for sub-agent coordination (WU-1203)',
    schema: ProgressSignalsConfigSchema,
  },
  {
    name: 'ui',
    description: 'UI configuration',
    schema: UiConfigSchema,
  },
  {
    name: 'yaml',
    description: 'YAML serialization configuration',
    schema: YamlConfigSchema,
  },
  {
    name: 'agents',
    description: 'Agents configuration',
    schema: AgentsConfigSchema,
  },
  {
    name: 'agents.methodology',
    description: 'Methodology defaults (agent-facing project defaults)',
    schema: MethodologyDefaultsSchema,
  },
  {
    name: 'agents.clients.*',
    description: 'Client configuration (per-client settings)',
    schema: ClientConfigSchema,
  },
];

function extractConfigSchema(): ConfigSection[] {
  const sections: ConfigSection[] = [];

  for (const { name, description, schema } of SCHEMA_DEFINITIONS) {
    // Use Zod 4's native toJSONSchema() method
    const jsonSchema = schema.toJSONSchema();

    const fields: ConfigField[] = [];

    // Extract properties from JSON schema
    if (jsonSchema && typeof jsonSchema === 'object' && 'properties' in jsonSchema) {
      const properties = jsonSchema.properties as Record<string, unknown>;

      for (const [fieldName, fieldSchema] of Object.entries(properties)) {
        const field = fieldSchema as {
          type?: string;
          default?: unknown;
          description?: string;
          items?: { type?: string };
          enum?: string[];
        };

        // Determine type string
        let typeStr = field.type || 'unknown';
        if (typeStr === 'array' && field.items?.type) {
          typeStr = `${field.items.type}[]`;
        }
        if (field.enum) {
          typeStr = field.enum.map((e) => `"${e}"`).join(' | ');
        }

        // Format default value
        let defaultVal = '-';
        if (field.default !== undefined) {
          if (typeof field.default === 'string') {
            defaultVal = `"${field.default}"`;
          } else if (Array.isArray(field.default)) {
            defaultVal = JSON.stringify(field.default);
          } else {
            defaultVal = String(field.default);
          }
        }

        fields.push({
          name: fieldName,
          type: typeStr,
          default: defaultVal,
          description: field.description || '',
        });
      }
    }

    if (fields.length > 0) {
      sections.push({ name, description, fields });
    }
  }

  return sections;
}

// ============================================================================
// Generate CLI Reference MDX
// ============================================================================

function generateCliMdx(commands: CommandMetadata[]): string {
  const lines: string[] = [
    '---',
    'title: CLI Commands',
    'description: Complete CLI reference for LumenFlow',
    '---',
    '',
    '{/* AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY */}',
    '{/* Run `pnpm docs:generate` to regenerate from source */}',
    '{/* Includes formatting stabilization (WU-1157) */}',
    '',
    "import { Aside, Tabs, TabItem } from '@astrojs/starlight/components';",
    '',
    'LumenFlow provides a comprehensive CLI for managing Work Units, memory, initiatives, and more.',
    '',
    '<Aside type="tip">',
    'All commands can be run via `pnpm command` (e.g., `pnpm wu:claim`).',
    '</Aside>',
    '',
  ];

  // Group commands by category
  const byCategory = new Map<string, CommandMetadata[]>();
  for (const cmd of commands) {
    if (!byCategory.has(cmd.category)) {
      byCategory.set(cmd.category, []);
    }
    byCategory.get(cmd.category)!.push(cmd);
  }

  // Generate table of contents
  lines.push('## Commands Overview', '');
  lines.push('| Category | Commands |');
  lines.push('|----------|----------|');
  for (const [category, cmds] of byCategory) {
    const cmdLinks = cmds
      .map((c) => `[\`${c.pnpmCommand}\`](#${c.pnpmCommand.replace(/:/g, '')})`)
      .join(', ');
    lines.push(`| ${category} | ${cmdLinks} |`);
  }
  lines.push('');

  // Generate command sections
  for (const [category, cmds] of byCategory) {
    lines.push(`## ${category}`, '');

    for (const cmd of cmds) {
      // Note: Auto-generated heading IDs from Starlight will use the heading text
      // Custom {#anchor} syntax breaks MDX parsing
      lines.push(`### ${cmd.pnpmCommand}`, '');
      lines.push(cmd.description, '');

      lines.push('```bash');
      lines.push(buildExampleCommand(cmd));
      lines.push('```');
      lines.push('');

      if (cmd.options.length > 0) {
        lines.push('**Options:**', '');
        lines.push('| Flag | Description | Required |');
        lines.push('|------|-------------|----------|');

        for (const opt of cmd.options) {
          const isRequired = cmd.required.includes(opt.name) ? 'Yes' : 'No';
          // Escape angle brackets for MDX
          const flags = opt.flags.replace(/</g, '&lt;').replace(/>/g, '&gt;');
          lines.push(`| \`${flags}\` | ${opt.description} | ${isRequired} |`);
        }
        lines.push('');
      }
    }
  }

  // Add footer
  lines.push('---', '');
  lines.push('## Next Steps', '');
  lines.push('- [Configuration](/reference/config) – Configure LumenFlow');
  lines.push('- [WU Schema](/reference/wu-schema) – Work Unit YAML structure');
  lines.push('');

  return lines.join('\n');
}

// ============================================================================
// Generate Config Reference MDX
// ============================================================================

function generateConfigMdx(sections: ConfigSection[]): string {
  const lines: string[] = [
    '---',
    'title: Configuration',
    'description: LumenFlow configuration file reference',
    '---',
    '',
    '{/* AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY */}',
    '{/* Run `pnpm docs:generate` to regenerate from source */}',
    '{/* Includes formatting stabilization (WU-1157) */}',
    '',
    'LumenFlow is configured via `.lumenflow.config.yaml` in your project root.',
    '',
    '## Minimal Config',
    '',
    '```yaml',
    "version: '2.0'",
    '',
    'lanes:',
    '  definitions:',
    "    - name: 'Framework: Core'",
    "      code_paths: ['src/**']",
    '',
    'gates:',
    '  format: true',
    '  lint: true',
    '  typecheck: true',
    '  test: true',
    '```',
    '',
    '## Config Sections',
    '',
  ];

  for (const section of sections) {
    lines.push(`### ${section.name}`, '');
    lines.push(section.description, '');
    lines.push('');
    lines.push('| Field | Type | Default | Description |');
    lines.push('|-------|------|---------|-------------|');

    for (const field of section.fields) {
      // Truncate long defaults
      let defaultVal = field.default;
      if (defaultVal.length > 30) {
        defaultVal = defaultVal.slice(0, 27) + '...';
      }
      // Escape pipes in descriptions
      const desc = field.description.replace(/\|/g, '\\|');
      lines.push(`| \`${field.name}\` | ${field.type} | \`${defaultVal}\` | ${desc} |`);
    }
    lines.push('');
  }

  // WU-1356: Add framework agnostic configuration examples
  lines.push('## Framework Agnostic Configuration', '');
  lines.push(
    'LumenFlow supports different package managers and test runners. Configure these at the top level of your config file:',
    '',
  );
  lines.push('');
  lines.push('| Field | Type | Default | Description |');
  lines.push('|-------|------|---------|-------------|');
  lines.push(
    '| `package_manager` | `"pnpm"` \\| `"npm"` \\| `"yarn"` \\| `"bun"` | `"pnpm"` | Package manager for CLI operations |',
  );
  lines.push(
    '| `test_runner` | `"vitest"` \\| `"jest"` \\| `"mocha"` | `"vitest"` | Test runner for incremental test detection |',
  );
  lines.push(
    '| `build_command` | string | `"pnpm --filter @lumenflow/cli build"` | Custom build command for CLI bootstrap |',
  );
  lines.push('');
  lines.push('### Example: npm + Jest', '');
  lines.push('```yaml');
  lines.push("version: '2.0'");
  lines.push('');
  lines.push('# WU-1356: Framework agnostic settings');
  lines.push('package_manager: npm');
  lines.push('test_runner: jest');
  lines.push('build_command: npm run build');
  lines.push('');
  lines.push('gates:');
  lines.push('  commands:');
  lines.push('    test_full: npm test');
  lines.push('    test_docs_only: npm test -- --testPathPattern=docs');
  lines.push('    test_incremental: npm test -- --onlyChanged');
  lines.push('```');
  lines.push('');
  lines.push('### Example: yarn + Nx', '');
  lines.push('```yaml');
  lines.push("version: '2.0'");
  lines.push('');
  lines.push('package_manager: yarn');
  lines.push('test_runner: jest');
  lines.push('build_command: yarn nx build @lumenflow/cli');
  lines.push('');
  lines.push('gates:');
  lines.push('  commands:');
  lines.push('    test_full: yarn nx run-many --target=test --all');
  lines.push('    test_docs_only: yarn nx test docs');
  lines.push('    test_incremental: yarn nx affected --target=test');
  lines.push('```');
  lines.push('');
  lines.push('### Example: bun', '');
  lines.push('```yaml');
  lines.push("version: '2.0'");
  lines.push('');
  lines.push('package_manager: bun');
  lines.push('test_runner: vitest');
  lines.push('build_command: bun run --filter @lumenflow/cli build');
  lines.push('');
  lines.push('gates:');
  lines.push('  commands:');
  lines.push('    test_full: bun test');
  lines.push('    test_incremental: bun test --changed');
  lines.push('```');
  lines.push('');

  // Add environment overrides section
  lines.push('## Environment Overrides', '');
  lines.push('Config values can be overridden via environment variables:', '');
  lines.push('```bash');
  lines.push('LUMENFLOW_MAIN_BRANCH=develop pnpm wu:done --id WU-001');
  lines.push('```');
  lines.push('');
  lines.push('| Variable | Overrides |');
  lines.push('|----------|-----------|');
  lines.push('| `LUMENFLOW_CONFIG` | Config file path |');
  lines.push('| `LUMENFLOW_MAIN_BRANCH` | `git.mainBranch` |');
  lines.push('| `LUMENFLOW_WU_SPECS` | `directories.wuDir` |');
  lines.push('');

  // Add validation section
  lines.push('## Validation', '');
  lines.push('Validate your config:', '');
  lines.push('```bash');
  lines.push('pnpm exec lumenflow validate');
  lines.push('```');
  lines.push('');

  // Footer
  lines.push('---', '');
  lines.push('## Next Steps', '');
  lines.push('- [CLI Commands](/reference/cli) – All commands');
  lines.push('- [WU Schema](/reference/wu-schema) – WU YAML structure');
  lines.push('');

  return lines.join('\n');
}

// ============================================================================
// WU-1371: Generate CLI README.md
// ============================================================================

/**
 * README.md category structure matching the manual README.md format.
 * Maps internal categories to README section names.
 */
const README_CATEGORIES: Record<string, string> = {
  'Work Units': 'Work Unit Management',
  'Memory Layer': 'Memory & Session',
  Initiatives: 'Initiative Orchestration',
  Orchestration: 'Initiative Orchestration',
  'Sub-Agents': 'Initiative Orchestration',
  'Flow Metrics': 'Metrics & Analytics',
  Metrics: 'Metrics & Analytics',
  'Quality Gates': 'Verification & Gates',
  'Agent Lifecycle': 'Memory & Session',
  Setup: 'System & Setup',
  Other: 'System & Setup',
};

/**
 * Generate README.md for the CLI package.
 *
 * The README has static sections (badges, installation, etc.) that are preserved,
 * and a dynamic Commands section that is auto-generated.
 *
 * WU-1371: Single source of truth - commands generated from same data as cli.mdx.
 *
 * @param commands - Command metadata extracted from package.json
 * @returns README.md content string
 */
function generateReadmeMd(commands: CommandMetadata[]): string {
  const lines: string[] = [];

  // Static header section
  lines.push('# @lumenflow/cli');
  lines.push('');
  lines.push(
    '[![npm version](https://img.shields.io/npm/v/@lumenflow/cli.svg)](https://www.npmjs.com/package/@lumenflow/cli)',
  );
  lines.push(
    '[![npm downloads](https://img.shields.io/npm/dm/@lumenflow/cli.svg)](https://www.npmjs.com/package/@lumenflow/cli)',
  );
  lines.push(
    '[![license](https://img.shields.io/npm/l/@lumenflow/cli.svg)](https://github.com/hellmai/os/blob/main/LICENSE)',
  );
  lines.push('[![node](https://img.shields.io/node/v/@lumenflow/cli.svg)](https://nodejs.org)');
  lines.push('');
  lines.push('> Command-line interface for LumenFlow workflow framework');
  lines.push('');

  // Installation section
  lines.push('## Installation');
  lines.push('');
  lines.push('```bash');
  lines.push('npm install @lumenflow/cli');
  lines.push('```');
  lines.push('');

  // Quick Start section
  lines.push('## Quick Start');
  lines.push('');
  lines.push('```bash');
  lines.push('# Install the CLI');
  lines.push('pnpm add -D @lumenflow/cli   # or: npm install -D @lumenflow/cli');
  lines.push('');
  lines.push('# Initialize LumenFlow (works with any AI)');
  lines.push('pnpm exec lumenflow');
  lines.push('');
  lines.push('# Or specify your AI tool for enhanced integration');
  lines.push('pnpm exec lumenflow --client claude    # Claude Code');
  lines.push('pnpm exec lumenflow --client cursor    # Cursor');
  lines.push('pnpm exec lumenflow --client windsurf  # Windsurf');
  lines.push('pnpm exec lumenflow --client cline     # Cline');
  lines.push('pnpm exec lumenflow --client aider     # Aider');
  lines.push('pnpm exec lumenflow --client all       # All integrations');
  lines.push('```');
  lines.push('');
  lines.push(
    'The default `lumenflow` command creates `AGENTS.md` and `LUMENFLOW.md` which work with **any AI coding assistant**. The `--client` flag adds vendor-specific configuration files for deeper integration.',
  );
  lines.push('');
  lines.push(
    'See [AI Integrations](https://lumenflow.dev/guides/ai-integrations) for details on each tool.',
  );
  lines.push('');

  // Overview section
  lines.push('## Overview');
  lines.push('');
  lines.push('This package provides CLI commands for the LumenFlow workflow framework, including:');
  lines.push('');
  lines.push('- **WU (Work Unit) management**: Claim, complete, block, and track work units');
  lines.push('- **Memory layer**: Session tracking, context recovery, and agent coordination');
  lines.push('- **Initiative orchestration**: Multi-phase project coordination');
  lines.push('- **Quality gates**: Pre-merge validation and checks');
  lines.push('');

  // Commands section - AUTO-GENERATED
  lines.push('## Commands');
  lines.push('');
  lines.push('<!-- AUTO-GENERATED SECTION - DO NOT EDIT DIRECTLY -->');
  lines.push('<!-- Run `pnpm docs:generate` to regenerate from source -->');
  lines.push('');

  // Group commands by README category
  const byReadmeCategory = new Map<string, CommandMetadata[]>();
  for (const cmd of commands) {
    const readmeCategory = README_CATEGORIES[cmd.category] || 'System & Setup';
    if (!byReadmeCategory.has(readmeCategory)) {
      byReadmeCategory.set(readmeCategory, []);
    }
    byReadmeCategory.get(readmeCategory)!.push(cmd);
  }

  // Define the category order to match manual README
  const categoryOrder = [
    'Work Unit Management',
    'Memory & Session',
    'Initiative Orchestration',
    'Metrics & Analytics',
    'Lane Tooling',
    'Verification & Gates',
    'System & Setup',
    'File & Git Operations',
  ];

  // Add Lane Tooling category for lane-* commands
  const laneCommands = commands.filter((cmd) => cmd.binName.startsWith('lane-'));
  if (laneCommands.length > 0) {
    byReadmeCategory.set('Lane Tooling', laneCommands);
  }

  // Add File & Git Operations category
  const fileGitCommands = commands.filter(
    (cmd) => cmd.binName.startsWith('file-') || cmd.binName.startsWith('git-'),
  );
  if (fileGitCommands.length > 0) {
    byReadmeCategory.set('File & Git Operations', fileGitCommands);
  }

  // Generate command tables for each category
  for (const category of categoryOrder) {
    const cmds = byReadmeCategory.get(category);
    if (!cmds || cmds.length === 0) continue;

    // Filter out duplicates (commands that appear in multiple categories)
    const uniqueCmds = cmds.filter((cmd, index, self) => {
      // Skip if this command is a lane/file/git command but we're not in that category
      if (category !== 'Lane Tooling' && cmd.binName.startsWith('lane-')) return false;
      if (category !== 'File & Git Operations' && cmd.binName.startsWith('file-')) return false;
      if (category !== 'File & Git Operations' && cmd.binName.startsWith('git-')) return false;
      // Remove duplicates within the category
      return self.findIndex((c) => c.binName === cmd.binName) === index;
    });

    if (uniqueCmds.length === 0) continue;

    lines.push(`### ${category}`);
    lines.push('');
    lines.push('| Command | Description |');
    lines.push('| ------- | ----------- |');

    // Sort commands alphabetically within each category
    const sortedCmds = [...uniqueCmds].sort((a, b) => a.binName.localeCompare(b.binName));

    for (const cmd of sortedCmds) {
      // Use bin name (wu-claim) instead of pnpm command (wu:claim) for README
      const description = cmd.description.replace(/\|/g, '\\|');
      lines.push(`| \`${cmd.binName}\` | ${description} |`);
    }
    lines.push('');
  }

  lines.push('<!-- END AUTO-GENERATED SECTION -->');
  lines.push('');

  // Usage section
  lines.push('## Usage');
  lines.push('');
  lines.push('Commands are typically invoked via pnpm scripts in your project:');
  lines.push('');
  lines.push('```bash');
  lines.push('# WU workflow');
  lines.push('pnpm wu:claim --id WU-123 --lane operations');
  lines.push('pnpm wu:done --id WU-123');
  lines.push('');
  lines.push('# Memory operations');
  lines.push('pnpm mem:checkpoint "Completed port definitions" --wu WU-123');
  lines.push('pnpm mem:inbox --since 10m');
  lines.push('');
  lines.push('# Initiative management');
  lines.push('pnpm initiative:status INIT-007');
  lines.push('');
  lines.push('# Quality gates');
  lines.push('pnpm gates');
  lines.push('```');
  lines.push('');

  // Direct CLI Usage section
  lines.push('### Direct CLI Usage');
  lines.push('');
  lines.push('```bash');
  lines.push('# After installing the package');
  lines.push('npx wu-claim --id WU-123 --lane operations');
  lines.push('npx gates');
  lines.push('```');
  lines.push('');

  // Global Flags section
  lines.push('## Global Flags');
  lines.push('');
  lines.push('All commands support these flags:');
  lines.push('');
  lines.push('| Flag | Description |');
  lines.push('| ---- | ----------- |');
  lines.push('| `--help`, `-h` | Show help for the command |');
  lines.push('| `--version`, `-V` | Show version number |');
  lines.push('| `--no-color` | Disable colored output |');
  lines.push('');

  // Environment Variables section
  lines.push('## Environment Variables');
  lines.push('');
  lines.push('| Variable | Description |');
  lines.push('| -------- | ----------- |');
  lines.push(
    '| `NO_COLOR` | Disable colored output when set (any value, per [no-color.org](https://no-color.org/)) |',
  );
  lines.push(
    '| `FORCE_COLOR` | Override color level: `0` (disabled), `1` (basic), `2` (256 colors), `3` (16m colors) |',
  );
  lines.push('');

  // Integration section
  lines.push('## Integration');
  lines.push('');
  lines.push('The CLI integrates with other LumenFlow packages:');
  lines.push('');
  lines.push('- `@lumenflow/core` - Git operations, worktree management');
  lines.push('- `@lumenflow/memory` - Session and context persistence');
  lines.push('- `@lumenflow/agent` - Agent session management');
  lines.push('- `@lumenflow/initiatives` - Initiative tracking');
  lines.push('');

  // MCP Server Setup section (WU-1413)
  lines.push('## MCP Server Setup (Claude Code)');
  lines.push('');
  lines.push(
    'LumenFlow provides an MCP (Model Context Protocol) server for deep integration with Claude Code.',
  );
  lines.push('');
  lines.push(
    'When you run `lumenflow init --client claude`, a `.mcp.json` is automatically created:',
  );
  lines.push('');
  lines.push('```json');
  lines.push('{');
  lines.push('  "mcpServers": {');
  lines.push('    "lumenflow": {');
  lines.push('      "command": "npx",');
  lines.push('      "args": ["@lumenflow/mcp"]');
  lines.push('    }');
  lines.push('  }');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push(
    'The `@lumenflow/mcp` server provides tools for WU lifecycle, memory coordination, and lane management directly within Claude Code.',
  );
  lines.push('');
  lines.push(
    'See [AI Integrations](https://lumenflow.dev/guides/ai-integrations) for full MCP documentation.',
  );
  lines.push('');

  // Documentation section
  lines.push('## Documentation');
  lines.push('');
  lines.push(
    'For complete documentation, see [lumenflow.dev](https://lumenflow.dev/reference/cli).',
  );
  lines.push('');

  // Upgrading section
  lines.push('## Upgrading');
  lines.push('');
  lines.push('To upgrade LumenFlow packages:');
  lines.push('');
  lines.push('```bash');
  lines.push('# Check for available updates');
  lines.push('pnpm outdated @lumenflow/*');
  lines.push('');
  lines.push('# Update all LumenFlow packages');
  lines.push(
    'pnpm update @lumenflow/cli @lumenflow/core @lumenflow/memory @lumenflow/agent @lumenflow/initiatives',
  );
  lines.push('');
  lines.push('# Sync documentation and templates');
  lines.push('pnpm exec lumenflow docs:sync');
  lines.push('```');
  lines.push('');
  lines.push(
    '**Important**: Always run `docs:sync` after upgrading to update agent onboarding documentation, workflow rules, and vendor-specific configurations.',
  );
  lines.push('');
  lines.push(
    'For detailed upgrade instructions, migration guides, and troubleshooting, see [UPGRADING.md](https://lumenflow.dev/upgrading).',
  );
  lines.push('');

  // License section
  lines.push('## License');
  lines.push('');
  lines.push('Apache-2.0');
  lines.push('');

  return lines.join('\n');
}

// ============================================================================
// Format generated files with Prettier
// ============================================================================

function formatGeneratedFiles(...filePaths: string[]) {
  console.log('🎨 Formatting generated files...');
  try {
    execSync(`npx prettier --write ${filePaths.join(' ')}`, {
      cwd: ROOT,
      stdio: 'pipe',
    });
    for (const path of filePaths) {
      console.log(`   ✅ Formatted: ${path}`);
    }
  } catch (error) {
    console.warn('⚠️  Warning: Prettier formatting failed');
    console.warn('   Generated files may not match project formatting');
    // Don't fail the generation, just warn
  }
}

function formatContent(content: string): string {
  try {
    const result = execSync('npx prettier --stdin --stdin-filepath=.mdx', {
      cwd: ROOT,
      input: content,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return result;
  } catch (error) {
    // If formatting fails, return original content
    return content;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const validateOnly = args.includes('--validate');

  console.log('📚 LumenFlow Documentation Generator\n');
  console.log('   Using library imports (no regex parsing)\n');

  // Extract metadata using proper imports
  console.log('📖 Using WU_OPTIONS from @lumenflow/core...');
  console.log(`   Found ${Object.keys(WU_OPTIONS).length} options\n`);

  console.log('📖 Extracting command metadata from package.json...');
  const commands = extractCommandMetadata();
  console.log(`   Found ${commands.length} commands\n`);

  console.log('📖 Extracting config schema via zod-to-json-schema...');
  const configSections = extractConfigSchema();
  console.log(`   Found ${configSections.length} config sections\n`);

  // Generate MDX
  console.log('📝 Generating CLI reference...');
  const cliMdx = generateCliMdx(commands);

  console.log('📝 Generating config reference...');
  const configMdx = generateConfigMdx(configSections);

  // WU-1371: Generate README.md from same data
  console.log('📝 Generating CLI README.md...');
  const readmeMd = generateReadmeMd(commands);

  // Output paths
  const cliPath = join(ROOT, 'apps/docs/src/content/docs/reference/cli.mdx');
  const configPath = join(ROOT, 'apps/docs/src/content/docs/reference/config.mdx');
  const readmePath = join(ROOT, 'packages/@lumenflow/cli/README.md');

  if (validateOnly) {
    // Format the generated content to match what would be written to files
    const formattedCliMdx = formatContent(cliMdx);
    const formattedConfigMdx = formatContent(configMdx);
    const formattedReadmeMd = formatContent(readmeMd);

    // Compare with existing files
    let hasChanges = false;

    if (existsSync(cliPath)) {
      const existing = readFileSync(cliPath, 'utf-8');
      if (existing !== formattedCliMdx) {
        console.log('❌ CLI docs are out of sync');
        hasChanges = true;
      } else {
        console.log('✅ CLI docs are up to date');
      }
    } else {
      console.log('❌ CLI docs file does not exist');
      hasChanges = true;
    }

    if (existsSync(configPath)) {
      const existing = readFileSync(configPath, 'utf-8');
      if (existing !== formattedConfigMdx) {
        console.log('❌ Config docs are out of sync');
        hasChanges = true;
      } else {
        console.log('✅ Config docs are up to date');
      }
    } else {
      console.log('❌ Config docs file does not exist');
      hasChanges = true;
    }

    // WU-1371: Also check README.md for drift
    if (existsSync(readmePath)) {
      const existing = readFileSync(readmePath, 'utf-8');
      if (existing !== formattedReadmeMd) {
        console.log('❌ README.md is out of sync');
        hasChanges = true;
      } else {
        console.log('✅ README.md is up to date');
      }
    } else {
      console.log('❌ README.md file does not exist');
      hasChanges = true;
    }

    if (hasChanges) {
      console.log('\n⚠️  Documentation drift detected!');
      console.log('   Run `pnpm docs:generate` to update.\n');
      process.exit(1);
    }

    console.log('\n✅ All documentation is up to date\n');
    process.exit(0);
  }

  // Write files
  writeFileSync(cliPath, cliMdx);
  console.log(`   ✅ Written: ${cliPath}`);

  writeFileSync(configPath, configMdx);
  console.log(`   ✅ Written: ${configPath}`);

  // WU-1371: Write README.md
  writeFileSync(readmePath, readmeMd);
  console.log(`   ✅ Written: ${readmePath}`);

  // Format generated files to prevent format:check failures
  formatGeneratedFiles(cliPath, configPath, readmePath);

  console.log('\n✅ Documentation generated successfully\n');
  console.log('Next steps:');
  console.log('  1. Review generated files');
  console.log('  2. Run `pnpm docs:build` to verify');
  console.log('  3. Commit changes');
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});

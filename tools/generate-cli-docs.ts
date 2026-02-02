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
// Note: Using Zod 4's native .toJSONSchema() instead of zod-to-json-schema library
// which doesn't support Zod 4

// Import directly from built packages - no regex parsing needed
// Use relative path to the built dist folder for workspace compatibility
import {
  WU_OPTIONS,
  WU_CREATE_OPTIONS,
  type WUOption,
  DirectoriesSchema,
  BeaconPathsSchema,
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
} from '../packages/@lumenflow/core/dist/index.js';

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
// Extract command metadata from package.json and source files
// ============================================================================

function extractCommandMetadata(): CommandMetadata[] {
  const cliPackageJson = JSON.parse(
    readFileSync(join(ROOT, 'packages/@lumenflow/cli/package.json'), 'utf-8'),
  );

  const binEntries = cliPackageJson.bin as Record<string, string>;
  const commands: CommandMetadata[] = [];

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

  // Manual descriptions for commands - these are authoritative
  const manualDescriptions: Record<string, string> = {
    gates: 'Run quality gates (format, lint, typecheck, test)',
    'lumenflow-init': 'Initialize LumenFlow in a project',
    lumenflow: 'Initialize LumenFlow in a project',
    'agent-session': 'Start an agent session for a WU',
    'agent-session-end': 'End an agent session',
    'agent-log-issue': 'Log an issue encountered during agent work',
    'agent-issues-query': 'Query logged issues from agent sessions',
    'flow-report': 'Generate DORA metrics flow report',
    'flow-bottlenecks': 'Identify workflow bottlenecks and critical path',
    'metrics-snapshot': 'Capture current metrics snapshot for dashboards',
    'spawn-list': 'List spawned sub-agents and their status',
    'orchestrate-initiative': 'Orchestrate initiative execution with agents',
    'orchestrate-init-status': 'Show initiative orchestration status',
    'orchestrate-monitor': 'Monitor spawned agent progress and signals',
    'lumenflow-docs-sync':
      'Sync agent onboarding docs to existing projects (skips existing files by default, use --force to overwrite)',
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

  for (const [binName, binPath] of Object.entries(binEntries)) {
    // Skip aliases
    if (binName === 'lumenflow-gates') continue;

    // Derive source file path
    const srcFileName = binPath.replace('./dist/', '').replace('.js', '.ts');
    const srcPath = join(ROOT, 'packages/@lumenflow/cli/src', srcFileName);

    // Determine category
    const prefix = binName.split('-')[0];
    const category = categories[prefix] || 'Other';

    // Convert bin name to pnpm command (wu-claim -> wu:claim, agent-issues-query -> agent:issues-query)
    const pnpmCommand = binName.replace('-', ':');

    // Try to extract options from source file
    let options: WUOption[] = [];
    let required: string[] = [];
    let description = manualDescriptions[binName] || `Run ${pnpmCommand}`;

    if (existsSync(srcPath)) {
      const srcContent = readFileSync(srcPath, 'utf-8');

      // Extract description from createWUParser
      const descMatch = srcContent.match(
        /createWUParser\s*\(\s*\{[\s\S]*?description:\s*['"`]([^'"`]+)['"`]/,
      );
      if (descMatch) {
        description = descMatch[1];
      } else if (!manualDescriptions[binName]) {
        // Fall back to JSDoc at top of file
        const jsdocMatch = srcContent.match(/\/\*\*\s*\n\s*\*\s*([^\n*@]+)/);
        if (jsdocMatch) {
          description = jsdocMatch[1].trim();
        }
      }

      // Extract options array - look for WU_OPTIONS / WU_CREATE_OPTIONS references
      const optionsMatch = srcContent.match(/options:\s*\[\s*([\s\S]*?)\s*\]\s*,/);
      if (optionsMatch) {
        const optionRefs = [
          ...(optionsMatch[1].match(/WU_OPTIONS\.(\w+)/g) || []),
          ...(optionsMatch[1].match(/WU_CREATE_OPTIONS\.(\w+)/g) || []),
        ];
        for (const ref of optionRefs) {
          if (ref.startsWith('WU_OPTIONS.')) {
            const optName = ref.replace('WU_OPTIONS.', '');
            if (WU_OPTIONS[optName]) {
              options.push(WU_OPTIONS[optName]);
            }
          } else if (ref.startsWith('WU_CREATE_OPTIONS.')) {
            const optName = ref.replace('WU_CREATE_OPTIONS.', '');
            if (WU_CREATE_OPTIONS[optName]) {
              options.push(WU_CREATE_OPTIONS[optName]);
            }
          }
        }
      }

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

    commands.push({
      name: binName,
      binName,
      pnpmCommand,
      category,
      description,
      options,
      required,
    });
  }

  return commands.sort((a, b) => {
    // Sort by category, then by name
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    return a.name.localeCompare(b.name);
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
    name: 'beacon',
    description: 'Beacon paths configuration (.beacon directory structure)',
    schema: BeaconPathsSchema,
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

  // Output paths
  const cliPath = join(ROOT, 'apps/docs/src/content/docs/reference/cli.mdx');
  const configPath = join(ROOT, 'apps/docs/src/content/docs/reference/config.mdx');

  if (validateOnly) {
    // Format the generated content to match what would be written to files
    const formattedCliMdx = formatContent(cliMdx);
    const formattedConfigMdx = formatContent(configMdx);

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

  // Format generated files to prevent format:check failures
  formatGeneratedFiles(cliPath, configPath);

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

/**
 * @file init.ts
 * LumenFlow project scaffolding command (WU-1045)
 * WU-1006: Library-First - use core defaults for config generation
 * WU-1028: Vendor-agnostic core + vendor overlays
 * WU-1085: Added createWUParser for proper --help support
 * WU-1171: Added --merge mode, --client flag, AGENTS.md, updated vendor paths
 * WU-1362: Added branch guard to check branch before writing tracked files
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getDefaultConfig, createWUParser, WU_OPTIONS, CLAUDE_HOOKS } from '@lumenflow/core';
// WU-1067: Import GATE_PRESETS for --preset support
import { GATE_PRESETS } from '@lumenflow/core/gates-config';
// WU-1171: Import merge block utilities
import { updateMergeBlock } from './merge-block.js';
// WU-1362: Import worktree guard utilities for branch checking
import { isMainBranch, isInWorktree } from '@lumenflow/core/core/worktree-guard';
// WU-1386: Import doctor for auto-run after init
import { runDoctorForInit } from './doctor.js';
// WU-1505: Use shared SessionStart hook generator (vendor wrappers stay thin)
import { generateSessionStartRecoveryScript } from './hooks/enforcement-generator.js';
// WU-1576: Import integrate to fold enforcement hooks into init for Claude
import { integrateClaudeCode } from './commands/integrate.js';
// WU-1433: Import public manifest to derive scripts (no hardcoded subset)
import { getPublicManifest } from './public-manifest.js';
import { runCLI } from './cli-entry-point.js';

/**
 * WU-1085: CLI option definitions for init command
 * WU-1171: Added --merge and --client options
 */
const INIT_OPTIONS = {
  full: {
    name: 'full',
    flags: '--full',
    description: 'Add docs + agent onboarding + task scaffolding (default: true)',
  },
  minimal: {
    name: 'minimal',
    flags: '--minimal',
    description: 'Skip agent onboarding docs (only core files)',
  },
  framework: {
    name: 'framework',
    flags: '--framework <name>',
    description: 'Add framework hint + overlay docs',
  },
  // WU-1171: --client is the new primary flag (wu:spawn vocabulary)
  client: {
    name: 'client',
    flags: '--client <type>',
    description: 'Client type (claude, cursor, windsurf, codex, all, none)',
  },
  // WU-1171: --vendor kept as backward-compatible alias
  vendor: {
    name: 'vendor',
    flags: '--vendor <type>',
    description: 'Alias for --client (deprecated)',
  },
  // WU-1171: --merge mode for safe insertion into existing files
  merge: {
    name: 'merge',
    flags: '--merge',
    description: 'Merge LumenFlow config into existing files using bounded markers',
  },
  preset: {
    name: 'preset',
    flags: '--preset <preset>',
    description: 'Gate preset for config (node, python, go, rust, dotnet)',
  },
  force: WU_OPTIONS.force,
};

/**
 * WU-1085: Parse init command options using createWUParser
 * WU-1171: Added --merge, --client options
 * Provides proper --help, --version, and option parsing
 */
export function parseInitOptions(): {
  force: boolean;
  full: boolean;
  merge: boolean;
  framework?: string;
  client?: ClientType;
  vendor?: ClientType; // Alias for backwards compatibility
  preset?: GatePresetType;
} {
  // WU-1378: Description includes subcommand hint
  const opts = createWUParser({
    name: 'lumenflow-init',
    description:
      'Initialize LumenFlow in a project\n\n' +
      'Subcommands:\n' +
      '  lumenflow commands    List all available CLI commands',
    options: Object.values(INIT_OPTIONS),
  });

  // WU-1171: --client takes precedence, --vendor is alias
  const clientValue = opts.client || opts.vendor;

  // WU-1286: --full is now the default (true), use --minimal to disable
  // --minimal explicitly sets full to false, otherwise full defaults to true
  const fullMode = opts.minimal ? false : (opts.full ?? true);

  return {
    force: opts.force ?? false,
    full: fullMode,
    merge: opts.merge ?? false,
    framework: opts.framework,
    client: clientValue as ClientType | undefined,
    vendor: clientValue as ClientType | undefined,
    preset: opts.preset as GatePresetType | undefined,
  };
}

/**
 * Supported client/vendor integrations
 * WU-1171: Added 'windsurf' and 'codex', renamed primary type to ClientType
 * WU-1177: Added 'cline' support
 */
export type ClientType =
  | 'claude'
  | 'cursor'
  | 'windsurf'
  | 'codex'
  | 'cline'
  | 'aider'
  | 'all'
  | 'none';

/**
 * Detected IDE type from environment
 * WU-1177: Auto-detection support
 */
export type DetectedIDE = 'claude' | 'cursor' | 'windsurf' | 'vscode' | undefined;

/** @deprecated Use ClientType instead */
// eslint-disable-next-line sonarjs/redundant-type-aliases -- Intentional backwards compatibility
export type VendorType = ClientType;

const DEFAULT_CLIENT_CLAUDE = 'claude-code' as const;

export type DefaultClient = typeof DEFAULT_CLIENT_CLAUDE | 'none';

/**
 * WU-1171: File creation mode
 */
export type FileMode = 'skip' | 'merge' | 'force';

// WU-1067: Supported gate presets for config-driven gates
export type GatePresetType = 'node' | 'python' | 'go' | 'rust' | 'dotnet';

/** WU-1300: Docs structure type for scaffolding */
export type DocsStructureType = 'simple' | 'arc42';

/**
 * WU-1309: Docs paths for different structure types
 */
export interface DocsPathConfig {
  /** Base operations directory */
  operations: string;
  /** Tasks directory */
  tasks: string;
  /** Agent onboarding docs directory */
  onboarding: string;
  /** Quick-ref link for AGENTS.md */
  quickRefLink: string;
}

/**
 * WU-1309: Get docs paths based on structure type
 */
export function getDocsPath(structure: DocsStructureType): DocsPathConfig {
  if (structure === 'simple') {
    return {
      operations: 'docs',
      tasks: 'docs/tasks',
      onboarding: 'docs/_frameworks/lumenflow/agent/onboarding',
      quickRefLink: 'docs/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md',
    };
  }
  // arc42 structure
  return {
    operations: 'docs/04-operations',
    tasks: 'docs/04-operations/tasks',
    onboarding: 'docs/04-operations/_frameworks/lumenflow/agent/onboarding',
    quickRefLink: 'docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md',
  };
}

/**
 * WU-1309: Detect existing docs structure or return default
 * Auto-detects arc42 when docs/04-operations or any numbered dir (01-*, 02-*, etc.) exists
 */
export function detectDocsStructure(targetDir: string): DocsStructureType {
  const docsDir = path.join(targetDir, 'docs');

  if (!fs.existsSync(docsDir)) {
    return 'simple';
  }

  // Check for arc42 numbered directories (01-*, 02-*, ..., 04-operations, etc.)
  const entries = fs.readdirSync(docsDir);
  const hasNumberedDir = entries.some((entry) => /^\d{2}-/.test(entry));

  if (hasNumberedDir) {
    return 'arc42';
  }

  return 'simple';
}

export interface ScaffoldOptions {
  force: boolean;
  full: boolean;
  /** WU-1171: Enable merge mode for safe insertion into existing files */
  merge?: boolean;
  framework?: string;
  /** WU-1171: Primary client flag (replaces vendor) */
  client?: ClientType;
  /** @deprecated Use client instead */
  vendor?: ClientType;
  defaultClient?: DefaultClient;
  /** WU-1067: Gate preset to populate in gates.execution */
  gatePreset?: GatePresetType;
  /** WU-1300: Docs structure (simple or arc42). Auto-detects if not specified. */
  docsStructure?: DocsStructureType;
}

export interface ScaffoldResult {
  created: string[];
  skipped: string[];
  /** WU-1171: Files that were merged (not overwritten) */
  merged?: string[];
  /** WU-1171: Warnings encountered during scaffolding */
  warnings?: string[];
  /** WU-1576: Files created by client integration adapters (enforcement hooks etc.) */
  integrationFiles?: string[];
}

const CONFIG_FILE_NAME = '.lumenflow.config.yaml';
const FRAMEWORK_HINT_FILE = '.lumenflow.framework.yaml';
const LUMENFLOW_DIR = '.lumenflow';
const LUMENFLOW_AGENTS_DIR = `${LUMENFLOW_DIR}/agents`;
const CLAUDE_DIR = '.claude';
const CLAUDE_AGENTS_DIR = path.join(CLAUDE_DIR, 'agents');

/**
 * WU-1362: Check branch guard before writing tracked files
 *
 * Warns (but does not block) if:
 * - On main branch AND
 * - Not in a worktree directory AND
 * - Git repository exists (has .git)
 *
 * This prevents accidental main branch pollution during init operations.
 * Uses warning instead of error to allow initial project setup.
 *
 * @param targetDir - Directory where files will be written
 * @param result - ScaffoldResult to add warnings to
 */
async function checkBranchGuard(targetDir: string, result: ScaffoldResult): Promise<void> {
  result.warnings = result.warnings ?? [];

  // Only check if target is a git repository
  const gitDir = path.join(targetDir, '.git');
  if (!fs.existsSync(gitDir)) {
    // Not a git repo - allow scaffold (initial setup)
    return;
  }

  // Check if we're in a worktree (always allow)
  if (isInWorktree({ cwd: targetDir })) {
    return;
  }

  // Check if on main branch
  try {
    const onMain = await isMainBranch();
    if (onMain) {
      result.warnings.push(
        'Running init on main branch in main checkout. ' +
          'Consider using a worktree for changes to tracked files.',
      );
    }
  } catch {
    // Git error (e.g., not initialized) - silently allow
  }
}

/**
 * WU-1177: Detect IDE environment from environment variables
 * Auto-detects which AI coding assistant is running
 */
export function detectIDEEnvironment(): DetectedIDE {
  // Claude Code detection (highest priority - most specific)
  if (process.env.CLAUDE_PROJECT_DIR || process.env.CLAUDE_CODE) {
    return 'claude';
  }

  // Cursor detection
  const cursorVars = Object.keys(process.env).filter((key) => key.startsWith('CURSOR_'));
  if (cursorVars.length > 0) {
    return 'cursor';
  }

  // Windsurf detection
  const windsurfVars = Object.keys(process.env).filter((key) => key.startsWith('WINDSURF_'));
  if (windsurfVars.length > 0) {
    return 'windsurf';
  }

  // VS Code detection (lowest priority - most generic)
  const vscodeVars = Object.keys(process.env).filter((key) => key.startsWith('VSCODE_'));
  if (vscodeVars.length > 0) {
    return 'vscode';
  }

  return undefined;
}

/**
 * WU-1177: Prerequisite check result
 */
export interface PrerequisiteResult {
  passed: boolean;
  version: string;
  required: string;
  message?: string;
}

/**
 * WU-1177: All prerequisite results
 */
export interface PrerequisiteResults {
  node: PrerequisiteResult;
  pnpm: PrerequisiteResult;
  git: PrerequisiteResult;
}

/**
 * Get command version safely using execFileSync
 */
function getCommandVersion(command: string, args: string[]): string {
  try {
    const output = execFileSync(command, args, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return output;
  } catch {
    return 'not found';
  }
}

/**
 * Parse semver version string to compare
 */
function parseVersion(versionStr: string): number[] {
  // Extract version numbers using a non-backtracking pattern
  // eslint-disable-next-line security/detect-unsafe-regex -- static semver pattern; no backtracking risk
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(versionStr);
  if (!match) {
    return [0, 0, 0];
  }
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3] || '0', 10)];
}

/**
 * Compare versions: returns true if actual >= required
 */
function compareVersions(actual: string, required: string): boolean {
  const actualParts = parseVersion(actual);
  const requiredParts = parseVersion(required);

  for (let i = 0; i < 3; i++) {
    if (actualParts[i] > requiredParts[i]) {
      return true;
    }
    if (actualParts[i] < requiredParts[i]) {
      return false;
    }
  }
  return true;
}

/**
 * WU-1177: Check prerequisite versions
 * Non-blocking - returns results but doesn't fail init
 */
export function checkPrerequisites(): PrerequisiteResults {
  const nodeVersion = getCommandVersion('node', ['--version']);
  const pnpmVersion = getCommandVersion('pnpm', ['--version']);
  const gitVersion = getCommandVersion('git', ['--version']);

  const requiredNode = '22.0.0';
  const requiredPnpm = '9.0.0';
  const requiredGit = '2.0.0';

  const nodeOk = nodeVersion !== 'not found' && compareVersions(nodeVersion, requiredNode);
  const pnpmOk = pnpmVersion !== 'not found' && compareVersions(pnpmVersion, requiredPnpm);
  const gitOk = gitVersion !== 'not found' && compareVersions(gitVersion, requiredGit);

  return {
    node: {
      passed: nodeOk,
      version: nodeVersion,
      required: `>=${requiredNode}`,
      message: nodeOk ? undefined : `Node.js ${requiredNode}+ required`,
    },
    pnpm: {
      passed: pnpmOk,
      version: pnpmVersion,
      required: `>=${requiredPnpm}`,
      message: pnpmOk ? undefined : `pnpm ${requiredPnpm}+ required`,
    },
    git: {
      passed: gitOk,
      version: gitVersion,
      required: `>=${requiredGit}`,
      message: gitOk ? undefined : `Git ${requiredGit}+ required`,
    },
  };
}

/**
 * WU-1307: Default lane definitions for config generation
 * These lanes match the parent lanes used in onboarding documentation.
 */
// WU-1576: Lane definitions must have zero overlapping code_paths.
// Each path must appear in exactly one lane to avoid doctor warnings.
const DEFAULT_LANE_DEFINITIONS = [
  {
    name: 'Framework: Core',
    wip_limit: 1,
    code_paths: ['packages/**/core/**', 'src/core/**', 'lib/**'],
  },
  {
    name: 'Framework: CLI',
    wip_limit: 1,
    code_paths: ['packages/**/cli/**', 'src/cli/**', 'bin/**'],
  },
  {
    name: 'Experience: Web',
    wip_limit: 1,
    code_paths: ['apps/web/**', 'web/**', 'src/components/**', 'src/pages/**', 'src/app/**'],
  },
  {
    name: 'Operations: Infrastructure',
    wip_limit: 1,
    code_paths: ['infrastructure/**', 'deploy/**'],
  },
  {
    name: 'Operations: CI/CD',
    wip_limit: 1,
    code_paths: ['.github/workflows/**', '.github/actions/**', '.circleci/**'],
  },
  {
    name: 'Content: Documentation',
    wip_limit: 1,
    code_paths: ['docs/**', '*.md'],
  },
];

/**
 * Generate YAML configuration with header comment
 * WU-1067: Supports --preset option for config-driven gates
 * WU-1307: Includes default lane definitions for onboarding
 * WU-1364: Supports git config overrides (requireRemote)
 * WU-1383: Adds enforcement hooks config for Claude client by default
 */
function generateLumenflowConfigYaml(
  gatePreset?: GatePresetType,
  gitConfigOverride?: { requireRemote: boolean } | null,
  client?: ClientType,
): string {
  // WU-1382: Add managed file header to prevent manual edits
  const header = `# ============================================================================
# LUMENFLOW MANAGED FILE - DO NOT EDIT MANUALLY
# ============================================================================
# Generated by: lumenflow init
# Regenerate with: pnpm exec lumenflow init --force
#
# This file is managed by LumenFlow tooling. Manual edits may be overwritten.
# To customize, use the CLI commands or edit the appropriate source templates.
# ============================================================================

# LumenFlow Configuration
# Customize paths based on your project structure

`;
  const config = getDefaultConfig();
  config.directories.agentsDir = LUMENFLOW_AGENTS_DIR;

  // WU-1067: Add gates.execution section with preset if specified
  if (gatePreset && GATE_PRESETS[gatePreset]) {
    const presetConfig = GATE_PRESETS[gatePreset];
    (config.gates as Record<string, unknown>).execution = {
      preset: gatePreset,
      ...presetConfig,
    };
  }

  // WU-1307: Add default lane definitions
  (config as Record<string, unknown>).lanes = {
    definitions: DEFAULT_LANE_DEFINITIONS,
  };

  // WU-1364: Add git config overrides (e.g., requireRemote: false for local-only)
  if (gitConfigOverride) {
    (config as Record<string, unknown>).git = {
      requireRemote: gitConfigOverride.requireRemote,
    };
  }

  // WU-1383: Add enforcement hooks for Claude client by default
  // This prevents agents from working on main and editing config files manually
  if (client === 'claude') {
    (config as Record<string, unknown>).agents = {
      clients: {
        [DEFAULT_CLIENT_CLAUDE]: {
          enforcement: {
            hooks: true,
            block_outside_worktree: true,
            require_wu_for_edits: true,
            warn_on_stop_without_wu_done: true,
          },
        },
      },
    };
  }

  return header + yaml.stringify(config);
}

/**
 * Get current date in YYYY-MM-DD format
 */
function getCurrentDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Normalize a framework name into display + slug
 */
function normalizeFrameworkName(framework: string): { name: string; slug: string } {
  const name = framework.trim();
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    // Remove leading dashes and trailing dashes separately (explicit precedence)
    .replace(/^-+/, '')

    .replace(/-+$/, '');

  if (!slug) {
    throw new Error(`Invalid framework name: "${framework}"`);
  }

  return { name, slug };
}

/**
 * Process template content by replacing placeholders
 */
function processTemplate(content: string, tokens: Record<string, string>): string {
  let output = content;
  for (const [key, value] of Object.entries(tokens)) {
    // eslint-disable-next-line security/detect-non-literal-regexp -- key is from internal token map, not user input
    output = output.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return output;
}

function getRelativePath(targetDir: string, filePath: string): string {
  return path.relative(targetDir, filePath).split(path.sep).join('/');
}

// WU-1171: Template for AGENTS.md (universal entry point)
// WU-1300: Updated quick-ref link to correct path
// WU-1309: Use {{QUICK_REF_LINK}} and <project-root> placeholder for portability
const AGENTS_MD_TEMPLATE = `# Universal Agent Instructions

**Last updated:** {{DATE}}

This project uses LumenFlow workflow. For complete documentation, see [LUMENFLOW.md](LUMENFLOW.md).

---

## Quick Start

\`\`\`bash
# 1. Claim a WU
pnpm wu:claim --id WU-XXXX --lane <Lane>
cd worktrees/<lane>-wu-xxxx

# 2. Work in worktree, run gates
pnpm gates

# 3. Complete (ALWAYS run this!)
cd <project-root>
pnpm wu:done --id WU-XXXX
\`\`\`

> **Complete CLI reference:** See [quick-ref-commands.md]({{QUICK_REF_LINK}})

---

## Critical: Always wu:done

After completing work, ALWAYS run \`pnpm wu:done --id WU-XXXX\` from the main checkout.

This is the single most forgotten step. See [LUMENFLOW.md](LUMENFLOW.md) for details.

---

## Core Principles

1. **TDD**: Write tests first, then implementation
2. **Worktree Discipline**: After \`wu:claim\`, work ONLY in the worktree
3. **Gates Before Done**: Run \`pnpm gates\` before \`wu:done\`
4. **Never Bypass Hooks**: No \`--no-verify\`

---

## Forbidden Commands

- \`git reset --hard\`
- \`git push --force\`
- \`git stash\` (on main)
- \`--no-verify\`

---

## Vendor-Specific Overlays

This file provides universal guidance for all AI agents. Additional vendor-specific configuration:

- **Claude Code**: See \`CLAUDE.md\` (if present)
- **Cursor**: See \`.cursor/rules/lumenflow.md\` (if present)
- **Windsurf**: See \`.windsurf/rules/lumenflow.md\` (if present)
`;

// Template for LUMENFLOW.md (main entry point)
// WU-1309: Use <project-root> placeholder for portability
// WU-1364: Added initiative workflow section
const LUMENFLOW_MD_TEMPLATE = `# LumenFlow Workflow Guide\n\n**Last updated:** {{DATE}}\n\nLumenFlow is a vendor-agnostic workflow framework for AI-native software development.\n\n---\n\n## Critical Rule: ALWAYS Run wu:done\n\n**After completing work on a WU, you MUST run \`pnpm wu:done --id WU-XXXX\` from the main checkout.**\n\nThis is the single most forgotten step. Do NOT:\n- Write "To Complete: pnpm wu:done" and stop\n- Ask if you should run wu:done\n- Forget to run wu:done\n\n**DO**: Run \`pnpm wu:done --id WU-XXXX\` immediately after gates pass.\n\n---\n\n## When to Use Initiatives\n\nUse **Initiatives** for multi-phase work spanning multiple WUs:\n\n- **Product visions**: "Build a task management app"\n- **Larger features**: Work requiring multiple WUs across lanes\n- **Complex projects**: Anything that needs phased delivery\n\n\`\`\`bash\n# Create an initiative for multi-phase work\npnpm initiative:create --id INIT-001 --title "Feature Name" \\\\\n  --description "..." --phase "Phase 1: MVP" --phase "Phase 2: Polish"\n\n# Add WUs to the initiative\npnpm initiative:add-wu --initiative INIT-001 --wu WU-XXX --phase 1\n\n# Track progress\npnpm initiative:status --id INIT-001\n\`\`\`\n\n**Skip initiatives** for: single-file bug fixes, small docs updates, isolated refactoring.\n\n---\n\n## Quick Start\n\n\`\`\`bash\n# 1. Create a WU\npnpm wu:create --id WU-XXXX --lane <Lane> --title "Title"\n\n# 2. Edit WU spec with acceptance criteria, then claim:\npnpm wu:claim --id WU-XXXX --lane <Lane>\ncd worktrees/<lane>-wu-xxxx\n\n# 3. Implement in worktree\n\n# 4. Run gates\npnpm gates --docs-only  # for docs changes\npnpm gates              # for code changes\n\n# 5. Complete (from main checkout)\ncd <project-root>\npnpm wu:done --id WU-XXXX\n\`\`\`\n\n---\n\n## Core Principles\n\n1. **TDD**: Failing test -> implementation -> passing test (>=90% coverage on new code)\n2. **Library-First**: Search existing libraries before custom code\n3. **DRY/SOLID/KISS/YAGNI**: No magic numbers, no hardcoded strings\n4. **Worktree Discipline**: After \`wu:claim\`, work ONLY in the worktree\n5. **Gates Before Done**: All gates must pass before \`wu:done\`\n6. **Do Not Bypass Hooks**: No \`--no-verify\`, fix issues properly\n7. **Always wu:done**: Complete every WU by running \`pnpm wu:done\`\n\n---\n\n## Documentation Structure\n\n### Core (Vendor-Agnostic)\n\n- **LUMENFLOW.md** - This file, main entry point\n- **.lumenflow/constraints.md** - Non-negotiable workflow constraints\n- **.lumenflow/agents/** - Agent instructions (vendor-agnostic)\n- **.lumenflow.config.yaml** - Workflow configuration\n\n### Optional Overlays\n\n- **CLAUDE.md + .claude/agents/** - Claude Code overlay (auto if Claude Code detected)\n- **{{DOCS_TASKS_PATH}}** - Task boards and WU storage (\`lumenflow init --full\`)\n- **{{DOCS_ONBOARDING_PATH}}** - Agent onboarding docs\n- **.lumenflow.framework.yaml** - Framework hint file (created with \`--framework\`)\n\n---\n\n## Worktree Discipline (IMMUTABLE LAW)\n\nAfter claiming a WU, you MUST work in its worktree:\n\n\`\`\`bash\n# 1. Claim creates worktree\npnpm wu:claim --id WU-XXX --lane <lane>\n\n# 2. IMMEDIATELY cd to worktree\ncd worktrees/<lane>-wu-xxx\n\n# 3. ALL work happens here\n\n# 4. Return to main ONLY to complete\ncd <project-root>\npnpm wu:done --id WU-XXX\n\`\`\`\n\n---\n\n## Definition of Done\n\n- Acceptance criteria satisfied\n- Gates green (\`pnpm gates\` or \`pnpm gates --docs-only\`)\n- WU YAML status = \`done\`\n- \`wu:done\` has been run\n\n---\n\n## Commands Reference\n\n| Command           | Description                         |\n| ----------------- | ----------------------------------- |\n| \`pnpm wu:create\` | Create new WU spec                  |\n| \`pnpm wu:claim\`  | Claim WU and create worktree        |\n| \`pnpm wu:done\`   | Complete WU (merge, stamp, cleanup) |\n| \`pnpm gates\`     | Run quality gates                   |\n| \`pnpm initiative:create\` | Create multi-phase initiative |\n| \`pnpm initiative:status\` | View initiative progress |\n\n---\n\n## Constraints\n\nSee [.lumenflow/constraints.md](.lumenflow/constraints.md) for the 6 non-negotiable rules.\n\n---\n\n## Agent Onboarding\n\n- Start with **CLAUDE.md** if present (Claude Code overlay).\n- Add vendor-agnostic guidance in **.lumenflow/agents/**.\n- Check the onboarding docs in **{{DOCS_ONBOARDING_PATH}}** for detailed guidance.\n`;

// Template for .lumenflow/constraints.md
const CONSTRAINTS_MD_TEMPLATE = `# LumenFlow Constraints Capsule\n\n**Version:** 1.0\n**Last updated:** {{DATE}}\n\n## The 6 Non-Negotiable Constraints\n\n### 1. Worktree Discipline and Git Safety\nWork only in worktrees, treat main as read-only, never run destructive git commands on main.\n\n### 2. WUs Are Specs, Not Code\nRespect code_paths boundaries, no feature creep, no code blocks in WU YAML files.\n\n### 3. Docs-Only vs Code WUs\nDocumentation WUs use \`--docs-only\` gates, code WUs run full gates.\n\n### 4. LLM-First, Zero-Fallback Inference\nUse LLMs for semantic tasks, fall back to safe defaults (never regex/keywords).\n\n### 5. Gates and Skip-Gates\nComplete via \`pnpm wu:done\`; skip-gates only for pre-existing failures with \`--reason\` and \`--fix-wu\`.\n\n### 6. Safety and Governance\nRespect privacy rules, approved sources, security policies; when uncertain, choose safer path.\n\n---\n\n## Mini Audit Checklist\n\nBefore running \`wu:done\`, verify:\n\n- [ ] Working in worktree (not main)\n- [ ] Only modified files in \`code_paths\`\n- [ ] Gates pass\n- [ ] No forbidden git commands used\n- [ ] Acceptance criteria satisfied\n\n---\n\n## Escalation Triggers\n\nStop and ask a human when:\n- Same error repeats 3 times\n- Auth or permissions changes required\n- PII/PHI/safety issues discovered\n- Cloud spend or secrets involved\n`;

// Template for root CLAUDE.md
// WU-1309: Use <project-root> placeholder for portability
// WU-1382: Expanded with CLI commands table and warning about manual YAML editing
const CLAUDE_MD_TEMPLATE = `# Claude Code Instructions

**Last updated:** {{DATE}}

This project uses LumenFlow workflow. For workflow documentation, see [LUMENFLOW.md](LUMENFLOW.md).

---

## Quick Start

\`\`\`bash
# 1. Claim a WU
pnpm wu:claim --id WU-XXXX --lane <Lane>
cd worktrees/<lane>-wu-xxxx

# 2. Work in worktree, run gates
pnpm gates

# 3. Complete (ALWAYS run this!)
cd <project-root>
pnpm wu:done --id WU-XXXX
\`\`\`

---

## CLI Commands Reference

### WU Lifecycle

| Command                                   | Description                              |
| ----------------------------------------- | ---------------------------------------- |
| \`pnpm wu:status --id WU-XXX\`              | Show WU status, location, valid commands |
| \`pnpm wu:claim --id WU-XXX --lane <Lane>\` | Claim WU and create worktree             |
| \`pnpm wu:prep --id WU-XXX\`                | Run gates in worktree, prep for wu:done  |
| \`pnpm wu:done --id WU-XXX\`                | Complete WU (from main checkout)         |
| \`pnpm wu:block --id WU-XXX --reason "..."\`| Block WU with reason                     |
| \`pnpm wu:unblock --id WU-XXX\`             | Unblock WU                               |

### Gates & Quality

| Command                  | Description                |
| ------------------------ | -------------------------- |
| \`pnpm gates\`             | Run all quality gates      |
| \`pnpm gates --docs-only\` | Run gates for docs changes |
| \`pnpm format\`            | Format all files           |
| \`pnpm lint\`              | Run linter                 |
| \`pnpm typecheck\`         | Run TypeScript check       |
| \`pnpm test\`              | Run tests                  |

---

## Critical: Always wu:done

After completing work, ALWAYS run \`pnpm wu:done --id WU-XXXX\` from the main checkout.

See [LUMENFLOW.md](LUMENFLOW.md) for full workflow documentation.

---

## Warning: Do Not Edit WU YAML Files Manually

**Never manually edit WU YAML files** in \`docs/.../tasks/wu/WU-XXX.yaml\`.

Use CLI commands instead:

- \`pnpm wu:create ...\` to create new WUs
- \`pnpm wu:edit --id WU-XXX ...\` to modify WU fields
- \`pnpm wu:claim\` / \`wu:block\` / \`wu:done\` for status changes

Manual edits bypass validation and can corrupt workflow state.
`;

// Template for .claude/settings.json
const CLAUDE_SETTINGS_TEMPLATE = `{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash",
      "Read",
      "Write",
      "Edit",
      "WebFetch",
      "WebSearch"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Write(./.env*)",
      "Bash(git reset --hard *)",
      "Bash(git stash *)",
      "Bash(git clean -fd *)",
      "Bash(git push --force *)",
      "Bash(git push -f *)",
      "Bash(git commit --no-verify *)",
      "Bash(HUSKY=0 *)",
      "Bash(rm -rf /*)",
      "Bash(sudo *)",
      "Bash(git worktree remove *)",
      "Bash(git worktree prune *)"
    ]
  }
}
`;

// WU-1171: Template for .cursor/rules/lumenflow.md (updated path)
// WU-1309: Use <project-root> placeholder for portability
const CURSOR_RULES_TEMPLATE = `# Cursor LumenFlow Rules

This project uses LumenFlow workflow. See [LUMENFLOW.md](../../LUMENFLOW.md).

## Critical Rules

1. **Always run wu:done** - After gates pass, run \`pnpm wu:done --id WU-XXX\`
2. **Work in worktrees** - After \`wu:claim\`, work only in the worktree
3. **Never bypass hooks** - No \`--no-verify\`
4. **TDD** - Write tests first

## Forbidden Commands

- \`git reset --hard\`
- \`git push --force\`
- \`git stash\` (on main)
- \`--no-verify\`

## Quick Reference

\`\`\`bash
# Claim WU
pnpm wu:claim --id WU-XXX --lane <Lane>
cd worktrees/<lane>-wu-xxx

# Run gates
pnpm gates

# Complete (from main)
cd <project-root>
pnpm wu:done --id WU-XXX
\`\`\`
`;

// WU-1171: Template for .windsurf/rules/lumenflow.md
// WU-1309: Use <project-root> placeholder for portability
const WINDSURF_RULES_TEMPLATE = `# Windsurf LumenFlow Rules

This project uses LumenFlow workflow. See [LUMENFLOW.md](../../LUMENFLOW.md).

## Critical Rules

1. **Always run wu:done** - After gates pass, run \`pnpm wu:done --id WU-XXX\`
2. **Work in worktrees** - After \`wu:claim\`, work only in the worktree
3. **Never bypass hooks** - No \`--no-verify\`
4. **TDD** - Write tests first

## Forbidden Commands

- \`git reset --hard\`
- \`git push --force\`
- \`git stash\` (on main)
- \`--no-verify\`

## Quick Reference

\`\`\`bash
# Claim WU
pnpm wu:claim --id WU-XXX --lane <Lane>
cd worktrees/<lane>-wu-xxx

# Run gates
pnpm gates

# Complete (from main)
cd <project-root>
pnpm wu:done --id WU-XXX
\`\`\`
`;

// WU-1177: Template for .clinerules (Cline AI assistant)
// WU-1309: Use <project-root> placeholder for portability
const CLINE_RULES_TEMPLATE = `# Cline LumenFlow Rules

This project uses LumenFlow workflow. See [LUMENFLOW.md](LUMENFLOW.md).

## Critical Rules

1. **Always run wu:done** - After gates pass, run \`pnpm wu:done --id WU-XXX\`
2. **Work in worktrees** - After \`wu:claim\`, work only in the worktree
3. **Never bypass hooks** - No \`--no-verify\`
4. **TDD** - Write tests first

## Forbidden Commands

- \`git reset --hard\`
- \`git push --force\`
- \`git stash\` (on main)
- \`--no-verify\`

## Quick Reference

\`\`\`bash
# Claim WU
pnpm wu:claim --id WU-XXX --lane <Lane>
cd worktrees/<lane>-wu-xxx

# Run gates
pnpm gates

# Complete (from main)
cd <project-root>
pnpm wu:done --id WU-XXX
\`\`\`
`;

// Template for .aider.conf.yml
const AIDER_CONF_TEMPLATE = `# Aider Configuration for LumenFlow Projects\n# See LUMENFLOW.md for workflow documentation\n\nmodel: gpt-4-turbo\nauto-commits: false\ndirty-commits: false\n\nread:\n  - LUMENFLOW.md\n  - .lumenflow/constraints.md\n`;

// WU-1413: Template for .mcp.json (MCP server configuration for Claude Code)
const MCP_JSON_TEMPLATE = `{
  "mcpServers": {
    "lumenflow": {
      "command": "npx",
      "args": ["@lumenflow/mcp"]
    }
  }
}
`;

// Template for docs/04-operations/tasks/backlog.md
const BACKLOG_TEMPLATE = `---\nsections:\n  ready:\n    heading: '## 🚀 Ready (pull from here)'\n    insertion: after_heading_blank_line\n  in_progress:\n    heading: '## 🔧 In progress'\n    insertion: after_heading_blank_line\n  blocked:\n    heading: '## ⛔ Blocked'\n    insertion: after_heading_blank_line\n  done:\n    heading: '## ✅ Done'\n    insertion: after_heading_blank_line\n---\n\n# Backlog (single source of truth)\n\n## 🚀 Ready (pull from here)\n\n(No items ready)\n\n## 🔧 In progress\n\n(No items in progress)\n\n## ⛔ Blocked\n\n(No items blocked)\n\n## ✅ Done\n\n(No items completed yet)\n`;

// Template for docs/04-operations/tasks/status.md
const STATUS_TEMPLATE = `# Status (active work)\n\n## In Progress\n\n(No items in progress)\n\n## Blocked\n\n(No items blocked)\n\n## Completed\n\n(No items completed yet)\n`;

// Template for docs tasks WU template YAML (scaffolded to {{DOCS_TASKS_PATH}}/templates/wu-template.yaml)
const WU_TEMPLATE_YAML = `# Work Unit Template (LumenFlow WU Schema)\n#\n# Copy this template when creating new WUs. Fill in all required fields and\n# remove optional fields if not needed.\n#\n# If you used "lumenflow init --full", this template lives at:\n# {{DOCS_TASKS_PATH}}/templates/wu-template.yaml\n\n# Required: Unique work unit identifier (format: WU-NNN)\nid: WU-XXX\n\n# Required: Short, descriptive title (max 80 chars)\ntitle: 'Your WU title here'\n\n# Required: Lane (Parent: Sublane format)\nlane: '<Parent: Sublane>'\n\n# Required: Type of work\ntype: 'feature' # feature | bug | documentation | process | tooling | chore | refactor\n\n# Required: Current status\nstatus: 'ready' # ready | in_progress | blocked | done | cancelled\n\n# Required: Priority\npriority: P2 # P0 | P1 | P2 | P3\n\n# Required: Creation date (YYYY-MM-DD)\ncreated: {{DATE}}\n\n# Required: Owner/assignee (email)\nassigned_to: 'unassigned@example.com'\n\n# Required: Description\ndescription: |\n  Context: ...\n  Problem: ...\n  Solution: ...\n\n# Required: Acceptance criteria (testable, binary)\nacceptance:\n  - Criterion 1 (specific, measurable, testable)\n  - Criterion 2 (binary pass/fail)\n  - Documentation updated\n\n# Required: References to plans/specs (required for type: feature)\n# Tip: use pnpm wu:create --plan to generate a plan stub at lumenflow://plans/WU-XXX-plan.md\nspec_refs:\n  - lumenflow://plans/WU-XXX-plan.md\n\n# Required: Code files changed or created (empty only for docs/process WUs)\n# Docs-only WUs should use docs/ or *.md paths to avoid docs-only gate failures.\ncode_paths:\n  - path/to/file.ts\n\n# Required: Test paths (at least one of manual/unit/e2e/integration for non-doc WUs)\ntests:\n  manual:\n    - Manual check: Verify behavior or docs output\n  unit:\n    - path/to/test.test.ts\n  e2e: []\n  integration: []\n\n# Required: Exposure level\nexposure: 'backend-only' # ui | api | backend-only | documentation\n\n# Optional: User journey (recommended for ui/api)\n# user_journey: |\n#   User navigates to ...\n#   User performs ...\n\n# Optional: UI pairing WUs (for api exposure)\n# ui_pairing_wus:\n#   - WU-1234\n\n# Optional: Navigation path (required when exposure=ui and no page file)\n# navigation_path: '/settings'\n\n# Required: Deliverable artifacts (stamps, docs, etc.)\nartifacts:\n  - .lumenflow/stamps/WU-XXX.done\n\n# Optional: Dependencies (other WUs that must complete first)\ndependencies: []\n\n# Optional: Risks\nrisks:\n  - Risk 1\n\n# Optional: Notes (required by spec linter)\nnotes: 'Implementation notes, rollout context, or plan summary.'\n\n# Optional: Requires human review\nrequires_review: false\n\n# Optional: Claimed mode (worktree or branch-only)\n# Automatically set by wu:claim, usually don't need to specify\n# claimed_mode: worktree\n\n# Optional: Assigned to (email of current claimant)\n# Automatically set by wu:claim\n# assigned_to: engineer@example.com\n\n# Optional: Locked status (prevents concurrent edits)\n# Automatically set by wu:claim and wu:done\n# locked: false\n\n# Optional: Completion date (ISO 8601 format)\n# Automatically set by wu:done\n# completed: 2025-10-23\n\n# Optional: Completion notes (added by wu:done)\n# completion_notes: |\n#   Additional notes added during wu:done.\n#   Any deviations from original plan.\n#   Lessons learned.\n\n# ============================================================================\n# GOVERNANCE BLOCK (WU Schema v2.0)\n# ============================================================================\n# Optional: COS governance rules that apply to this WU\n# Only include if this WU needs specific governance enforcement\n\n# governance:\n#   # Rules that apply to this WU (evaluated during cos:gates)\n#   rules:\n#     - rule_id: UPAIN-01\n#       satisfied: false  # Initially false, set true when evidence provided\n#       evidence:\n#         - type: link\n#           value: docs/product/voc/feature-user-pain.md\n#           description: "Voice of Customer analysis showing user pain"\n#       notes: |\n#         VOC analysis shows 40% of support tickets request this feature.\n#         Average time wasted: 15min/user/week.\n#\n#     - rule_id: CASH-03\n#       satisfied: false\n#       evidence:\n#         - type: link\n#           value: docs/finance/spend-reviews/2025-10-cloud-infra.md\n#           description: "Spend review for £1200/month cloud infrastructure"\n#         - type: approval\n#           value: owner@example.com\n#           description: "Owner approval for spend commitment"\n#       notes: |\n#         New cloud infrastructure commitment: £1200/month for 12 months.\n#         ROI: Reduces latency by 50%, improves user retention.\n#\n#   # Gate checks (enforced by cos-gates.ts)\n#   gates:\n#     narrative: "pending"  # Status: pending, passed, skipped, failed\n#     finance: "pending"\n#\n#   # Exemptions (only if rule doesn't apply)\n#   exemptions:\n#     - rule_id: FAIR-01\n#       reason: "No user-facing pricing changes in this WU"\n#       approved_by: product-owner@example.com\n#       approved_at: 2025-10-23\n\n# ============================================================================\n# USAGE NOTES\n# ============================================================================\n#\n# 1. Remove this entire governance block if no COS rules apply to your WU\n# 2. Only include rules that require enforcement (not all rules apply to all WUs)\n# 3. Evidence types: link:, metric:, screenshot:, approval:\n# 4. Gates are checked during wu:done (before merge)\n# 5. Exemptions require approval from rule owner\n#\n# For more details, see:\n# - {{DOCS_OPERATIONS_PATH}}/_frameworks/cos/system-prompt-v1.3.md\n# - {{DOCS_OPERATIONS_PATH}}/_frameworks/cos/evidence-format.md\n`;

// Template for .lumenflow.framework.yaml
const FRAMEWORK_HINT_TEMPLATE = `# LumenFlow Framework Hint\n# Generated by: lumenflow init --framework {{FRAMEWORK_NAME}}\n\nframework: "{{FRAMEWORK_NAME}}"\nslug: "{{FRAMEWORK_SLUG}}"\n`;

// Template for docs/04-operations/_frameworks/<framework>/README.md
const FRAMEWORK_OVERLAY_TEMPLATE = `# {{FRAMEWORK_NAME}} Framework Overlay\n\n**Last updated:** {{DATE}}\n\nThis overlay captures framework-specific conventions, constraints, and references for {{FRAMEWORK_NAME}} projects.\n\n## Scope\n\n- Project structure conventions\n- Framework-specific testing guidance\n- Common pitfalls and mitigations\n\n## References\n\n- Add official docs links here\n`;

// WU-1083: Agent onboarding docs templates
// WU-1309: Updated quick-ref with --docs-structure and complete wu:create example
const QUICK_REF_COMMANDS_TEMPLATE = `# Quick Reference: LumenFlow Commands

**Last updated:** {{DATE}}

---

## Project Setup

| Command                                              | Description                               |
| ---------------------------------------------------- | ----------------------------------------- |
| \`pnpm exec lumenflow init\`                         | Scaffold minimal LumenFlow core           |
| \`pnpm exec lumenflow init --full\`                  | Add docs + agent onboarding scaffolding   |
| \`pnpm exec lumenflow init --docs-structure simple\` | Use simple docs structure (docs/tasks)    |
| \`pnpm exec lumenflow init --docs-structure arc42\`  | Use arc42 structure (docs/04-operations)  |
| \`pnpm exec lumenflow init --framework <name>\`      | Add framework hint + overlay docs         |
| \`pnpm exec lumenflow init --client <type>\`         | Add client overlay (claude, cursor, etc.) |
| \`pnpm exec lumenflow init --force\`                 | Overwrite existing files                  |

---

## WU Management

| Command                                   | Description                     |
| ----------------------------------------- | ------------------------------- |
| \`pnpm wu:create ...\` (see example below) | Create new WU                   |
| \`pnpm wu:claim --id WU-XXX --lane <Lane>\`| Claim WU (creates worktree)     |
| \`pnpm wu:done --id WU-XXX\`               | Complete WU (merge, stamp)      |
| \`pnpm wu:block --id WU-XXX --reason "..."\`| Block a WU                     |
| \`pnpm wu:unblock --id WU-XXX\`            | Unblock a WU                    |
| \`pnpm wu:status --id WU-XXX\`             | Check WU status and location    |

---

## Complete wu:create Example

\`\`\`bash
pnpm wu:create \\
  --id WU-001 \\
  --lane "Framework: Core" \\
  --title "Add validation feature" \\
  --description "Context: Users need input validation. Problem: No validation exists. Solution: Add Zod-based validation." \\
  --acceptance "Validation rejects invalid input" \\
  --acceptance "Unit tests cover edge cases with >90% coverage" \\
  --acceptance "Documentation updated" \\
  --code-paths "packages/@lumenflow/core/src/validation.ts" \\
  --test-paths-unit "packages/@lumenflow/core/src/__tests__/validation.test.ts" \\
  --exposure backend-only \\
  --spec-refs "lumenflow://plans/WU-001-plan.md"
\`\`\`

**Required fields for code WUs:**
- \`--lane\`: Format is "Parent: Sublane" (e.g., "Framework: Core")
- \`--title\`: Short descriptive title
- \`--description\`: Context, Problem, Solution
- \`--acceptance\`: At least one (repeatable)
- \`--code-paths\`: Files to modify (repeatable)
- \`--test-paths-unit\` or \`--test-paths-e2e\`: Test files
- \`--exposure\`: ui | api | backend-only | documentation
- \`--spec-refs\`: Required for type: feature

---

## Gates

| Command                  | Description                |
| ------------------------ | -------------------------- |
| \`pnpm gates\`             | Run all quality gates      |
| \`pnpm gates --docs-only\` | Run gates for docs changes |
| \`pnpm format\`            | Format all files           |
| \`pnpm lint\`              | Run linter                 |
| \`pnpm typecheck\`         | Run TypeScript check       |
| \`pnpm test\`              | Run tests                  |

---

## Git (Safe Operations)

| Command                              | Description               |
| ------------------------------------ | ------------------------- |
| \`git status\`                         | Check working tree status |
| \`git add .\`                          | Stage all changes         |
| \`git commit -m "type: message"\`      | Commit with message       |
| \`git push origin lane/<lane>/wu-xxx\` | Push to remote            |

---

## Navigation

\`\`\`bash
# After claiming, go to worktree
cd worktrees/<lane>-wu-xxx

# Return to main for wu:done
cd <project-root>
\`\`\`

---

## Workflow Sequence

\`\`\`bash
# 1. Create (see complete example above)
pnpm wu:create --id WU-001 --lane "Framework: Core" --title "Add feature" \\
  --description "Context: ... Problem: ... Solution: ..." \\
  --acceptance "Feature works" --acceptance "Tests pass" \\
  --code-paths "src/feature.ts" \\
  --test-paths-unit "src/__tests__/feature.test.ts" \\
  --exposure backend-only \\
  --spec-refs "lumenflow://plans/WU-001-plan.md"

# 2. Claim
pnpm wu:claim --id WU-001 --lane "Framework: Core"
cd worktrees/framework-core-wu-001

# 3. Work (TDD)
# ... write tests first, then code ...

# 4. Commit
git add .
git commit -m "feat: add feature"
git push origin lane/framework-core/wu-001

# 5. Gates
pnpm gates

# 6. Complete (from main checkout)
cd <project-root>
pnpm wu:done --id WU-001
\`\`\`

---

## File Paths

| Path                                 | Description          |
| ------------------------------------ | -------------------- |
| \`{{DOCS_TASKS_PATH}}/wu/WU-XXX.yaml\` | WU specification     |
| \`{{DOCS_TASKS_PATH}}/status.md\`      | Current status board |
| \`.lumenflow/stamps/WU-XXX.done\`      | Completion stamp     |
| \`worktrees/<lane>-wu-xxx/\`           | Worktree directory   |
`;

const FIRST_WU_MISTAKES_TEMPLATE = `# First WU Mistakes

**Last updated:** {{DATE}}

Common mistakes agents make on their first WU, and how to avoid them.

---

## Mistake 1: Not Using Worktrees

### Wrong

\`\`\`bash
# Working directly in main
vim src/feature.ts
git commit -m "feat: add feature"
git push origin main
\`\`\`

### Right

\`\`\`bash
# Claim first, then work in worktree
pnpm wu:claim --id WU-123 --lane Core
cd worktrees/core-wu-123
vim src/feature.ts
git commit -m "feat: add feature"
git push origin lane/core/wu-123
cd /path/to/main
pnpm wu:done --id WU-123
\`\`\`

---

## Mistake 2: Forgetting to Run wu:done

See [troubleshooting-wu-done.md](troubleshooting-wu-done.md) for the full explanation.

**TL;DR:** After gates pass, ALWAYS run \`pnpm wu:done --id WU-XXX\`.

---

## Mistake 3: Working Outside code_paths

### Wrong

The WU says \`code_paths: [src/api/**]\` but you edit \`src/ui/component.ts\`.

### Right

Only edit files within the specified \`code_paths\`. If you need to edit other files, that's a different WU.

---

## Mistake 4: Skipping TDD

### Wrong

\`\`\`
1. Write the feature
2. Maybe write tests later
3. Tests are hard, skip them
\`\`\`

### Right

\`\`\`
1. Write failing test
2. Run test (confirm RED)
3. Write minimum code
4. Run test (confirm GREEN)
5. Refactor if needed
\`\`\`

---

## Mistake 5: Using Forbidden Git Commands

### Wrong

\`\`\`bash
git reset --hard HEAD
git push --force
git commit --no-verify
\`\`\`

### Right

\`\`\`bash
git add .
git commit -m "feat: description"
git push origin lane/core/wu-123
\`\`\`

---

## Mistake 6: Ignoring Gate Failures

### Wrong

\`\`\`
Gates failed but I think the code is fine.
Let me use --skip-gates.
\`\`\`

### Right

\`\`\`
Gates failed. Let me read the error:
- TypeScript error in src/api/handler.ts
- Missing return type

Fix: Add the return type.
Re-run: pnpm gates
\`\`\`

---

## Quick Checklist

Before starting any WU:

- [ ] Read the full WU spec
- [ ] Understand acceptance criteria
- [ ] Claim the WU with \`pnpm wu:claim\`
- [ ] cd to the worktree IMMEDIATELY
- [ ] Work only in the worktree
- [ ] Stay within code_paths
- [ ] Follow TDD
- [ ] Run gates before wu:done
- [ ] ALWAYS run wu:done
`;

const TROUBLESHOOTING_WU_DONE_TEMPLATE = `# Troubleshooting: wu:done Not Run

**Last updated:** {{DATE}}

This is the most common mistake agents make. This document explains why it happens and how to fix it.

---

## The Problem

Agents complete their work, write "To Complete: pnpm wu:done --id WU-XXX" in their response, and then **stop without actually running the command**.

### Why This Happens

1. **Confusion about scope**: Agent thinks completion is a "next step" for the human
2. **Fear of overstepping**: Agent hesitates to take "final" actions
3. **Missing context**: Agent doesn't realize wu:done is expected to be run immediately
4. **Token limits**: Agent runs out of context and summarizes remaining steps

---

## The Fix

### Rule: ALWAYS Run wu:done

After gates pass, you MUST run:

\`\`\`bash
cd /path/to/main
pnpm wu:done --id WU-XXX
\`\`\`

Do NOT:

- Ask "Should I run wu:done?"
- Write "To Complete: pnpm wu:done"
- Wait for permission
- Treat it as a "future step"

---

## Correct Completion Flow

\`\`\`bash
# 1. In worktree, run gates
pnpm gates

# 2. If gates pass, return to main
cd /path/to/main

# 3. IMMEDIATELY run wu:done
pnpm wu:done --id WU-XXX

# 4. Report success with the wu:done output
\`\`\`

---

## What wu:done Does

When you run \`pnpm wu:done --id WU-XXX\`:

1. Validates the worktree exists and has commits
2. Runs gates in the worktree (not main)
3. Fast-forward merges to main
4. Creates the done stamp
5. Updates status and backlog docs
6. Removes the worktree
7. Pushes to origin

**This is the ONLY way to complete a WU.** Manual steps will leave things in an inconsistent state.

---

## Symptoms of Incomplete WU

If wu:done wasn't run, you'll see:

- Worktree still exists: \`ls worktrees/\`
- No stamp: \`ls .lumenflow/stamps/WU-XXX.done\` returns nothing
- Status unchanged: WU still shows as \`in_progress\`
- Branch not merged: Changes only on lane branch

---

## Recovery

If a previous agent forgot to run wu:done:

\`\`\`bash
# 1. Check worktree exists
ls worktrees/

# 2. If it does, run wu:done
pnpm wu:done --id WU-XXX
\`\`\`

---

## Checklist Before Ending Session

- [ ] Did I run \`pnpm gates\` in the worktree?
- [ ] Did gates pass?
- [ ] Did I \`cd\` back to main?
- [ ] Did I run \`pnpm wu:done --id WU-XXX\`?
- [ ] Did wu:done complete successfully?

If any answer is "no", you're not done yet.
`;

const AGENT_SAFETY_CARD_TEMPLATE = `# Agent Safety Card

**Last updated:** {{DATE}}

Quick reference for AI agents working in LumenFlow projects.

---

## Stop and Ask When

- Same error repeats 3 times
- Auth or permissions changes needed
- PII/PHI/secrets involved
- Cloud spend decisions
- Policy changes required
- Anything feels irreversible

---

## Never Do

| Action                   | Why              |
| ------------------------ | ---------------- |
| \`git reset --hard\`       | Data loss        |
| \`git push --force\`       | History rewrite  |
| \`--no-verify\`            | Bypasses safety  |
| \`git stash\` (on main)    | Hides work       |
| \`git clean -fd\`          | Deletes files    |
| Work in main after claim | Breaks isolation |
| Skip wu:done             | Incomplete WU    |

---

## Always Do

| Action                     | Why              |
| -------------------------- | ---------------- |
| Read WU spec first         | Understand scope |
| cd to worktree after claim | Isolation        |
| Write tests before code    | TDD              |
| Run gates before wu:done   | Quality          |
| Run wu:done                | Complete WU      |
| Stay within code_paths     | Scope discipline |

---

## Error Handling

### Max 3 Attempts

If same error happens 3 times:

1. Stop trying
2. Document what happened
3. Ask for help

### Gate Failures

1. Read the error message
2. Fix the underlying issue
3. Re-run gates
4. Never use \`--skip-gates\` for new failures

---

## Quick Commands

\`\`\`bash
# Check lane availability
cat {{DOCS_TASKS_PATH}}/status.md

# Claim a WU
pnpm wu:claim --id WU-XXX --lane <Lane>

# Work in worktree
cd worktrees/<lane>-wu-xxx

# Run gates
pnpm gates          # Code changes
pnpm gates --docs-only  # Docs changes

# Complete WU
cd /path/to/main
pnpm wu:done --id WU-XXX
\`\`\`

---

## Completion Checklist

- [ ] Gates pass
- [ ] cd to main
- [ ] Run wu:done
- [ ] Verify success output
- [ ] Report completion

---

## When Uncertain

Choose the safer path:

- Don't modify files outside code_paths
- Don't bypass hooks
- Don't skip gates
- Ask rather than assume
`;

// WU-1307: Lane inference configuration template (hierarchical Parent→Sublane format)
// WU-1364: Added Core and Feature as parent lanes for intuitive naming
// WU-1382: Added managed file header to prevent manual edits
// This format is required by lane-inference.ts and lane-checker.ts
const LANE_INFERENCE_TEMPLATE = `# ============================================================================
# LUMENFLOW MANAGED FILE - DO NOT EDIT MANUALLY
# ============================================================================
# Generated by: lumenflow init
# Regenerate with: pnpm exec lumenflow init --force
#
# This file is managed by LumenFlow tooling. Manual edits may be overwritten.
# To customize lanes, use: pnpm lane:suggest --output .lumenflow.lane-inference.yaml
# ============================================================================

# Lane Inference Configuration
#
# Hierarchical format: Parent -> Sublane -> { code_paths, keywords }
# This format is required by lane-inference.ts for proper sub-lane suggestion.
#
# Common parent lanes: Core, Feature, Framework, Experience, Operations, Content

# Core Lane: Platform foundations, shared libraries, base infrastructure
Core:
  Platform:
    description: 'Core platform: shared utilities, base infrastructure, common libraries'
    code_paths:
      - 'packages/**/core/**'
      - 'src/core/**'
      - 'src/lib/**'
      - 'lib/**'
    keywords:
      - 'platform'
      - 'core'
      - 'infrastructure'
      - 'foundation'

  Library:
    description: 'Shared libraries and utilities'
    code_paths:
      - 'packages/**/lib/**'
      - 'src/utils/**'
      - 'src/helpers/**'
    keywords:
      - 'library'
      - 'utility'
      - 'helper'
      - 'shared'

# Feature Lane: Product features and user-facing functionality
Feature:
  Backend:
    description: 'Backend features: APIs, services, business logic'
    code_paths:
      - 'src/api/**'
      - 'src/services/**'
      - 'packages/**/api/**'
    keywords:
      - 'api'
      - 'service'
      - 'backend'
      - 'business logic'

  Frontend:
    description: 'Frontend features: UI, components, pages'
    code_paths:
      - 'src/components/**'
      - 'src/pages/**'
      - 'src/app/**'
      - 'apps/web/**'
    keywords:
      - 'frontend'
      - 'ui'
      - 'component'
      - 'page'

# Framework Lane: Framework-specific code and tooling
Framework:
  Core:
    description: 'Core framework: business logic, domain models, utilities'
    code_paths:
      - 'packages/**/core/**'
      - 'src/core/**'
      - 'lib/**'
    keywords:
      - 'core library'
      - 'business logic'
      - 'domain'
      - 'utility'

  CLI:
    description: 'CLI commands and tooling'
    code_paths:
      - 'packages/**/cli/**'
      - 'src/cli/**'
      - 'bin/**'
    keywords:
      - 'cli command'
      - 'command line'
      - 'tooling'

# Experience Lane: User-facing frontend work
Experience:
  UI:
    description: 'User interface components and pages'
    code_paths:
      - 'apps/web/**'
      - 'src/components/**'
      - 'src/pages/**'
      - 'src/app/**'
    keywords:
      - 'ui'
      - 'component'
      - 'page'
      - 'frontend'
      - 'user interface'

  Web:
    description: 'Web application features'
    code_paths:
      - 'apps/web/**'
      - 'web/**'
    keywords:
      - 'web'
      - 'browser'
      - 'frontend'

# Operations Lane: Infrastructure and CI/CD
Operations:
  Infrastructure:
    description: 'Apps, deployment, hosting configuration'
    code_paths:
      - 'apps/**'
      - 'infrastructure/**'
      - 'deploy/**'
      - 'turbo.json'
      - 'pnpm-workspace.yaml'
    keywords:
      - 'infrastructure'
      - 'deployment'
      - 'hosting'
      - 'monorepo'

  CI/CD:
    description: 'GitHub Actions, workflows, build pipelines'
    code_paths:
      - '.github/workflows/**'
      - '.github/actions/**'
      - '.github/**'
      - '.circleci/**'
    keywords:
      - 'ci'
      - 'cd'
      - 'github actions'
      - 'workflow'
      - 'pipeline'

# Content Lane: Documentation
Content:
  Documentation:
    description: 'All documentation: guides, references, specs'
    code_paths:
      - 'docs/**'
      - '*.md'
      - 'README.md'
    keywords:
      - 'documentation'
      - 'docs'
      - 'guide'
      - 'readme'
      - 'markdown'
{{FRAMEWORK_LANES}}
`;

// WU-1300: Starting prompt template for agent onboarding
// WU-1364: Added "When Starting From Product Vision" section for initiative-first workflow
const STARTING_PROMPT_TEMPLATE = `# Starting Prompt for LumenFlow Agents

**Last updated:** {{DATE}}

This document provides the initial context for AI agents working on this project.

---

## When Starting From Product Vision

If you are starting a new project or feature from a product vision (e.g., "Build a task management app"), **do NOT create standalone WUs immediately**. Instead, follow the initiative-first workflow:

### 4-Step Initiative Workflow

1. **Create an Initiative**: Capture the vision as an initiative
   \`\`\`bash
   pnpm initiative:create --id INIT-001 --title "Task Management App" \\
     --description "Build a task management application with..." \\
     --phase "Phase 1: Core MVP" --phase "Phase 2: Collaboration"
   \`\`\`

2. **Define Phases**: Break the vision into logical phases (MVP, iteration, polish)

3. **Create WUs under the Initiative**: Each WU belongs to a phase
   \`\`\`bash
   pnpm wu:create --lane "Core: Platform" --title "Add task model" \\
     --description "..." --acceptance "..." --code-paths "..." \\
     && pnpm initiative:add-wu --initiative INIT-001 --wu WU-XXX --phase 1
   \`\`\`

4. **Track Progress**: Use \`pnpm initiative:status --id INIT-001\` to see overall progress

### Why Initiatives Matter

- **Avoid orphan WUs**: Without initiative structure, agents create disconnected WUs that lack coherent scope
- **Better coordination**: Phases enable parallel work across lanes
- **Clear completion criteria**: The initiative tracks when all phases are done
- **Visibility**: Stakeholders can see multi-phase progress

### When to Skip Initiatives

Only skip initiatives for:
- Single-file bug fixes
- Small documentation updates
- Isolated refactoring tasks

If work spans multiple WUs or multiple days, create an initiative first.

---

## Step 1: Read Core Documentation

Before starting any work, read these documents in order:

1. **[LUMENFLOW.md](../../../../../../LUMENFLOW.md)** - Main workflow documentation
2. **[constraints.md](../../../../../../.lumenflow/constraints.md)** - Non-negotiable rules
3. **This file** - Onboarding context

---

## Step 2: Understand the Workflow

LumenFlow uses Work Units (WUs) to track all changes:

1. **Claim a WU**: \`pnpm wu:claim --id WU-XXX --lane <Lane>\`
2. **Work in worktree**: \`cd worktrees/<lane>-wu-xxx\`
3. **Run gates**: \`pnpm gates\`
4. **Complete WU**: \`pnpm wu:done --id WU-XXX\` (from main checkout)

---

## Step 3: Key Constraints

1. **Worktree Discipline**: Never work in main after claiming a WU
2. **TDD**: Write tests first, then implementation
3. **Gates**: Must pass before \`wu:done\`
4. **Always wu:done**: Never skip the completion step

---

## Step 4: Common Commands

| Command | Description |
| ------- | ----------- |
| \`pnpm wu:claim --id WU-XXX --lane <Lane>\` | Claim a WU |
| \`pnpm gates\` | Run quality gates |
| \`pnpm wu:done --id WU-XXX\` | Complete WU |
| \`pnpm wu:status --id WU-XXX\` | Check WU status |
| \`pnpm initiative:create ...\` | Create a new initiative |
| \`pnpm initiative:status --id INIT-XXX\` | Check initiative progress |

---

## Step 5: When Stuck

1. Read the WU spec at \`{{DOCS_TASKS_PATH}}/wu/WU-XXX.yaml\`
2. Check [troubleshooting-wu-done.md](troubleshooting-wu-done.md)
3. Review [first-wu-mistakes.md](first-wu-mistakes.md)

---

## Additional Resources

- [quick-ref-commands.md](quick-ref-commands.md) - Complete command reference
- [agent-safety-card.md](agent-safety-card.md) - Safety guidelines
- [wu-create-checklist.md](wu-create-checklist.md) - WU creation guide
- [wu-sizing-guide.md](wu-sizing-guide.md) - WU complexity and context management
`;

const WU_CREATE_CHECKLIST_TEMPLATE = `# WU Creation Checklist

**Last updated:** {{DATE}}

Before running \`pnpm wu:create\`, verify these items.

---

## Step 1: Check Valid Lanes

\`\`\`bash
grep -A 30 "lanes:" .lumenflow.config.yaml
\`\`\`

**Format:** \`"Parent: Sublane"\` (colon + single space)

Examples:
- \`"Framework: CLI"\`
- \`"Framework: Core"\`
- \`"Operations: CI/CD"\`
- \`"Content: Documentation"\`

---

## Step 2: Required Fields

| Field | Required For | Example |
|-------|--------------|---------|
| \`--id\` | All | \`WU-1234\` |
| \`--lane\` | All | \`"Experience: Chat"\` |
| \`--title\` | All | \`"Add feature"\` |
| \`--description\` | All | \`"Context: ... Problem: ... Solution: ..."\` |
| \`--acceptance\` | All | \`--acceptance "Works"\` (repeatable) |
| \`--exposure\` | All | \`ui\`, \`api\`, \`backend-only\`, \`documentation\` |
| \`--code-paths\` | Code WUs | \`"src/a.ts,src/b.ts"\` |
| \`--test-paths-unit\` | Code WUs | \`"src/__tests__/a.test.ts"\` |
| \`--spec-refs\` | Feature WUs | \`"~/.lumenflow/plans/WU-XXX.md"\` |

---

## Step 3: Plan Storage

Plans go in \`~/.lumenflow/plans/\` (NOT in project):

\`\`\`bash
mkdir -p ~/.lumenflow/plans
# Create your plan
vim ~/.lumenflow/plans/WU-XXX-plan.md
\`\`\`

Reference in wu:create:
\`\`\`bash
--spec-refs "~/.lumenflow/plans/WU-XXX-plan.md"
\`\`\`

---

## Step 4: Validate First

\`\`\`bash
pnpm wu:create --id WU-XXX ... --validate
\`\`\`

Fix errors, then remove \`--validate\` to create.

---

## Complete Example

\`\`\`bash
pnpm wu:create \\
  --id WU-1234 \\
  --lane "Framework: CLI" \\
  --title "Add feature X" \\
  --description "Context: Users need X. Problem: X doesn't exist. Solution: Add X." \\
  --acceptance "Feature X works as specified" \\
  --acceptance "Unit tests pass with >90% coverage" \\
  --code-paths "packages/@lumenflow/cli/src/x.ts" \\
  --test-paths-unit "packages/@lumenflow/cli/__tests__/x.test.ts" \\
  --exposure backend-only \\
  --spec-refs "~/.lumenflow/plans/WU-1234-plan.md"
\`\`\`

---

## Common Errors

### "Lane format invalid"

**Cause:** Missing colon or space in lane format.

**Fix:** Use \`"Parent: Sublane"\` format (colon + space).

### "Missing required field"

**Cause:** Required field not provided.

**Fix:** Add the missing \`--field\` argument.

### "WU already exists"

**Cause:** WU with this ID already exists.

**Fix:** Use a different ID or check existing WUs.

---

## After Creation

1. Review the created YAML: \`cat {{DOCS_TASKS_PATH}}/wu/WU-XXX.yaml\`
2. Claim the WU: \`pnpm wu:claim --id WU-XXX --lane "Lane"\`
3. cd to worktree: \`cd worktrees/<lane>-wu-xxx\`
`;

// WU-1309: First 15 Minutes template
const FIRST_15_MINS_TEMPLATE = `# First 15 Minutes with LumenFlow

**Last updated:** {{DATE}}

A quick-start guide for your first session with LumenFlow.

---

## Minute 0-2: Verify Setup

\`\`\`bash
# Check LumenFlow is configured
ls LUMENFLOW.md AGENTS.md .lumenflow.config.yaml

# Run doctor to verify safety components
pnpm exec lumenflow doctor
\`\`\`

---

## Minute 2-5: Read Essential Docs

1. Open **LUMENFLOW.md** - Main workflow guide
2. Scan **AGENTS.md** - Quick reference for commands
3. Review **.lumenflow/constraints.md** - The 6 rules you must follow

---

## Minute 5-8: Find a WU to Work On

\`\`\`bash
# Check status board
cat {{DOCS_TASKS_PATH}}/status.md

# List ready WUs
ls {{DOCS_TASKS_PATH}}/wu/*.yaml | head -5
\`\`\`

---

## Minute 8-12: Claim and Start

\`\`\`bash
# Claim a WU
pnpm wu:claim --id WU-XXX --lane "Framework: Core"

# IMPORTANT: cd to worktree immediately
cd worktrees/framework-core-wu-xxx

# Verify you're in the right place
pwd  # Should end with worktrees/...
\`\`\`

---

## Minute 12-15: Begin TDD Cycle

\`\`\`bash
# 1. Write a failing test
# 2. Run it to confirm RED
pnpm test -- --run

# 3. Write minimal code to pass
# 4. Run test again for GREEN
pnpm test -- --run

# 5. Run gates to check everything
pnpm gates
\`\`\`

---

## Key Reminders

- **Stay in the worktree** after claiming
- **TDD**: Test first, then code
- **Gates before done**: Always run \`pnpm gates\`
- **Always wu:done**: Never forget to complete

---

## When Done

\`\`\`bash
# From worktree: run gates
pnpm gates

# From main: complete WU
cd <project-root>
pnpm wu:done --id WU-XXX
\`\`\`
`;

// WU-1309: Local-only / no remote template
const LOCAL_ONLY_TEMPLATE = `# Local-Only Development

**Last updated:** {{DATE}}

Configure LumenFlow for local development without a remote repository.

---

## When to Use

- Air-gapped environments
- Testing/evaluation
- Pre-remote development (haven't pushed to GitHub yet)
- Offline development

---

## Configuration

Add this to \`.lumenflow.config.yaml\`:

\`\`\`yaml
git:
  requireRemote: false
\`\`\`

---

## Behavior Changes

When \`requireRemote: false\`:

| Command | Default Behavior | Local-Only Behavior |
|---------|------------------|---------------------|
| \`wu:create\` | Fetches origin/main | Skips remote fetch |
| \`wu:claim\` | Pushes lane branch | Creates local branch only |
| \`wu:done\` | Pushes to origin | Commits to local main |

---

## Warnings

With local-only mode:

1. **No remote visibility** - Team members can't see your WUs
2. **No backup** - Work is only on your machine
3. **Manual sync required** - When adding a remote later

---

## Transitioning to Remote

When you add an origin remote:

1. Update config: \`git.requireRemote: true\` or remove the setting
2. Push your main branch: \`git push -u origin main\`
3. Resume normal workflow

---

## Troubleshooting

### "No origin remote configured"

**Cause:** \`requireRemote: true\` (default) but no origin exists.

**Fix:** Add remote or set \`requireRemote: false\`:

\`\`\`bash
# Option 1: Add remote
git remote add origin <url>

# Option 2: Enable local-only mode
echo "git:\\n  requireRemote: false" >> .lumenflow.config.yaml
\`\`\`
`;

// WU-1309: Lane Inference template
const LANE_INFERENCE_DOC_TEMPLATE = `# Lane Inference

**Last updated:** {{DATE}}

How LumenFlow determines which lane a WU belongs to.

---

## Lane Format

LumenFlow uses hierarchical lanes: \`"Parent: Sublane"\`

Examples:
- \`"Framework: Core"\`
- \`"Framework: CLI"\`
- \`"Experience: UI"\`
- \`"Operations: CI/CD"\`
- \`"Content: Documentation"\`

---

## Lane Taxonomy File

Lanes are defined in \`.lumenflow.lane-inference.yaml\`:

\`\`\`yaml
Framework:
  Core:
    description: 'Core library'
    code_paths:
      - 'packages/**/core/**'
    keywords:
      - 'core'
      - 'library'

  CLI:
    description: 'CLI commands'
    code_paths:
      - 'packages/**/cli/**'
      - 'bin/**'
    keywords:
      - 'cli'
      - 'command'
\`\`\`

---

## Auto-Inference

Use \`wu:infer-lane\` to suggest a lane based on code paths:

\`\`\`bash
# Infer from WU code_paths
pnpm wu:infer-lane --id WU-XXX

# Infer from manual inputs
pnpm wu:infer-lane --paths "packages/@lumenflow/cli/**" --desc "Add CLI command"
\`\`\`

---

## Generating Lane Taxonomy

If no taxonomy exists, generate one:

\`\`\`bash
pnpm lane:suggest --output .lumenflow.lane-inference.yaml
\`\`\`

---

## Common Issues

### "Lane format invalid"

**Cause:** Missing colon or space.

**Fix:** Use \`"Parent: Sublane"\` format (colon + space).

### "Sub-lane validation failed"

**Cause:** No \`.lumenflow.lane-inference.yaml\` file.

**Fix:** Create the file or generate it:

\`\`\`bash
pnpm lane:suggest --output .lumenflow.lane-inference.yaml
\`\`\`

---

## Lane Health

Check lane configuration for issues:

\`\`\`bash
pnpm lane:health
\`\`\`

This detects:
- Overlapping code paths between lanes
- Code files not covered by any lane
`;

// WU-1385: WU sizing guide template for agent onboarding
const WU_SIZING_GUIDE_TEMPLATE = `# Work Unit Sizing & Strategy Guide

**Last updated:** {{DATE}}

**Purpose:** Decision framework for agents to determine execution strategy based on task complexity.

**Status:** Active — Thresholds are **mandatory limits**, not guidelines.

---

## Complexity Assessment Matrix

Before claiming a WU, estimate its "weight" using these heuristics.

| Complexity    | Files | Tool Calls | Context Budget | Strategy                                     |
| :------------ | :---- | :--------- | :------------- | :------------------------------------------- |
| **Simple**    | <20   | <50        | <30%           | **Single Session** (Tier 2 Context)          |
| **Medium**    | 20-50 | 50-100     | 30-50%         | **Checkpoint-Resume** (Standard Handoff)     |
| **Complex**   | 50+   | 100+       | >50%           | **Orchestrator-Worker** OR **Decomposition** |
| **Oversized** | 100+  | 200+       | —              | **MUST Split** (See Patterns below)          |

**These thresholds are mandatory.** Exceeding them leads to context exhaustion and rule loss. Agents operate in context windows and tool calls, not clock time.

---

## Context Safety Triggers

If you hit ANY of these triggers during a session, you MUST checkpoint and spawn fresh:

- **Token Limit:** Context usage hits **50% (Warning)** or **80% (Critical)**.
- **Tool Volume:** **50+ tool calls** in current session.
- **File Volume:** **20+ files** modified in \`git status\`.
- **Session Staleness:** Repeated redundant queries or forgotten context.

---

## Spawn Fresh, Don't Continue

**When approaching context limits, spawn a fresh agent instead of continuing after compaction.**

Context compaction causes agents to lose critical rules. The disciplined approach:

1. Checkpoint your progress: \`pnpm mem:checkpoint --wu WU-XXX\`
2. Commit and push work
3. Generate fresh agent prompt: \`pnpm wu:spawn --id WU-XXX\`
4. EXIT current session (do NOT continue after compaction)

---

## Splitting Patterns

When a WU is Oversized or Complex, split it using approved patterns:

- **Tracer Bullet**: WU-1 proves skeleton works, WU-2 implements real logic
- **Layer Split**: WU-1 for ports/application, WU-2 for infrastructure
- **UI/Logic Split**: WU-1 for backend, WU-2 for frontend
- **Feature Flag**: WU-1 behind flag, WU-2 removes flag

---

## Quick Reference

| Scenario                            | Strategy            | Action                                       |
| :---------------------------------- | :------------------ | :------------------------------------------- |
| Bug fix, single file, <20 calls     | Simple              | Claim, fix, commit, \`wu:done\`              |
| Feature 50-100 calls, clear phases  | Checkpoint-Resume   | Phase 1 → checkpoint → Phase 2 → done        |
| Multi-domain, must land atomically  | Orchestrator-Worker | Main agent coordinates, spawns sub-agents    |
| Large refactor 100+ calls           | Feature Flag Split  | WU-A: New behind flag → WU-B: Remove flag    |

---

## Documentation-Only Exception

Documentation WUs (\`type: documentation\`) have relaxed file count thresholds:

| Complexity | Files (docs) | Tool Calls | Strategy          |
| :--------- | :----------- | :--------- | :---------------- |
| **Simple** | <40          | <50        | Single Session    |
| **Medium** | 40-80        | 50-100     | Checkpoint-Resume |

**Applies when ALL true:**
- WU \`type: documentation\`
- Only modifies: \`docs/**\`, \`*.md\`
- Does NOT touch code paths

---

For complete sizing guidance, see the canonical [wu-sizing-guide.md](https://lumenflow.dev/reference/wu-sizing-guide/) documentation.
`;

// WU-1083: Claude skills templates
const WU_LIFECYCLE_SKILL_TEMPLATE = `---
name: wu-lifecycle
description: Work Unit claim/block/done workflow automation.
version: 1.0.0
---

# WU Lifecycle Skill

## When to Use

Activate this skill when:

- Claiming a WU (\`pnpm wu:claim\`)
- Blocking/unblocking WUs due to dependencies
- Running \`wu:done\` completion workflow
- Understanding WU state machine transitions

## State Machine

\`\`\`
ready -> in_progress -> waiting/blocked -> done
\`\`\`

## Core Commands

\`\`\`bash
# Claim WU
pnpm wu:claim --id WU-XXX --lane <lane>
cd worktrees/<lane>-wu-xxx   # IMMEDIATELY

# Complete WU (from main)
cd ../..
pnpm wu:done --id WU-XXX

# Block/Unblock
pnpm wu:block --id WU-XXX --reason "..."
pnpm wu:unblock --id WU-XXX

# Create (full spec)
pnpm wu:create --id WU-999 --lane "Operations" --title "Add feature" \\
  --description "Context: ... Problem: ... Solution: ..." \\
  --acceptance "Feature works" --code-paths "src/a.ts" --validate
\`\`\`

## wu:done Workflow

1. Runs gates in worktree
2. Fast-forward merge to main
3. Creates \`.lumenflow/stamps/WU-XXX.done\`
4. Updates backlog.md + status.md
5. Removes worktree

## Worktree Discipline

After \`wu:claim\`:

- \`cd worktrees/<lane>-wu-xxx\` immediately
- Use relative paths (never absolute)
- Main is read-only
`;

const WORKTREE_DISCIPLINE_SKILL_TEMPLATE = `---
name: worktree-discipline
description: Prevents the "absolute path trap" in Write/Edit/Read tools.
version: 1.0.0
---

# Worktree Discipline: Absolute Path Trap Prevention

**Purpose**: Prevent AI agents from bypassing worktree isolation via absolute file paths.

## The Absolute Path Trap

**Problem**: AI agents using Write/Edit/Read tools can bypass worktree isolation by passing absolute paths. Even when your shell is in the worktree, absolute paths target the main checkout.

### Example

\`\`\`typescript
// Shell: cd worktrees/operations-wu-427

// WRONG - Absolute path bypasses worktree
Write({
  file_path: '/<user-home>/source/project/apps/web/src/validator.ts',
  content: '...',
});
// Result: Written to MAIN checkout, not worktree!

// RIGHT - Relative path respects worktree
Write({
  file_path: 'apps/web/src/validator.ts',
  content: '...',
});
// Result: Written to worktree correctly
\`\`\`

## Pre-Operation Checklist

**Before ANY Write/Edit/Read operation:**

1. **Verify working directory**:

   \`\`\`bash
   pwd
   # Must show: .../worktrees/<lane>-wu-xxx
   \`\`\`

2. **Check file path format**:

   | Pattern                           | Safe? | Example                     |
   | --------------------------------- | ----- | --------------------------- |
   | Starts with \`/<user-home>/\`       | NO    | \`/<user-home>/.../file.ts\` |
   | Contains full repo path           | NO    | \`/source/project/...\`    |
   | Starts with package name          | YES   | \`apps/web/src/...\`       |
   | Starts with \`./\` or \`../\`         | YES   | \`./src/lib/...\`          |
   | Just filename                     | YES   | \`README.md\`              |

3. **Use relative paths for ALL file operations**

## Golden Rules

1. **Always verify pwd** before file operations
2. **Never use absolute paths** in Write/Edit/Read tools
3. **When in doubt, use relative paths**
`;

const LUMENFLOW_GATES_SKILL_TEMPLATE = `---
name: lumenflow-gates
description: Quality gates troubleshooting (format, lint, typecheck, tests).
version: 1.0.0
---

# LumenFlow Gates Skill

## When to Use

Activate this skill when:

- \`pnpm gates\` fails with format, lint, or typecheck errors
- Need to determine if failure is from your changes vs pre-existing
- Debugging test failures or coverage issues
- Deciding whether to use \`--skip-gates\` (emergency only)

## Gate Sequence

\`\`\`
pnpm gates = format:check -> lint -> typecheck -> spec:linter -> tests
\`\`\`

## Fix Patterns

| Gate      | Auto-fix        | Manual                              |
| --------- | --------------- | ----------------------------------- |
| Format    | \`pnpm format\`   | -                                   |
| Lint      | \`pnpm lint:fix\` | Fix reported issues                 |
| Typecheck | -               | Fix type errors (first error first) |
| Tests     | -               | Debug, fix mocks, update snapshots  |

## Decision Tree

**Gate failed. Is it from YOUR changes?**

\`\`\`bash
git checkout main && pnpm gates  # Check main
# Pass on main -> Your change caused it -> Fix it
# Fail on main -> Pre-existing -> Consider --skip-gates
\`\`\`

**Can you fix it?**

- In your \`code_paths\`, <=10 lines -> Fix in place
- Different paths, >10 lines -> Create Bug WU

## Skip Gates (Emergency)

Only when pre-existing failures:

\`\`\`bash
pnpm wu:done --id WU-XXX --skip-gates --reason "Pre-existing" --fix-wu WU-YYY
\`\`\`

## Common Lint Fixes

\`\`\`
no-explicit-any -> Add proper types
no-unused-vars -> Remove or prefix with _
no-restricted-paths -> Check hex boundaries
exhaustive-deps -> Add missing dependencies
\`\`\`

## Validation Commands

\`\`\`bash
pnpm gates                # All gates
pnpm gates -- --docs-only # Docs WUs
pnpm format               # Fix formatting
pnpm lint:fix             # Fix lint issues
pnpm typecheck            # Check types
\`\`\`
`;

/**
 * Detect default client from environment
 */
function detectDefaultClient(): DefaultClient {
  if (process.env.CLAUDE_PROJECT_DIR || process.env.CLAUDE_CODE) {
    return DEFAULT_CLIENT_CLAUDE;
  }
  return 'none';
}

/**
 * WU-1171: Resolve client type from options
 * --client takes precedence over --vendor (backwards compat)
 */
function resolveClientType(
  client: ClientType | undefined,
  vendor: ClientType | undefined,
  defaultClient: DefaultClient,
): ClientType {
  // Explicit --client or --vendor takes precedence
  if (client) {
    return client;
  }
  if (vendor) {
    return vendor;
  }
  // Default based on environment
  return defaultClient === DEFAULT_CLIENT_CLAUDE ? 'claude' : 'none';
}

/**
 * WU-1171: Determine file mode from options
 */
function getFileMode(options: ScaffoldOptions): FileMode {
  if (options.force) {
    return 'force';
  }
  if (options.merge) {
    return 'merge';
  }
  return 'skip';
}

/**
 * WU-1364: Check if directory is a git repository
 */
function isGitRepo(targetDir: string): boolean {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: targetDir,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * WU-1364: Check if git repo has any commits
 */
function hasGitCommits(targetDir: string): boolean {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: targetDir,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * WU-1364: Check if git repo has an origin remote
 */
function hasOriginRemote(targetDir: string): boolean {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    const result = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: targetDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * WU-1576: Run client-specific integrations (enforcement hooks) based on config.
 *
 * Reads the just-scaffolded .lumenflow.config.yaml and runs integration for any
 * client that has enforcement.hooks enabled. This is vendor-agnostic: when new
 * clients add enforcement support, register them in CLIENT_INTEGRATIONS.
 *
 * Must run BEFORE the initial commit so all generated files are included.
 */

// Vendor-agnostic dispatch map: client key in config → integration adapter.
// Each adapter runs integration and returns relative paths of files it created.
// init.ts has zero knowledge of client-specific paths — adapters own that.
const CLIENT_INTEGRATIONS: Record<
  string,
  (projectDir: string, enforcement: Record<string, unknown>) => Promise<string[]>
> = {
  [DEFAULT_CLIENT_CLAUDE]: (projectDir, enforcement) =>
    integrateClaudeCode(projectDir, { enforcement }),
  // When new clients gain enforcement: add adapter entry here.
};

async function runClientIntegrations(targetDir: string, result: ScaffoldResult): Promise<string[]> {
  const integrationFiles: string[] = [];
  const configPath = path.join(targetDir, CONFIG_FILE_NAME);
  if (!fs.existsSync(configPath)) return integrationFiles;

  let config: Record<string, unknown> | null;
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    config = yaml.parse(content) as Record<string, unknown> | null;
  } catch {
    return integrationFiles; // Config unreadable — skip silently
  }
  if (!config) return integrationFiles;

  const agents = config.agents as Record<string, unknown> | undefined;
  const clients = agents?.clients as Record<string, Record<string, unknown>> | undefined;
  if (!clients) return integrationFiles;

  for (const [clientKey, clientConfig] of Object.entries(clients)) {
    const enforcement = clientConfig.enforcement as Record<string, unknown> | undefined;
    if (!enforcement?.hooks) continue;

    const integrateFn = CLIENT_INTEGRATIONS[clientKey];
    if (!integrateFn) continue;

    const createdFiles = await integrateFn(targetDir, enforcement);
    integrationFiles.push(...createdFiles);
  }

  result.created.push(...integrationFiles);
  result.integrationFiles = integrationFiles;
  return integrationFiles;
}

/**
 * WU-1364: Create initial commit if git repo has no commits
 */
function createInitialCommitIfNeeded(targetDir: string): boolean {
  if (!isGitRepo(targetDir) || hasGitCommits(targetDir)) {
    return false;
  }

  try {
    // Stage all files

    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    execFileSync('git', ['add', '.'], { cwd: targetDir, stdio: 'pipe' });
    // Create initial commit

    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    execFileSync('git', ['commit', '-m', 'chore: initialize LumenFlow project'], {
      cwd: targetDir,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * WU-1497: Rename master branch to main if git init defaulted to master.
 *
 * Many git installations still default to "master" as the initial branch name.
 * LumenFlow requires "main" for consistency. This renames the branch automatically
 * so users do not need to run `git branch -m master main` manually.
 *
 * Safe to call at any point: only renames when current branch is exactly "master".
 */
export function renameMasterToMainIfNeeded(targetDir: string): boolean {
  if (!isGitRepo(targetDir)) {
    return false;
  }

  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    const currentBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: targetDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();

    if (currentBranch !== 'master') {
      return false;
    }

    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    execFileSync('git', ['branch', '-m', 'master', 'main'], {
      cwd: targetDir,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * WU-1364: Detect git state and return config overrides
 * Returns requireRemote: false if no origin remote is configured
 */
interface GitStateConfig {
  requireRemote: boolean;
}

function detectGitStateConfig(targetDir: string): GitStateConfig | null {
  // If not a git repo, default to local-only mode for safety
  if (!isGitRepo(targetDir)) {
    return { requireRemote: false };
  }

  // If git repo but no origin remote, set requireRemote: false
  if (!hasOriginRemote(targetDir)) {
    return { requireRemote: false };
  }

  // Has origin remote - use default (requireRemote: true)
  return null;
}

/**
 * WU-1171: Get templates directory path
 */
function getTemplatesDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Check for dist/templates (production) or ../templates (development)
  const distTemplates = path.join(__dirname, '..', 'templates');
  if (fs.existsSync(distTemplates)) {
    return distTemplates;
  }

  throw new Error(`Templates directory not found at ${distTemplates}`);
}

/**
 * WU-1171: Load a template file
 */
function loadTemplate(templatePath: string): string {
  const templatesDir = getTemplatesDir();
  const fullPath = path.join(templatesDir, templatePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  return fs.readFileSync(fullPath, 'utf-8');
}

/**
 * Scaffold a new LumenFlow project
 * WU-1171: Added AGENTS.md, --merge mode, updated vendor/client handling
 * WU-1362: Added branch guard to prevent main branch pollution
 */
export async function scaffoldProject(
  targetDir: string,
  options: ScaffoldOptions,
): Promise<ScaffoldResult> {
  const result: ScaffoldResult = {
    created: [],
    skipped: [],
    merged: [],
    warnings: [],
  };

  // WU-1362: Check branch before writing tracked files
  // Only block if we're on main branch AND not in a worktree
  // This allows scaffold to run in worktrees and during initial setup
  await checkBranchGuard(targetDir, result);

  const defaultClient = options.defaultClient ?? detectDefaultClient();
  // WU-1171: Use resolveClientType with both client and vendor (vendor is deprecated but kept for backwards compat)

  const client = resolveClientType(options.client, options.vendor, defaultClient);
  const fileMode = getFileMode(options);

  // Ensure target directory exists
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // WU-1309: Detect or use specified docs structure
  const docsStructure = options.docsStructure ?? detectDocsStructure(targetDir);
  const docsPaths = getDocsPath(docsStructure);

  // WU-1364: Detect git state for config generation
  const gitConfigOverride = detectGitStateConfig(targetDir);

  const tokenDefaults = {
    DATE: getCurrentDate(),
    PROJECT_ROOT: '<project-root>', // WU-1309: Use portable placeholder
    QUICK_REF_LINK: docsPaths.quickRefLink,
    DOCS_OPERATIONS_PATH: docsPaths.operations, // WU-1309: For framework overlay
    DOCS_TASKS_PATH: docsPaths.tasks,
    DOCS_ONBOARDING_PATH: docsPaths.onboarding,
  };

  // Create .lumenflow.config.yaml (WU-1067: includes gate preset if specified)
  // WU-1364: Includes git config overrides (e.g., requireRemote: false for local-only)
  // WU-1383: Includes enforcement hooks for Claude client
  // Note: Config files don't use merge mode (always skip or force)
  const configPath = path.join(targetDir, CONFIG_FILE_NAME);

  // WU-1383: Warn if config already exists to discourage manual editing
  if (fs.existsSync(configPath) && !options.force) {
    result.warnings = result.warnings ?? [];
    result.warnings.push(
      `${CONFIG_FILE_NAME} already exists. ` +
        'To modify configuration, use CLI commands (e.g., pnpm lumenflow:init --force) ' +
        'instead of manual editing.',
    );
  }

  await createFile(
    configPath,
    generateLumenflowConfigYaml(options.gatePreset, gitConfigOverride, client),
    options.force ? 'force' : 'skip',
    result,
    targetDir,
  );

  // WU-1171: Create AGENTS.md (universal entry point for all agents)
  try {
    const agentsTemplate = loadTemplate('core/AGENTS.md.template');
    await createFile(
      path.join(targetDir, 'AGENTS.md'),
      processTemplate(agentsTemplate, tokenDefaults),
      fileMode,
      result,
      targetDir,
    );
  } catch {
    // Fallback to hardcoded template if template file not found
    await createFile(
      path.join(targetDir, 'AGENTS.md'),
      processTemplate(AGENTS_MD_TEMPLATE, tokenDefaults),
      fileMode,
      result,
      targetDir,
    );
  }

  // Create LUMENFLOW.md (main entry point)
  await createFile(
    path.join(targetDir, 'LUMENFLOW.md'),
    processTemplate(LUMENFLOW_MD_TEMPLATE, tokenDefaults),
    fileMode,
    result,
    targetDir,
  );

  // Create .lumenflow/constraints.md
  await createFile(
    path.join(targetDir, LUMENFLOW_DIR, 'constraints.md'),
    processTemplate(CONSTRAINTS_MD_TEMPLATE, tokenDefaults),
    fileMode,
    result,
    targetDir,
  );

  // Create .lumenflow/agents directory with .gitkeep
  await createDirectory(path.join(targetDir, LUMENFLOW_AGENTS_DIR), result, targetDir);
  await createFile(
    path.join(targetDir, LUMENFLOW_AGENTS_DIR, '.gitkeep'),
    '',
    options.force ? 'force' : 'skip',
    result,
    targetDir,
  );

  // WU-1342: Create .gitignore with required exclusions
  await scaffoldGitignore(targetDir, options, result);

  // WU-1517: Create .prettierignore so format:check passes immediately after init
  await scaffoldPrettierignore(targetDir, options, result);

  // WU-1408: Scaffold safe-git wrapper and pre-commit hook
  // These are core safety components needed for all projects
  await scaffoldSafetyScripts(targetDir, options, result);

  // Optional: full docs scaffolding
  if (options.full) {
    await scaffoldFullDocs(targetDir, options, result, tokenDefaults);
  }

  // Optional: framework overlay
  if (options.framework) {
    await scaffoldFrameworkOverlay(targetDir, options, result, tokenDefaults);
  }

  // Scaffold client-specific files (WU-1171: renamed from vendor)
  await scaffoldClientFiles(targetDir, options, result, tokenDefaults, client);

  // WU-1300: Inject LumenFlow scripts into package.json
  if (options.full) {
    await injectPackageJsonScripts(targetDir, options, result);
  }

  // WU-1576: Run client integrations (enforcement hooks) BEFORE initial commit.
  // Reads the just-scaffolded config, dispatches to registered adapters per client.
  // Vendor-agnostic: init.ts has zero knowledge of client-specific file paths.
  await runClientIntegrations(targetDir, result);

  // WU-1364: Create initial commit if git repo has no commits
  // This must be done after all files are created
  const createdInitialCommit = createInitialCommitIfNeeded(targetDir);
  if (createdInitialCommit) {
    result.created.push('Initial git commit');
  }

  // WU-1497: Rename master branch to main if git init defaulted to master
  // Must run after initial commit so the branch ref exists for rename
  const renamedBranch = renameMasterToMainIfNeeded(targetDir);
  if (renamedBranch) {
    result.created.push('Renamed branch master -> main');
  }

  return result;
}

/**
 * WU-1342: .gitignore template with required exclusions
 * WU-1519: Removed .lumenflow/state/ (must be tracked for wu-events.jsonl)
 * Includes node_modules, .lumenflow/telemetry, and worktrees
 */
const GITIGNORE_TEMPLATE = `# Dependencies
node_modules/

# LumenFlow telemetry (local only, not shared)
.lumenflow/telemetry/

# Worktrees (isolated parallel work directories)
worktrees/

# Build output
dist/
*.tsbuildinfo

# Environment files
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS files
.DS_Store
Thumbs.db
`;

/** Gitignore file name constant to avoid duplicate string lint error */
const GITIGNORE_FILE_NAME = '.gitignore';

/**
 * WU-1342: Scaffold .gitignore file with LumenFlow exclusions
 * Supports merge mode to add exclusions to existing .gitignore
 */
async function scaffoldGitignore(
  targetDir: string,
  options: ScaffoldOptions,
  result: ScaffoldResult,
): Promise<void> {
  const gitignorePath = path.join(targetDir, GITIGNORE_FILE_NAME);
  const fileMode = getFileMode(options);

  if (fileMode === 'merge' && fs.existsSync(gitignorePath)) {
    // Merge mode: append LumenFlow exclusions if not already present
    const existingContent = fs.readFileSync(gitignorePath, 'utf-8');
    const linesToAdd: string[] = [];

    // Check each required exclusion
    // WU-1519: Replaced .lumenflow/state with .lumenflow/telemetry
    const requiredExclusions = [
      { pattern: 'node_modules', line: 'node_modules/' },
      { pattern: '.lumenflow/telemetry', line: '.lumenflow/telemetry/' },
      { pattern: 'worktrees', line: 'worktrees/' },
    ];

    for (const { pattern, line } of requiredExclusions) {
      if (!existingContent.includes(pattern)) {
        linesToAdd.push(line);
      }
    }

    if (linesToAdd.length > 0) {
      const separator = existingContent.endsWith('\n') ? '' : '\n';
      const lumenflowBlock = `${separator}
# LumenFlow (auto-added)
${linesToAdd.join('\n')}
`;
      fs.writeFileSync(gitignorePath, existingContent + lumenflowBlock);
      result.merged?.push(GITIGNORE_FILE_NAME);
    } else {
      result.skipped.push(GITIGNORE_FILE_NAME);
    }
    return;
  }

  // Skip or force mode
  await createFile(gitignorePath, GITIGNORE_TEMPLATE, fileMode, result, targetDir);
}

/**
 * WU-1517: .prettierignore template with sane defaults
 * Ensures format:check passes immediately after init by excluding
 * generated files, build artifacts, and lockfiles.
 */
const PRETTIERIGNORE_TEMPLATE = `# Dependencies
node_modules/

# Build output
dist/
*.tsbuildinfo

# Coverage reports
coverage/

# LumenFlow state (local only)
.lumenflow/state/

# Worktrees
worktrees/

# Lockfiles (auto-generated)
pnpm-lock.yaml
package-lock.json
yarn.lock

# Environment files
.env
.env.local
.env.*.local
`;

/** Prettierignore file name constant to avoid duplicate string lint error */
const PRETTIERIGNORE_FILE_NAME = '.prettierignore';

/**
 * WU-1517: Scaffold .prettierignore file with sane defaults
 * This is a core file scaffolded in all modes (full and minimal)
 * because it's required for format:check gate to pass.
 */
async function scaffoldPrettierignore(
  targetDir: string,
  options: ScaffoldOptions,
  result: ScaffoldResult,
): Promise<void> {
  const prettierignorePath = path.join(targetDir, PRETTIERIGNORE_FILE_NAME);
  const fileMode = getFileMode(options);

  await createFile(prettierignorePath, PRETTIERIGNORE_TEMPLATE, fileMode, result, targetDir);
}

/**
 * WU-1433: Script argument overrides for commands that need extra flags.
 * Most commands map simply to their binName, but some aliases need arguments.
 * Key = command name (colon notation), Value = full script command string.
 */
const SCRIPT_ARG_OVERRIDES: Record<string, string> = {
  'gates:docs': 'gates --docs-only',
};

/**
 * WU-1307: LumenFlow scripts to inject into package.json
 * WU-1342: Expanded to include essential commands
 * WU-1433: Now derived from the public CLI manifest (WU-1432) instead of
 * hardcoded list. Ensures all public commands are exposed and avoids drift.
 */
function generateLumenflowScripts(): Record<string, string> {
  const scripts: Record<string, string> = {};
  const manifest = getPublicManifest();

  for (const cmd of manifest) {
    // Use override if defined, otherwise map to the binary name
    scripts[cmd.name] = SCRIPT_ARG_OVERRIDES[cmd.name] ?? cmd.binName;
  }

  return scripts;
}

/** WU-1408: Safety script path constants */
const SCRIPTS_DIR = 'scripts';
const SAFE_GIT_FILE = 'safe-git';
const HUSKY_DIR = '.husky';
const PRE_COMMIT_FILE = 'pre-commit';
const SAFE_GIT_TEMPLATE_PATH = 'core/scripts/safe-git.template';
const PRE_COMMIT_TEMPLATE_PATH = 'core/.husky/pre-commit.template';

/**
 * WU-1408: Scaffold safety scripts (safe-git wrapper and pre-commit hook)
 * These are core safety components needed for LumenFlow enforcement:
 * - scripts/safe-git: Blocks dangerous git operations (e.g., manual worktree remove)
 * - .husky/pre-commit: Blocks direct commits to main/master, enforces WU workflow
 *
 * Both scripts are scaffolded in all modes (full and minimal) because they are
 * required for lumenflow-doctor to pass.
 */
async function scaffoldSafetyScripts(
  targetDir: string,
  options: ScaffoldOptions,
  result: ScaffoldResult,
): Promise<void> {
  const fileMode = getFileMode(options);

  // Scaffold scripts/safe-git
  const safeGitPath = path.join(targetDir, SCRIPTS_DIR, SAFE_GIT_FILE);
  try {
    const safeGitTemplate = loadTemplate(SAFE_GIT_TEMPLATE_PATH);
    await createExecutableScript(safeGitPath, safeGitTemplate, fileMode, result, targetDir);
  } catch {
    // Fallback to hardcoded template if template file not found
    await createExecutableScript(safeGitPath, SAFE_GIT_TEMPLATE, fileMode, result, targetDir);
  }

  // Scaffold .husky/pre-commit
  const preCommitPath = path.join(targetDir, HUSKY_DIR, PRE_COMMIT_FILE);
  try {
    const preCommitTemplate = loadTemplate(PRE_COMMIT_TEMPLATE_PATH);
    await createExecutableScript(preCommitPath, preCommitTemplate, fileMode, result, targetDir);
  } catch {
    // Fallback to hardcoded template if template file not found
    await createExecutableScript(preCommitPath, PRE_COMMIT_TEMPLATE, fileMode, result, targetDir);
  }
}

/**
 * WU-1408: Fallback safe-git template
 * Blocks dangerous git operations in LumenFlow environment
 */
const SAFE_GIT_TEMPLATE = `#!/bin/sh
#
# safe-git - LumenFlow safety wrapper for git
#
# Blocks dangerous operations that can corrupt agent state.
# For all other commands, passes through to system git.
#

set -e

# Block 'worktree remove'
if [ "$1" = "worktree" ] && [ "$2" = "remove" ]; then
  echo "" >&2
  echo "=== LUMENFLOW SAFETY BLOCK ===" >&2
  echo "" >&2
  echo "BLOCKED: Manual 'git worktree remove' is unsafe in this environment." >&2
  echo "" >&2
  echo "REASON: Manual removal leaves orphan directories and corrupts agent state." >&2
  echo "" >&2
  echo "USE INSTEAD:" >&2
  echo "  pnpm wu:done --id <ID>    (To complete a task)" >&2
  echo "  pnpm wu:cleanup --id <ID> (To discard a task)" >&2
  echo "==============================" >&2
  exit 1
fi

# Pass through to real git
exec git "$@"
`;

/**
 * WU-1408: Fallback pre-commit template
 * Blocks direct commits to main/master, allows commits on lane branches
 * Does NOT run pnpm test (which fails on new projects)
 */
const PRE_COMMIT_TEMPLATE = `#!/bin/sh
#
# LumenFlow Pre-Commit Hook
#
# Enforces worktree discipline by blocking direct commits to main/master.
# Does NOT assume pnpm test or any other commands exist.
#
# Rules:
#   1. BLOCK commits to main/master (use WU workflow instead)
#   2. ALLOW commits on lane branches (lane/*/wu-*)
#   3. ALLOW commits on tmp/* branches (CLI micro-worktrees)
#

# Skip on tmp/* branches (CLI micro-worktrees)
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
case "$BRANCH" in tmp/*) exit 0 ;; esac

# Check for force bypass
if [ "$LUMENFLOW_FORCE" = "1" ]; then
  exit 0
fi

# Block direct commits to main/master
case "$BRANCH" in
  main|master)
    echo "" >&2
    echo "=== DIRECT COMMIT TO \${BRANCH} BLOCKED ===" >&2
    echo "" >&2
    echo "LumenFlow protects main from direct commits." >&2
    echo "" >&2
    echo "USE INSTEAD:" >&2
    echo "  pnpm wu:claim --id WU-XXXX --lane \\"<Lane>\\"" >&2
    echo "  cd worktrees/<lane>-wu-xxxx" >&2
    echo "  # Make commits in the worktree" >&2
    echo "" >&2
    echo "EMERGENCY BYPASS (logged):" >&2
    echo "  LUMENFLOW_FORCE=1 git commit ..." >&2
    echo "==========================================" >&2
    exit 1
    ;;
esac

# Allow commits on other branches
exit 0
`;

/**
 * WU-1517: Prettier version to add to devDependencies.
 * Uses caret range to allow minor/patch updates.
 */
const PRETTIER_VERSION = '^3.8.0';

/** WU-1517: Prettier package name constant */
const PRETTIER_PACKAGE_NAME = 'prettier';

/** WU-1517: Format script names */
const FORMAT_SCRIPT_NAME = 'format';
const FORMAT_CHECK_SCRIPT_NAME = 'format:check';

/** WU-1517: Format script commands using prettier */
const FORMAT_SCRIPT_COMMAND = 'prettier --write .';
const FORMAT_CHECK_SCRIPT_COMMAND = 'prettier --check .';

/**
 * WU-1518: Gate stub scripts for projects that don't have their own lint/typecheck/spec-linter.
 * These stubs log a clear message and exit 0 so `pnpm gates` passes on a fresh project.
 * Projects should replace them with real tooling when ready.
 */
const GATE_STUB_SCRIPTS: Record<string, string> = {
  'spec:linter':
    'echo "[lumenflow] spec:linter stub -- install a WU spec linter or replace this script" && exit 0',
  lint: 'echo "[lumenflow] lint stub -- add ESLint or your preferred linter to enable this gate (e.g. eslint .)" && exit 0',
  typecheck:
    'echo "[lumenflow] typecheck stub -- add TypeScript or your type checker to enable this gate (e.g. tsc --noEmit)" && exit 0',
};

/**
 * WU-1300: Inject LumenFlow scripts into package.json
 * WU-1517: Also adds prettier devDependency and format/format:check scripts
 * WU-1518: Also adds gate stub scripts (spec:linter, lint, typecheck)
 * - Creates package.json if it doesn't exist
 * - Preserves existing scripts (doesn't overwrite unless --force)
 * - Adds missing LumenFlow scripts
 * - Adds prettier to devDependencies
 * - Adds format and format:check scripts
 * - Adds gate stub scripts for spec:linter, lint, typecheck
 */
async function injectPackageJsonScripts(
  targetDir: string,
  options: ScaffoldOptions,
  result: ScaffoldResult,
): Promise<void> {
  const packageJsonPath = path.join(targetDir, 'package.json');
  let packageJson: Record<string, unknown>;

  if (fs.existsSync(packageJsonPath)) {
    // Read existing package.json
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    packageJson = JSON.parse(content) as Record<string, unknown>;
  } else {
    // Create minimal package.json
    packageJson = {
      name: path.basename(targetDir),
      version: '0.0.1',
      private: true,
    };
  }

  // Ensure scripts object exists
  if (!packageJson.scripts || typeof packageJson.scripts !== 'object') {
    packageJson.scripts = {};
  }

  const scripts = packageJson.scripts as Record<string, string>;
  let modified = false;

  // WU-1433: Derive scripts from public manifest (not hardcoded)
  const lumenflowScripts = generateLumenflowScripts();
  for (const [scriptName, scriptCommand] of Object.entries(lumenflowScripts)) {
    if (options.force || !(scriptName in scripts)) {
      if (!(scriptName in scripts)) {
        scripts[scriptName] = scriptCommand;
        modified = true;
      }
    }
  }

  // WU-1517: Add format and format:check scripts
  const formatScripts: Record<string, string> = {
    [FORMAT_SCRIPT_NAME]: FORMAT_SCRIPT_COMMAND,
    [FORMAT_CHECK_SCRIPT_NAME]: FORMAT_CHECK_SCRIPT_COMMAND,
  };
  for (const [scriptName, scriptCommand] of Object.entries(formatScripts)) {
    if (options.force || !(scriptName in scripts)) {
      if (!(scriptName in scripts)) {
        scripts[scriptName] = scriptCommand;
        modified = true;
      }
    }
  }

  // WU-1518: Add gate stub scripts (spec:linter, lint, typecheck)
  // These stubs let `pnpm gates` pass on a fresh project without manual script additions.
  // Projects replace them with real tooling when ready.
  for (const [scriptName, scriptCommand] of Object.entries(GATE_STUB_SCRIPTS)) {
    if (options.force) {
      scripts[scriptName] = scriptCommand;
      modified = true;
    } else if (!(scriptName in scripts)) {
      scripts[scriptName] = scriptCommand;
      modified = true;
    }
  }

  // WU-1517: Add prettier to devDependencies
  if (!packageJson.devDependencies || typeof packageJson.devDependencies !== 'object') {
    packageJson.devDependencies = {};
  }
  const devDeps = packageJson.devDependencies as Record<string, string>;
  if (options.force || !(PRETTIER_PACKAGE_NAME in devDeps)) {
    if (!(PRETTIER_PACKAGE_NAME in devDeps)) {
      devDeps[PRETTIER_PACKAGE_NAME] = PRETTIER_VERSION;
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    result.created.push('package.json (scripts updated)');
  }
}

async function scaffoldFullDocs(
  targetDir: string,
  options: ScaffoldOptions,
  result: ScaffoldResult,
  tokens: Record<string, string>,
): Promise<void> {
  // WU-1309: Use docs structure from tokens (computed in scaffoldProject)
  const tasksPath = tokens.DOCS_TASKS_PATH;
  const tasksDir = path.join(targetDir, tasksPath);
  const wuDir = path.join(tasksDir, 'wu');
  const templatesDir = path.join(tasksDir, 'templates');

  await createDirectory(wuDir, result, targetDir);
  await createDirectory(templatesDir, result, targetDir);
  await createFile(path.join(wuDir, '.gitkeep'), '', options.force, result, targetDir);

  await createFile(
    path.join(tasksDir, 'backlog.md'),
    BACKLOG_TEMPLATE,
    options.force,
    result,
    targetDir,
  );

  await createFile(
    path.join(tasksDir, 'status.md'),
    STATUS_TEMPLATE,
    options.force,
    result,
    targetDir,
  );

  await createFile(
    path.join(templatesDir, 'wu-template.yaml'),
    processTemplate(WU_TEMPLATE_YAML, tokens),
    options.force,
    result,
    targetDir,
  );

  // WU-1300: Scaffold lane inference configuration
  await scaffoldLaneInference(targetDir, options, result, tokens);

  // WU-1083: Scaffold agent onboarding docs with --full
  await scaffoldAgentOnboardingDocs(targetDir, options, result, tokens);
}

/**
 * WU-1307: Scaffold lane inference configuration
 * Uses hierarchical Parent→Sublane format required by lane-inference.ts
 */
async function scaffoldLaneInference(
  targetDir: string,
  options: ScaffoldOptions,
  result: ScaffoldResult,
  tokens: Record<string, string>,
): Promise<void> {
  // WU-1307: Add framework-specific lanes in hierarchical format if framework is provided
  let frameworkLanes = '';
  if (options.framework) {
    const { name, slug } = normalizeFrameworkName(options.framework);
    // Add framework lanes in hierarchical format (indentation matters in YAML)
    frameworkLanes = `
# Framework-specific lanes (added with --framework ${name})
  ${name}:
    description: '${name} framework-specific code'
    code_paths:
      - 'src/${slug}/**'
      - 'packages/${slug}/**'
    keywords:
      - '${slug}'
      - '${name.toLowerCase()}'
`;
  }

  const laneInferenceContent = processTemplate(LANE_INFERENCE_TEMPLATE, {
    ...tokens,
    FRAMEWORK_LANES: frameworkLanes,
  });

  await createFile(
    path.join(targetDir, '.lumenflow.lane-inference.yaml'),
    laneInferenceContent,
    options.force ? 'force' : 'skip',
    result,
    targetDir,
  );
}

/**
 * WU-1083: Scaffold agent onboarding documentation
 * WU-1300: Added starting-prompt.md
 * WU-1309: Added first-15-mins.md, local-only.md, lane-inference.md; use dynamic docs path
 */
async function scaffoldAgentOnboardingDocs(
  targetDir: string,
  options: ScaffoldOptions,
  result: ScaffoldResult,
  tokens: Record<string, string>,
): Promise<void> {
  // WU-1309: Use dynamic onboarding path from tokens
  const onboardingDir = path.join(targetDir, tokens.DOCS_ONBOARDING_PATH);

  await createDirectory(onboardingDir, result, targetDir);

  // WU-1300: Add starting-prompt.md as first file
  await createFile(
    path.join(onboardingDir, 'starting-prompt.md'),
    processTemplate(STARTING_PROMPT_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  // WU-1309: Add first-15-mins.md
  await createFile(
    path.join(onboardingDir, 'first-15-mins.md'),
    processTemplate(FIRST_15_MINS_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  // WU-1309: Add local-only.md
  await createFile(
    path.join(onboardingDir, 'local-only.md'),
    processTemplate(LOCAL_ONLY_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  // WU-1309: Add lane-inference.md
  await createFile(
    path.join(onboardingDir, 'lane-inference.md'),
    processTemplate(LANE_INFERENCE_DOC_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  await createFile(
    path.join(onboardingDir, 'quick-ref-commands.md'),
    processTemplate(QUICK_REF_COMMANDS_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  await createFile(
    path.join(onboardingDir, 'first-wu-mistakes.md'),
    processTemplate(FIRST_WU_MISTAKES_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  await createFile(
    path.join(onboardingDir, 'troubleshooting-wu-done.md'),
    processTemplate(TROUBLESHOOTING_WU_DONE_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  await createFile(
    path.join(onboardingDir, 'agent-safety-card.md'),
    processTemplate(AGENT_SAFETY_CARD_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  await createFile(
    path.join(onboardingDir, 'wu-create-checklist.md'),
    processTemplate(WU_CREATE_CHECKLIST_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  // WU-1385: Add wu-sizing-guide.md to onboarding docs
  await createFile(
    path.join(onboardingDir, 'wu-sizing-guide.md'),
    processTemplate(WU_SIZING_GUIDE_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );
}

/**
 * WU-1083: Scaffold Claude skills
 */
async function scaffoldClaudeSkills(
  targetDir: string,
  options: ScaffoldOptions,
  result: ScaffoldResult,
  tokens: Record<string, string>,
): Promise<void> {
  const skillsDir = path.join(targetDir, '.claude', 'skills');

  // wu-lifecycle skill
  const wuLifecycleDir = path.join(skillsDir, 'wu-lifecycle');
  await createDirectory(wuLifecycleDir, result, targetDir);
  await createFile(
    path.join(wuLifecycleDir, 'SKILL.md'),
    processTemplate(WU_LIFECYCLE_SKILL_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  // worktree-discipline skill
  const worktreeDir = path.join(skillsDir, 'worktree-discipline');
  await createDirectory(worktreeDir, result, targetDir);
  await createFile(
    path.join(worktreeDir, 'SKILL.md'),
    processTemplate(WORKTREE_DISCIPLINE_SKILL_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  // lumenflow-gates skill
  const gatesDir = path.join(skillsDir, 'lumenflow-gates');
  await createDirectory(gatesDir, result, targetDir);
  await createFile(
    path.join(gatesDir, 'SKILL.md'),
    processTemplate(LUMENFLOW_GATES_SKILL_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );
}

async function scaffoldFrameworkOverlay(
  targetDir: string,
  options: ScaffoldOptions,
  result: ScaffoldResult,
  tokens: Record<string, string>,
): Promise<void> {
  if (!options.framework) {
    return;
  }

  const { name, slug } = normalizeFrameworkName(options.framework);
  const frameworkTokens = {
    ...tokens,
    FRAMEWORK_NAME: name,
    FRAMEWORK_SLUG: slug,
  };

  await createFile(
    path.join(targetDir, FRAMEWORK_HINT_FILE),
    processTemplate(FRAMEWORK_HINT_TEMPLATE, frameworkTokens),
    options.force,
    result,
    targetDir,
  );

  // WU-1309: Use dynamic operations path from tokens
  const overlayDir = path.join(targetDir, tokens.DOCS_OPERATIONS_PATH, '_frameworks', slug);
  await createDirectory(overlayDir, result, targetDir);

  await createFile(
    path.join(overlayDir, 'README.md'),
    processTemplate(FRAMEWORK_OVERLAY_TEMPLATE, frameworkTokens),
    options.force,
    result,
    targetDir,
  );
}

/**
 * WU-1171: Scaffold client-specific files based on --client option
 * Updated paths: Cursor uses .cursor/rules/lumenflow.md, Windsurf uses .windsurf/rules/lumenflow.md
 */
async function scaffoldClientFiles(
  targetDir: string,
  options: ScaffoldOptions,
  result: ScaffoldResult,
  tokens: Record<string, string>,
  client: ClientType,
): Promise<void> {
  const fileMode = getFileMode(options);

  // Claude Code
  if (client === 'claude' || client === 'all') {
    // WU-1171: Single CLAUDE.md at root only (no .claude/CLAUDE.md duplication)
    await createFile(
      path.join(targetDir, 'CLAUDE.md'),
      processTemplate(CLAUDE_MD_TEMPLATE, tokens),
      fileMode,
      result,
      targetDir,
    );

    await createDirectory(path.join(targetDir, CLAUDE_AGENTS_DIR), result, targetDir);
    await createFile(
      path.join(targetDir, CLAUDE_AGENTS_DIR, '.gitkeep'),
      '',
      options.force ? 'force' : 'skip',
      result,
      targetDir,
    );

    // WU-1394: Load settings.json from template (includes PreCompact/SessionStart hooks)
    let settingsContent: string;
    try {
      settingsContent = loadTemplate(CLAUDE_HOOKS.TEMPLATES.SETTINGS);
    } catch {
      settingsContent = CLAUDE_SETTINGS_TEMPLATE;
    }

    await createFile(
      path.join(targetDir, CLAUDE_DIR, 'settings.json'),
      settingsContent,
      options.force ? 'force' : 'skip',
      result,
      targetDir,
    );

    // WU-1413: Scaffold .mcp.json for MCP server integration
    let mcpJsonContent: string;
    try {
      mcpJsonContent = loadTemplate('core/.mcp.json.template');
    } catch {
      mcpJsonContent = MCP_JSON_TEMPLATE;
    }
    await createFile(
      path.join(targetDir, '.mcp.json'),
      mcpJsonContent,
      fileMode,
      result,
      targetDir,
    );

    // WU-1394: Scaffold recovery hook scripts with executable permissions
    const hooksDir = path.join(targetDir, CLAUDE_DIR, 'hooks');
    await createDirectory(hooksDir, result, targetDir);

    // Load and write pre-compact-checkpoint.sh
    try {
      const preCompactScript = loadTemplate(CLAUDE_HOOKS.TEMPLATES.PRE_COMPACT);
      await createExecutableScript(
        path.join(hooksDir, CLAUDE_HOOKS.SCRIPTS.PRE_COMPACT_CHECKPOINT),
        preCompactScript,
        options.force ? 'force' : 'skip',
        result,
        targetDir,
      );
    } catch {
      // Template not found - hook won't be scaffolded
    }

    // WU-1505: Generate session-start script from shared logic source.
    const sessionStartScript = generateSessionStartRecoveryScript();
    await createExecutableScript(
      path.join(hooksDir, CLAUDE_HOOKS.SCRIPTS.SESSION_START_RECOVERY),
      sessionStartScript,
      options.force ? 'force' : 'skip',
      result,
      targetDir,
    );

    // WU-1083: Scaffold Claude skills
    await scaffoldClaudeSkills(targetDir, options, result, tokens);

    // WU-1083: Scaffold agent onboarding docs for Claude vendor (even without --full)
    await scaffoldAgentOnboardingDocs(targetDir, options, result, tokens);
  }

  // WU-1171: Cursor uses .cursor/rules/lumenflow.md (not .cursor/rules.md)
  if (client === 'cursor' || client === 'all') {
    const cursorRulesDir = path.join(targetDir, '.cursor', 'rules');
    await createDirectory(cursorRulesDir, result, targetDir);

    // Try to load from template, fallback to hardcoded
    let cursorContent: string;
    try {
      cursorContent = loadTemplate('vendors/cursor/.cursor/rules/lumenflow.md.template');
    } catch {
      cursorContent = CURSOR_RULES_TEMPLATE;
    }

    await createFile(
      path.join(cursorRulesDir, 'lumenflow.md'),
      processTemplate(cursorContent, tokens),
      fileMode,
      result,
      targetDir,
    );
  }

  // WU-1171: Windsurf uses .windsurf/rules/lumenflow.md (not .windsurfrules)
  if (client === 'windsurf' || client === 'all') {
    const windsurfRulesDir = path.join(targetDir, '.windsurf', 'rules');
    await createDirectory(windsurfRulesDir, result, targetDir);

    // Try to load from template, fallback to hardcoded
    let windsurfContent: string;
    try {
      windsurfContent = loadTemplate('vendors/windsurf/.windsurf/rules/lumenflow.md.template');
    } catch {
      windsurfContent = WINDSURF_RULES_TEMPLATE;
    }

    await createFile(
      path.join(windsurfRulesDir, 'lumenflow.md'),
      processTemplate(windsurfContent, tokens),
      fileMode,
      result,
      targetDir,
    );
  }

  // WU-1171: Codex reads AGENTS.md directly - minimal extra config needed
  // AGENTS.md is always created, so nothing extra needed for codex

  // WU-1177: Cline uses .clinerules file at project root
  if (client === 'cline' || client === 'all') {
    // Try to load from template, fallback to hardcoded
    let clineContent: string;
    try {
      clineContent = loadTemplate('vendors/cline/.clinerules.template');
    } catch {
      clineContent = CLINE_RULES_TEMPLATE;
    }

    await createFile(
      path.join(targetDir, '.clinerules'),
      processTemplate(clineContent, tokens),
      fileMode,
      result,
      targetDir,
    );
  }

  // Aider
  if (client === 'aider' || client === 'all') {
    await createFile(
      path.join(targetDir, '.aider.conf.yml'),
      AIDER_CONF_TEMPLATE,
      fileMode,
      result,
      targetDir,
    );
  }
}

/**
 * Create a directory if missing
 */
async function createDirectory(
  dirPath: string,
  result: ScaffoldResult,
  targetDir: string,
): Promise<void> {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    result.created.push(getRelativePath(targetDir, dirPath));
  }
}

/**
 * WU-1171: Create a file with support for skip, merge, and force modes
 *
 * @param filePath - Path to the file to create
 * @param content - Content to write (or merge block content in merge mode)
 * @param mode - 'skip' (default), 'merge', or 'force'
 * @param result - ScaffoldResult to track created/skipped/merged files
 * @param targetDir - Target directory for relative path calculation
 */
async function createFile(
  filePath: string,
  content: string,
  mode: FileMode | boolean,
  result: ScaffoldResult,
  targetDir: string,
): Promise<void> {
  const relativePath = getRelativePath(targetDir, filePath);

  // Handle boolean for backwards compatibility (true = force, false = skip)
  const resolvedMode = resolveBooleanToFileMode(mode);

  // Ensure merged/warnings arrays exist
  result.merged = result.merged ?? [];
  result.warnings = result.warnings ?? [];

  const fileExists = fs.existsSync(filePath);

  if (fileExists && resolvedMode === 'skip') {
    result.skipped.push(relativePath);
    return;
  }

  if (fileExists && resolvedMode === 'merge') {
    handleMergeMode(filePath, content, result, relativePath);
    return;
  }

  // Force mode or file doesn't exist: write new content
  writeNewFile(filePath, content, result, relativePath);
}

/**
 * Convert boolean or FileMode to FileMode
 */
function resolveBooleanToFileMode(mode: FileMode | boolean): FileMode {
  if (typeof mode === 'boolean') {
    return mode ? 'force' : 'skip';
  }
  return mode;
}

/**
 * Handle merge mode file update
 */
function handleMergeMode(
  filePath: string,
  content: string,
  result: ScaffoldResult,
  relativePath: string,
): void {
  const existingContent = fs.readFileSync(filePath, 'utf-8');
  const mergeResult = updateMergeBlock(existingContent, content);

  if (mergeResult.unchanged) {
    result.skipped.push(relativePath);
    return;
  }

  if (mergeResult.warning) {
    result.warnings?.push(`${relativePath}: ${mergeResult.warning}`);
  }

  fs.writeFileSync(filePath, mergeResult.content);
  result.merged?.push(relativePath);
}

/**
 * Write a new file, creating parent directories if needed
 */
function writeNewFile(
  filePath: string,
  content: string,
  result: ScaffoldResult,
  relativePath: string,
): void {
  const parentDir = path.dirname(filePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  fs.writeFileSync(filePath, content);
  result.created.push(relativePath);
}

/**
 * WU-1394: Create an executable script file with proper permissions
 * Similar to createFile but sets 0o755 mode for shell scripts
 */
async function createExecutableScript(
  filePath: string,
  content: string,
  mode: FileMode | boolean,
  result: ScaffoldResult,
  targetDir: string,
): Promise<void> {
  const relativePath = getRelativePath(targetDir, filePath);
  const resolvedMode = resolveBooleanToFileMode(mode);

  result.merged = result.merged ?? [];
  result.warnings = result.warnings ?? [];

  const fileExists = fs.existsSync(filePath);

  if (fileExists && resolvedMode === 'skip') {
    result.skipped.push(relativePath);
    return;
  }

  // Write file with executable permissions
  const parentDir = path.dirname(filePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  fs.writeFileSync(filePath, content, { mode: 0o755 });
  result.created.push(relativePath);
}

/**
 * CLI entry point
 * WU-1085: Updated to use parseInitOptions for proper --help support
 * WU-1171: Added --merge and --client support
 * WU-1378: Added subcommand routing for 'commands' subcommand
 */
export async function main(): Promise<void> {
  // WU-1378: Check for subcommands before parsing init options
  const subcommand = process.argv[2];

  if (subcommand === 'commands') {
    // Route to commands subcommand
    const { main: commandsMain } = await import('./commands.js');
    // Remove 'commands' from argv so the subcommand parser sees clean args
    process.argv.splice(2, 1);
    await commandsMain();
    return;
  }

  const opts = parseInitOptions();
  const targetDir = process.cwd();

  console.log('[lumenflow init] Scaffolding LumenFlow project...');
  console.log(`  Mode: ${opts.full ? 'full' : 'minimal'}${opts.merge ? ' (merge)' : ''}`);
  console.log(`  Framework: ${opts.framework ?? 'none'}`);
  console.log(`  Client: ${opts.client ?? 'auto'}`);
  console.log(`  Gate preset: ${opts.preset ?? 'none (manual config)'}`);

  // WU-1177: Check prerequisites (non-blocking)
  const prereqs = checkPrerequisites();
  const failingPrereqs = Object.entries(prereqs)
    .filter(([, check]) => !check.passed)
    .map(([name, check]) => `${name}: ${check.version} (requires ${check.required})`);

  if (failingPrereqs.length > 0) {
    console.log('\nPrerequisite warnings (non-blocking):');
    failingPrereqs.forEach((msg) => console.log(`  ! ${msg}`));
    console.log('  Run "lumenflow doctor" for details.\n');
  }

  const result = await scaffoldProject(targetDir, {
    force: opts.force,
    full: opts.full,
    merge: opts.merge,
    client: opts.client,
    vendor: opts.vendor, // Backwards compatibility
    framework: opts.framework,
    gatePreset: opts.preset,
  });

  if (result.created.length > 0) {
    console.log('\nCreated:');
    result.created.forEach((f) => console.log(`  + ${f}`));
  }

  if (result.merged && result.merged.length > 0) {
    console.log('\nMerged (LumenFlow block inserted/updated):');
    result.merged.forEach((f) => console.log(`  ~ ${f}`));
  }

  if (result.skipped.length > 0) {
    console.log('\nSkipped (already exists, use --force to overwrite or --merge to insert block):');
    result.skipped.forEach((f) => console.log(`  - ${f}`));
  }

  if (result.warnings && result.warnings.length > 0) {
    console.log('\nWarnings:');
    result.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }

  // WU-1386: Run doctor auto-check (non-blocking)
  // This provides feedback on workflow health without failing init
  try {
    const doctorResult = await runDoctorForInit(targetDir);
    if (doctorResult.output) {
      console.log('');
      console.log(doctorResult.output);
    }
  } catch {
    // Doctor check is non-blocking - if it fails, continue with init
  }

  // WU-1359: Show complete lifecycle with auto-ID (no --id flag required)
  // WU-1364: Added initiative-first guidance for product visions
  // WU-1576: Show enforcement hooks status — vendor-agnostic (any adapter that produced files)
  console.log('\n[lumenflow init] Done! Next steps:');
  console.log('  1. Review AGENTS.md and LUMENFLOW.md for workflow documentation');
  console.log(`  2. Edit ${CONFIG_FILE_NAME} to match your project structure`);
  if (result.integrationFiles && result.integrationFiles.length > 0) {
    console.log('  \u2713 Enforcement hooks installed — regenerate with: pnpm lumenflow:integrate');
  }
  console.log('');
  console.log('  For a product vision (multi-phase work):');
  console.log('     pnpm initiative:create --id INIT-001 --title "Project Name" \\');
  console.log('       --phase "Phase 1: MVP" --phase "Phase 2: Polish"');
  console.log('');
  console.log('  For a single WU:');
  console.log('     pnpm wu:create --lane <lane> --title "First WU" \\');
  console.log('       --description "Context: ... Problem: ... Solution: ..." \\');
  console.log('       --acceptance "Criterion 1" --code-paths "src/..." --exposure backend-only');
  console.log('');
  console.log('     # Or for rapid prototyping (minimal validation):');
  console.log('     pnpm wu:proto --lane <lane> --title "Quick experiment"');
  console.log('');
  console.log('  Full lifecycle: wu:create -> wu:claim -> wu:prep -> wu:done');
}

// WU-1297: Use import.meta.main instead of exporting main() without calling it
// This ensures main() runs when the script is executed as a CLI entry point
// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}

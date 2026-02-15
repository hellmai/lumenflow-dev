#!/usr/bin/env node
/**
 * WU Spawn Helper
 *
 * Generates ready-to-use Task tool invocations for sub-agent WU execution.
 * Includes context loading preamble, skills selection guidance, and constraints block.
 *
 * Usage:
 *   pnpm wu:spawn --id WU-123
 *   pnpm wu:spawn --id WU-123 --codex
 *
 * Output:
 *   A complete Task tool invocation block with:
 *   - Context loading preamble (.claude/CLAUDE.md, README, lumenflow, WU YAML)
 *   - WU details and acceptance criteria
 *   - Skills Selection section (sub-agent reads catalogue and selects at runtime)
 *   - Mandatory agent advisory
 *   - Constraints block at end (Lost in the Middle research)
 *
 * Skills Selection:
 *   This command is AGENT-FACING. Unlike /wu-prompt (human-facing, skills selected
 *   at generation time), wu:spawn instructs the sub-agent to read the skill catalogue
 *   and select skills at execution time based on WU context.
 *
 * Codex Mode:
 *   When --codex is used, outputs a Codex/GPT-friendly Markdown prompt (no antml/XML escaping).
 *
 * @see {@link https://lumenflow.dev/reference/agent-invocation-guide/} - Context loading templates
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createWUParser, WU_OPTIONS } from './arg-parser.js';
import { WU_PATHS } from './wu-paths.js';
import { parseYAML } from './wu-yaml.js';
import { die } from './error-handler.js';
import { WU_STATUS, PATTERNS, EMOJI, LUMENFLOW_PATHS } from './wu-constants.js';
// WU-1603: Check lane lock status before spawning
import { checkLaneLock, type LockMetadata } from './lane-lock.js';
import { minimatch } from 'minimatch';
import { SpawnStrategyFactory } from './spawn-strategy.js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Type is used in JSDoc comments
import type { SpawnStrategy } from './spawn-strategy.js';
import { getConfig } from './lumenflow-config.js';
import type { ClientConfig, LumenFlowConfig } from './lumenflow-config-schema.js';
import {
  generateClientSkillsGuidance,
  generateSkillsSelectionSection,
  resolveClientConfig,
} from './wu-spawn-skills.js';
// WU-2252: Import invariants loader for spawn output injection
import { loadInvariants, INVARIANT_TYPES } from './invariants-runner.js';
import {
  validateSpawnArgs,
  generateExecutionModeSection,
  generateThinkToolGuidance,
  recordSpawnToRegistry,
  formatSpawnRecordedMessage,
} from './wu-spawn-helpers.js';
// Agent skills loading removed for vendor-agnostic design
import { validateSpawnDependencies, formatDependencyError } from './dependency-validator.js';
/**
 * WU-1253/WU-1291: Template System for Spawn Prompts
 *
 * DECISION (WU-1291): Template system is ACTIVATED with graceful degradation.
 *
 * The template system loads prompt sections from .lumenflow/templates/spawn-prompt/
 * with YAML frontmatter and manifest-driven assembly order. This design provides:
 *
 * 1. **Maintainability**: Templates in markdown files are easier to edit than code strings
 * 2. **Client extensibility**: Client-specific overrides via templates.{client}/ directories
 * 3. **Conditional inclusion**: Templates selected based on WU type and policy settings
 * 4. **Graceful fallback**: If template loading fails, hardcoded functions are used
 *
 * Template loading is attempted via tryAssembleSpawnTemplates(). If it returns null
 * (templates missing or assembly fails), the spawn output uses hardcoded generator
 * functions (generateTDDDirective, generateBugDiscoverySection, etc.).
 *
 * @see template-loader.ts for the loading and assembly implementation
 * @see .lumenflow/templates/manifest.yaml for the template registry
 */
import {
  loadManifest,
  loadTemplatesWithOverrides,
  assembleTemplates,
  type TemplateContext,
} from './template-loader.js';
// WU-1261: Import ResolvedPolicy for policy-based template selection
import type { ResolvedPolicy } from './resolve-policy.js';
import { resolvePolicy } from './resolve-policy.js';
// WU-1270: Import telemetry emit function for methodology tracking
import { emit as emitTelemetry } from './telemetry.js';

/**
 * Mandatory agent trigger patterns.
 * Mirrors MANDATORY_TRIGGERS from orchestration.constants.ts.
 *
 * Note: For LumenFlow framework development, this is empty since we don't have
 * application-specific concerns like PHI, auth, or RLS. Projects using LumenFlow
 * should configure their own triggers based on their domain requirements.
 */
const MANDATORY_TRIGGERS: Record<string, readonly string[]> = {
  // No mandatory triggers for LumenFlow framework development.
};

const LOG_PREFIX = '[wu:spawn]';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface WUDoc {
  id?: string;
  title?: string;
  lane?: string;
  type?: string;
  status?: string;
  description?: string;
  worktree_path?: string;
  acceptance?: string[];
  code_paths?: string[];
  spec_refs?: string[];
  notes?: string;
  risks?: string[];
  claimed_at?: string;
  tests?: {
    manual?: string[];
  };
  [key: string]: unknown;
}

interface InvariantDefinition {
  id: string;
  type: string;
  description: string;
  message?: string;
  path?: string;
  paths?: string[];
  scope?: string[];
  from?: string;
  cannot_import?: string[];
  pattern?: string;
}

interface SpawnCliArgs {
  id: string;
  codex?: boolean;
  thinking?: boolean;
  noThinking?: boolean;
  budget?: string;
  parentWu?: string;
  client?: string;
  vendor?: string;
  noContext?: boolean;
}

/**
 * WU-1192: Truncation prevention constants (consolidated from CLI)
 *
 * These constants help detect when spawn output has been truncated during
 * copy-paste operations or context loading. The warning banner alerts users
 * to the truncation risk, and the end sentinel allows verification that
 * the full output was received.
 */
export const TRUNCATION_WARNING_BANNER = `<!-- LUMENFLOW_TRUNCATION_WARNING -->
<!--
  ⚠️ CRITICAL: DO NOT TRUNCATE THIS OUTPUT

  This spawn prompt MUST be copied verbatim. Truncation causes:
  - Missing constraints (agents ignore safety rules)
  - Missing TDD directives (agents skip tests)
  - Degraded agent performance

  VERIFICATION: The output MUST end with: <!-- LUMENFLOW_SPAWN_END -->
  If you don't see that sentinel at the end, the output was truncated.
-->
`;

export const SPAWN_END_SENTINEL = '<!-- LUMENFLOW_SPAWN_END -->';

/**
 * WU-1253/WU-1291: Try to assemble spawn prompt sections from templates.
 *
 * This function loads templates from .lumenflow/templates/ and assembles
 * them according to the manifest order. Client-specific overrides are
 * supported via templates.{client}/ directories.
 *
 * **Decision (WU-1291)**: Template system is ACTIVATED. This function is called
 * by generateTaskInvocation() and generateCodexPrompt() to attempt template-based
 * generation. If it returns null (templates missing, manifest invalid, or assembly
 * fails), callers fall back to hardcoded generator functions.
 *
 * Template coverage (as of WU-1291):
 * - Methodology directives (TDD, test-after, none)
 * - Architecture directives (hexagonal, layered, none)
 * - Type-specific directives (documentation, visual, refactor)
 * - Agent guidance (effort-scaling, parallel-tool-calls, search-heuristics, token-budget)
 * - Operational guidance (bug-discovery, quick-fix-commands, lane-selection)
 * - Lane-specific guidance and constraints
 *
 * @param baseDir - Project root directory
 * @param clientName - Client name for overrides (e.g., 'claude', 'cursor')
 * @param context - Context for token replacement and condition evaluation
 * @returns Assembled template content, or null if templates unavailable
 */
export function tryAssembleSpawnTemplates(
  baseDir: string,
  clientName: string,
  context: TemplateContext,
): string | null {
  try {
    const manifest = loadManifest(baseDir);
    const templates = loadTemplatesWithOverrides(baseDir, clientName);

    if (templates.size === 0) {
      return null;
    }

    return assembleTemplates(templates, manifest, context);
  } catch {
    // Template loading failed - return null for hardcoded fallback (intentional)
    return null;
  }
}

/**
 * Build template context from WU document.
 *
 * @param doc - WU YAML document
 * @param id - WU ID
 * @returns Context for template assembly
 */
export function buildTemplateContext(doc: Record<string, unknown>, id: string): TemplateContext {
  const lane = (doc.lane as string) || '';
  const laneParent = lane.split(':')[0]?.trim() || '';

  return {
    WU_ID: id,
    LANE: lane,
    TYPE: ((doc.type as string) || 'feature').toLowerCase(),
    TITLE: (doc.title as string) || '',
    DESCRIPTION: (doc.description as string) || '',
    WORKTREE_PATH: (doc.worktree_path as string) || '',
    laneParent,
    // Add lowercase aliases for condition evaluation
    type: ((doc.type as string) || 'feature').toLowerCase(),
    lane,
    worktreePath: (doc.worktree_path as string) || '',
  };
}

/**
 * WU-1261: Build template context with resolved policy fields.
 *
 * Extends buildTemplateContext() with policy.testing and policy.architecture
 * fields for template condition evaluation.
 *
 * @param doc - WU YAML document
 * @param id - WU ID
 * @param policy - Resolved policy from resolvePolicy()
 * @returns Context for template assembly with policy fields
 */
export function buildTemplateContextWithPolicy(
  doc: Record<string, unknown>,
  id: string,
  policy: ResolvedPolicy,
): TemplateContext & { 'policy.testing': string; 'policy.architecture': string } {
  const baseContext = buildTemplateContext(doc, id);

  return {
    ...baseContext,
    'policy.testing': policy.testing,
    'policy.architecture': policy.architecture,
  };
}

/**
 * WU types that require TDD (failing test first)
 * Note: Used as documentation reference. TDD is the default for any type not in other categories.
 */
const _TDD_REQUIRED_TYPES = ['feature', 'bug', 'tooling', 'enhancement'];

/**
 * WU types that require existing tests to pass (no new tests mandated)
 */
const EXISTING_TESTS_TYPES = ['refactor'];

/**
 * WU types that require smoke tests + manual QA
 */
const SMOKE_TEST_TYPES = ['visual', 'design', 'ui'];

/**
 * WU types that only need format checks (no TDD)
 */
const DOCS_ONLY_TYPES = ['documentation', 'docs', 'config'];

/**
 * Generate type-aware test guidance (WU-1142, WU-1192)
 *
 * Returns appropriate test guidance based on WU type:
 * - feature/bug/tooling: Full TDD directive
 * - documentation: Format check only
 * - visual/design: Smoke test + manual QA
 * - refactor: Existing tests must pass
 *
 * @param {string} wuType - WU type from YAML
 * @returns {string} Test guidance section
 */
export function generateTestGuidance(wuType: string): string {
  const type = (wuType || 'feature').toLowerCase();

  // Documentation WUs - no TDD, just format checks
  if (DOCS_ONLY_TYPES.includes(type)) {
    return `## Documentation Standards

**Format check only** - No TDD required for documentation WUs.

### Requirements

1. Run \`pnpm gates --docs-only\` before completion
2. Ensure markdown formatting is correct
3. Verify links are valid
4. Check spelling and grammar`;
  }

  // Visual/Design WUs - smoke tests + manual QA
  if (SMOKE_TEST_TYPES.includes(type)) {
    return `## Visual/Design Testing

**Smoke test + manual QA** - Visual WUs require different verification.

### Requirements

1. Create smoke test for component rendering (if applicable)
2. Verify visual appearance manually
3. Test responsive behavior across breakpoints
4. Check accessibility (keyboard navigation, screen reader)
5. Document manual QA results in completion notes`;
  }

  // Refactor WUs - existing tests must pass
  if (EXISTING_TESTS_TYPES.includes(type)) {
    return `## Refactor Testing

**Existing tests must pass** - Refactoring must not break current behavior.

### Requirements

1. Run all existing tests BEFORE refactoring
2. Run all existing tests AFTER refactoring
3. No new tests required unless behavior changes
4. If tests fail after refactor, the refactor introduced a bug`;
  }

  // Default: TDD required (feature, bug, tooling, enhancement)
  return generateTDDDirective();
}

/**
 * Generate the TDD directive section (WU-1585, WU-1192)
 *
 * Positioned immediately after </task> preamble per "Lost in the Middle" research.
 * Critical instructions at START and END of prompt improve adherence.
 *
 * @returns {string} TDD directive section
 */
function generateTDDDirective() {
  return `## ⛔ TDD DIRECTIVE — READ BEFORE CODING

**IF YOU WRITE IMPLEMENTATION CODE BEFORE A FAILING TEST, YOU HAVE FAILED THIS WU.**

### Test-First Workflow (MANDATORY)

1. Write a failing test for the acceptance criteria
2. Run the test to confirm it fails (RED)
3. Implement the minimum code to pass the test
4. Run the test to confirm it passes (GREEN)
5. Refactor if needed, keeping tests green

### Test Ratchet Rule (WU-1253)

Gates compare test results against \`.lumenflow/test-baseline.json\`:

- **NEW failures** (not in baseline) **BLOCK** gates - you must fix them
- **Pre-existing failures** (in baseline) show **WARNING** - do not block your WU
- When tests are **fixed**, baseline auto-updates (ratchet forward)

If gates fail due to test failures:
1. Check if failure is in baseline: \`cat .lumenflow/test-baseline.json\`
2. If pre-existing: continue, it will warn but not block
3. If NEW: fix the test or add to baseline with reason and fix-wu

### Why This Matters

- Tests document expected behavior BEFORE implementation
- Prevents scope creep and over-engineering
- Ensures every feature has verification
- Failing tests prove the test actually tests something
- Ratchet pattern prevents being blocked by unrelated failures`;
}

/**
 * WU-1279: Generate the Mandatory Standards section based on resolved policy
 *
 * Instead of hardcoding TDD/90%/Hexagonal, this function generates the
 * section dynamically based on the resolved methodology policy.
 *
 * @param policy - Resolved policy from resolvePolicy()
 * @returns Mandatory Standards section content
 */
export function generateMandatoryStandards(policy: ResolvedPolicy): string {
  const lines: string[] = ['## Mandatory Standards', ''];

  // LumenFlow workflow is always required
  lines.push('- **LumenFlow**: Follow trunk-based flow, WIP=1, worktree discipline');

  // Testing methodology based on policy
  if (policy.testing === 'tdd') {
    lines.push(
      `- **TDD**: Failing test first, then implementation, then passing test. ${policy.coverage_threshold}%+ coverage on new application code`,
    );
  } else if (policy.testing === 'test-after') {
    lines.push(
      `- **Test-After**: Write implementation first, then add tests. ${policy.coverage_threshold}%+ coverage on new application code`,
    );
  } else if (policy.testing === 'none') {
    lines.push('- **Testing**: Tests are optional for this project');
  }

  // Architecture based on policy
  if (policy.architecture === 'hexagonal') {
    lines.push(
      '- **Hexagonal Architecture**: Ports-first design. No application -> infrastructure imports',
    );
  } else if (policy.architecture === 'layered') {
    lines.push(
      '- **Layered Architecture**: Clear layer separation. Each layer can only depend on layers below it',
    );
  }
  // For architecture: 'none', we don't add any architecture guidance

  // Always include these standards
  lines.push('- **SOLID/DRY/YAGNI/KISS**: No over-engineering, no premature abstraction');
  lines.push(
    '- **Library-First**: Search context7 before writing custom code. No reinventing wheels',
  );
  lines.push(
    '- **Code Quality**: No string literals, no magic numbers, no brittle regexes when libraries exist',
  );
  lines.push(
    '- **Worktree Discipline**: ALWAYS use `pnpm wu:claim` to create worktrees (never `git worktree add` directly). Work ONLY in the worktree, never edit main',
  );
  lines.push(
    '- **Documentation**: Update tooling docs if changing tools. Keep docs in sync with code',
  );
  lines.push(
    '- **Sub-agents**: Use Explore agent for codebase investigation. Activate mandatory agents as configured for your project',
  );

  return lines.join('\n');
}

/**
 * WU-1261: Generate test guidance based on resolved policy
 *
 * Selects the appropriate test guidance based on policy.testing value:
 * - 'tdd': Full TDD directive (failing test first)
 * - 'test-after': Implementation first, then tests
 * - 'none': Testing is optional
 *
 * Type overrides still apply (documentation WUs always get docs guidance).
 *
 * @param wuType - WU type from YAML (e.g., 'feature', 'documentation')
 * @param policy - Resolved policy from resolvePolicy()
 * @returns Test guidance section
 */
export function generatePolicyBasedTestGuidance(wuType: string, policy: ResolvedPolicy): string {
  const type = (wuType || 'feature').toLowerCase();

  // Type overrides take precedence (documentation never needs TDD)
  if (DOCS_ONLY_TYPES.includes(type)) {
    return `## Documentation Standards

**Format check only** - No TDD required for documentation WUs.

### Requirements

1. Run \`pnpm gates --docs-only\` before completion
2. Ensure markdown formatting is correct
3. Verify links are valid
4. Check spelling and grammar`;
  }

  // Visual/Design WUs - smoke tests + manual QA
  if (SMOKE_TEST_TYPES.includes(type)) {
    return `## Visual/Design Testing

**Smoke test + manual QA** - Visual WUs require different verification.

### Requirements

1. Create smoke test for component rendering (if applicable)
2. Verify visual appearance manually
3. Test responsive behavior across breakpoints
4. Check accessibility (keyboard navigation, screen reader)
5. Document manual QA results in completion notes`;
  }

  // Refactor WUs - existing tests must pass
  if (EXISTING_TESTS_TYPES.includes(type)) {
    return `## Refactor Testing

**Existing tests must pass** - Refactoring must not break current behavior.

### Requirements

1. Run all existing tests BEFORE refactoring
2. Run all existing tests AFTER refactoring
3. No new tests required unless behavior changes
4. If tests fail after refactor, the refactor introduced a bug`;
  }

  // Policy-based selection for feature/bug/enhancement/tooling types
  switch (policy.testing) {
    case 'test-after':
      return generateTestAfterDirective(policy.coverage_threshold);
    case 'none':
      return generateTestingOptionalDirective();
    case 'tdd':
    default:
      return generateTDDDirective();
  }
}

/**
 * WU-1261, WU-1279: Generate test-after directive
 *
 * @param coverageThreshold - Coverage threshold from resolved policy
 * @returns Test-after guidance section
 */
function generateTestAfterDirective(coverageThreshold: number): string {
  return `## Test-After Methodology

**Write implementation first, then add tests** - Focus on solving the problem, then verify.

### Test-After Workflow

1. Understand the acceptance criteria
2. Write implementation first
3. Add tests to verify behavior
4. Aim for ${coverageThreshold}% coverage on new code

### When This Works

- Exploratory prototyping where requirements are unclear
- Quick iterations where test-first slows discovery
- Projects configured with \`methodology.testing: 'test-after'\`

### Requirements

- Tests must be added before \`wu:done\`
- Coverage target: ${coverageThreshold}%+ on new application code
- All existing tests must still pass`;
}

/**
 * WU-1261: Generate testing optional directive
 *
 * @returns Testing optional guidance section
 */
function generateTestingOptionalDirective(): string {
  return `## Testing Optional

**Tests are not required** - Project is configured without test requirements.

### Focus

- Code quality and functionality
- Run \`pnpm gates\` before completion (will skip coverage checks)

### If You Want to Add Tests

You can still add tests for critical functionality:
\`\`\`bash
pnpm test -- --coverage
\`\`\`

But they are not required for WU completion.`;
}

/**
 * WU-1261: Generate architecture guidance based on resolved policy
 *
 * Selects appropriate architecture guidance based on policy.architecture:
 * - 'hexagonal': Ports and adapters, dependency inversion
 * - 'layered': Traditional layer separation
 * - 'none': No architecture constraints
 *
 * @param policy - Resolved policy from resolvePolicy()
 * @returns Architecture guidance section, or empty string for 'none'
 */
export function generatePolicyBasedArchitectureGuidance(policy: ResolvedPolicy): string {
  switch (policy.architecture) {
    case 'hexagonal':
      return `## Hexagonal Architecture

**Ports and Adapters** - Keep domain logic pure, infrastructure at the edges.

### Key Principles

- **Ports**: Interfaces defining what the domain needs (inbound) or uses (outbound)
- **Adapters**: Implementations connecting ports to infrastructure
- **Domain**: Pure business logic with no infrastructure imports
- **Dependency Rule**: Domain -> Ports <- Adapters (never domain -> adapters)

### Directory Structure

\`\`\`
src/
  domain/           # Pure business logic
  ports/            # Interfaces
  adapters/         # Infrastructure implementations
  application/      # Use cases orchestrating domain + ports
\`\`\``;

    case 'layered':
      return `## Layered Architecture

**Traditional layer separation** - Clear boundaries between concerns.

### Layers (Top to Bottom)

1. **Presentation**: UI, API controllers, CLI
2. **Application**: Use cases, orchestration
3. **Domain**: Business logic, entities
4. **Infrastructure**: Database, external services

### Dependency Rule

- Each layer can only depend on layers below it
- Presentation -> Application -> Domain -> Infrastructure
- Never skip layers (Presentation should not directly use Infrastructure)`;

    case 'none':
    default:
      return '';
  }
}

/**
 * WU-1261: Generate enforcement summary from resolved policy
 *
 * Creates a "You will be judged by" section that summarizes the active
 * enforcement rules based on the resolved policy.
 *
 * @param policy - Resolved policy from resolvePolicy()
 * @returns Enforcement summary section
 */
export function generateEnforcementSummary(policy: ResolvedPolicy): string {
  const lines: string[] = ['## You will be judged by', ''];

  // Testing methodology
  const testingStatus = policy.tests_required ? 'required' : 'optional';
  lines.push(`- **Testing**: ${policy.testing} (tests ${testingStatus})`);

  // Coverage
  if (policy.coverage_mode === 'off') {
    lines.push('- **Coverage**: disabled');
  } else {
    const modeLabel = policy.coverage_mode === 'block' ? 'blocking' : 'warn only';
    lines.push(`- **Coverage**: ${policy.coverage_threshold}% (${modeLabel})`);
  }

  // Architecture
  if (policy.architecture !== 'none') {
    lines.push(`- **Architecture**: ${policy.architecture}`);
  }

  return lines.join('\n');
}

/**
 * Generate worktree block recovery section (WU-1192)
 *
 * Provides guidance when agents encounter worktree hook blocks.
 *
 * @param {string} worktreePath - Path to the worktree
 * @returns {string} Recovery section
 */
export function generateWorktreeBlockRecoverySection(worktreePath: string): string {
  return `## When Blocked by Worktree Hook

If you encounter a "worktree required" or "commit blocked" error:

1. **Check existing worktrees**: \`git worktree list\`
2. **Navigate to the worktree**: \`cd ${worktreePath || 'worktrees/<lane>-wu-xxx'}\`
3. **Retry your operation** from within the worktree
4. **Use relative paths only** (never absolute paths)

### Common Causes

- Running \`git commit\` from main checkout instead of worktree
- Using absolute paths that bypass worktree isolation
- Forgetting to \`cd\` to worktree after \`wu:claim\`

### Quick Fix

\`\`\`bash
# Check where you are
pwd
git worktree list

# Navigate to your worktree
cd ${worktreePath || 'worktrees/<lane>-wu-xxx'}

# Retry your commit
git add . && git commit -m "your message"
\`\`\``;
}

/**
 * Detect mandatory agents based on code paths.
 *
 * @param {string[]} codePaths - Array of file paths
 * @returns {string[]} Array of mandatory agent names
 */
function detectMandatoryAgents(codePaths: string[] | undefined): string[] {
  if (!codePaths || codePaths.length === 0) {
    return [];
  }

  const triggeredAgents = new Set<string>();

  for (const [agentName, patterns] of Object.entries(MANDATORY_TRIGGERS)) {
    const isTriggered = codePaths.some((filePath) =>
      patterns.some((pattern) => minimatch(filePath, pattern)),
    );

    if (isTriggered) {
      triggeredAgents.add(agentName);
    }
  }

  return Array.from(triggeredAgents);
}

/**
 * Format acceptance criteria as markdown list
 *
 * @param {string[]|undefined} acceptance - Acceptance criteria array
 * @returns {string} Formatted acceptance criteria
 */
function formatAcceptance(acceptance: string[] | undefined): string {
  if (!acceptance || acceptance.length === 0) {
    return '- No acceptance criteria defined';
  }
  return acceptance.map((item) => `- [ ] ${item}`).join('\n');
}

/**
 * Format spec_refs as markdown links
 *
 * WU-1062: Handles external paths (lumenflow://, ~/.lumenflow/, $LUMENFLOW_HOME/)
 * by expanding them to absolute paths and adding a note about reading them.
 *
 * @param {string[]|undefined} specRefs - Spec references array
 * @returns {string} Formatted references or empty string if none
 */
function formatSpecRefs(specRefs: string[] | undefined): string {
  if (!specRefs || specRefs.length === 0) {
    return '';
  }

  const formattedRefs = specRefs.map((ref) => {
    // WU-1062: Add note for external paths
    if (
      ref.startsWith('lumenflow://') ||
      ref.startsWith('~/') ||
      ref.startsWith('$LUMENFLOW_HOME') ||
      (ref.startsWith('/') && ref.includes('.lumenflow'))
    ) {
      return `- ${ref} (external - read with filesystem access)`;
    }
    return `- ${ref}`;
  });

  return formattedRefs.join('\n');
}

/**
 * Format risks as markdown list
 *
 * @param {string[]|undefined} risks - Risks array
 * @returns {string} Formatted risks or empty string if none
 */
function formatRisks(risks: string[] | undefined): string {
  if (!risks || risks.length === 0) {
    return '';
  }
  return risks.map((risk) => `- ${risk}`).join('\n');
}

/**
 * Format manual tests as markdown checklist
 *
 * @param {string[]|undefined} manualTests - Manual test steps
 * @returns {string} Formatted tests or empty string if none
 */
function formatManualTests(manualTests: string[] | undefined): string {
  if (!manualTests || manualTests.length === 0) {
    return '';
  }
  return manualTests.map((test) => `- [ ] ${test}`).join('\n');
}

/**
 * Generate implementation context section (WU-1833)
 *
 * Includes spec_refs, notes, risks, and tests.manual if present.
 * Sections with no content are omitted to keep prompts lean.
 *
 * @param {object} doc - WU YAML document
 * @returns {string} Implementation context section or empty string
 */
function generateImplementationContext(doc: WUDoc): string {
  const sections: string[] = [];

  // References (spec_refs)
  const refs = formatSpecRefs(doc.spec_refs);
  if (refs) {
    sections.push(`## References\n\n${refs}`);
  }

  // Implementation Notes
  if (doc.notes && doc.notes.trim()) {
    sections.push(`## Implementation Notes\n\n${doc.notes.trim()}`);
  }

  // Risks
  const risks = formatRisks(doc.risks);
  if (risks) {
    sections.push(`## Risks\n\n${risks}`);
  }

  // Manual Verification (tests.manual)
  const manualTests = formatManualTests(doc.tests?.manual);
  if (manualTests) {
    sections.push(`## Manual Verification\n\n${manualTests}`);
  }

  if (sections.length === 0) {
    return '';
  }

  return sections.join('\n\n---\n\n');
}

/**
 * Check if a code path matches an invariant based on type
 *
 * @param {object} invariant - Invariant definition
 * @param {string[]} codePaths - Array of code paths
 * @returns {boolean} True if code paths match the invariant
 */
function codePathMatchesInvariant(invariant: InvariantDefinition, codePaths: string[]): boolean {
  switch (invariant.type) {
    case INVARIANT_TYPES.FORBIDDEN_FILE:
    case INVARIANT_TYPES.REQUIRED_FILE:
      return codePaths.some(
        (p) => p === invariant.path || minimatch(p, invariant.path) || minimatch(invariant.path, p),
      );

    case INVARIANT_TYPES.MUTUAL_EXCLUSIVITY:
      return codePaths.some((p) =>
        invariant.paths.some((invPath) => p === invPath || minimatch(p, invPath)),
      );

    case INVARIANT_TYPES.FORBIDDEN_PATTERN:
    case INVARIANT_TYPES.REQUIRED_PATTERN:
      return (
        invariant.scope?.some((scopePattern) =>
          codePaths.some((p) => minimatch(p, scopePattern)),
        ) ?? false
      );

    // WU-2254: forbidden-import uses 'from' glob instead of 'scope'
    case INVARIANT_TYPES.FORBIDDEN_IMPORT:
      return invariant.from ? codePaths.some((p) => minimatch(p, invariant.from)) : false;

    default:
      return false;
  }
}

/**
 * Format a single invariant for output
 *
 * @param {object} inv - Invariant definition
 * @returns {string[]} Lines of formatted output
 */
function formatInvariantForOutput(inv: InvariantDefinition): string[] {
  const lines = [`### ${inv.id} (${inv.type})`, '', inv.description, ''];

  if (inv.message) {
    lines.push(`**Action:** ${inv.message}`, '');
  }

  if (inv.path) {
    lines.push(`**Path:** \`${inv.path}\``);
  }

  if (inv.paths) {
    const formattedPaths = inv.paths.map((p) => `\`${p}\``).join(', ');
    lines.push(`**Paths:** ${formattedPaths}`);
  }

  // WU-2254: forbidden-import specific fields
  if (inv.from) {
    lines.push(`**From:** \`${inv.from}\``);
  }

  if (inv.cannot_import && Array.isArray(inv.cannot_import)) {
    const formattedImports = inv.cannot_import.map((m) => `\`${m}\``).join(', ');
    lines.push(`**Cannot Import:** ${formattedImports}`);
  }

  // WU-2254: required-pattern specific fields
  if (
    inv.pattern &&
    (inv.type === INVARIANT_TYPES.REQUIRED_PATTERN ||
      inv.type === INVARIANT_TYPES.FORBIDDEN_PATTERN)
  ) {
    lines.push(`**Pattern:** \`${inv.pattern}\``);
  }

  if (inv.scope && Array.isArray(inv.scope)) {
    const formattedScope = inv.scope.map((s) => `\`${s}\``).join(', ');
    lines.push(`**Scope:** ${formattedScope}`);
  }

  lines.push('');
  return lines;
}

/**
 * WU-2252: Generate invariants/prior-art section for code_paths
 *
 * Loads relevant invariants from invariants.yml and generates a section
 * that surfaces constraints and prior-art for the WU's code_paths.
 *
 * @param {string[]} codePaths - Array of code paths from the WU
 * @returns {string} Invariants/prior-art section or empty string if none relevant
 */
function generateInvariantsPriorArtSection(codePaths: string[]): string {
  if (!codePaths || codePaths.length === 0) {
    return '';
  }

  // Try to load tools/invariants.yml
  const invariantsPath = path.resolve('tools/invariants.yml');
  if (!existsSync(invariantsPath)) {
    return '';
  }

  let invariants: InvariantDefinition[];
  try {
    invariants = loadInvariants(invariantsPath);
  } catch {
    return '';
  }

  if (!invariants || invariants.length === 0) {
    return '';
  }

  // Find relevant invariants based on code_paths
  const relevantInvariants = invariants.filter((inv) => codePathMatchesInvariant(inv, codePaths));

  if (relevantInvariants.length === 0) {
    return '';
  }

  // Format the section
  const lines = [
    '## Invariants/Prior-Art (WU-2252)',
    '',
    'The following repo invariants are relevant to your code_paths:',
    '',
    ...relevantInvariants.flatMap(formatInvariantForOutput),
    '**IMPORTANT:** Do not create specs or acceptance criteria that conflict with these invariants.',
  ];

  return lines.join('\n');
}

/**
 * Generate the context loading preamble
 *
 * Follows AGENTS.md context loading protocol (WU-2247):
 * 1. CLAUDE.md for workflow fundamentals
 * 2. README.md for project structure
 * 3. lumenflow-complete.md sections 1-7 (TDD, gates, DoD)
 * 4. WU YAML for specific task
 *
 * Includes context recovery section for session resumption (WU-1589).
 *
 * @param {string} id - WU ID
 * @returns {string} Context loading preamble
 */
/**
 * Generate the context loading preamble using the strategy
 *
 * @param {string} id - WU ID
 * @param {import('./spawn-strategy.js').SpawnStrategy} strategy - Client strategy
 * @returns {string} Context loading preamble
 */
function generatePreamble(id: string, strategy: SpawnStrategy): string {
  return strategy.getPreamble(id);
}

/**
 * Generate the constraints block (appended at end per Lost in the Middle research)
 *
 * WU-2247: Aligned with LumenFlow §7.2 (stop-and-ask) and §7.3 (anti-loop guard).
 * Includes item 6: MEMORY LAYER COORDINATION (WU-1589).
 *
 * @param {string} id - WU ID
 * @returns {string} Constraints block
 */
function generateConstraints(id: string): string {
  return `---

<constraints>
CRITICAL RULES - ENFORCE BEFORE EVERY ACTION:

1. TDD CHECKPOINT (VERIFY BEFORE IMPLEMENTATION)
   - Did you write tests BEFORE implementation?
   - Is there at least one failing test for each acceptance criterion?
   - Never skip the RED phase — failing tests prove the test works

2. ANTI-LOOP GUARD (LumenFlow §7.3)
   - Max 3 attempts per unique error before escalating
   - If same error repeats 3x, STOP and report with full context
   - Retry with different approach, not same command

3. STOP-AND-ASK TRIGGERS (LumenFlow §7.2 - narrow scope)
   - Policy changes, auth/permissions modifications
   - PII/PHI/safety issues, cloud spend, secrets, backups
   - Same error repeats 3x
   - For ordinary errors: fix and retry autonomously (up to 3 attempts)

4. VERIFY COMPLETION before reporting success
   - Run: node packages/@lumenflow/agent/verification ${id} (from shared checkout)
   - Exit 0 = passed, Exit 1 = INCOMPLETE
   - Never report "done" if verification fails

5. NEVER FABRICATE COMPLETION
   - If blockers remain, report INCOMPLETE
   - If verification fails, summarize failures
   - Honesty over false completion

6. GIT WORKFLOW (CRITICAL - GitHub rules reject merge commits)
   - GitHub REJECTS merge commits on main
   - ALWAYS use \`git rebase origin/main\` before push
   - Push to main via \`git push origin lane/...:main\` (fast-forward only)
   - NEVER use \`git merge\` on main branch
   - Use \`pnpm wu:prep\` from worktree, then \`pnpm wu:done\` from main (WU-1223)

7. MEMORY LAYER COORDINATION (INIT-007)
   - Use \`pnpm mem:checkpoint --wu ${id}\` to save progress before risky operations
   - Check \`pnpm mem:inbox --wu ${id}\` periodically for parallel signals from other agents
   - Checkpoint triggers (WU-1943): checkpoint after each acceptance criterion completed, checkpoint before gates, checkpoint every 30 tool calls

8. SKIP-GATES AUTONOMY (WU-1142)
   - If gates fail, first check if failure is pre-existing on main: \`git checkout main && pnpm gates\`
   - If failure exists on main (not your change), use: \`pnpm wu:done --id ${id} --skip-gates --reason "pre-existing on main" --fix-wu WU-XXXX\`
   - Do NOT ask for approval - autonomous skip-gates for pre-existing failures is correct
   - This prevents getting stuck on infrastructure debt

9. WORKTREE DISCIPLINE (WU-1282)
   - CRITICAL: PreToolUse hooks do not propagate to sub-agents spawned via Task tool
   - BEFORE any Write/Edit operation, manually verify you are in a worktree:
   - Run: \`pwd\` and confirm output contains \`worktrees/\`
   - If not in worktree, STOP and navigate: \`cd worktrees/<lane>-wu-xxx\`
   - Use RELATIVE paths only (never full absolute paths starting with root directory)
   - This constraint exists because Claude Code does not inherit settings.json hooks in sub-agent sessions
</constraints>

${SPAWN_END_SENTINEL}`;
}

function generateCodexConstraints(id: string): string {
  return `## Constraints (Critical)

1. **TDD checkpoint**: tests BEFORE implementation; never skip RED
2. **Stop on errors**: if any command fails, report BLOCKED (never DONE) with the error
3. **Verify before success**: run \`pnpm gates\` in the worktree, then run \`node packages/@lumenflow/agent/verification ${id}\` (from the shared checkout)
4. **No fabrication**: if blockers remain or verification fails, report INCOMPLETE
5. **Git workflow**: avoid merge commits; use \`wu:prep\` from worktree, then \`wu:done\` from main
6. **Scope discipline**: stay within \`code_paths\`; capture out-of-scope issues via \`pnpm mem:create\`
7. **Worktree discipline (WU-1282)**: BEFORE any Write/Edit, verify \`pwd\` shows \`worktrees/\`; hooks do not propagate to sub-agents`;
}

/**
 * Generate mandatory agent advisory section
 *
 * @param {string[]} mandatoryAgents - Array of mandatory agent names
 * @param {string} _id - WU ID (reserved for future use)
 * @returns {string} Mandatory agent section or empty string
 */
function generateMandatoryAgentSection(mandatoryAgents: string[], _id: string): string {
  if (mandatoryAgents.length === 0) {
    return '';
  }

  const agentList = mandatoryAgents.map((agent) => `  - ${agent}`).join('\n');
  return `
## Mandatory Agents (MUST invoke before wu:done)

Based on code_paths, the following agents MUST be invoked:

${agentList}

Run: pnpm orchestrate:monitor to check agent status
`;
}

/**
 * Generate effort scaling rules section (WU-1986)
 *
 * Based on Anthropic multi-agent research: helps agents decide when to
 * spawn sub-agents vs handle inline.
 *
 * @returns {string} Effort scaling section
 */
export function generateEffortScalingRules() {
  return `## Effort Scaling (When to Spawn Sub-Agents)

Use this heuristic to decide complexity:

| Complexity | Approach | Tool Calls |
|------------|----------|------------|
| **Simple** (single file, <50 lines) | Handle inline | 3-10 |
| **Moderate** (2-3 files, clear scope) | Handle inline | 10-20 |
| **Complex** (4+ files, exploration needed) | Spawn Explore agent first | 20+ |
| **Multi-domain** (cross-cutting concerns) | Spawn specialized sub-agents | Varies |

**Rule**: If you need >30 tool calls for a subtask, consider spawning a sub-agent with a focused scope.`;
}

/**
 * Generate parallel tool call guidance (WU-1986)
 *
 * Based on Anthropic research: 3+ parallel tool calls significantly improve performance.
 *
 * @returns {string} Parallel tool call guidance
 */
export function generateParallelToolCallGuidance() {
  return `## Parallel Tool Calls (Performance)

**IMPORTANT**: Make 3+ tool calls in parallel when operations are independent.

Good examples:
- Reading multiple files simultaneously
- Running independent grep searches
- Spawning multiple Explore agents for different areas

Bad examples:
- Reading a file then editing it (sequential dependency)
- Running tests then checking results (sequential)

Parallelism reduces latency by 50-90% for complex tasks.`;
}

/**
 * Generate iterative search heuristics (WU-1986)
 *
 * Based on Anthropic research: start broad, narrow focus.
 *
 * @returns {string} Search heuristics section
 */
export function generateIterativeSearchHeuristics() {
  return `## Search Strategy (Broad to Narrow)

When exploring the codebase:

1. **Start broad**: Use Explore agent or glob patterns to understand structure
2. **Evaluate findings**: What patterns exist? What's relevant?
3. **Narrow focus**: Target specific files/functions based on findings
4. **Iterate**: Refine if initial approach misses the target

Avoid: Jumping directly to specific file edits without understanding context.`;
}

/**
 * Generate token budget awareness section (WU-1986)
 *
 * @param {string} id - WU ID
 * @returns {string} Token budget section
 */
export function generateTokenBudgetAwareness(id: string): string {
  return `## Token Budget Awareness

Context limit is ~200K tokens. Monitor your usage:

- **At 50+ tool calls**: Create a checkpoint (\`pnpm mem:checkpoint --wu ${id}\`)
- **At 100+ tool calls**: Consider spawning fresh sub-agent with focused scope
- **Before risky operations**: Always checkpoint first

If approaching limits, summarize progress and spawn continuation agent.`;
}

/**
 * Generate structured completion format (WU-1986)
 *
 * @param {string} id - WU ID
 * @returns {string} Completion format section
 */
export function generateCompletionFormat(_id: string): string {
  return `## Completion Report Format

When finishing, provide structured output:

\`\`\`
## Summary
<1-3 sentences describing what was accomplished>

## Artifacts
- Files modified: <list>
- Tests added: <list>
- Documentation updated: <list>

## Verification
- Gates: <pass/fail>
- Tests: <X passing, Y failing>

## Blockers (if any)
- <blocker description>

## Follow-up (if needed)
- <suggested next WU or action>
\`\`\`

This format enables orchestrator to track progress across waves.`;
}

/**
 * Generate agent coordination section (WU-1987, WU-1203)
 *
 * Provides guidance on mem:signal for parallel agent coordination,
 * orchestrate:monitor for agent status checks, and abandoned WU handling.
 *
 * WU-1203: Reads progress_signals config to generate dynamic guidance.
 * When enabled:true, shows "Progress Signals (Required at Milestones)" with
 * configurable triggers. When enabled:false or not configured, shows
 * "Progress Signals (Optional)".
 *
 * @param {string} id - WU ID
 * @returns {string} Agent coordination section
 */
export function generateAgentCoordinationSection(id: string): string {
  const config = getConfig();
  const progressSignals = config.memory?.progress_signals;
  // WU-1210: Default to enabled (Required at Milestones) when not explicitly configured
  // This ensures agents signal progress at key milestones by default
  const isEnabled = progressSignals?.enabled ?? true;

  // Generate milestone triggers section based on config
  const generateMilestoneTriggers = (): string => {
    if (!isEnabled) {
      // Disabled - show optional guidance only
      return `For long-running work, send progress signals at milestones:

\`\`\`bash
pnpm mem:signal "50% complete: tests passing, implementing adapter" --wu ${id}
pnpm mem:signal "Blocked: waiting for WU-XXX dependency" --wu ${id}
\`\`\``;
    }

    // WU-1210: isEnabled is true (either by default or explicit config)
    // Build list of enabled triggers, using defaults when progressSignals is undefined
    const triggers: string[] = [];

    // Default all triggers to enabled when not explicitly configured
    if ((progressSignals?.on_milestone ?? true) !== false) {
      triggers.push('**After each acceptance criterion completed** - helps track progress');
    }
    if ((progressSignals?.on_tests_pass ?? true) !== false) {
      triggers.push('**When tests first pass** - indicates implementation is working');
    }
    if ((progressSignals?.before_gates ?? true) !== false) {
      triggers.push('**Before running gates** - signals imminent completion');
    }
    if ((progressSignals?.on_blocked ?? true) !== false) {
      triggers.push('**When blocked** - allows orchestrator to re-allocate or assist');
    }

    // Add frequency-based trigger if configured
    const frequency = progressSignals?.frequency ?? 0;
    let frequencyGuidance = '';
    if (frequency > 0) {
      frequencyGuidance = `\n5. **Every ${frequency} tool calls** - periodic progress update`;
    }

    const triggerList =
      triggers.length > 0
        ? triggers.map((t, i) => `${i + 1}. ${t}`).join('\n') + frequencyGuidance
        : 'Signal at key milestones to enable orchestrator visibility.';

    return `**Signal at these milestones** to enable orchestrator visibility:

${triggerList}

\`\`\`bash
pnpm mem:signal "AC1 complete: tests passing for feature X" --wu ${id}
pnpm mem:signal "All tests passing, running gates" --wu ${id}
pnpm mem:signal "Blocked: waiting for WU-XXX dependency" --wu ${id}
\`\`\``;
  };

  const progressSectionTitle = isEnabled
    ? '### Progress Signals (Required at Milestones)'
    : '### Progress Signals (Optional)';

  return `## Agent Coordination (Parallel Work)

### ⚠️ CRITICAL: Use mem:signal, NOT TaskOutput

**DO NOT** use TaskOutput to check agent progress - it returns full transcripts
and causes "prompt too long" errors. Always use the memory layer instead:

\`\`\`bash
# ✅ CORRECT: Compact signals (~6 lines)
pnpm mem:inbox --since 30m

# ❌ WRONG: Full transcripts (context explosion)
# TaskOutput with block=false  <-- NEVER DO THIS FOR MONITORING
\`\`\`

### Automatic Completion Signals

\`wu:done\` automatically broadcasts completion signals. You do not need to
manually signal completion - just run \`wu:done\` and orchestrators will
see your signal via \`mem:inbox\`.

${progressSectionTitle}

${generateMilestoneTriggers()}

### Checking Status

\`\`\`bash
pnpm orchestrate:init-status -i INIT-XXX  # Initiative progress (compact)
pnpm mem:inbox --since 1h                  # Recent signals from all agents
pnpm mem:inbox --lane "Experience: Web"    # Lane-specific signals
\`\`\``;
}

/**
 * Generate quick fix commands section (WU-1987)
 *
 * Provides format/lint/typecheck commands for quick fixes before gates.
 *
 * @returns {string} Quick fix commands section
 */
export function generateQuickFixCommands() {
  return `## Quick Fix Commands

If gates fail, try these before investigating:

\`\`\`bash
pnpm format      # Auto-fix formatting issues
pnpm lint        # Check linting (use --fix for auto-fix)
pnpm typecheck   # Check TypeScript types
\`\`\`

**Use before gates** to catch simple issues early. These are faster than full \`pnpm gates\`.`;
}

/**
 * WU-1270: Emit methodology telemetry event (opt-in)
 *
 * Emits privacy-preserving telemetry about methodology selection.
 * Only emits if telemetry.methodology.enabled is true in config.
 *
 * @param config - LumenFlow configuration
 * @param policy - Resolved methodology policy
 */
export function emitMethodologyTelemetry(config: LumenFlowConfig, policy: ResolvedPolicy): void {
  // Check if methodology telemetry is opt-in enabled
  if (!config.telemetry?.methodology?.enabled) {
    return;
  }

  const event = {
    timestamp: new Date().toISOString(),
    event_type: 'methodology.selection',
    methodology_testing: policy.testing,
    methodology_architecture: policy.architecture,
    event_context: 'spawn',
  };

  // Use the telemetry emit function from telemetry.ts - WU-1430: Use centralized constant
  emitTelemetry(LUMENFLOW_PATHS.METHODOLOGY_LOG, event);
}

/**
 * Generate Lane Selection section (WU-2107)
 *
 * Provides guidance on lane selection when creating new WUs.
 * Points agents to wu:infer-lane for automated lane suggestions.
 *
 * @returns {string} Lane Selection section
 */
export function generateLaneSelectionSection() {
  return `## Lane Selection

When creating new WUs, use the correct lane to enable parallelization:

\`\`\`bash
# Get lane suggestion based on code paths and description
pnpm wu:infer-lane --id WU-XXX

# Or infer from manual inputs
pnpm wu:infer-lane --paths "tools/**" --desc "CLI improvements"
\`\`\`

**Lane taxonomy**: See \`.lumenflow.lane-inference.yaml\` for valid lanes and patterns.

**Why lanes matter**: WIP=1 per lane means correct lane selection enables parallel work across lanes.`;
}

/**
 * Generate Worktree Path Guidance section (WU-2362)
 *
 * Provides guidance for sub-agents on working within worktrees, including
 * how to determine the worktree root and where to create stamps.
 *
 * Problem: CLAUDE_PROJECT_DIR is hook-only; sub-agents inherit parent cwd (main).
 * Solution: Use git rev-parse --show-toplevel to determine actual worktree root.
 *
 * @param {string|undefined} worktreePath - Worktree path from WU YAML
 * @returns {string} Worktree path guidance section
 */
export function generateWorktreePathGuidance(worktreePath: string | undefined): string {
  if (!worktreePath) {
    return '';
  }

  return `## Worktree Path Guidance (WU-2362)

**Your worktree:** \`${worktreePath}\`

### Finding the Worktree Root

Sub-agents may inherit the parent's cwd (main checkout). To find the actual worktree root:

\`\`\`bash
# Get the worktree root (not main checkout)
git rev-parse --show-toplevel
\`\`\`

### Stamp Creation

When creating \`.lumenflow/\` stamps or other artifacts:

1. **ALWAYS** create stamps in the **worktree**, not main
2. Use \`git rev-parse --show-toplevel\` to get the correct base path
3. Stamps created on main will be lost when the worktree merges

\`\`\`bash
# CORRECT: Create stamp in worktree
WORKTREE_ROOT=$(git rev-parse --show-toplevel)
mkdir -p "$WORKTREE_ROOT/.lumenflow/agent-runs"
touch "$WORKTREE_ROOT/.lumenflow/agent-runs/code-reviewer.stamp"

# WRONG: Hardcoded path to main
# touch /path/to/main/.lumenflow/agent-runs/code-reviewer.stamp
\`\`\`

### Why This Matters

- Stamps on main get overwritten by worktree merge
- \`wu:done\` validates stamps exist in the worktree branch
- Parallel WUs in other lanes won't see your stamps if on main`;
}

/**
 * Generate the Bug Discovery section (WU-1592, WU-2284)
 *
 * Instructs sub-agents to capture bugs found mid-WU via mem:create.
 * This enables scope-creep tracking and ensures discovered bugs
 * are not lost when agents encounter issues outside their WU scope.
 *
 * WU-2284: Added explicit prohibition against using wu:create directly
 * for discovered issues. Agents must use mem:create for capture, then
 * human triage decides whether to promote to a WU.
 *
 * @param {string} id - WU ID
 * @returns {string} Bug Discovery section
 */
function generateBugDiscoverySection(id: string): string {
  return `## Bug Discovery (Mid-WU Issue Capture)

If you discover a bug or issue **outside the scope of this WU**:

1. **Capture it immediately** using:
   \`\`\`bash
   pnpm mem:create 'Bug: <description>' --type discovery --tags bug,scope-creep --wu ${id}
   \`\`\`

2. **Continue with your WU** — do not fix bugs outside your scope
3. **Reference in notes** — mention the mem node ID in your completion notes

### NEVER use wu:create for discovered issues

**Do NOT use \`wu:create\` directly for bugs discovered mid-WU.**

- \`mem:create\` = **capture** (immediate, no human approval needed)
- \`wu:create\` = **planned work** (requires human triage and approval)

Discovered issues MUST go through human triage before becoming WUs.
Using \`wu:create\` directly bypasses the triage workflow and creates
unreviewed work items.

### When to Capture

- Found a bug in code NOT in your \`code_paths\`
- Discovered an issue that would require >10 lines to fix
- Encountered broken behaviour unrelated to your acceptance criteria

### Triage Workflow

After WU completion, bugs can be promoted to Bug WUs by humans:
\`\`\`bash
pnpm mem:triage --wu ${id}           # List discoveries for this WU
pnpm mem:triage --promote <node-id> --lane "<lane>"  # Create Bug WU (human action)
\`\`\`

See: https://lumenflow.dev/reference/agent-invocation-guide/ §Bug Discovery`;
}

/**
 * Generate lane-specific guidance
 *
 * @param {string} lane - Lane name
 * @returns {string} Lane-specific guidance or empty string
 */
function generateLaneGuidance(lane: string | undefined): string {
  if (!lane) return '';

  const laneParent = lane.split(':')[0].trim();

  const guidance: Record<string, string> = {
    Operations: `## Lane-Specific: Tooling

- Update tool documentation in tools/README.md or relevant docs if adding new CLI commands`,
    Intelligence: `## Lane-Specific: Intelligence

- All prompt changes require golden dataset evaluation (pnpm prompts:eval)
- Follow prompt versioning guidelines in ai/prompts/README.md`,
    Experience: `## Lane-Specific: Experience

- Follow design system tokens defined in the project
- Ensure accessibility compliance (WCAG 2.1 AA)`,
    Core: `## Lane-Specific: Core

- Maintain hexagonal architecture boundaries
- Update domain model documentation if changing entities`,
  };

  return guidance[laneParent] || '';
}

/**
 * Generate the Action section based on WU claim status (WU-1745).
 *
 * If WU is already claimed (has claimed_at and worktree_path), tells agent
 * to continue in the existing worktree.
 *
 * If WU is unclaimed (status: ready), tells agent to run wu:claim first.
 *
 * @param {object} doc - WU YAML document
 * @param {string} id - WU ID
 * @returns {string} Action section content
 */
export function generateActionSection(doc: WUDoc, id: string): string {
  const isAlreadyClaimed = doc.claimed_at && doc.worktree_path;

  if (isAlreadyClaimed) {
    return `This WU is already claimed. Continue implementation in worktree following all standards above.

cd ${doc.worktree_path}`;
  }

  // WU is unclaimed - agent needs to claim first
  const laneSlug = (doc.lane || 'unknown')
    .toLowerCase()
    .replace(/[:\s]+/g, '-')
    .replace(/-+/g, '-');

  return `**FIRST: Claim this WU before starting work:**

\`\`\`bash
pnpm wu:claim --id ${id} --lane "${doc.lane}"
cd worktrees/${laneSlug}-${id.toLowerCase()}
\`\`\`

Then implement following all standards above.

**CRITICAL:** Never use \`git worktree add\` directly. Always use \`pnpm wu:claim\` to ensure:
- Event tracking in ${LUMENFLOW_PATHS.WU_EVENTS}
- Lane lock acquisition (WIP=1 enforcement)
- Session tracking for context recovery`;
}

interface ClientContext {
  name: string;
  config?: ClientConfig;
}

interface SpawnOptions {
  thinking?: boolean;
  noThinking?: boolean;
  budget?: string;
  client?: ClientContext;
  config?: LumenFlowConfig;
  /** WU-1240: Base directory for memory context loading */
  baseDir?: string;
  /** WU-1240: Include memory context section (default: false for backward compat) */
  includeMemoryContext?: boolean;
  /** WU-1240: Skip memory context even if includeMemoryContext is true */
  noContext?: boolean;
  /** WU-1240: Memory context content (pre-generated, for async integration) */
  memoryContextContent?: string;
}

function generateClientBlocksSection(clientContext: ClientContext | undefined): string {
  if (!clientContext?.config?.blocks?.length) return '';
  const blocks = clientContext.config.blocks
    .map((block) => `### ${block.title}\n\n${block.content}`)
    .join('\n\n');
  return `## Client Guidance (${clientContext.name})\n\n${blocks}`;
}

/**
 * Generate the complete Task tool invocation
 *
 * @param {object} doc - WU YAML document
 * @param {string} id - WU ID
 * @param {SpawnStrategy} strategy - Client strategy
 * @param {object} [options={}] - Thinking mode options
 * @param {boolean} [options.thinking] - Whether extended thinking is enabled
 * @param {boolean} [options.noThinking] - Whether thinking is explicitly disabled
 * @param {string} [options.budget] - Token budget for thinking
 * @returns {string} Complete Task tool invocation
 */
export function generateTaskInvocation(
  doc: WUDoc,
  id: string,
  strategy: SpawnStrategy,
  options: SpawnOptions = {},
): string {
  const codePaths = doc.code_paths || [];
  const mandatoryAgents = detectMandatoryAgents(codePaths);

  const preamble = generatePreamble(id, strategy);
  const clientContext = options.client;
  const config = options.config || getConfig();

  // WU-1279: Resolve policy and use policy-based test guidance
  const policy = resolvePolicy(config);
  const testGuidance = generatePolicyBasedTestGuidance(doc.type || 'feature', policy);

  // WU-1279: Generate enforcement summary from resolved policy
  const enforcementSummary = generateEnforcementSummary(policy);

  // WU-1279: Generate mandatory standards based on resolved policy
  const mandatoryStandards = generateMandatoryStandards(policy);
  const clientSkillsGuidance = generateClientSkillsGuidance(clientContext);
  const skillsSection =
    generateSkillsSelectionSection(doc, config, clientContext?.name) +
    (clientSkillsGuidance ? `\n${clientSkillsGuidance}` : '');
  const clientBlocks = generateClientBlocksSection(clientContext);
  const mandatorySection = generateMandatoryAgentSection(mandatoryAgents, id);
  const laneGuidance = generateLaneGuidance(doc.lane);
  const bugDiscoverySection = generateBugDiscoverySection(id);
  const constraints = generateConstraints(id);
  const implementationContext = generateImplementationContext(doc);

  // WU-2252: Generate invariants/prior-art section for code_paths
  const invariantsPriorArt = generateInvariantsPriorArtSection(codePaths);

  // WU-1986: Anthropic multi-agent best practices sections
  const effortScaling = generateEffortScalingRules();
  const parallelToolCalls = generateParallelToolCallGuidance();
  const searchHeuristics = generateIterativeSearchHeuristics();
  const tokenBudget = generateTokenBudgetAwareness(id);
  const completionFormat = generateCompletionFormat(id);

  // WU-1987: Agent coordination and quick fix sections
  const agentCoordination = generateAgentCoordinationSection(id);
  const quickFix = generateQuickFixCommands();

  // WU-2107: Lane selection guidance
  const laneSelection = generateLaneSelectionSection();

  // WU-2362: Worktree path guidance for sub-agents
  const worktreeGuidance = generateWorktreePathGuidance(doc.worktree_path);

  // WU-1240: Memory context section
  // Include if explicitly enabled and not disabled via noContext
  const shouldIncludeMemoryContext = options.includeMemoryContext && !options.noContext;
  const memoryContextSection = shouldIncludeMemoryContext ? options.memoryContextContent || '' : '';

  // Generate thinking mode sections if applicable
  const executionModeSection = generateExecutionModeSection(options);
  const thinkToolGuidance = generateThinkToolGuidance(options);

  // Build optional sections string
  const thinkingSections = [executionModeSection, thinkToolGuidance]
    .filter((section) => section.length > 0)
    .join('\n\n---\n\n');

  const thinkingBlock = thinkingSections ? `${thinkingSections}\n\n---\n\n` : '';

  // Build the task prompt
  // WU-1192: Truncation warning at start, test guidance after </task> per "Lost in the Middle" research
  const taskPrompt = `${TRUNCATION_WARNING_BANNER}<task>
${preamble}
</task>

---

${testGuidance}

---

# ${id}: ${doc.title || 'Untitled'}

## WU Details

- **ID:** ${id}
- **Lane:** ${doc.lane || 'Unknown'}
- **Type:** ${doc.type || 'feature'}
- **Status:** ${doc.status || 'unknown'}
- **Worktree:** ${doc.worktree_path || `worktrees/<lane>-${id.toLowerCase()}`}

## Description

${doc.description || 'No description provided.'}

## Acceptance Criteria

${formatAcceptance(doc.acceptance)}

## Code Paths

${codePaths.length > 0 ? codePaths.map((p) => `- ${p}`).join('\n') : '- No code paths defined'}
${mandatorySection}${invariantsPriorArt ? `---\n\n${invariantsPriorArt}\n\n` : ''}${implementationContext ? `---\n\n${implementationContext}\n\n` : ''}---

${thinkingBlock}${skillsSection}
${memoryContextSection ? `---\n\n${memoryContextSection}\n\n` : ''}---

${mandatoryStandards}

---

${enforcementSummary}

${clientBlocks ? `---\n\n${clientBlocks}\n\n` : ''}${worktreeGuidance ? `---\n\n${worktreeGuidance}\n\n` : ''}---

${bugDiscoverySection}

---

${effortScaling}

---

${parallelToolCalls}

---

${searchHeuristics}

---

${tokenBudget}

---

${completionFormat}

---

${agentCoordination}

---

${quickFix}

---

${laneSelection}

---

${laneGuidance}${laneGuidance ? '\n\n---\n\n' : ''}## Action

${generateActionSection(doc, id)}

${constraints}`;

  // Escape special characters for XML output
  const escapedPrompt = taskPrompt
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Build the Task tool invocation block using antml format
  // Using array join to avoid XML parsing issues
  const openTag = '<' + 'antml:invoke name="Task">';
  const closeTag = '</' + 'antml:invoke>';
  const paramOpen = '<' + 'antml:parameter name="';
  const paramClose = '</' + 'antml:parameter>';

  const invocation = [
    '<' + 'antml:function_calls>',
    openTag,
    `${paramOpen}subagent_type">general-purpose${paramClose}`,
    `${paramOpen}description">Execute ${id}${paramClose}`,
    `${paramOpen}prompt">${escapedPrompt}${paramClose}`,
    closeTag,
    '</' + 'antml:function_calls>',
  ].join('\n');

  return invocation;
}

export function generateCodexPrompt(
  doc: WUDoc,
  id: string,
  strategy: SpawnStrategy,
  options: SpawnOptions = {},
): string {
  const codePaths = doc.code_paths || [];
  const mandatoryAgents = detectMandatoryAgents(codePaths);

  const preamble = generatePreamble(id, strategy);
  const mandatorySection = generateMandatoryAgentSection(mandatoryAgents, id);
  const laneGuidance = generateLaneGuidance(doc.lane);
  const bugDiscoverySection = generateBugDiscoverySection(id);
  const implementationContext = generateImplementationContext(doc);
  const action = generateActionSection(doc, id);
  const constraints = generateCodexConstraints(id);
  const clientContext = options.client;
  const config = options.config || getConfig();
  const clientSkillsGuidance = generateClientSkillsGuidance(clientContext);
  const skillsSection =
    generateSkillsSelectionSection(doc, config, clientContext?.name) +
    (clientSkillsGuidance ? `\n${clientSkillsGuidance}` : '');
  const clientBlocks = generateClientBlocksSection(clientContext);

  // WU-1290: Resolve policy and use policy-based test guidance (same as generateTaskInvocation)
  const policy = resolvePolicy(config);
  const testGuidance = generatePolicyBasedTestGuidance(doc.type || 'feature', policy);

  // WU-1290: Generate enforcement summary from resolved policy
  const enforcementSummary = generateEnforcementSummary(policy);

  // WU-1290: Generate mandatory standards based on resolved policy
  const mandatoryStandards = generateMandatoryStandards(policy);

  const executionModeSection = generateExecutionModeSection(options);
  const thinkToolGuidance = generateThinkToolGuidance(options);
  const thinkingSections = [executionModeSection, thinkToolGuidance]
    .filter((section) => section.length > 0)
    .join('\n\n---\n\n');
  const thinkingBlock = thinkingSections ? `${thinkingSections}\n\n---\n\n` : '';

  return `# ${id}: ${doc.title || 'Untitled'}

${testGuidance}

---

## Context

${preamble}

---

## WU Details

- **ID:** ${id}
- **Lane:** ${doc.lane || 'Unknown'}
- **Type:** ${doc.type || 'feature'}
- **Status:** ${doc.status || 'unknown'}
- **Worktree:** ${doc.worktree_path || `worktrees/<lane>-${id.toLowerCase()}`}

## Description

${doc.description || 'No description provided.'}

## Scope (code_paths)

Only change files within these paths:

${codePaths.length > 0 ? codePaths.map((p) => `- ${p}`).join('\n') : '- No code paths defined'}

## Acceptance Criteria

${formatAcceptance(doc.acceptance)}

---

${mandatoryStandards}

---

${enforcementSummary}

---

${skillsSection}

---

## Action

${action}

---

## Verification

- Run in worktree: \`pnpm gates\`
- From shared checkout: \`node packages/@lumenflow/agent/verification ${id}\`

---

${mandatorySection}${implementationContext ? `${implementationContext}\n\n---\n\n` : ''}${clientBlocks ? `${clientBlocks}\n\n---\n\n` : ''}${thinkingBlock}${bugDiscoverySection}

---

${laneGuidance}${laneGuidance ? '\n\n---\n\n' : ''}${constraints}
`;
}

/**
 * WU-1603: Check if a lane is currently occupied by another WU
 *
 * @param {string} lane - Lane name (e.g., "Operations: Tooling")
 * @returns {import('./lib/lane-lock.js').LockMetadata|null} Lock metadata if occupied, null otherwise
 */
export function checkLaneOccupation(lane: string): LockMetadata | null {
  const lockStatus = checkLaneLock(lane);
  if (lockStatus.locked && lockStatus.metadata) {
    return lockStatus.metadata;
  }
  return null;
}

/**
 * Options for lane occupation warning
 */
interface LaneOccupationWarningOptions {
  /** Whether the lock is stale (>24h old) */
  isStale?: boolean;
}

/**
 * WU-1603: Generate a warning message when lane is occupied
 *
 * @param {import('./lib/lane-lock.js').LockMetadata} lockMetadata - Lock metadata
 * @param {string} targetWuId - WU ID being spawned
 * @param {LaneOccupationWarningOptions} [options={}] - Options
 * @returns {string} Warning message
 */
export function generateLaneOccupationWarning(
  lockMetadata: LockMetadata,
  targetWuId: string,
  options: LaneOccupationWarningOptions = {},
): string {
  const { isStale = false } = options;

  let warning = `⚠️  Lane "${lockMetadata.lane}" is occupied by ${lockMetadata.wuId}\n`;
  warning += `   This violates WIP=1 (Work In Progress limit of 1 per lane).\n\n`;

  if (isStale) {
    warning += `   ⏰ This lock is STALE (>24 hours old) - the WU may be abandoned.\n`;
    warning += `   Consider using pnpm wu:block --id ${lockMetadata.wuId} if work is stalled.\n\n`;
  }

  warning += `   Options:\n`;
  warning += `   1. Wait for ${lockMetadata.wuId} to complete or block\n`;
  warning += `   2. Choose a different lane for ${targetWuId}\n`;
  warning += `   3. Block ${lockMetadata.wuId} if work is stalled: pnpm wu:block --id ${lockMetadata.wuId}`;

  return warning;
}

/**
 * Main entry point
 */
async function main() {
  // WU-2202: Validate dependencies BEFORE any other operation
  // This prevents false lane occupancy reports when yaml package is missing
  const depResult = await validateSpawnDependencies();
  if (!depResult.valid) {
    die(formatDependencyError('wu:spawn', depResult.missing));
  }

  const args = createWUParser({
    name: 'wu-spawn',
    description: 'Generate Task tool invocation for sub-agent WU execution',
    options: [
      WU_OPTIONS.id,
      WU_OPTIONS.thinking,
      WU_OPTIONS.noThinking,
      WU_OPTIONS.budget,
      WU_OPTIONS.codex,
      WU_OPTIONS.id,
      WU_OPTIONS.thinking,
      WU_OPTIONS.noThinking,
      WU_OPTIONS.budget,
      WU_OPTIONS.codex,
      WU_OPTIONS.parentWu, // WU-1945: Parent WU for spawn registry tracking
      WU_OPTIONS.client,
      WU_OPTIONS.vendor,
    ],
    required: ['id'],
    allowPositionalId: true,
  }) as SpawnCliArgs;

  // Validate thinking mode options
  try {
    validateSpawnArgs(args);
  } catch (e: unknown) {
    die(getErrorMessage(e));
  }

  const id = args.id.toUpperCase();
  if (!PATTERNS.WU_ID.test(id)) {
    die(`Invalid WU id '${args.id}'. Expected format WU-123`);
  }

  const WU_PATH = WU_PATHS.WU(id);

  // Check if WU file exists
  if (!existsSync(WU_PATH)) {
    die(
      `WU file not found: ${WU_PATH}\n\n` +
        `Cannot spawn a sub-agent for a WU that doesn't exist.\n\n` +
        `Options:\n` +
        `  1. Create the WU first: pnpm wu:create --id ${id} --lane <lane> --title "..."\n` +
        `  2. Check if the WU ID is correct`,
    );
  }

  // Read and parse WU YAML
  let doc;
  let text;
  try {
    text = readFileSync(WU_PATH, { encoding: 'utf-8' });
  } catch (e: unknown) {
    die(
      `Failed to read WU file: ${WU_PATH}\n\n` +
        `Error: ${getErrorMessage(e)}\n\n` +
        `Options:\n` +
        `  1. Check file permissions: ls -la ${WU_PATH}\n` +
        `  2. Ensure the file exists and is readable`,
    );
  }
  try {
    doc = parseYAML(text);
  } catch (e: unknown) {
    die(
      `Failed to parse WU YAML ${WU_PATH}\n\n` +
        `Error: ${getErrorMessage(e)}\n\n` +
        `Options:\n` +
        `  1. Validate YAML syntax: pnpm wu:validate --id ${id}\n` +
        `  2. Fix YAML errors manually and retry`,
    );
  }

  // Warn if WU is not in ready or in_progress status
  const validStatuses = [WU_STATUS.READY, WU_STATUS.IN_PROGRESS];
  if (!validStatuses.includes(doc.status)) {
    console.warn(`${LOG_PREFIX} ${EMOJI.WARNING} Warning: ${id} has status '${doc.status}'.`);
    console.warn(
      `${LOG_PREFIX} ${EMOJI.WARNING} Sub-agents typically work on ready or in_progress WUs.`,
    );
    console.warn('');
  }

  // WU-1603: Check if lane is already occupied and warn
  const lane = doc.lane;
  if (lane) {
    const existingLock = checkLaneOccupation(lane);
    if (existingLock && existingLock.wuId !== id) {
      // Lane is occupied by a different WU
      const { isLockStale } = await import('./lane-lock.js');
      const isStale = isLockStale(existingLock);
      const warning = generateLaneOccupationWarning(existingLock, id, { isStale });
      console.warn(`${LOG_PREFIX} ${EMOJI.WARNING}\n${warning}\n`);
    }
  }

  // Build thinking mode options for task invocation
  const thinkingOptions = {
    thinking: args.thinking,
    noThinking: args.noThinking,
    budget: args.budget,
  };

  // Client Resolution
  const config = getConfig();
  let clientName = args.client;

  if (!clientName && args.vendor) {
    console.warn(`${LOG_PREFIX} ${EMOJI.WARNING} Warning: --vendor is deprecated. Use --client.`);
    clientName = args.vendor;
  }

  // Codex handling (deprecated legacy flag)
  if (args.codex) {
    if (!clientName) {
      console.warn(
        `${LOG_PREFIX} ${EMOJI.WARNING} Warning: --codex is deprecated. Use --client codex-cli.`,
      );
      clientName = 'codex-cli';
    }
  }

  if (!clientName) {
    clientName = config.agents.defaultClient || 'claude-code';
  }

  // Create strategy
  const strategy = SpawnStrategyFactory.create(clientName);
  const clientContext = { name: clientName, config: resolveClientConfig(config, clientName) };

  if (clientName === 'codex-cli' || args.codex) {
    const _prompt = generateCodexPrompt(doc, id, strategy, {
      ...thinkingOptions,
      client: clientContext,
      config,
    });
    console.log(`${LOG_PREFIX} Generated Codex/GPT prompt for ${id}`);
    console.log(`${LOG_PREFIX} Copy the Markdown below:\n`);
    // ...

    // Generate and output the Task invocation
    const invocation = generateTaskInvocation(doc, id, strategy, {
      ...thinkingOptions,
      client: clientContext,
      config,
    });

    console.log(`${LOG_PREFIX} Generated Task tool invocation for ${id}`);
    console.log(`${LOG_PREFIX} Copy the block below to spawn a sub-agent:\n`);
    console.log(invocation);

    // WU-1270: Emit methodology telemetry (opt-in only)
    const policy = resolvePolicy(config);
    emitMethodologyTelemetry(config, policy);

    // WU-1945: Record spawn event to registry (non-blocking)
    // Only record if --parent-wu is provided (orchestrator context)
    if (args.parentWu) {
      const registryResult = await recordSpawnToRegistry({
        parentWuId: args.parentWu,
        targetWuId: id,
        lane: doc.lane || 'Unknown',
        baseDir: LUMENFLOW_PATHS.STATE_DIR,
      });

      const registryMessage = formatSpawnRecordedMessage(
        registryResult.spawnId,
        registryResult.error,
      );
      console.log(`\n${registryMessage}`);
    }
  }
}

// Guard main() for testability
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}

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
 * @see {@link docs/04-operations/_frameworks/lumenflow/agent/onboarding/agent-invocation-guide.md} - Context loading templates
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/dist/arg-parser.js';
import { WU_PATHS } from '@lumenflow/core/dist/wu-paths.js';
import { parseYAML } from '@lumenflow/core/dist/wu-yaml.js';
import { die } from '@lumenflow/core/dist/error-handler.js';
import { WU_STATUS, PATTERNS, FILE_SYSTEM, EMOJI } from '@lumenflow/core/dist/wu-constants.js';
// WU-1603: Check lane lock status before spawning
import { checkLaneLock } from '@lumenflow/core/dist/lane-lock.js';
import { minimatch } from 'minimatch';
// WU-2252: Import invariants loader for spawn output injection
import { loadInvariants, INVARIANT_TYPES } from '@lumenflow/core/dist/invariants-runner.js';
import {
  validateSpawnArgs,
  generateExecutionModeSection,
  generateThinkToolGuidance,
  recordSpawnToRegistry,
  formatSpawnRecordedMessage,
} from '@lumenflow/core/dist/wu-spawn-helpers.js';
import { SpawnStrategyFactory } from '@lumenflow/core/dist/spawn-strategy.js';
import type { SpawnStrategy } from '@lumenflow/core/dist/spawn-strategy.js';
import { getConfig } from '@lumenflow/core/dist/lumenflow-config.js';
import type { ClientConfig } from '@lumenflow/core/dist/lumenflow-config-schema.js';
import {
  generateClientSkillsGuidance,
  generateSkillsSelectionSection,
  resolveClientConfig,
} from '@lumenflow/core/dist/wu-spawn-skills.js';

import {
  validateSpawnDependencies,
  formatDependencyError,
} from '@lumenflow/core/dist/dependency-validator.js';

/**
 * Mandatory agent trigger patterns.
 * Mirrors MANDATORY_TRIGGERS from orchestration-advisory-loader.mjs.
 */
const MANDATORY_TRIGGERS = {
  'security-auditor': ['supabase/migrations/**', '**/auth/**', '**/rls/**', '**/permissions/**'],
  'beacon-guardian': ['**/prompts/**', '**/classification/**', '**/detector/**', '**/llm/**'],
};

const LOG_PREFIX = '[wu:spawn]';

/**
 * WU-1131: Truncation prevention constants
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
 * Detect mandatory agents based on code paths.
 *
 * @param {string[]} codePaths - Array of file paths
 * @returns {string[]} Array of mandatory agent names
 */
function detectMandatoryAgents(codePaths) {
  if (!codePaths || codePaths.length === 0) {
    return [];
  }

  const triggeredAgents = new Set();

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
function formatAcceptance(acceptance) {
  if (!acceptance || acceptance.length === 0) {
    return '- No acceptance criteria defined';
  }
  return acceptance.map((item) => `- [ ] ${item}`).join('\n');
}

/**
 * Format spec_refs as markdown links
 *
 * @param {string[]|undefined} specRefs - Spec references array
 * @returns {string} Formatted references or empty string if none
 */
function formatSpecRefs(specRefs) {
  if (!specRefs || specRefs.length === 0) {
    return '';
  }
  return specRefs.map((ref) => `- ${ref}`).join('\n');
}

/**
 * Format risks as markdown list
 *
 * @param {string[]|undefined} risks - Risks array
 * @returns {string} Formatted risks or empty string if none
 */
function formatRisks(risks) {
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
function formatManualTests(manualTests) {
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
function generateImplementationContext(doc) {
  const sections = [];

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
function codePathMatchesInvariant(invariant, codePaths) {
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
function formatInvariantForOutput(inv) {
  const lines = [`### ${inv.id} (${inv.type})`, '', inv.description, ''];

  if (inv.message) {
    lines.push(`**Action:** ${inv.message}`, '');
  }

  if (inv.path) {
    lines.push(`**Path:** \`${inv.path}\``);
  }

  if (inv.paths) {
    lines.push(`**Paths:** ${inv.paths.map((p) => `\`${p}\``).join(', ')}`);
  }

  // WU-2254: forbidden-import specific fields
  if (inv.from) {
    lines.push(`**From:** \`${inv.from}\``);
  }

  if (inv.cannot_import && Array.isArray(inv.cannot_import)) {
    lines.push(`**Cannot Import:** ${inv.cannot_import.map((m) => `\`${m}\``).join(', ')}`);
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
    lines.push(`**Scope:** ${inv.scope.map((s) => `\`${s}\``).join(', ')}`);
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
function generateInvariantsPriorArtSection(codePaths) {
  if (!codePaths || codePaths.length === 0) {
    return '';
  }

  // Try to load tools/invariants.yml
  const invariantsPath = path.resolve('tools/invariants.yml');
  if (!existsSync(invariantsPath)) {
    return '';
  }

  let invariants;
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
 * WU types that require TDD (failing test first)
 */
const TDD_REQUIRED_TYPES = ['feature', 'bug', 'tooling', 'enhancement'];

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
 * Generate type-aware test guidance (WU-1142)
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
 * Generate the TDD directive section (WU-1585)
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

### Why This Matters

- Tests document expected behavior BEFORE implementation
- Prevents scope creep and over-engineering
- Ensures every feature has verification
- Failing tests prove the test actually tests something`;
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
 * @param {SpawnStrategy} strategy - Client strategy
 * @returns {string} Context loading preamble
 */
function generatePreamble(id, strategy) {
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
function generateConstraints(id) {
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
   - Run: node tools/lib/agent-verification.mjs ${id} (from shared checkout)
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
   - Let \`pnpm wu:done\` handle the merge workflow

7. MEMORY LAYER COORDINATION (INIT-007)
   - Use \`pnpm mem:checkpoint --wu ${id}\` to save progress before risky operations
   - Check \`pnpm mem:inbox --wu ${id}\` periodically for parallel signals from other agents
   - Checkpoint triggers (WU-1943): checkpoint after each acceptance criterion completed, checkpoint before gates, checkpoint every 30 tool calls

8. SKIP-GATES AUTONOMY (WU-1142)
   - If gates fail, first check if failure is pre-existing on main: \`git checkout main && pnpm gates\`
   - If failure exists on main (not your change), use: \`pnpm wu:done --id ${id} --skip-gates --reason "pre-existing on main" --fix-wu WU-XXXX\`
   - Do NOT ask for approval - autonomous skip-gates for pre-existing failures is correct
   - This prevents getting stuck on infrastructure debt
</constraints>`;
}

function generateCodexConstraints(id) {
  return `## Constraints (Critical)

1. **TDD checkpoint**: tests BEFORE implementation; never skip RED
2. **Stop on errors**: if any command fails, report BLOCKED (never DONE) with the error
3. **Verify before success**: run \`pnpm gates\` in the worktree, then run \`node tools/lib/agent-verification.mjs ${id}\` (from the shared checkout)
4. **No fabrication**: if blockers remain or verification fails, report INCOMPLETE
5. **Git workflow**: avoid merge commits; let \`pnpm wu:done\` handle completion
6. **Scope discipline**: stay within \`code_paths\`; capture out-of-scope issues via \`pnpm mem:create\`
7. **Skip-gates for pre-existing**: if gates fail due to pre-existing issue on main, use \`--skip-gates --reason "pre-existing" --fix-wu WU-XXX\``;
}

/**
 * Generate mandatory agent advisory section
 *
 * @param {string[]} mandatoryAgents - Array of mandatory agent names
 * @param {string} id - WU ID
 * @returns {string} Mandatory agent section or empty string
 */
function generateMandatoryAgentSection(mandatoryAgents, id) {
  if (mandatoryAgents.length === 0) {
    return '';
  }

  const agentList = mandatoryAgents.map((agent) => `  - ${agent}`).join('\n');
  return `
## Mandatory Agents (MUST invoke before wu:done)

Based on code_paths, the following agents MUST be invoked:

${agentList}

Run: pnpm orchestrate:suggest --wu ${id}
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
export function generateTokenBudgetAwareness(id) {
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
export function generateCompletionFormat(_id) {
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
 * Generate agent coordination section (WU-1987)
 *
 * Provides guidance on mem:signal for parallel agent coordination,
 * orchestrate:status for dashboard checks, and abandoned WU handling.
 *
 * @param {string} id - WU ID
 * @returns {string} Agent coordination section
 */
export function generateAgentCoordinationSection(id) {
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

### Progress Signals (Optional)

For long-running work, send progress signals at milestones:

\`\`\`bash
pnpm mem:signal "50% complete: tests passing, implementing adapter" --wu ${id}
pnpm mem:signal "Blocked: waiting for WU-XXX dependency" --wu ${id}
\`\`\`

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
export function generateWorktreePathGuidance(worktreePath) {
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
touch "$WORKTREE_ROOT/.lumenflow/agent-runs/beacon-guardian.stamp"

# WRONG: Hardcoded path to main
# touch /path/to/main/.lumenflow/agent-runs/beacon-guardian.stamp
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
function generateBugDiscoverySection(id) {
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

See: docs/04-operations/_frameworks/lumenflow/agent/onboarding/agent-invocation-guide.md §Bug Discovery`;
}

/**
 * Generate lane-specific guidance
 *
 * @param {string} lane - Lane name
 * @returns {string} Lane-specific guidance or empty string
 */
function generateLaneGuidance(lane) {
  if (!lane) return '';

  const laneParent = lane.split(':')[0].trim();

  const guidance = {
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
export function generateActionSection(doc, id) {
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
- Event tracking in .lumenflow/state/wu-events.jsonl
- Lane lock acquisition (WIP=1 enforcement)
- Session tracking for context recovery`;
}

/**
 * Generate the Completion Workflow section for sub-agents (WU-2682).
 *
 * Explicitly instructs sub-agents to run wu:done autonomously after gates pass.
 * This prevents agents from asking permission instead of completing.
 *
 * @param {string} id - WU ID
 * @returns {string} Completion Workflow section
 */
export function generateCompletionWorkflowSection(id: string): string {
  return `## Completion Workflow

**CRITICAL: Complete autonomously. Do NOT ask for permission.**

After all acceptance criteria are satisfied:

1. Run gates in the worktree: \`pnpm gates\`
2. If gates pass, cd back to main checkout
3. Run: \`pnpm wu:done --id ${id}\`

\`\`\`bash
# From worktree, after gates pass:
cd /path/to/main  # NOT the worktree
pnpm wu:done --id ${id}
\`\`\`

**wu:done** handles: merge to main, stamp creation, worktree cleanup.

**Do not ask** "should I run wu:done?" — just run it when gates pass.`;
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
  config?: ReturnType<typeof getConfig>;
}

function generateClientBlocksSection(clientContext) {
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
export function generateTaskInvocation(doc, id, strategy, options: SpawnOptions = {}) {
  const codePaths = doc.code_paths || [];
  const mandatoryAgents = detectMandatoryAgents(codePaths);

  const preamble = generatePreamble(id, strategy);
  // WU-1142: Use type-aware test guidance instead of hardcoded TDD directive
  const testGuidance = generateTestGuidance(doc.type);
  const clientContext = options.client;
  const config = options.config || getConfig();
  // WU-1142: Pass lane to get byLane skills
  const clientSkillsGuidance = generateClientSkillsGuidance(clientContext, doc.lane);
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

  // Generate thinking mode sections if applicable
  const executionModeSection = generateExecutionModeSection(options);
  const thinkToolGuidance = generateThinkToolGuidance(options);

  // Build optional sections string
  const thinkingSections = [executionModeSection, thinkToolGuidance]
    .filter((section) => section.length > 0)
    .join('\n\n---\n\n');

  const thinkingBlock = thinkingSections ? `${thinkingSections}\n\n---\n\n` : '';

  // Build the task prompt
  // WU-1131: Warning banner at start, end sentinel after constraints
  // WU-1142: Type-aware test guidance (TDD for code, format-only for docs, etc.)
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
---

## Mandatory Standards

- **LumenFlow**: Follow trunk-based flow, WIP=1, worktree discipline
- **TDD**: Failing test first, then implementation, then passing test. 90%+ coverage on new application code
- **Hexagonal Architecture**: Ports-first design. No application -> infrastructure imports
- **SOLID/DRY/YAGNI/KISS**: No over-engineering, no premature abstraction
- **Library-First**: Search context7 before writing custom code. No reinventing wheels
- **Code Quality**: No string literals, no magic numbers, no brittle regexes when libraries exist
- **Worktree Discipline**: ALWAYS use \`pnpm wu:claim\` to create worktrees (never \`git worktree add\` directly). Work ONLY in the worktree, never edit main
- **Documentation**: Update tooling docs if changing tools. Keep docs in sync with code
- **Sub-agents**: Use Explore agent for codebase investigation. Activate mandatory agents (security-auditor for PHI/auth, beacon-guardian for LLM/prompts)

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

${constraints}

${SPAWN_END_SENTINEL}`;

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

export function generateCodexPrompt(doc, id, strategy, options: SpawnOptions = {}) {
  const codePaths = doc.code_paths || [];
  const mandatoryAgents = detectMandatoryAgents(codePaths);

  const preamble = generatePreamble(id, strategy);
  // WU-1142: Use type-aware test guidance instead of hardcoded TDD directive
  const testGuidance = generateTestGuidance(doc.type);
  const mandatorySection = generateMandatoryAgentSection(mandatoryAgents, id);
  const laneGuidance = generateLaneGuidance(doc.lane);
  const bugDiscoverySection = generateBugDiscoverySection(id);
  const implementationContext = generateImplementationContext(doc);
  const action = generateActionSection(doc, id);
  const constraints = generateCodexConstraints(id);
  const clientContext = options.client;
  const config = options.config || getConfig();
  // WU-1142: Pass lane to get byLane skills
  const clientSkillsGuidance = generateClientSkillsGuidance(clientContext, doc.lane);
  const skillsSection =
    generateSkillsSelectionSection(doc, config, clientContext?.name) +
    (clientSkillsGuidance ? `\n${clientSkillsGuidance}` : '');
  const clientBlocks = generateClientBlocksSection(clientContext);

  const executionModeSection = generateExecutionModeSection(options);
  const thinkToolGuidance = generateThinkToolGuidance(options);
  const thinkingSections = [executionModeSection, thinkToolGuidance]
    .filter((section) => section.length > 0)
    .join('\n\n---\n\n');
  const thinkingBlock = thinkingSections ? `${thinkingSections}\n\n---\n\n` : '';

  // WU-1131: Warning banner at start, end sentinel after constraints
  // WU-1142: Type-aware test guidance
  return `${TRUNCATION_WARNING_BANNER}# ${id}: ${doc.title || 'Untitled'}

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

${skillsSection}

---

## Action

${action}

---

## Verification

- Run in worktree: \`pnpm gates\`
- From shared checkout: \`node tools/lib/agent-verification.mjs ${id}\`

---

${mandatorySection}${implementationContext ? `${implementationContext}\n\n---\n\n` : ''}${clientBlocks ? `${clientBlocks}\n\n---\n\n` : ''}${thinkingBlock}${bugDiscoverySection}

---

${laneGuidance}${laneGuidance ? '\n\n---\n\n' : ''}${constraints}

${SPAWN_END_SENTINEL}
`;
}

/**
 * WU-1603: Check if a lane is currently occupied by another WU
 *
 * @param {string} lane - Lane name (e.g., "Operations: Tooling")
 * @returns {import('@lumenflow/core/dist/lane-lock.js').LockMetadata|null} Lock metadata if occupied, null otherwise
 */
export function checkLaneOccupation(lane) {
  const lockStatus = checkLaneLock(lane);
  if (lockStatus.locked && lockStatus.metadata) {
    return lockStatus.metadata;
  }
  return null;
}

/**
 * WU-1603: Generate a warning message when lane is occupied
 *
 * @param {import('@lumenflow/core/dist/lane-lock.js').LockMetadata} lockMetadata - Lock metadata
 * @param {string} targetWuId - WU ID being spawned
 * @param {Object} [options={}] - Options
 * @param {boolean} [options.isStale] - Whether the lock is stale (>24h old)
 * @returns {string} Warning message
 */
interface LaneOccupationOptions {
  isStale?: boolean;
}

export function generateLaneOccupationWarning(
  lockMetadata: { lane: string; wuId: string },
  targetWuId: string,
  options: LaneOccupationOptions = {},
) {
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
      WU_OPTIONS.parentWu, // WU-1945: Parent WU for spawn registry tracking
      WU_OPTIONS.client,
      WU_OPTIONS.vendor,
    ],
    required: ['id'],
    allowPositionalId: true,
  });

  // Validate thinking mode options
  try {
    validateSpawnArgs(args);
  } catch (e) {
    die(e.message);
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
    text = readFileSync(WU_PATH, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  } catch (e) {
    die(
      `Failed to read WU file: ${WU_PATH}\n\n` +
        `Error: ${e.message}\n\n` +
        `Options:\n` +
        `  1. Check file permissions: ls -la ${WU_PATH}\n` +
        `  2. Ensure the file exists and is readable`,
    );
  }
  try {
    doc = parseYAML(text);
  } catch (e) {
    die(
      `Failed to parse WU YAML ${WU_PATH}\n\n` +
        `Error: ${e.message}\n\n` +
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
      const { isLockStale } = await import('@lumenflow/core/dist/lane-lock.js');
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
    const prompt = generateCodexPrompt(doc, id, strategy, {
      ...thinkingOptions,
      client: clientContext,
      config,
    });
    console.log(`${LOG_PREFIX} Generated Codex/GPT prompt for ${id}`);
    console.log(`${LOG_PREFIX} Copy the Markdown below:\n`);
    console.log(prompt.trimEnd());
    return;
  }

  // Generate and output the Task invocation
  const invocation = generateTaskInvocation(doc, id, strategy, {
    ...thinkingOptions,
    client: clientContext,
    config,
  });

  console.log(`${LOG_PREFIX} Generated Task tool invocation for ${id}`);
  console.log(`${LOG_PREFIX} Copy the block below to spawn a sub-agent:\n`);
  console.log(invocation);

  // WU-1945: Record spawn event to registry (non-blocking)
  // Only record if --parent-wu is provided (orchestrator context)
  if (args.parentWu) {
    const registryResult = await recordSpawnToRegistry({
      parentWuId: args.parentWu,
      targetWuId: id,
      lane: doc.lane || 'Unknown',
      baseDir: '.lumenflow/state',
    });

    const registryMessage = formatSpawnRecordedMessage(
      registryResult.spawnId,
      registryResult.error,
    );
    console.log(`\n${registryMessage}`);
  }
}

// Guard main() for testability (WU-1366)
// WU-1071: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  runCLI(main);
}

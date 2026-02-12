#!/usr/bin/env node

/**
 * WU Prompt Helper
 *
 * Generates ready-to-use handoff prompts for sub-agent WU execution.
 * Includes context loading preamble, skills selection guidance, and constraints block.
 *
 * Usage:
 *   pnpm wu:brief --id WU-123
 *   pnpm wu:brief --id WU-123 --codex
 *   pnpm wu:delegate --id WU-123 --parent-wu WU-100
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
 *   at generation time), wu:brief instructs the sub-agent to read the skill catalogue
 *   and select skills at execution time based on WU context.
 *
 * Codex Mode:
 *   When --codex is used, outputs a Codex/GPT-friendly Markdown prompt (no antml/XML escaping).
 *
 * @see {@link https://lumenflow.dev/reference/agent-invocation-guide/} - Context loading templates
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { parseYAML } from '@lumenflow/core/wu-yaml';
import { die } from '@lumenflow/core/error-handler';
import { WU_STATUS, PATTERNS, FILE_SYSTEM, EMOJI } from '@lumenflow/core/wu-constants';
// WU-1603: Check lane lock status before spawning
// WU-1325: Import lock policy getter for lane availability check
import { checkLaneLock } from '@lumenflow/core/lane-lock';
import { getLockPolicyForLane, getWipLimitForLane } from '@lumenflow/core/lane-checker';
import { minimatch } from 'minimatch';
// WU-2252: Import invariants loader for spawn output injection
import { loadInvariants, INVARIANT_TYPES } from '@lumenflow/core/invariants-runner';
import {
  validateSpawnArgs,
  generateExecutionModeSection,
  generateThinkToolGuidance,
  recordSpawnToRegistry,
  formatSpawnRecordedMessage,
} from '@lumenflow/core/wu-spawn-helpers';

import { SpawnStrategyFactory } from '@lumenflow/core/spawn-strategy';
import type { SpawnStrategy } from '@lumenflow/core/spawn-strategy';
import { getConfig } from '@lumenflow/core/config';
import type { ClientConfig } from '@lumenflow/core/config-schema';
import {
  generateClientSkillsGuidance,
  generateSkillsSelectionSection,
  resolveClientConfig,
} from '@lumenflow/core/wu-spawn-skills';
// WU-1253: Template loader for extracted prompt templates
import { loadTemplatesWithOverrides, replaceTokens } from '@lumenflow/core/template-loader';
import type { TemplateContext } from '@lumenflow/core/template-loader';

import {
  validateSpawnDependencies,
  formatDependencyError,
} from '@lumenflow/core/dependency-validator';

// WU-1192: Import prompt generation from Core (single source of truth)
// WU-1203: Import generateAgentCoordinationSection from core for config-driven progress signals
// WU-1288: Import policy-based test guidance and mandatory standards generators
import {
  TRUNCATION_WARNING_BANNER,
  SPAWN_END_SENTINEL,
  generateTestGuidance,
  generateAgentCoordinationSection,
  generatePolicyBasedTestGuidance,
  generateMandatoryStandards,
  generateEnforcementSummary,
} from '@lumenflow/core/wu-spawn';

// WU-1288: Import resolvePolicy for methodology policy resolution
import { resolvePolicy } from '@lumenflow/core/resolve-policy';

// WU-1240: Import memory context integration for spawn prompts
import {
  generateMemoryContextSection,
  checkMemoryLayerInitialized,
  getMemoryContextMaxSize,
} from '@lumenflow/core/wu-spawn-context';

// Re-export for backwards compatibility
export {
  TRUNCATION_WARNING_BANNER,
  SPAWN_END_SENTINEL,
  generateTestGuidance,
  generateAgentCoordinationSection,
};

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

const BRIEF_LOG_PREFIX = '[wu:brief]';
const DELEGATE_LOG_PREFIX = '[wu:delegate]';

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
 * @param {string[]|undefined} specRefs - Spec references array
 * @returns {string} Formatted references or empty string if none
 */
function formatSpecRefs(specRefs: string[] | undefined): string {
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
interface WUDocument {
  title?: string;
  lane?: string;
  type?: string;
  status?: string;
  code_paths?: string[];
  acceptance?: string[];
  description?: string;
  worktree_path?: string;
  spec_refs?: string[];
  notes?: string;
  risks?: string[];
  tests?: { manual?: string[] };
  claimed_at?: string;
}

function generateImplementationContext(doc: WUDocument): string {
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

interface Invariant {
  id: string;
  type: string;
  description: string;
  message?: string;
  path?: string;
  paths?: string[];
  from?: string;
  cannot_import?: string[];
  pattern?: string;
  scope?: string[];
}

/**
 * Check if a code path matches an invariant based on type
 *
 * @param {object} invariant - Invariant definition
 * @param {string[]} codePaths - Array of code paths
 * @returns {boolean} True if code paths match the invariant
 */
function codePathMatchesInvariant(invariant: Invariant, codePaths: string[]): boolean {
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
function formatInvariantForOutput(inv: Invariant): string[] {
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
function generateInvariantsPriorArtSection(codePaths: string[] | undefined): string {
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

// WU-1192: generateTestGuidance and related constants moved to @lumenflow/core
// See imports from '@lumenflow/core/wu-spawn' above

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
   - Run: node packages/@lumenflow/agent/dist/agent-verification.js ${id} (from shared checkout)
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

function generateCodexConstraints(id: string): string {
  return `## Constraints (Critical)

1. **TDD checkpoint**: tests BEFORE implementation; never skip RED
2. **Stop on errors**: if any command fails, report BLOCKED (never DONE) with the error
3. **Verify before success**: run \`pnpm gates\` in the worktree, then run \`node packages/@lumenflow/agent/dist/agent-verification.js ${id}\` (from the shared checkout)
4. **No fabrication**: if blockers remain or verification fails, report INCOMPLETE
5. **Git workflow**: avoid merge commits; let \`pnpm wu:done\` handle completion
6. **Scope discipline**: stay within \`code_paths\`; capture out-of-scope issues via \`pnpm mem:create\`
7. **Skip-gates for pre-existing**: if gates fail due to pre-existing issue on main, use \`--skip-gates --reason "pre-existing" --fix-wu WU-XXX\``;
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
export function generateEffortScalingRules(): string {
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
export function generateParallelToolCallGuidance(): string {
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
export function generateIterativeSearchHeuristics(): string {
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

// WU-1203: generateAgentCoordinationSection is now imported from @lumenflow/core
// The core version reads config and generates dynamic guidance based on progress_signals settings

/**
 * Generate quick fix commands section (WU-1987)
 *
 * Provides format/lint/typecheck commands for quick fixes before gates.
 *
 * @returns {string} Quick fix commands section
 */
export function generateQuickFixCommands(): string {
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
 * Generate Worktree Block Recovery section (WU-1134)
 *
 * Provides guidance for agents when they're blocked by the worktree hook.
 * This happens when agents try to commit from main instead of the worktree.
 *
 * @param {string} worktreePath - Worktree path from WU YAML
 * @returns {string} Worktree block recovery section
 */
export function generateWorktreeBlockRecoverySection(worktreePath: string): string {
  return `## When Blocked by Worktree Hook

If you encounter a "worktree required" or "commit blocked" error:

1. **Check existing worktrees**: \`git worktree list\`
2. **Navigate to the worktree**: \`cd ${worktreePath || 'worktrees/<lane>-wu-xxx'}\`
3. **Retry your operation** from within the worktree
4. **Use relative paths only** (never absolute paths starting with /)

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
 * Generate Lane Selection section (WU-2107)
 *
 * Provides guidance on lane selection when creating new WUs.
 * Points agents to wu:infer-lane for automated lane suggestions.
 *
 * @returns {string} Lane Selection section
 */
export function generateLaneSelectionSection(): string {
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
export function generateActionSection(doc: WUDocument, id: string): string {
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
  /** WU-1240: Base directory for memory context loading */
  baseDir?: string;
  /** WU-1240: Include memory context section */
  includeMemoryContext?: boolean;
  /** WU-1240: Skip memory context */
  noContext?: boolean;
  /** WU-1240: Memory context content (pre-generated) */
  memoryContextContent?: string;
}

/**
 * WU-1253: Try to load templates for spawn prompt sections.
 *
 * Implements shadow mode: tries templates first, returns empty map
 * if templates aren't available (caller uses hardcoded fallback).
 *
 * @param clientName - Client name for overrides (e.g., 'claude-code', 'cursor')
 * @param context - Token values for replacement
 * @returns Map of template id to processed content, empty if templates unavailable
 */
function tryLoadTemplates(clientName: string, context: TemplateContext): Map<string, string> {
  const result = new Map<string, string>();
  try {
    const baseDir = process.cwd();
    const templates = loadTemplatesWithOverrides(baseDir, clientName);

    // Process each template: replace tokens
    for (const [id, template] of templates) {
      const processed = replaceTokens(template.content, context);
      result.set(id, processed);
    }
  } catch {
    // Template loading failed - return empty map for hardcoded fallback
  }
  return result;
}

/**
 * WU-1253: Build template context from WU document.
 *
 * @param doc - WU YAML document
 * @param id - WU ID
 * @returns Context for template token replacement
 */
function buildSpawnTemplateContext(doc: WUDocument, id: string): TemplateContext {
  const lane = doc.lane || '';
  const laneParent = lane.split(':')[0]?.trim() || '';
  const type = (doc.type || 'feature').toLowerCase();

  return {
    WU_ID: id,
    LANE: lane,
    TYPE: type,
    TITLE: doc.title || '',
    DESCRIPTION: doc.description || '',
    WORKTREE_PATH: doc.worktree_path || '',
    laneParent,
    // Lowercase aliases for condition evaluation
    type,
    lane,
    worktreePath: doc.worktree_path || '',
  };
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
  doc: WUDocument,
  id: string,
  strategy: SpawnStrategy,
  options: SpawnOptions = {},
): string {
  const codePaths = doc.code_paths || [];
  const mandatoryAgents = detectMandatoryAgents(codePaths);

  // WU-1253: Try loading templates (shadow mode - falls back to hardcoded if unavailable)
  const clientName = options.client?.name || 'claude-code';
  const templateContext = buildSpawnTemplateContext(doc, id);
  const templates = tryLoadTemplates(clientName, templateContext);

  const preamble = generatePreamble(id, strategy);
  const clientContext = options.client;
  const config = options.config || getConfig();

  // WU-1288: Resolve methodology policy from config
  const policy = resolvePolicy(config);

  // WU-1142: Use type-aware test guidance instead of hardcoded TDD directive
  // WU-1288: Use policy-based test guidance that respects methodology.testing config
  // WU-1253: Try template first, fall back to policy-based guidance
  const testGuidance =
    templates.get('tdd-directive') || generatePolicyBasedTestGuidance(doc.type, policy);

  // WU-1288: Generate enforcement summary from resolved policy
  const enforcementSummary = generateEnforcementSummary(policy);

  // WU-1288: Generate mandatory standards based on resolved policy
  const mandatoryStandards = generateMandatoryStandards(policy);
  // WU-1142: Pass lane to get byLane skills
  const clientSkillsGuidance = generateClientSkillsGuidance(clientContext, doc.lane);
  // WU-1253: Try template for skills-selection, build skills section
  const skillsTemplateContent = templates.get('skills-selection');
  const skillsGuidanceSuffix = clientSkillsGuidance ? '\n' + clientSkillsGuidance : '';
  const skillsBaseContent =
    skillsTemplateContent || generateSkillsSelectionSection(doc, config, clientContext?.name);
  const skillsSection = skillsBaseContent + skillsGuidanceSuffix;
  const clientBlocks = generateClientBlocksSection(clientContext);
  const mandatorySection = generateMandatoryAgentSection(mandatoryAgents, id);
  const laneGuidance = generateLaneGuidance(doc.lane);
  // WU-1253: Try template for bug-discovery
  const bugDiscoverySection = templates.get('bug-discovery') || generateBugDiscoverySection(id);
  // WU-1253: Try template for constraints
  const constraints = templates.get('constraints') || generateConstraints(id);
  const implementationContext = generateImplementationContext(doc);

  // WU-2252: Generate invariants/prior-art section for code_paths
  const invariantsPriorArt = generateInvariantsPriorArtSection(codePaths);

  // WU-1986: Anthropic multi-agent best practices sections
  // WU-1253: Try templates for these sections
  const effortScaling = templates.get('effort-scaling') || generateEffortScalingRules();
  const parallelToolCalls =
    templates.get('parallel-tool-calls') || generateParallelToolCallGuidance();
  const searchHeuristics =
    templates.get('search-heuristics') || generateIterativeSearchHeuristics();
  const tokenBudget = templates.get('token-budget') || generateTokenBudgetAwareness(id);
  const completionFormat = generateCompletionFormat(id);

  // WU-1987: Agent coordination and quick fix sections
  const agentCoordination = generateAgentCoordinationSection(id);
  // WU-1253: Try template for quick-fix-commands
  const quickFix = templates.get('quick-fix-commands') || generateQuickFixCommands();

  // WU-2107: Lane selection guidance
  // WU-1253: Try template for lane-selection
  const laneSelection = templates.get('lane-selection') || generateLaneSelectionSection();

  // WU-2362: Worktree path guidance for sub-agents
  const worktreeGuidance = generateWorktreePathGuidance(doc.worktree_path);

  // WU-1134: Worktree block recovery guidance
  // WU-1253: Try template for worktree-recovery
  const worktreeBlockRecovery =
    templates.get('worktree-recovery') || generateWorktreeBlockRecoverySection(doc.worktree_path);

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

---

${worktreeBlockRecovery}

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

export function generateCodexPrompt(
  doc: WUDocument,
  id: string,
  strategy: SpawnStrategy,
  options: SpawnOptions = {},
): string {
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

  // WU-1134: Worktree block recovery guidance
  const worktreeBlockRecovery = generateWorktreeBlockRecoverySection(doc.worktree_path);

  // WU-1240: Memory context section
  const shouldIncludeMemoryContext = options.includeMemoryContext && !options.noContext;
  const memoryContextSection = shouldIncludeMemoryContext ? options.memoryContextContent || '' : '';

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
${memoryContextSection ? `---\n\n${memoryContextSection}\n\n` : ''}---

## Action

${action}

---

## Verification

- Run in worktree: \`pnpm gates\`
- From shared checkout: \`node packages/@lumenflow/agent/dist/agent-verification.js ${id}\`

---

${mandatorySection}${implementationContext ? `${implementationContext}\n\n---\n\n` : ''}${clientBlocks ? `${clientBlocks}\n\n---\n\n` : ''}${thinkingBlock}${bugDiscoverySection}

---

${laneGuidance}${laneGuidance ? '\n\n---\n\n' : ''}${worktreeBlockRecovery}

---

${constraints}

${SPAWN_END_SENTINEL}
`;
}

/**
 * WU-1603: Check if a lane is currently occupied by another WU
 * WU-1325: Now considers lock_policy - lanes with policy=none are never occupied
 *
 * @param {string} lane - Lane name (e.g., "Operations: Tooling")
 * @returns {import('@lumenflow/core/lane-lock').LockMetadata|null} Lock metadata if occupied, null otherwise
 */
export function checkLaneOccupation(
  lane: string,
): ReturnType<typeof checkLaneLock>['metadata'] | null {
  // WU-1325: Lanes with lock_policy=none never report as occupied
  const lockPolicy = getLockPolicyForLane(lane);
  if (lockPolicy === 'none') {
    return null;
  }

  const lockStatus = checkLaneLock(lane);
  if (lockStatus.locked && lockStatus.metadata) {
    return lockStatus.metadata;
  }
  return null;
}

/**
 * WU-1603: Generate a warning message when lane is occupied
 *
 * @param {import('@lumenflow/core/lane-lock').LockMetadata} lockMetadata - Lock metadata
 * @param {string} targetWuId - WU ID being spawned
 * @param {Object} [options={}] - Options
 * @param {boolean} [options.isStale] - Whether the lock is stale (>24h old)
 * @param {number} [options.wipLimit] - WU-1346: Injected WIP limit (for testing)
 * @param {'all' | 'active' | 'none'} [options.lockPolicy] - WU-1346: Injected lock policy (for testing)
 * @returns {string} Warning message
 */
interface LaneOccupationOptions {
  isStale?: boolean;
  /** WU-1346: Injected WIP limit for testing (bypasses config lookup) */
  wipLimit?: number;
  /** WU-1346: Injected lock policy for testing (bypasses config lookup) */
  lockPolicy?: 'all' | 'active' | 'none';
}

export function generateLaneOccupationWarning(
  lockMetadata: { lane: string; wuId: string },
  targetWuId: string,
  options: LaneOccupationOptions = {},
): string {
  const { isStale = false } = options;

  let warning = `⚠️  Lane "${lockMetadata.lane}" is occupied by ${lockMetadata.wuId}\n`;
  // WU-1346: Use injected values if provided, otherwise look up from config
  const lockPolicy = options.lockPolicy ?? getLockPolicyForLane(lockMetadata.lane);
  const wipLimit = options.wipLimit ?? getWipLimitForLane(lockMetadata.lane);

  warning += `   This violates WIP=${wipLimit} (lock_policy=${lockPolicy}).\n\n`;

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
 * Parse and validate CLI arguments
 */
interface ParsedArgs {
  id: string;
  thinking?: boolean;
  noThinking?: boolean;
  budget?: string;
  codex?: boolean;
  parentWu?: string;
  client?: string;
  vendor?: string;
  noContext?: boolean;
}

interface SpawnOutputWithRegistryOptions {
  id: string;
  output: string;
  isCodexClient: boolean;
  parentWu?: string;
  lane?: string;
  /** Record lineage intent in registry (wu:delegate explicit path only). */
  recordDelegationIntent?: boolean;
  /** WU-1608: Log prefix to use instead of module-level default */
  logPrefix?: string;
}

interface SpawnOutputWithRegistryDependencies {
  log?: (message: string) => void;
  recordSpawn?: typeof recordSpawnToRegistry;
  formatSpawnMessage?: typeof formatSpawnRecordedMessage;
}

/**
 * Emit prompt output and optionally persist parent/child lineage.
 *
 * WU-1604: Prompt generation (wu:brief) is side-effect free.
 * Only explicit delegation mode records lineage intent.
 */
export async function emitSpawnOutputWithRegistry(
  options: SpawnOutputWithRegistryOptions,
  dependencies: SpawnOutputWithRegistryDependencies = {},
): Promise<void> {
  const {
    id,
    output,
    isCodexClient,
    parentWu,
    lane,
    recordDelegationIntent = false,
    logPrefix: prefix = BRIEF_LOG_PREFIX,
  } = options;
  const log = dependencies.log ?? console.log;
  const recordSpawn = dependencies.recordSpawn ?? recordSpawnToRegistry;
  const formatSpawnMessage = dependencies.formatSpawnMessage ?? formatSpawnRecordedMessage;

  if (isCodexClient) {
    log(`${prefix} Generated Codex/GPT prompt for ${id}`);
    log(`${prefix} Copy the Markdown below:\n`);
    log(output.trimEnd());
  } else {
    log(`${prefix} Generated Task tool invocation for ${id}`);
    log(`${prefix} Copy the block below to spawn a sub-agent:\n`);
    log(output);
  }

  if (!recordDelegationIntent || !parentWu) {
    return;
  }

  const registryResult = await recordSpawn({
    parentWuId: parentWu,
    targetWuId: id,
    lane: lane || 'Unknown',
    baseDir: '.lumenflow/state',
  });

  const registryMessage = formatSpawnMessage(registryResult.spawnId, registryResult.error);
  log(`\n${registryMessage}`);
}

/**
 * Parser configuration for wu:brief / wu:delegate commands
 */
interface BriefParserConfig {
  /** CLI command name (e.g., 'wu-brief' or 'wu-delegate') */
  name: string;
  /** CLI description shown in --help */
  description: string;
}

const BRIEF_PARSER_CONFIG: BriefParserConfig = {
  name: 'wu-brief',
  description: 'Generate handoff prompt for sub-agent WU execution',
};

const DELEGATE_PARSER_CONFIG: BriefParserConfig = {
  name: 'wu-delegate',
  description: 'Generate delegation prompt and record explicit lineage intent',
};

function parseAndValidateArgs(parserConfig: BriefParserConfig = BRIEF_PARSER_CONFIG): ParsedArgs {
  const args = createWUParser({
    name: parserConfig.name,
    description: parserConfig.description,
    options: [
      WU_OPTIONS.id,
      WU_OPTIONS.thinking,
      WU_OPTIONS.noThinking,
      WU_OPTIONS.budget,
      WU_OPTIONS.codex,
      WU_OPTIONS.parentWu, // WU-1945: Parent WU for spawn registry tracking
      WU_OPTIONS.client,
      WU_OPTIONS.vendor,
      WU_OPTIONS.noContext, // WU-1240: Skip memory context injection
    ],
    required: ['id'],
    allowPositionalId: true,
  }) as ParsedArgs;

  // Validate thinking mode options
  try {
    validateSpawnArgs(args);
  } catch (e) {
    die((e as Error).message);
  }

  return args;
}

/**
 * Load and validate WU document from YAML file
 */
function loadWUDocument(id: string, wuPath: string): WUDocument {
  // Check if WU file exists
  if (!existsSync(wuPath)) {
    die(
      `WU file not found: ${wuPath}\n\n` +
        `Cannot spawn a sub-agent for a WU that doesn't exist.\n\n` +
        `Options:\n` +
        `  1. Create the WU first: pnpm wu:create --id ${id} --lane <lane> --title "..."\n` +
        `  2. Check if the WU ID is correct`,
    );
  }

  // Read WU file
  let text: string;
  try {
    text = readFileSync(wuPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  } catch (e) {
    die(
      `Failed to read WU file: ${wuPath}\n\n` +
        `Error: ${(e as Error).message}\n\n` +
        `Options:\n` +
        `  1. Check file permissions: ls -la ${wuPath}\n` +
        `  2. Ensure the file exists and is readable`,
    );
  }

  // Parse YAML
  try {
    return parseYAML(text) as WUDocument;
  } catch (e) {
    die(
      `Failed to parse WU YAML ${wuPath}\n\n` +
        `Error: ${(e as Error).message}\n\n` +
        `Options:\n` +
        `  1. Validate YAML syntax: pnpm wu:validate --id ${id}\n` +
        `  2. Fix YAML errors manually and retry`,
    );
  }
}

/**
 * Resolve the client name from args and config
 */
function resolveClientName(
  args: ParsedArgs,
  config: ReturnType<typeof getConfig>,
  logPrefix = BRIEF_LOG_PREFIX,
): string {
  let clientName = args.client;

  if (!clientName && args.vendor) {
    console.warn(`${logPrefix} ${EMOJI.WARNING} Warning: --vendor is deprecated. Use --client.`);
    clientName = args.vendor;
  }

  // Codex handling (deprecated legacy flag)
  if (args.codex && !clientName) {
    console.warn(
      `${logPrefix} ${EMOJI.WARNING} Warning: --codex is deprecated. Use --client codex-cli.`,
    );
    clientName = 'codex-cli';
  }

  return clientName || config.agents.defaultClient || 'claude-code';
}

/**
 * Check lane occupation and warn if occupied by a different WU
 */
async function checkAndWarnLaneOccupation(
  lane: string | undefined,
  id: string,
  logPrefix = BRIEF_LOG_PREFIX,
): Promise<void> {
  if (!lane) return;

  const existingLock = checkLaneOccupation(lane);
  if (existingLock && existingLock.wuId !== id) {
    // Lane is occupied by a different WU
    const { isLockStale } = await import('@lumenflow/core/lane-lock');
    const isStale = isLockStale(existingLock);
    const warning = generateLaneOccupationWarning(existingLock, id, { isStale });
    console.warn(`${logPrefix} ${EMOJI.WARNING}\n${warning}\n`);
  }
}

/**
 * Options for running prompt-generation logic.
 */
export interface RunBriefOptions {
  /** Parser config override (command name and description) */
  parserConfig?: BriefParserConfig;
  /** Log prefix override for output messages */
  logPrefix?: string;
  /** Execution mode for command entry points */
  mode?: 'brief' | 'delegate';
}

/**
 * Shared entry point for wu:brief and wu:delegate.
 */
export async function runBriefLogic(options: RunBriefOptions = {}): Promise<void> {
  const {
    mode = 'brief',
    parserConfig = mode === 'delegate' ? DELEGATE_PARSER_CONFIG : BRIEF_PARSER_CONFIG,
    logPrefix = BRIEF_LOG_PREFIX,
  } = options;

  const args = parseAndValidateArgs(parserConfig);
  const explicitDelegation = mode === 'delegate';
  const effectiveLogPrefix = explicitDelegation ? DELEGATE_LOG_PREFIX : logPrefix;

  // WU-2202: Validate dependencies BEFORE any other operation
  // This prevents false lane occupancy reports when yaml package is missing
  const commandLabel = explicitDelegation ? 'wu:delegate' : 'wu:brief';
  const depResult = await validateSpawnDependencies();
  if (!depResult.valid) {
    die(formatDependencyError(commandLabel, depResult.missing));
  }

  if (explicitDelegation && !args.parentWu) {
    die(
      'wu:delegate requires --parent-wu to record delegation lineage intent.\n\n' +
        'Example:\n' +
        '  pnpm wu:delegate --id WU-123 --parent-wu WU-100 --client claude-code',
    );
  }

  if (!explicitDelegation && args.parentWu) {
    console.warn(
      `${effectiveLogPrefix} ${EMOJI.WARNING} --parent-wu does not record lineage in generation-only mode.`,
    );
    console.warn(
      `${effectiveLogPrefix} ${EMOJI.WARNING} Use wu:delegate for explicit, side-effectful delegation intent tracking.`,
    );
    console.warn('');
  }

  const id = args.id.toUpperCase();
  if (!PATTERNS.WU_ID.test(id)) {
    die(`Invalid WU id '${args.id}'. Expected format WU-123`);
  }

  const wuPath = WU_PATHS.WU(id);
  const doc = loadWUDocument(id, wuPath);

  // Warn if WU is not in ready or in_progress status
  const validStatuses = [WU_STATUS.READY, WU_STATUS.IN_PROGRESS];
  if (!validStatuses.includes(doc.status)) {
    console.warn(
      `${effectiveLogPrefix} ${EMOJI.WARNING} Warning: ${id} has status '${doc.status}'.`,
    );
    console.warn(
      `${effectiveLogPrefix} ${EMOJI.WARNING} Sub-agents typically work on ready or in_progress WUs.`,
    );
    console.warn('');
  }

  // WU-1603: Check if lane is already occupied and warn
  await checkAndWarnLaneOccupation(doc.lane, id, effectiveLogPrefix);

  // Build thinking mode options for task invocation
  const thinkingOptions = {
    thinking: args.thinking,
    noThinking: args.noThinking,
    budget: args.budget,
  };

  // Client Resolution
  const config = getConfig();
  const clientName = resolveClientName(args, config, effectiveLogPrefix);

  // WU-1240: Generate memory context if not skipped
  const baseDir = process.cwd();
  let memoryContextContent = '';
  const shouldIncludeMemoryContext = !args.noContext;

  if (shouldIncludeMemoryContext) {
    const isMemoryInitialized = await checkMemoryLayerInitialized(baseDir);
    if (isMemoryInitialized) {
      const maxSize = getMemoryContextMaxSize(config);
      memoryContextContent = await generateMemoryContextSection(baseDir, {
        wuId: id,
        lane: doc.lane,
        maxSize,
      });
      if (memoryContextContent) {
        console.log(
          `${effectiveLogPrefix} Memory context loaded (${memoryContextContent.length} bytes)`,
        );
      }
    }
  }

  // Create strategy

  const strategy = SpawnStrategyFactory.create(clientName);
  const clientContext = { name: clientName, config: resolveClientConfig(config, clientName) };

  const isCodexClient = clientName === 'codex-cli' || args.codex;

  if (isCodexClient) {
    const prompt = generateCodexPrompt(doc, id, strategy, {
      ...thinkingOptions,
      client: clientContext,
      config,
    });
    await emitSpawnOutputWithRegistry({
      id,
      output: prompt,
      isCodexClient: true,
      parentWu: args.parentWu,
      lane: doc.lane,
      recordDelegationIntent: explicitDelegation,
      logPrefix: effectiveLogPrefix,
    });
    return;
  }

  // Generate and output the Task invocation
  const invocation = generateTaskInvocation(doc, id, strategy, {
    ...thinkingOptions,
    client: clientContext,
    config,
    // WU-1240: Include memory context in spawn prompt
    baseDir,
    includeMemoryContext: shouldIncludeMemoryContext && memoryContextContent.length > 0,
    memoryContextContent,
    noContext: args.noContext,
  });
  await emitSpawnOutputWithRegistry({
    id,
    output: invocation,
    isCodexClient: false,
    parentWu: args.parentWu,
    lane: doc.lane,
    recordDelegationIntent: explicitDelegation,
    logPrefix: effectiveLogPrefix,
  });
}

/**
 * Main entry point for removed wu:spawn command.
 *
 * WU-1617: command removed in favor of explicit wu:brief and wu:delegate.
 */
async function main(): Promise<void> {
  die(
    'wu:spawn has been removed. Use wu:brief for prompt generation or wu:delegate for explicit delegation lineage.',
  );
}

// Guard main() for testability (WU-1366)
// WU-1071: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}

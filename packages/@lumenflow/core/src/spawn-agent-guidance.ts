// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file spawn-agent-guidance.ts
 * WU-2012: Extracted from wu-spawn.ts
 *
 * Agent-facing operational guidance sections for spawn prompts:
 * - Effort scaling rules
 * - Parallel tool call guidance
 * - Iterative search heuristics
 * - Token budget awareness
 * - Completion report format
 * - Agent coordination (parallel work)
 * - Quick fix commands
 * - Lane selection guidance
 * - Worktree path guidance
 * - Bug discovery (mid-WU capture)
 * - Lane-specific guidance
 * - Action section (claim/continue)
 *
 * Single responsibility: Generate agent-operational guidance sections
 * that help sub-agents work effectively during WU execution.
 *
 * @module spawn-agent-guidance
 */

import { getConfig } from './lumenflow-config.js';
import { LUMENFLOW_PATHS } from './wu-constants.js';

/**
 * WU document interface (shared across spawn modules)
 */
export interface WUDoc {
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

/** Generate effort scaling rules section (WU-1986) */
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

/** Generate parallel tool call guidance (WU-1986) */
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

/** Generate iterative search heuristics (WU-1986) */
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

## Blockers (if UnsafeAny)
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

### \u26a0\ufe0f CRITICAL: Use mem:signal, NOT TaskOutput

**DO NOT** use TaskOutput to check agent progress - it returns full transcripts
and causes "prompt too long" errors. Always use the memory layer instead:

\`\`\`bash
# \u2705 CORRECT: Compact signals (~6 lines)
pnpm mem:inbox --since 30m

# \u274c WRONG: Full transcripts (context explosion)
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

/** Generate quick fix commands section (WU-1987) */
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

/** Generate Lane Selection section (WU-2107) */
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
export function generateBugDiscoverySection(id: string): string {
  return `## Bug Discovery (Mid-WU Issue Capture)

If you discover a bug or issue **outside the scope of this WU**:

1. **Capture it immediately** using:
   \`\`\`bash
   pnpm mem:create 'Bug: <description>' --type discovery --tags bug,scope-creep --wu ${id}
   \`\`\`

2. **Continue with your WU** \u2014 do not fix bugs outside your scope
3. **Reference in notes** \u2014 mention the mem node ID in your completion notes

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

See: https://lumenflow.dev/reference/agent-invocation-guide/ \u00a7Bug Discovery`;
}

/**
 * Generate lane-specific guidance
 *
 * @param {string} lane - Lane name
 * @returns {string} Lane-specific guidance or empty string
 */
export function generateLaneGuidance(lane: string | undefined): string {
  if (!lane) return '';

  const laneParent = (lane.split(':')[0] ?? '').trim();

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

// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file init-templates.ts
 * Template string constants for LumenFlow project scaffolding.
 *
 * Extracted from init.ts (WU-1643) to reduce file size and isolate static data.
 * These are pure data constants with no behavioral logic.
 */

import { DIRECTORIES, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';

const DEFAULT_WORKTREES_DIR = DIRECTORIES.WORKTREES;
const DEFAULT_WORKTREES_PATTERN = DEFAULT_WORKTREES_DIR.endsWith('/')
  ? DEFAULT_WORKTREES_DIR.slice(0, -1)
  : DEFAULT_WORKTREES_DIR;
const DEFAULT_STATE_DIR_IGNORE = LUMENFLOW_PATHS.STATE_DIR.endsWith('/')
  ? LUMENFLOW_PATHS.STATE_DIR
  : `${LUMENFLOW_PATHS.STATE_DIR}/`;

// WU-1576: Lane definitions must have zero overlapping code_paths.
// Each path must appear in exactly one lane to avoid doctor warnings.
export const DEFAULT_LANE_DEFINITIONS = [
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

// WU-1171: Template for AGENTS.md (universal entry point)
// WU-1300: Updated quick-ref link to correct path
// WU-1309: Use {{QUICK_REF_LINK}} and <project-root> placeholder for portability
export const AGENTS_MD_TEMPLATE = `# Universal Agent Instructions

**Last updated:** {{DATE}}

This project uses LumenFlow workflow. For complete documentation, see [LUMENFLOW.md](LUMENFLOW.md).

---

## Quick Start

\`\`\`bash
# First-time lane setup (once per project)
pnpm lane:setup
pnpm lane:validate
pnpm lane:lock
\`\`\`

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
export const LUMENFLOW_MD_TEMPLATE = `# LumenFlow Workflow Guide\n\n**Last updated:** {{DATE}}\n\nLumenFlow is a vendor-agnostic workflow framework for AI-native software development.\n\n---\n\n## Critical Rule: ALWAYS Run wu:done\n\n**After completing work on a WU, you MUST run \`pnpm wu:done --id WU-XXXX\` from the main checkout.**\n\nThis is the single most forgotten step. Do NOT:\n- Write "To Complete: pnpm wu:done" and stop\n- Ask if you should run wu:done\n- Forget to run wu:done\n\n**DO**: Run \`pnpm wu:done --id WU-XXXX\` immediately after gates pass.\n\n---\n\n## When to Use Initiatives\n\nUse **Initiatives** for multi-phase work spanning multiple WUs:\n\n- **Product visions**: "Build a task management app"\n- **Larger features**: Work requiring multiple WUs across lanes\n- **Complex projects**: Anything that needs phased delivery\n\n\`\`\`bash\n# Create an initiative for multi-phase work\npnpm initiative:create --id INIT-001 --title "Feature Name" \\\\\n  --description "..." --phase "Phase 1: MVP" --phase "Phase 2: Polish"\n\n# Add WUs to the initiative\npnpm initiative:add-wu --initiative INIT-001 --wu WU-XXX --phase 1\n\n# Track progress\npnpm initiative:status --id INIT-001\n\`\`\`\n\n**Skip initiatives** for: single-file bug fixes, small docs updates, isolated refactoring.\n\n---\n\n## Quick Start\n\n\`\`\`bash\n# 1. Configure lanes (once per project)\npnpm lane:setup\npnpm lane:validate\npnpm lane:lock\n\n# 2. Create a WU\npnpm wu:create --id WU-XXXX --lane <Lane> --title "Title"\n\n# 3. Edit WU spec with acceptance criteria, then claim:\npnpm wu:claim --id WU-XXXX --lane <Lane>\ncd worktrees/<lane>-wu-xxxx\n\n# 4. Implement in worktree\n\n# 5. Run gates\npnpm gates --docs-only  # for docs changes\npnpm gates              # for code changes\n\n# 6. Complete (from main checkout)\ncd <project-root>\npnpm wu:done --id WU-XXXX\n\`\`\`\n\n---\n\n## Core Principles\n\n1. **TDD**: Failing test -> implementation -> passing test (>=90% coverage on new code)\n2. **Library-First**: Search existing libraries before custom code\n3. **DRY/SOLID/KISS/YAGNI**: No magic numbers, no hardcoded strings\n4. **Worktree Discipline**: After \`wu:claim\`, work ONLY in the worktree\n5. **Gates Before Done**: All gates must pass before \`wu:done\`\n6. **Do Not Bypass Hooks**: No \`--no-verify\`, fix issues properly\n7. **Always wu:done**: Complete every WU by running \`pnpm wu:done\`\n\n---\n\n## Documentation Structure\n\n### Core (Vendor-Agnostic)\n\n- **LUMENFLOW.md** - This file, main entry point\n- **.lumenflow/constraints.md** - Non-negotiable workflow constraints\n- **.lumenflow/agents/** - Agent instructions (vendor-agnostic)\n- **workspace.yaml** - Kernel workspace configuration (software_delivery block)\n\n### Optional Overlays\n\n- **CLAUDE.md + .claude/agents/** - Claude Code overlay (auto if Claude Code detected)\n- **{{DOCS_TASKS_PATH}}** - Task boards and WU storage (\`lumenflow init --full\`)\n- **{{DOCS_ONBOARDING_PATH}}** - Agent onboarding docs\n- **.lumenflow.framework.yaml** - Framework hint file (created with \`--framework\`)\n\n---\n\n## Worktree Discipline (IMMUTABLE LAW)\n\nAfter claiming a WU, you MUST work in its worktree:\n\n\`\`\`bash\n# 1. Claim creates worktree\npnpm wu:claim --id WU-XXX --lane <lane>\n\n# 2. IMMEDIATELY cd to worktree\ncd worktrees/<lane>-wu-xxx\n\n# 3. ALL work happens here\n\n# 4. Return to main ONLY to complete\ncd <project-root>\npnpm wu:done --id WU-XXX\n\`\`\`\n\n---\n\n## Definition of Done\n\n- Acceptance criteria satisfied\n- Gates green (\`pnpm gates\` or \`pnpm gates --docs-only\`)\n- WU YAML status = \`done\`\n- \`wu:done\` has been run\n\n---\n\n## Commands Reference\n\n| Command           | Description                         |\n| ----------------- | ----------------------------------- |\n| \`pnpm lane:status\` | Show lane lifecycle status       |\n| \`pnpm lane:setup\`  | Create/update draft lane artifacts |\n| \`pnpm lane:lock\`   | Lock lane lifecycle for WU creation |\n| \`pnpm wu:create\` | Create new WU spec                  |\n| \`pnpm wu:claim\`  | Claim WU and create worktree        |\n| \`pnpm wu:done\`   | Complete WU (merge, stamp, cleanup) |\n| \`pnpm gates\`     | Run quality gates                   |\n| \`pnpm initiative:create\` | Create multi-phase initiative |\n| \`pnpm initiative:status\` | View initiative progress |\n\n---\n\n## Constraints\n\nSee [.lumenflow/constraints.md](.lumenflow/constraints.md) for the 6 non-negotiable rules.\n\n---\n\n## Agent Onboarding\n\n- Start with **CLAUDE.md** if present (Claude Code overlay).\n- Add vendor-agnostic guidance in **.lumenflow/agents/**.\n- Check the onboarding docs in **{{DOCS_ONBOARDING_PATH}}** for detailed guidance.\n`;

// Template for .lumenflow/constraints.md
export const CONSTRAINTS_MD_TEMPLATE = `# LumenFlow Constraints Capsule\n\n**Version:** 1.0\n**Last updated:** {{DATE}}\n\n## The 6 Non-Negotiable Constraints\n\n### 1. Worktree Discipline and Git Safety\nWork only in worktrees, treat main as read-only, never run destructive git commands on main.\n\n### 2. WUs Are Specs, Not Code\nRespect code_paths boundaries, no feature creep, no code blocks in WU YAML files.\n\n### 3. Docs-Only vs Code WUs\nDocumentation WUs use \`--docs-only\` gates, code WUs run full gates.\n\n### 4. LLM-First, Zero-Fallback Inference\nUse LLMs for semantic tasks, fall back to safe defaults (never regex/keywords).\n\n### 5. Gates and Skip-Gates\nComplete via \`pnpm wu:done\`; skip-gates only for pre-existing failures with \`--reason\` and \`--fix-wu\`.\n\n### 6. Safety and Governance\nRespect privacy rules, approved sources, security policies; when uncertain, choose safer path.\n\n---\n\n## Mini Audit Checklist\n\nBefore running \`wu:done\`, verify:\n\n- [ ] Working in worktree (not main)\n- [ ] Only modified files in \`code_paths\`\n- [ ] Gates pass\n- [ ] No forbidden git commands used\n- [ ] Acceptance criteria satisfied\n\n---\n\n## Escalation Triggers\n\nStop and ask a human when:\n- Same error repeats 3 times\n- Auth or permissions changes required\n- PII/safety issues discovered\n- Cloud spend or secrets involved\n`;

// Template for root CLAUDE.md
// WU-1309: Use <project-root> placeholder for portability
// WU-1382: Expanded with CLI commands table and warning about manual YAML editing
export const CLAUDE_MD_TEMPLATE = `# Claude Code Instructions

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
export const CLAUDE_SETTINGS_TEMPLATE = `{
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
export const CURSOR_RULES_TEMPLATE = `# Cursor LumenFlow Rules

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
export const WINDSURF_RULES_TEMPLATE = `# Windsurf LumenFlow Rules

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
export const CLINE_RULES_TEMPLATE = `# Cline LumenFlow Rules

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
export const AIDER_CONF_TEMPLATE = `# Aider Configuration for LumenFlow Projects\n# See LUMENFLOW.md for workflow documentation\n\nmodel: gpt-4-turbo\nauto-commits: false\ndirty-commits: false\n\nread:\n  - LUMENFLOW.md\n  - .lumenflow/constraints.md\n`;

// WU-1413: Template for .mcp.json (MCP server configuration for Claude Code)
export const MCP_JSON_TEMPLATE = `{
  "mcpServers": {
    "lumenflow": {
      "command": "npx",
      "args": ["@lumenflow/mcp"]
    }
  }
}
`;

// Template for docs/04-operations/tasks/backlog.md
export const BACKLOG_TEMPLATE = `---\nsections:\n  ready:\n    heading: '## 🚀 Ready (pull from here)'\n    insertion: after_heading_blank_line\n  in_progress:\n    heading: '## 🔧 In progress'\n    insertion: after_heading_blank_line\n  blocked:\n    heading: '## ⛔ Blocked'\n    insertion: after_heading_blank_line\n  done:\n    heading: '## ✅ Done'\n    insertion: after_heading_blank_line\n---\n\n# Backlog (single source of truth)\n\n## 🚀 Ready (pull from here)\n\n(No items ready)\n\n## 🔧 In progress\n\n(No items in progress)\n\n## ⛔ Blocked\n\n(No items blocked)\n\n## ✅ Done\n\n(No items completed yet)\n`;

// Template for docs/04-operations/tasks/status.md
export const STATUS_TEMPLATE = `# Status (active work)\n\n## In Progress\n\n(No items in progress)\n\n## Blocked\n\n(No items blocked)\n\n## Completed\n\n(No items completed yet)\n`;

// Template for docs tasks WU template YAML (scaffolded to {{DOCS_TASKS_PATH}}/templates/wu-template.yaml)
export const WU_TEMPLATE_YAML = `# Work Unit Template (LumenFlow WU Schema)\n#\n# Copy this template when creating new WUs. Fill in all required fields and\n# remove optional fields if not needed.\n#\n# If you used "lumenflow init --full", this template lives at:\n# {{DOCS_TASKS_PATH}}/templates/wu-template.yaml\n\n# Required: Unique work unit identifier (format: WU-NNN)\nid: WU-XXX\n\n# Required: Short, descriptive title (max 80 chars)\ntitle: 'Your WU title here'\n\n# Required: Lane (Parent: Sublane format)\nlane: '<Parent: Sublane>'\n\n# Required: Type of work\ntype: 'feature' # feature | bug | documentation | process | tooling | chore | refactor\n\n# Required: Current status\nstatus: 'ready' # ready | in_progress | blocked | done | cancelled\n\n# Required: Priority\npriority: P2 # P0 | P1 | P2 | P3\n\n# Required: Creation date (YYYY-MM-DD)\ncreated: {{DATE}}\n\n# Required: Owner/assignee (email)\nassigned_to: 'unassigned@example.com'\n\n# Required: Description\ndescription: |\n  Context: ...\n  Problem: ...\n  Solution: ...\n\n# Required: Acceptance criteria (testable, binary)\nacceptance:\n  - Criterion 1 (specific, measurable, testable)\n  - Criterion 2 (binary pass/fail)\n  - Documentation updated\n\n# Required: References to plans/specs (required for type: feature)\n# Tip: use pnpm wu:create --plan to generate a plan stub at lumenflow://plans/WU-XXX-plan.md\nspec_refs:\n  - lumenflow://plans/WU-XXX-plan.md\n\n# Required: Code files changed or created (empty only for docs/process WUs)\n# Docs-only WUs should use docs/ or *.md paths to avoid docs-only gate failures.\ncode_paths:\n  - path/to/file.ts\n\n# Required: Test paths (at least one of manual/unit/e2e/integration for non-doc WUs)\ntests:\n  manual:\n    - Manual check: Verify behavior or docs output\n  unit:\n    - path/to/test.test.ts\n  e2e: []\n  integration: []\n\n# Required: Exposure level\nexposure: 'backend-only' # ui | api | backend-only | documentation\n\n# Optional: User journey (recommended for ui/api)\n# user_journey: |\n#   User navigates to ...\n#   User performs ...\n\n# Optional: UI pairing WUs (for api exposure)\n# ui_pairing_wus:\n#   - WU-1234\n\n# Optional: Navigation path (required when exposure=ui and no page file)\n# navigation_path: '/settings'\n\n# Required: Deliverable artifacts (stamps, docs, etc.)\nartifacts:\n  - .lumenflow/stamps/WU-XXX.done\n\n# Optional: Dependencies (other WUs that must complete first)\ndependencies: []\n\n# Optional: Risks\nrisks:\n  - Risk 1\n\n# Optional: Notes (required by spec linter)\nnotes: 'Implementation notes, rollout context, or plan summary.'\n\n# Optional: Requires human review\nrequires_review: false\n\n# Optional: Claimed mode (worktree or branch-only)\n# Automatically set by wu:claim, usually don't need to specify\n# claimed_mode: worktree\n\n# Optional: Assigned to (email of current claimant)\n# Automatically set by wu:claim\n# assigned_to: engineer@example.com\n\n# Optional: Locked status (prevents concurrent edits)\n# Automatically set by wu:claim and wu:done\n# locked: false\n\n# Optional: Completion date (ISO 8601 format)\n# Automatically set by wu:done\n# completed: 2025-10-23\n\n# Optional: Completion notes (added by wu:done)\n# completion_notes: |\n#   Additional notes added during wu:done.\n#   Any deviations from original plan.\n#   Lessons learned.\n\n# ============================================================================\n# GOVERNANCE BLOCK (WU Schema v2.0)\n# ============================================================================\n# Optional: COS governance rules that apply to this WU\n# Only include if this WU needs specific governance enforcement\n\n# governance:\n#   # Rules that apply to this WU (evaluated during cos:gates)\n#   rules:\n#     - rule_id: UPAIN-01\n#       satisfied: false  # Initially false, set true when evidence provided\n#       evidence:\n#         - type: link\n#           value: docs/product/voc/feature-user-pain.md\n#           description: "Voice of Customer analysis showing user pain"\n#       notes: |\n#         VOC analysis shows 40% of support tickets request this feature.\n#         Average time wasted: 15min/user/week.\n#\n#     - rule_id: CASH-03\n#       satisfied: false\n#       evidence:\n#         - type: link\n#           value: docs/finance/spend-reviews/2025-10-cloud-infra.md\n#           description: "Spend review for £1200/month cloud infrastructure"\n#         - type: approval\n#           value: owner@example.com\n#           description: "Owner approval for spend commitment"\n#       notes: |\n#         New cloud infrastructure commitment: £1200/month for 12 months.\n#         ROI: Reduces latency by 50%, improves user retention.\n#\n#   # Gate checks (enforced by cos-gates.ts)\n#   gates:\n#     narrative: "pending"  # Status: pending, passed, skipped, failed\n#     finance: "pending"\n#\n#   # Exemptions (only if rule doesn't apply)\n#   exemptions:\n#     - rule_id: FAIR-01\n#       reason: "No user-facing pricing changes in this WU"\n#       approved_by: product-owner@example.com\n#       approved_at: 2025-10-23\n\n# ============================================================================\n# USAGE NOTES\n# ============================================================================\n#\n# 1. Remove this entire governance block if no COS rules apply to your WU\n# 2. Only include rules that require enforcement (not all rules apply to all WUs)\n# 3. Evidence types: link:, metric:, screenshot:, approval:\n# 4. Gates are checked during wu:done (before merge)\n# 5. Exemptions require approval from rule owner\n#\n# For more details, see:\n# - {{DOCS_OPERATIONS_PATH}}/_frameworks/cos/system-prompt-v1.3.md\n# - {{DOCS_OPERATIONS_PATH}}/_frameworks/cos/evidence-format.md\n`;

// Template for .lumenflow.framework.yaml
export const FRAMEWORK_HINT_TEMPLATE = `# LumenFlow Framework Hint\n# Generated by: lumenflow init --framework {{FRAMEWORK_NAME}}\n\nframework: "{{FRAMEWORK_NAME}}"\nslug: "{{FRAMEWORK_SLUG}}"\n`;

// Template for docs/04-operations/_frameworks/<framework>/README.md
export const FRAMEWORK_OVERLAY_TEMPLATE = `# {{FRAMEWORK_NAME}} Framework Overlay\n\n**Last updated:** {{DATE}}\n\nThis overlay captures framework-specific conventions, constraints, and references for {{FRAMEWORK_NAME}} projects.\n\n## Scope\n\n- Project structure conventions\n- Framework-specific testing guidance\n- Common pitfalls and mitigations\n\n## References\n\n- Add official docs links here\n`;

// WU-1083: Agent onboarding docs templates
// WU-1309: Updated quick-ref with --docs-structure and complete wu:create example
export const QUICK_REF_COMMANDS_TEMPLATE = `# Quick Reference: LumenFlow Commands

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

export const FIRST_WU_MISTAKES_TEMPLATE = `# First WU Mistakes

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

Before starting UnsafeAny WU:

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

export const TROUBLESHOOTING_WU_DONE_TEMPLATE = `# Troubleshooting: wu:done Not Run

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

If UnsafeAny answer is "no", you're not done yet.
`;

export const AGENT_SAFETY_CARD_TEMPLATE = `# Agent Safety Card

**Last updated:** {{DATE}}

Quick reference for AI agents working in LumenFlow projects.

---

## Stop and Ask When

- Same error repeats 3 times
- Auth or permissions changes needed
- PII/secrets involved
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
export const LANE_INFERENCE_TEMPLATE = `# ============================================================================
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
export const STARTING_PROMPT_TEMPLATE = `# Starting Prompt for LumenFlow Agents

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

Before starting UnsafeAny work, read these documents in order:

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

export const WU_CREATE_CHECKLIST_TEMPLATE = `# WU Creation Checklist

**Last updated:** {{DATE}}

Before running \`pnpm wu:create\`, verify these items.

---

## Step 1: Check Valid Lanes

\`\`\`bash
grep -A 30 "lanes:" workspace.yaml
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
export const FIRST_15_MINS_TEMPLATE = `# First 15 Minutes with LumenFlow

**Last updated:** {{DATE}}

A quick-start guide for your first session with LumenFlow.

---

## Minute 0-2: Verify Setup

\`\`\`bash
# Check LumenFlow is configured
ls LUMENFLOW.md AGENTS.md workspace.yaml

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
export const LOCAL_ONLY_TEMPLATE = `# Local-Only Development

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

Add this to \`workspace.yaml\`:

\`\`\`yaml
software_delivery:
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
pnpm config:set --key git.requireRemote --value false
\`\`\`
`;

// WU-1309: Lane Inference template
export const LANE_INFERENCE_DOC_TEMPLATE = `# Lane Inference

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

## Lane Lifecycle Setup

Before creating delivery WUs, complete lane lifecycle:

\`\`\`bash
pnpm lane:setup
pnpm lane:validate
pnpm lane:lock
\`\`\`

Use \`pnpm lane:status\` to inspect current state.

---

## Common Issues

### "Lane format invalid"

**Cause:** Missing colon or space.

**Fix:** Use \`"Parent: Sublane"\` format (colon + space).

### "Sub-lane validation failed"

**Cause:** Lane lifecycle is not locked or taxonomy is missing.

**Fix:** Run lane lifecycle setup:

\`\`\`bash
pnpm lane:setup
pnpm lane:validate
pnpm lane:lock
\`\`\`

---

## Lane Health

Check lane configuration for issues:

\`\`\`bash
pnpm lane:health
\`\`\`

This detects:
- Overlapping code paths between lanes
- Code files not covered by UnsafeAny lane
`;

// WU-1385: WU sizing guide template for agent onboarding
export const WU_SIZING_GUIDE_TEMPLATE = `# Work Unit Sizing & Strategy Guide

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
3. Generate fresh agent prompt: \`pnpm wu:brief --id WU-XXX --client claude-code\`
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
export const WU_LIFECYCLE_SKILL_TEMPLATE = `---
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

export const WORKTREE_DISCIPLINE_SKILL_TEMPLATE = `---
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

export const LUMENFLOW_GATES_SKILL_TEMPLATE = `---
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
 * WU-1969: Shared exclusion list used by both the full GITIGNORE_TEMPLATE
 * (fresh init) and the merge path (existing .gitignore).
 *
 * Defined once so the two paths cannot drift.
 * Each entry has a `pattern` (substring to search for in existing content)
 * and a `line` (exact line to append when missing).
 */
export const REQUIRED_GITIGNORE_EXCLUSIONS: ReadonlyArray<{
  pattern: string;
  line: string;
}> = [
  { pattern: 'node_modules', line: 'node_modules/' },
  { pattern: '.lumenflow/telemetry', line: '.lumenflow/telemetry/' },
  { pattern: '.lumenflow/flow.log', line: '.lumenflow/flow.log' },
  { pattern: '.lumenflow/commands.log', line: '.lumenflow/commands.log' },
  { pattern: '.lumenflow/sessions/', line: '.lumenflow/sessions/' },
  { pattern: '.lumenflow/memory/', line: '.lumenflow/memory/' },
  // WU-2180: Ephemeral paths that were missing, causing wu:done clean-tree failures
  { pattern: '.lumenflow/checkpoints/', line: '.lumenflow/checkpoints/' },
  { pattern: '.lumenflow/locks/', line: '.lumenflow/locks/' },
  { pattern: '.lumenflow/artifacts/', line: '.lumenflow/artifacts/' },
  {
    pattern: '.lumenflow/state/spawn-registry.jsonl',
    line: '.lumenflow/state/spawn-registry.jsonl',
  },
  { pattern: '.logs/', line: '.logs/' },
  { pattern: DEFAULT_WORKTREES_PATTERN, line: DEFAULT_WORKTREES_DIR },
];

export const GITIGNORE_TEMPLATE = `# Dependencies
node_modules/

# LumenFlow runtime state (local only, not shared)
.lumenflow/telemetry/
.lumenflow/flow.log
.lumenflow/commands.log
.lumenflow/sessions/
.lumenflow/memory/
.lumenflow/checkpoints/
.lumenflow/locks/
.lumenflow/artifacts/
.lumenflow/state/spawn-registry.jsonl

# WU-1852: Gates output logs (generated by wu:done/wu:prep)
.logs/

# Worktrees (isolated parallel work directories)
${DEFAULT_WORKTREES_DIR}

# Build output
dist/
*.tsbuildinfo

# Turbo
.turbo/

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

export const PRETTIERIGNORE_TEMPLATE = `# Dependencies
node_modules/

# Build output
dist/
*.tsbuildinfo

# Coverage reports
coverage/

# Turbo
.turbo/

# LumenFlow state (local only)
${DEFAULT_STATE_DIR_IGNORE}

# Worktrees
${DEFAULT_WORKTREES_DIR}

# Lockfiles (auto-generated)
pnpm-lock.yaml
package-lock.json
yarn.lock

# Environment files
.env
.env.local
.env.*.local
`;

export const SCRIPT_ARG_OVERRIDES: Record<string, string> = {
  'gates:docs': 'gates --docs-only',
};

export const SAFE_GIT_TEMPLATE = `#!/bin/sh
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

export const PRE_COMMIT_TEMPLATE = `#!/bin/sh
#
# LumenFlow Pre-Commit Hook
#
# Enforces worktree discipline by blocking direct commits to main/master.
# Does NOT assume pnpm test or UnsafeAny other commands exist.
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

export const GATE_STUB_SCRIPTS: Record<string, string> = {
  'spec:linter':
    'echo "[lumenflow] spec:linter stub -- install a WU spec linter or replace this script" && exit 0',
  lint: 'echo "[lumenflow] lint stub -- add ESLint or your preferred linter to enable this gate (e.g. eslint .)" && exit 0',
  typecheck:
    'echo "[lumenflow] typecheck stub -- add TypeScript or your type checker to enable this gate (e.g. tsc --noEmit)" && exit 0',
  // WU-1747: format and format:check stubs that auto-detect prettier availability.
  // When prettier is installed (after pnpm install), they run prettier directly.
  // When prettier is not installed, they exit 0 with guidance -- matching other gate stubs.
  format:
    'if command -v prettier >/dev/null 2>&1; then prettier --write .; else echo "[lumenflow] format stub -- install prettier to enable formatting (pnpm install)"; fi',
  'format:check':
    'if command -v prettier >/dev/null 2>&1; then prettier --check .; else echo "[lumenflow] format:check stub -- install prettier to enable this gate (pnpm install)"; fi',
  // WU-1852: cos:gates no-op stub so fresh projects can complete wu:done without manual setup.
  // wu:done unconditionally runs `pnpm cos:gates`; without this stub the command fails.
  'cos:gates':
    'echo "[lumenflow] cos:gates stub -- add COS governance rules or replace this script" && exit 0',
};

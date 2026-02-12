# LumenFlow Workflow Guide

**Last updated:** 2026-01-26

LumenFlow is a vendor-agnostic workflow framework for AI-native software development.

> **Context Safety**: When approaching context limits (80% usage, 50+ tool calls), spawn a fresh agent instead of continuing after compaction. See [wu-sizing-guide.md](docs/04-operations/_frameworks/lumenflow/wu-sizing-guide.md).

---

## Critical Rule: Use wu:prep Then wu:done

**WU-1223 NEW WORKFLOW:**

1. From worktree: `pnpm wu:prep --id WU-XXXX` (runs gates, prints copy-paste instruction)
2. From main: `pnpm wu:done --id WU-XXXX` (merge + cleanup only)

**DO NOT:**

- Run `wu:done` from a worktree (it will error)
- Forget to run `wu:done` after `wu:prep`
- Skip `wu:prep` and go directly to `wu:done` (gates won't run in worktree)

See: [docs/04-operations/\_frameworks/lumenflow/agent/onboarding/troubleshooting-wu-done.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/troubleshooting-wu-done.md)

---

## Quick Start

```bash
# 1. Setup (first time only)
pnpm setup

# 2. Create a WU (--id is optional, auto-generates next sequential ID if omitted)
pnpm wu:create --lane <Lane> --title "Title" \
  --description "..." --acceptance "..." --code-paths "..." \
  --test-paths-unit "..." --exposure backend-only \
  --spec-refs "lumenflow://plans/WU-XXXX-plan.md"

# 3. Claim (auto-merges spec branch to main if needed)
pnpm wu:claim --id WU-XXXX --lane <Lane>
cd worktrees/<lane>-wu-xxxx

# 4. Implement in worktree

# 5. Prepare (runs gates in worktree) - WU-1223 NEW
pnpm wu:prep --id WU-XXXX
# This prints a copy-paste instruction for the next step

# 6. Complete (from main checkout - copy-paste from wu:prep output)
cd /path/to/main && pnpm wu:done --id WU-XXXX
```

---

## When to Use Initiatives

Use **Initiatives** for multi-phase work spanning multiple WUs:

- **Product visions**: "Build a task management app"
- **Larger features**: Work requiring multiple WUs across lanes
- **Complex projects**: Anything that needs phased delivery

```bash
# Create an initiative for multi-phase work
pnpm initiative:create --id INIT-001 --title "Feature Name" \
  --description "..." --phase "Phase 1: MVP" --phase "Phase 2: Polish"

# Add WUs to the initiative
pnpm initiative:add-wu --initiative INIT-001 --wu WU-XXX --phase 1

# Track progress
pnpm initiative:status --id INIT-001
```

**Skip initiatives** for: single-file bug fixes, small docs updates, isolated refactoring.

---

## Setup Notes (Common First-Run Failures)

### Lane inference (sub-lanes)

If you use sub-lanes like `Experience: UI`, you must have a lane taxonomy:

- Ensure `.lumenflow.lane-inference.yaml` exists, or
- Generate it with `pnpm lane:suggest --output .lumenflow.lane-inference.yaml`

Without this file, sub-lane validation will fail.

### Local-only / no remote

By default, `wu:create` expects an `origin` remote and will fetch `origin/main`.

For local-only or offline development, add this to `.lumenflow.config.yaml`:

```yaml
git:
  requireRemote: false
```

When `requireRemote: false`:

- `wu:create` skips remote fetch operations
- `wu:claim` works without pushing to origin
- Useful for air-gapped environments, testing/evaluation, or pre-remote development

When `requireRemote: true` (default):

- Operations fail with a clear error if no `origin` remote exists
- Ensures team visibility via remote branches

---

## Core Principles

1. **Design-First** (feature/refactor WUs): Load `/skill design-first` before implementation. Question requirements, delete unnecessary, simplify before optimizing
2. **TDD**: Failing test -> implementation -> passing test (>=90% coverage on new code)
3. **Library-First**: Search existing libraries before custom code
4. **DRY/SOLID/KISS/YAGNI**: No magic numbers, no hardcoded strings
5. **Worktree Discipline**: After `wu:claim`, work ONLY in the worktree
6. **Branch Safety**: NEVER edit files on main branch. Run `git branch --show-current` before edits.
7. **Command Clarity**: If you are unsure about a command, run `<command> --help` first. Do not guess.
8. **Gates Before Done**: All gates must pass before `wu:done`
9. **Do Not Bypass Hooks**: No `--no-verify`, fix issues properly
10. **Always wu:done**: Complete every WU by running `pnpm wu:done`

---

## Universal Agent Safety (WU-1170)

LumenFlow enforces safety at the repository level so protections apply to all agents and humans.

- **Git wrapper**: `scripts/safe-git` blocks destructive operations (e.g. `worktree remove`, `reset --hard`, `clean -fd`, `push --force`).
- **Husky hooks**: staged secret scanning, absolute-path scanning, lockfile sync, and worktree discipline.
- **Audit logs**:
  - `.lumenflow/safety-blocks.log`
  - `.lumenflow/force-bypasses.log`

**IMPORTANT**: All worktree management MUST use `wu:` commands (not raw git):

- Create/claim worktrees: `pnpm wu:claim`
- Complete and remove: `pnpm wu:done`
- Clean stale worktrees: `pnpm wu:prune`
- Fix inconsistent state: `pnpm wu:recover`
- Release abandoned WUs: `pnpm wu:release`

Never run `git worktree remove`, `git worktree prune`, or `git branch -D` on lane branches directly.

---

## Global State

Canonical global state is defined by:

- `origin/main` (WU YAML + status.md + backlog.md + state store)
- Remote lane branches (e.g., `origin/lane/<lane>/wu-<id>`)

`wu:claim` updates canonical claim state on `origin/main` using a push-only micro-worktree, then
creates the lane branch and pushes it by default for global visibility. Use `--no-push` only for
air-gapped/offline work; it creates a local-only claim and warns explicitly.

### Cloud Branch-PR Lifecycle

For cloud agents (Codex/Claude web/CI) operating on feature branches:

- `wu:create --cloud` writes WU specs on the active branch (no main checkout requirement)
- `wu:claim --cloud` sets `claimed_mode: branch-pr` and persists `claimed_branch`
- `wu:done` completes via PR flow; run `wu:cleanup` after merge for stamps/state cleanup
- `wu:recover` and `wu:repair --admin` apply branch-pr fixes on the claimed branch (not `origin/main`)

---

## Documentation Structure

### Core (Vendor-Agnostic)

- **AGENTS.md** - Universal entry point for AI agents (Codex, Cursor, Windsurf)
- **LUMENFLOW.md** - This file, main workflow documentation
- **.lumenflow/constraints.md** - Non-negotiable workflow constraints
- **.lumenflow/rules/** - Workflow rules (git-safety.md, wu-workflow.md, etc.)
- **docs/04-operations/\_frameworks/lumenflow/agent/onboarding/** - Agent onboarding documentation

### Client/Vendor Overlays

- **CLAUDE.md** - Claude Code overlay (single file at root)
- **.claude/** - Claude Code settings, hooks, skills, agents
- **.cursor/rules/lumenflow.md** - Cursor rules overlay
- **.windsurf/rules/lumenflow.md** - Windsurf rules overlay

Use `lumenflow init --client <type>` to generate client-specific files:

```bash
lumenflow init                     # Creates AGENTS.md + LUMENFLOW.md (universal)
lumenflow init --client claude     # + CLAUDE.md, .claude/
lumenflow init --client cursor     # + .cursor/rules/lumenflow.md
lumenflow init --client windsurf   # + .windsurf/rules/lumenflow.md
lumenflow init --client all        # All of the above
lumenflow init --merge             # Safe merge into existing files
```

The `--merge` flag uses bounded markers (`LUMENFLOW:START`/`END`) to safely insert or update LumenFlow config in existing files without overwriting user content.

---

## Worktree Discipline (IMMUTABLE LAW)

After claiming a WU, you MUST work in its worktree:

```bash
# 1. Claim creates worktree
pnpm wu:claim --id WU-XXX --lane <lane>

# 2. IMMEDIATELY cd to worktree
cd worktrees/<lane>-wu-xxx

# 3. ALL work happens here (edits, git add/commit/push, tests, gates)

# 4. Return to main ONLY to complete
cd /path/to/main
pnpm wu:done --id WU-XXX
```

Main checkout becomes read-only after claim. Hooks will block WU commits from main.

---

## Definition of Done

- Acceptance criteria satisfied
- Gates green (`pnpm gates` or `pnpm gates --docs-only`)
- WU YAML status = `done`
- `.lumenflow/stamps/WU-<id>.done` exists
- **wu:done has been run** (not just documented as "to do")

---

## Core Commands

> **Complete CLI reference (60+ commands):** See [quick-ref-commands.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md)

| Command                         | Description                                            |
| ------------------------------- | ------------------------------------------------------ |
| `pnpm wu:create`                | Create new WU spec                                     |
| `pnpm wu:claim`                 | Claim WU, update canonical state, create worktree      |
| `pnpm wu:done`                  | Complete WU (merge, stamp, cleanup)                    |
| `pnpm wu:block`                 | Block WU (transitions to blocked, frees lane)          |
| `pnpm wu:unblock`               | Unblock WU (transitions to in_progress)                |
| `pnpm wu:release`               | Release orphaned WU (in_progress to ready for reclaim) |
| `pnpm wu:status`                | Show WU status, location, and valid commands           |
| `pnpm wu:recover`               | Analyze and fix WU state inconsistencies               |
| `pnpm gates`                    | Run quality gates                                      |
| `pnpm mem:checkpoint`           | Save memory checkpoint                                 |
| `pnpm exec lumenflow docs:sync` | Sync agent docs after upgrading LumenFlow packages     |

### Context-Aware Validation (WU-1090)

WU lifecycle commands include context-aware validation that automatically checks:

- **Location**: Whether you are in main checkout or a worktree
- **WU Status**: Whether the WU is in the correct state for the command
- **Git State**: Uncommitted changes, commits ahead/behind

When validation fails, commands provide copy-paste ready fix commands:

```
ERROR: WRONG_LOCATION - wu:done must be run from main checkout

FIX: Run this command:
  cd <repo-root> && pnpm wu:done --id WU-1090
```

Configure validation behavior in `.lumenflow.config.yaml`:

```yaml
experimental:
  context_validation: true # Enable/disable validation
  validation_mode: 'warn' # 'off' | 'warn' | 'error'
  show_next_steps: true # Show guidance after command success
```

### Recovery Commands

If WU state becomes inconsistent (e.g., worktree exists but status is 'ready'), use recovery:

```bash
# Analyze issues
pnpm wu:recover --id WU-XXX

# Apply suggested fix
pnpm wu:recover --id WU-XXX --action resume   # Reconcile state, preserve work
pnpm wu:recover --id WU-XXX --action reset    # Reset to ready, discard worktree
pnpm wu:recover --id WU-XXX --action cleanup  # Remove leftover worktree
```

---

## Constraints

See [.lumenflow/constraints.md](.lumenflow/constraints.md) for the 6 non-negotiable rules:

1. Worktree discipline and git safety
2. WUs are specs, not code
3. Docs-only vs code WUs
4. LLM-first, zero-fallback inference
5. Gates and skip-gates
6. Safety and governance

---

## Agent Onboarding

If you're an AI agent, read the onboarding docs:

1. [docs/04-operations/\_frameworks/lumenflow/agent/onboarding/troubleshooting-wu-done.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/troubleshooting-wu-done.md) - Most common mistake
2. [docs/04-operations/\_frameworks/lumenflow/agent/onboarding/first-wu-mistakes.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/first-wu-mistakes.md) - First WU pitfalls
3. [docs/04-operations/\_frameworks/lumenflow/agent/onboarding/agent-safety-card.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/agent-safety-card.md) - Safety guardrails
4. [docs/04-operations/\_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md) - Command reference
5. [docs/04-operations/\_frameworks/lumenflow/agent/onboarding/test-ratchet.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/test-ratchet.md) - Test baseline ratchet pattern

---

## Skills & Agents

LumenFlow provides modular skills and agent definitions for AI assistants.

### Skills

Skills are knowledge bundles in `.claude/skills/` (Claude Code) or `.lumenflow/skills/` (vendor-agnostic):

| Skill                 | Purpose                                     |
| --------------------- | ------------------------------------------- |
| `wu-lifecycle`        | WU claim/block/done automation              |
| `worktree-discipline` | Prevent absolute path trap                  |
| `tdd-workflow`        | RED-GREEN-REFACTOR, test-driven development |
| `lumenflow-gates`     | Gate troubleshooting                        |
| `bug-classification`  | P0-P3 triage, fix-in-place decisions        |

Load skills in Claude Code: `/skill wu-lifecycle`

### Agents

Pre-configured agent definitions in `.claude/agents/`:

| Agent             | Purpose                    |
| ----------------- | -------------------------- |
| `general-purpose` | Standard WU implementation |
| `lumenflow-pm`    | Backlog & lifecycle        |
| `test-engineer`   | TDD, coverage              |
| `code-reviewer`   | Quality checks             |
| `bug-triage`      | Bug classification         |

Generate handoff prompts (prompt-only, execution is a separate step): `pnpm wu:brief --id WU-XXX --client claude-code`
Record explicit delegation lineage when needed: `pnpm wu:delegate --id WU-XXX --parent-wu WU-YYY --client claude-code`

---

## References

- [LumenFlow Complete Guide](docs/04-operations/_frameworks/lumenflow/lumenflow-complete.md)
- [WU Sizing Guide](docs/04-operations/_frameworks/lumenflow/wu-sizing-guide.md)
- [Skills Index](.claude/skills/INDEX.md)
- [Agents README](.claude/agents/README.md)

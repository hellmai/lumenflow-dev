# LumenFlow Workflow Guide

**Last updated:** 2026-01-19

LumenFlow is a vendor-agnostic workflow framework for AI-native software development.

---

## Critical Rule: ALWAYS Run wu:done

**After completing work on a WU, you MUST run `pnpm wu:done --id WU-XXXX` from the main checkout.**

This is the single most forgotten step. Do NOT:

- Write "To Complete: pnpm wu:done" and stop
- Ask if you should run wu:done
- Forget to run wu:done

**DO**: Run `pnpm wu:done --id WU-XXXX` immediately after gates pass.

See: [docs/04-operations/\_frameworks/lumenflow/agent/onboarding/troubleshooting-wu-done.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/troubleshooting-wu-done.md)

---

## Quick Start

```bash
# 1. Setup (first time only)
pnpm setup

# 2. Create a WU (default: creates spec/wu-xxxx branch, never writes to main)
pnpm wu:create --id WU-XXXX --lane <Lane> --title "Title" \
  --description "..." --acceptance "..." --code-paths "..." \
  --test-paths-unit "..." --exposure backend-only \
  --spec-refs "lumenflow://plans/WU-XXXX-plan.md"

# 3. Claim (auto-merges spec branch to main if needed)
pnpm wu:claim --id WU-XXXX --lane <Lane>
cd worktrees/<lane>-wu-xxxx

# 4. Implement in worktree

# 5. Run gates
pnpm gates --docs-only  # for docs changes
pnpm gates              # for code changes

# 6. Complete (from main checkout)
cd /path/to/main
pnpm wu:done --id WU-XXXX
```

---

## Core Principles

1. **TDD**: Failing test -> implementation -> passing test (>=90% coverage on new code)
2. **Library-First**: Search existing libraries before custom code
3. **DRY/SOLID/KISS/YAGNI**: No magic numbers, no hardcoded strings
4. **Worktree Discipline**: After `wu:claim`, work ONLY in the worktree
5. **Branch Safety**: NEVER edit files on main branch. Run `git branch --show-current` before edits.
6. **Gates Before Done**: All gates must pass before `wu:done`
7. **Do Not Bypass Hooks**: No `--no-verify`, fix issues properly
8. **Always wu:done**: Complete every WU by running `pnpm wu:done`

---

## Global State

Canonical global state is defined by:

- `origin/main` (WU YAML + status.md + backlog.md + state store)
- Remote lane branches (e.g., `origin/lane/<lane>/wu-<id>`)

`wu:claim` updates canonical claim state on `origin/main` using a push-only micro-worktree, then
creates the lane branch and pushes it by default for global visibility. Use `--no-push` only for
air-gapped/offline work; it creates a local-only claim and warns explicitly.

---

## Documentation Structure

### Core (Vendor-Agnostic)

- **LUMENFLOW.md** - This file, main entry point
- **.lumenflow/constraints.md** - Non-negotiable workflow constraints
- **.lumenflow/rules/** - Workflow rules (git-safety.md, wu-workflow.md, etc.)
- **docs/04-operations/\_frameworks/lumenflow/agent/onboarding/** - Agent onboarding documentation

### Vendor Integrations

- **.claude/** - Claude Code (settings.json, hooks, .claude/CLAUDE.md)
- **.cursor/** - Cursor (rules, settings)
- **.aider.conf.yml** - Aider configuration
- **.continue/** - Continue configuration

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

## Commands Reference

| Command               | Description                                            |
| --------------------- | ------------------------------------------------------ |
| `pnpm wu:create`      | Create new WU spec                                     |
| `pnpm wu:claim`       | Claim WU, update canonical state, create worktree      |
| `pnpm wu:done`        | Complete WU (merge, stamp, cleanup)                    |
| `pnpm wu:block`       | Block WU (transitions to blocked, frees lane)          |
| `pnpm wu:unblock`     | Unblock WU (transitions to in_progress)                |
| `pnpm wu:release`     | Release orphaned WU (in_progress to ready for reclaim) |
| `pnpm gates`          | Run quality gates                                      |
| `pnpm mem:checkpoint` | Save memory checkpoint                                 |

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

Generate spawn prompts: `pnpm wu:spawn --id WU-XXX --client claude-code`

---

## References

- [LumenFlow Complete Guide](docs/04-operations/_frameworks/lumenflow/lumenflow-complete.md)
- [WU Sizing Guide](docs/04-operations/_frameworks/lumenflow/wu-sizing-guide.md)
- [Skills Index](.claude/skills/INDEX.md)
- [Agents README](.claude/agents/README.md)

# WU Workflow Rules

**Last updated:** 2026-01-19

This document defines the workflow rules for Work Units (WUs) in LumenFlow.

---

## WU Lifecycle

```
ready -> in_progress -> done
              |
              v
          blocked -> in_progress (unblocked)
```

### States

| State         | Description                                       |
| ------------- | ------------------------------------------------- |
| `ready`       | Approved and waiting for a lane to free up        |
| `in_progress` | Actively being implemented (exactly one per lane) |
| `blocked`     | Cannot proceed due to external dependency         |
| `waiting`     | Implementation finished, awaiting verification    |
| `done`        | Meets Definition of Done, all gates green         |

---

## Global State

Canonical global state is defined by:

- `origin/main` (WU YAML + status.md + backlog.md + state store)
- Remote lane branches (e.g., `origin/lane/<lane>/wu-<id>`)

`wu:claim` updates canonical claim state on `origin/main` using a push-only micro-worktree, then
creates the lane branch and pushes it by default for global visibility. Use `--no-push` only for
air-gapped/offline work; it creates a local-only claim and warns explicitly.

---

## Claiming a WU

```bash
# 1. Check lane is free
cat docs/04-operations/tasks/status.md

# 2. Claim the WU (creates worktree)
pnpm wu:claim --id WU-XXX --lane <Lane>

# 3. IMMEDIATELY cd to worktree
cd worktrees/<lane>-wu-xxx

# 4. Work only in worktree from this point
```

**WIP = 1**: Only ONE WU can be `in_progress` per lane at any time.

---

## Working in a WU

### TDD Workflow

1. Write a failing test for acceptance criteria
2. Run the test to confirm it fails (RED)
3. Implement the minimum code to pass the test
4. Run the test to confirm it passes (GREEN)
5. Refactor if needed, keeping tests green

### Commits

Use conventional commit format:

```bash
git commit -m "feat(scope): add feature description"
git commit -m "fix(scope): resolve bug description"
git commit -m "docs: update documentation"
```

### Running Gates

```bash
# For code changes
pnpm gates

# For documentation changes
pnpm gates --docs-only
```

---

## Completing a WU

**CRITICAL: ALWAYS run wu:done to complete a WU.**

```bash
# 1. Ensure gates pass in worktree
pnpm gates

# 2. Return to main checkout
cd /path/to/main

# 3. Complete the WU
pnpm wu:done --id WU-XXX
```

### What wu:done Does

1. Runs gates in the worktree
2. Fast-forward merges to main
3. Creates stamp (`.lumenflow/stamps/WU-XXX.done`)
4. Updates status and backlog docs
5. Removes the worktree
6. Pushes to origin

**NEVER:**

- Manually merge branches
- Manually create stamps
- Edit docs in main after claiming
- Skip wu:done and just push

---

## Blocking a WU

If you cannot proceed:

```bash
# Block the WU with a reason
pnpm wu:block --id WU-XXX --reason "Waiting for API access"

# Later, unblock when ready
pnpm wu:unblock --id WU-XXX
```

---

## Definition of Done

A WU is done when:

- [ ] Acceptance criteria satisfied
- [ ] Gates pass (`pnpm gates` or `pnpm gates --docs-only`)
- [ ] WU YAML status = `done`
- [ ] `.lumenflow/stamps/WU-<id>.done` exists
- [ ] `pnpm wu:done` has been run (not just documented)

---

## Anti-Patterns

### DO NOT:

- Work in main after claiming a worktree
- Manually merge or rebase on main
- Create stamps by hand
- Use `--no-verify` to bypass hooks
- Ask "should I run wu:done?" - just run it
- Write "To Complete: pnpm wu:done" without running it
- Present findings then go silent when user implies action ("so update X then?")
- Ask "should I update the WU?" after user already implied yes

### DO:

- Work exclusively in the worktree
- Run gates before wu:done
- Let wu:done handle the merge
- Run wu:done immediately after gates pass

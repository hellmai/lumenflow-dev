# LumenFlow Agent Starting Prompt

**Last updated:** 2026-01-27

This is the complete onboarding document for AI agents working with LumenFlow. Read this entire document before starting any work.

---

## Quick Start (Copy This)

```bash
# 1. Check your assigned WU
cat docs/04-operations/tasks/wu/WU-XXXX.yaml

# 2. Claim the WU (creates isolated worktree)
pnpm wu:claim --id WU-XXXX --lane "Lane Name"

# 3. IMMEDIATELY cd to worktree (CRITICAL!)
cd worktrees/<lane>-wu-xxxx

# 4. Do your work here (not in main!)

# 5. Run gates before completion
pnpm gates              # For code changes
pnpm gates --docs-only  # For documentation changes

# 6. Return to main and complete
cd /path/to/main/checkout
pnpm wu:done --id WU-XXXX
```

---

## The 5 Rules You Must Follow

### Rule 1: ALWAYS Work in Worktrees

After `pnpm wu:claim`, you MUST immediately `cd` to the worktree. **Never edit files in the main checkout.**

```bash
# WRONG - editing in main
pnpm wu:claim --id WU-123 --lane "Framework: CLI"
vim packages/cli/src/index.ts  # BLOCKED BY HOOKS!

# RIGHT - editing in worktree
pnpm wu:claim --id WU-123 --lane "Framework: CLI"
cd worktrees/framework-cli-wu-123  # IMMEDIATELY!
vim packages/cli/src/index.ts  # Safe here
```

**Why:** Worktrees isolate your changes. Main checkout is protected by git hooks.

### Rule 2: ALWAYS Run wu:done

After gates pass, you MUST run `pnpm wu:done --id WU-XXXX` from the main checkout. Do not just write "To complete: run wu:done" - actually run it.

```bash
# WRONG
"Work complete. Next step: run pnpm wu:done --id WU-123"

# RIGHT
cd /path/to/main
pnpm wu:done --id WU-123
# Then report: "WU-123 completed. Changes merged to main."
```

**Why:** wu:done merges your changes, creates the completion stamp, and releases the lane lock.

### Rule 3: Use Relative Paths Only

When writing or editing files, use paths relative to the worktree root.

```bash
# WRONG - absolute paths
Write to: /home/user/project/worktrees/cli-wu-123/src/index.ts

# RIGHT - relative paths
Write to: src/index.ts
# (from within the worktree directory)
```

**Why:** Absolute paths may accidentally write to main or wrong worktree.

### Rule 4: Handle Gate Failures Properly

When gates fail, read the error and fix it. Common failures and fixes:

| Failure        | Cause                   | Fix                                    |
| -------------- | ----------------------- | -------------------------------------- |
| `format:check` | Prettier formatting     | `pnpm prettier --write <file>`         |
| `backlog-sync` | WU missing from backlog | Regenerate backlog or add WU reference |
| `typecheck`    | TypeScript errors       | Fix the type errors                    |
| `lint`         | ESLint violations       | `pnpm lint --fix` or manual fix        |
| `test`         | Failing tests           | Fix the tests or implementation        |

**Pre-existing failures:** If failures exist on main before your changes:

```bash
pnpm wu:done --id WU-XXX --skip-gates \
  --reason "Pre-existing format failures in apps/docs/*.mdx" \
  --fix-wu WU-XXX
```

### Rule 5: Know When to Use LUMENFLOW_FORCE

`LUMENFLOW_FORCE=1` bypasses git hooks. Use it ONLY for emergency fixes when hooks are incorrectly blocking you.

```bash
# Emergency: backlog fix when worktree hook blocks main writes
LUMENFLOW_FORCE=1 LUMENFLOW_FORCE_REASON="backlog corruption recovery" git commit -m "fix: ..."
LUMENFLOW_FORCE=1 LUMENFLOW_FORCE_REASON="backlog corruption recovery" git push
```

**Never use for:**

- Skipping failing tests
- Avoiding gate failures
- Convenience

**Always use with:**

- `LUMENFLOW_FORCE_REASON="explanation"`

---

## Common Failure Scenarios and Recovery

### Scenario 1: "BLOCKED: Direct commit to main"

**Cause:** You're trying to commit in the main checkout, not the worktree.

**Fix:**

```bash
# Check where you are
pwd
# Should be: .../worktrees/<lane>-wu-xxx
# If in main, cd to worktree first

cd worktrees/<lane>-wu-xxx
git add . && git commit -m "your message"
```

### Scenario 2: "backlog-sync failed - WU not found in backlog.md"

**Cause:** The backlog.md file is missing references to some WU YAML files.

**Fix:** Regenerate the backlog or manually add the missing WU:

```bash
# In worktree, edit docs/04-operations/tasks/backlog.md
# Add the missing WU reference in the appropriate section
```

### Scenario 3: "Auto-rebase failed: unstaged changes"

**Cause:** Your worktree has uncommitted changes when wu:done tries to rebase.

**Fix:**

```bash
cd worktrees/<lane>-wu-xxx
git status  # See what's uncommitted
git add . && git commit -m "wip: complete changes"
cd /path/to/main
pnpm wu:done --id WU-XXX
```

### Scenario 4: "Working tree is not clean" (when running wu:done)

**Cause:** Main checkout has uncommitted changes (possibly from another agent).

**Fix:**

```bash
cd /path/to/main
git status  # Check what's uncommitted
# If your changes: commit them
# If another agent's changes: DO NOT DELETE - coordinate with user
git restore <file>  # Only if safe to discard
```

### Scenario 5: Gate fails but you didn't cause the failure

**Cause:** Pre-existing failures on main that your WU didn't introduce.

**Fix:**

```bash
# Verify the failure exists on main before your changes
git stash
pnpm gates  # If still fails, it's pre-existing
git stash pop

# Complete with skip-gates
pnpm wu:done --id WU-XXX --skip-gates \
  --reason "Pre-existing failure in X" \
  --fix-wu WU-XXX
```

---

## WU Lifecycle Commands

| Command                                   | Description                      | When to Use           |
| ----------------------------------------- | -------------------------------- | --------------------- |
| `pnpm wu:status --id WU-XXX`              | Show WU state and valid commands | Check current state   |
| `pnpm wu:claim --id WU-XXX --lane "Lane"` | Claim WU and create worktree     | Start working         |
| `pnpm gates`                              | Run quality gates                | Before wu:done        |
| `pnpm gates --docs-only`                  | Run docs-only gates              | For documentation WUs |
| `pnpm wu:done --id WU-XXX`                | Complete WU, merge, cleanup      | After gates pass      |
| `pnpm wu:recover --id WU-XXX`             | Fix inconsistent WU state        | When state is broken  |

---

## File Structure

```
/path/to/repo/
├── docs/04-operations/tasks/
│   ├── backlog.md              # All WUs listed here
│   └── wu/WU-XXXX.yaml         # Individual WU specs
├── worktrees/
│   └── <lane>-wu-xxxx/         # Your isolated workspace
├── .lumenflow/
│   ├── constraints.md          # Non-negotiable rules
│   ├── stamps/WU-XXXX.done     # Completion stamps
│   └── state/wu-events.jsonl   # Event log
└── LUMENFLOW.md                # Main workflow docs
```

---

## Definition of Done

Before reporting a WU complete, verify:

- [ ] All acceptance criteria in WU YAML are satisfied
- [ ] Gates pass (`pnpm gates` or `pnpm gates --docs-only`)
- [ ] `pnpm wu:done --id WU-XXX` ran successfully
- [ ] Output shows "Marked done, pushed, and cleaned up"
- [ ] Worktree was removed (check `ls worktrees/`)

---

## Anti-Patterns (Don't Do These)

1. **Don't write "To complete: run wu:done"** - Actually run it
2. **Don't edit files in main checkout** - Use the worktree
3. **Don't use absolute paths** - Use relative paths from worktree root
4. **Don't ignore gate failures** - Fix them or use --skip-gates with reason
5. **Don't use LUMENFLOW_FORCE casually** - Only for genuine emergencies
6. **Don't delete another agent's uncommitted work** - Coordinate with user
7. **Don't work after context compaction** - Spawn fresh agent instead

---

## Getting Help

1. **Check WU status:** `pnpm wu:status --id WU-XXX`
2. **Read error messages:** They usually include fix commands
3. **Check gate logs:** `.logs/gates-*.log` in worktree
4. **Recovery command:** `pnpm wu:recover --id WU-XXX`

---

## Reference Documents

- [LUMENFLOW.md](../../../../../LUMENFLOW.md) - Main workflow documentation
- [.lumenflow/constraints.md](../../../../../.lumenflow/constraints.md) - The 6 non-negotiable rules
- [troubleshooting-wu-done.md](troubleshooting-wu-done.md) - Why agents forget wu:done
- [first-wu-mistakes.md](first-wu-mistakes.md) - Common mistakes to avoid
- [quick-ref-commands.md](quick-ref-commands.md) - Command reference

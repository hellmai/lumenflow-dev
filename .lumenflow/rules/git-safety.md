# Git Safety Rules

**Last updated:** 2026-01-19

This document defines the git safety rules for LumenFlow workflows.

---

## Golden Rules

1. **Main is protected**: Never run destructive commands on main
2. **Worktrees are isolated**: Safe to experiment within worktrees
3. **Hooks enforce safety**: Never bypass with `--no-verify`
4. **wu:done is the only path**: No manual merges to main

---

## Forbidden Commands on Main

These commands are blocked by hooks on the main checkout:

```bash
# Data destruction
git reset --hard           # Loses uncommitted changes
git clean -fd              # Deletes untracked files
git checkout -f            # Discards local changes

# Hidden work
git stash                  # Hides work from visibility

# History rewrite
git push --force           # Overwrites remote history
git push -f                # Same as above
git rebase -i              # Interactive rebase rewrites history

# Bypass safety
--no-verify                # Skips pre-commit hooks
HUSKY=0                    # Disables all hooks

# Worktree manipulation
git worktree remove        # Agents must not delete worktrees
git worktree prune         # Agents must not prune worktrees
```

---

## Safe Commands (Always Allowed)

```bash
# Reading
git status
git log
git diff
git show
git branch -a

# Worktree navigation
cd worktrees/<lane>-wu-xxx

# LumenFlow commands
pnpm wu:claim
pnpm wu:done
pnpm wu:block
pnpm wu:unblock
pnpm gates
```

---

## Commands Allowed in Worktrees

Inside a worktree on a lane branch, more commands are safe:

```bash
# Commits
git add .
git commit -m "message"
git push origin lane/<lane>/wu-xxx

# Branch operations
git fetch origin
git rebase origin/main     # Before push, to stay up to date

# Stash (within worktree only)
git stash                  # OK in worktree
git stash pop
```

**Why:** Worktrees are isolated. Destructive operations only affect your branch, not main or other WUs.

---

## Merge Strategy

LumenFlow uses fast-forward-only merges:

```bash
# WRONG: Manual merge
git checkout main
git merge lane/core/wu-123  # Creates merge commit

# RIGHT: Let wu:done handle it
pnpm wu:done --id WU-123    # Fast-forward merge
```

**Why:** Fast-forward merges keep history linear and avoid merge commits.

---

## Rebasing Before Push

If main has advanced while you worked:

```bash
# In worktree
git fetch origin
git rebase origin/main

# Resolve conflicts if any
# Then push
git push origin lane/<lane>/wu-xxx --force-with-lease
```

**Note:** `--force-with-lease` is safer than `--force` as it checks remote state first.

---

## Recovering from Mistakes

### Accidentally Committed to Main

```bash
# Check if pushed
git log origin/main..main

# If not pushed, reset (ONLY if safe)
git reset --soft HEAD~1    # Keeps changes staged

# Move to correct worktree and recommit
```

### Worktree in Bad State

```bash
# Ask for help rather than force-fixing
# wu:done will fail safely if worktree is corrupt
```

---

## Hook Enforcement

### Pre-commit Hook

- Runs format check
- Blocks commits on main for WU files
- Validates commit message format

### Pre-push Hook

- Validates branch naming
- Blocks force push to main
- Ensures wu:done workflow is followed

### What to Do if Hooks Fail

1. Read the error message carefully
2. Fix the underlying issue (format, lint, type errors)
3. Re-run the commit

**NEVER use `--no-verify` to bypass hooks.**

---

## Emergency Situations

If you encounter a situation where safety rules seem to block legitimate work:

1. **Stop and document** the situation
2. **Ask a human** before bypassing any safety
3. **Never assume** that bypassing is okay

Most "emergencies" are actually misunderstandings that have safe solutions.

# Troubleshooting: wu:done Not Run

**Last updated:** 2026-01-19

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

```bash
cd /path/to/main
pnpm wu:done --id WU-XXX
```

Do NOT:
- Ask "Should I run wu:done?"
- Write "To Complete: pnpm wu:done"
- Wait for permission
- Treat it as a "future step"

---

## Correct Completion Flow

```bash
# 1. In worktree, run gates
pnpm gates

# 2. If gates pass, return to main
cd /path/to/main

# 3. IMMEDIATELY run wu:done
pnpm wu:done --id WU-XXX

# 4. Report success with the wu:done output
```

---

## What wu:done Does

When you run `pnpm wu:done --id WU-XXX`:

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

- Worktree still exists: `ls worktrees/`
- No stamp: `ls .beacon/stamps/WU-XXX.done` returns nothing
- Status unchanged: WU still shows as `in_progress`
- Branch not merged: Changes only on lane branch

---

## Recovery

If a previous agent forgot to run wu:done:

```bash
# 1. Check worktree exists
ls worktrees/

# 2. If it does, run wu:done
pnpm wu:done --id WU-XXX

# 3. If worktree was deleted but branch exists
# This is a bad state - may need manual recovery
```

---

## Why This Matters

An incomplete WU causes problems:

1. **Lane blocked**: WIP=1 means no other work can start
2. **Work lost**: Changes might not reach main
3. **Context lost**: Next agent doesn't know work is done
4. **Process broken**: The whole workflow depends on wu:done

---

## Checklist Before Ending Session

- [ ] Did I run `pnpm gates` in the worktree?
- [ ] Did gates pass?
- [ ] Did I `cd` back to main?
- [ ] Did I run `pnpm wu:done --id WU-XXX`?
- [ ] Did wu:done complete successfully?

If any answer is "no", you're not done yet.

---

## Anti-Patterns

### WRONG:

```
I've completed all the work. To finish:
1. Run `pnpm wu:done --id WU-123`
```

### RIGHT:

```bash
# Actually run it
cd /home/project/main
pnpm wu:done --id WU-123
# Output: WU-123 completed successfully
```

Then report:

```
WU-123 completed successfully. Changes merged to main, stamp created.
```

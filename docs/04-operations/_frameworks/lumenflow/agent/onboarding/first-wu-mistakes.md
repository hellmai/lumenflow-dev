# First WU Mistakes

**Last updated:** 2026-02-25

Common mistakes agents make on their first WU, and how to avoid them.

---

## Mistake 1: Not Using Worktrees

### Wrong

```bash
# Working directly in main
vim src/feature.ts
git commit -m "feat: add feature"
git push origin main
```

### Right

```bash
# Claim first, then work in worktree
pnpm wu:claim --id WU-123 --lane Core
cd worktrees/core-wu-123
vim src/feature.ts
git commit -m "feat: add feature"
git push origin lane/core/wu-123
pnpm wu:prep --id WU-123  # WU-1223: runs gates, prints copy-paste instruction
cd /path/to/main && pnpm wu:done --id WU-123  # Copy-paste from wu:prep output
```

---

## Mistake 2: Forgetting to Run wu:prep and wu:done

See [troubleshooting-wu-done.md](troubleshooting-wu-done.md) for the full explanation.

**TL;DR (WU-1223):**

1. From worktree: `pnpm wu:prep --id WU-XXX` (runs gates)
2. From main: `pnpm wu:done --id WU-XXX` (copy-paste from wu:prep output)

---

## Mistake 3: Working Outside code_paths

### Wrong

The WU says `code_paths: [src/api/**]` but you edit `src/ui/component.ts`.

### Right

Only edit files within the specified `code_paths`. If you need to edit other files, that's a different WU.

---

## Mistake 4: Skipping TDD

### Wrong

```
1. Write the feature
2. Maybe write tests later
3. Tests are hard, skip them
```

### Right

```
1. Write failing test
2. Run test (confirm RED)
3. Write minimum code
4. Run test (confirm GREEN)
5. Refactor if needed
```

---

## Mistake 5: Using Forbidden Git Commands

### Wrong

```bash
git reset --hard HEAD
git push --force
git commit --no-verify
```

### Right

```bash
git add .
git commit -m "feat: description"
git push origin lane/core/wu-123
```

---

## Mistake 6: Working After Hours on Same WU

If you need to pause:

```bash
# Commit your work
git add .
git commit -m "wip: partial progress"
git push origin lane/core/wu-123
```

Do NOT leave uncommitted changes in the worktree.

---

## Mistake 7: Ignoring Gate Failures

### Wrong

```
Gates failed but I think the code is fine.
Let me use --skip-gates.
```

### Right

```
Gates failed. Let me read the error:
- TypeScript error in src/api/handler.ts
- Missing return type

Fix: Add the return type.
Re-run: pnpm gates
```

---

## Mistake 8: Scope Creep

### Wrong

The WU says "Add user profile endpoint" but you also:

- Refactor the database schema
- Add email notifications
- Redesign the UI

### Right

Implement exactly what the acceptance criteria specify. If you discover other needed changes, create new WUs for them.

---

## Mistake 9: Not Reading the WU Spec

### Wrong

Start coding immediately based on the title.

### Right

1. Read the full WU YAML
2. Understand acceptance criteria
3. Review code_paths
4. Check dependencies
5. Check spec_refs for linked plans (if present, read the plan document)
6. Then start

---

## Mistake 10: Editing Main After Claim

### Wrong

```bash
pnpm wu:claim --id WU-123 --lane Core
# Still in main directory
vim src/feature.ts  # WRONG!
```

### Right

```bash
pnpm wu:claim --id WU-123 --lane Core
cd worktrees/core-wu-123  # IMMEDIATELY
vim src/feature.ts  # Now it's safe
```

---

## Mistake 11: "Quick Fixing" on Main

### Wrong

```bash
# On main, see failing format check
pnpm gates
# Output: format:check failed

# Instinct: "I should help fix this!"
pnpm prettier --write apps/docs/src/content/docs/concepts/lanes.mdx
# Files modified on main - BAD!
```

### Right

```bash
# On main, see failing format check
pnpm gates
# Output: format:check failed

# Report to user or create a WU
# "Format check is failing on main. Should I create a WU to fix it?"

# If yes:
pnpm wu:create --lane "Content: Documentation" --title "Fix format issues" ...
pnpm wu:claim --id WU-XXX --lane "Content: Documentation"
cd worktrees/content-documentation-wu-xxx
pnpm prettier --write <files>  # Safe in worktree
```

**Why:** The "helpful fix" instinct is dangerous. Even small fixes (format, typos, lint) must go through a worktree. Commits are blocked by hooks, but files are still modified, requiring cleanup with `git checkout -- <files>`.

**Rule:** If you're on main and want to change something—STOP. Create a WU first.

---

## Mistake 12: Not Acting on Implied Directives

### Wrong

```text
Agent: [presents research findings about a bug]
User: "so update 1348 then?"
Agent: [no response or asks "should I update it?"]
```

### Right

```text
Agent: [presents research findings about a bug]
User: "so update 1348 then?"
Agent: Updating WU-1348 with these findings now.
[Edits the WU YAML file]
```

### How to Update a WU

**Option 1: CLI command**

```bash
pnpm wu:edit --id WU-1348 --notes "Research findings: ..."
```

**Option 2: Direct file edit**

```bash
# Edit docs/04-operations/tasks/wu/WU-1348.yaml directly
```

### Recognizing Implied Directives

Phrases that mean "do this now":

- "so do X then?" / "so X then?"
- "update that" / "add that"
- "fix it" / "make that change"
- "go ahead" / "proceed"
- "sounds good, do it"

**Rule:** Information + user confirmation = immediate action. Don't ask "should I proceed?" when user already implied yes.

---

## Lane Lock Lifecycle and Zombie Detection (WU-1901)

Lane locks (`.lumenflow/locks/<lane-kebab>.lock`) enforce WIP=1. Key semantics:

- **Lock acquisition**: `wu:claim` creates a lock file atomically with a PID, timestamp, and WU ID.
- **PID becomes invalid immediately**: Since `wu:claim` is a short-lived process, the PID in the lock becomes dead as soon as the claim completes. This is expected -- the lock persists on disk.
- **Zombie detection requires BOTH conditions**: A lock is only auto-cleared if it is BOTH stale (older than 2 hours) AND the PID is dead. A dead PID alone does NOT trigger auto-clearing.
- **Normal release**: `wu:done` removes the lock after merging.
- **Manual unlock**: `pnpm wu:unlock-lane --lane "<lane>" --reason "<reason>"` for genuinely abandoned locks.

This means a recently claimed lane (within 2 hours) will NOT be auto-cleared even if the claiming process has exited. To reclaim a lane held by another WU, complete or release the existing WU first.

---

## Mistake 13: Ignoring Sizing Warnings (WU-2141)

### Wrong

```
[wu:create] WARNING (WU-200): sizing: estimated_files (60) exceeds Simple
threshold (20). Consider adding exception_type/exception_reason...

Agent: [ignores the warning, proceeds without sizing metadata]
```

### Right

When `wu:create` or `wu:brief` emits a sizing advisory warning, either:

1. **Add exception metadata** if the oversize WU is justified:

```yaml
sizing_estimate:
  estimated_files: 60
  estimated_tool_calls: 150
  strategy: orchestrator-worker
  exception_type: docs-only
  exception_reason: All markdown documentation files, low complexity
```

2. **Split the WU** if the estimate genuinely exceeds session capacity (see [wu-sizing-guide.md](../../wu-sizing-guide.md) section 3 for splitting patterns).

**Strict mode:** Teams can enforce sizing compliance for delegated work with `--strict-sizing` on `wu:brief`. In strict mode, missing or non-compliant sizing metadata blocks the operation.

```bash
# This will block if WU-XXX lacks sizing_estimate or exceeds thresholds
pnpm wu:brief --id WU-XXX --client claude-code --strict-sizing
```

See the [WU Sizing Guide](../../wu-sizing-guide.md) section 1.4 for the full contract specification.

---

## Quick Checklist

Before starting any WU:

- [ ] Read the full WU spec
- [ ] Understand acceptance criteria
- [ ] Check spec_refs for plans (read linked plans if present)
- [ ] Review sizing_estimate if present (check thresholds)
- [ ] Claim the WU with `pnpm wu:claim`
- [ ] cd to the worktree IMMEDIATELY
- [ ] Work only in the worktree
- [ ] Stay within code_paths
- [ ] Follow TDD
- [ ] Run wu:prep from worktree (runs gates)
- [ ] Run wu:done from main (copy-paste from wu:prep output)

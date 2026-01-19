# First WU Mistakes

**Last updated:** 2026-01-19

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
cd /path/to/main
pnpm wu:done --id WU-123
```

---

## Mistake 2: Forgetting to Run wu:done

See [troubleshooting-wu-done.md](troubleshooting-wu-done.md) for the full explanation.

**TL;DR:** After gates pass, ALWAYS run `pnpm wu:done --id WU-XXX`.

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
5. Then start

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

## Quick Checklist

Before starting any WU:

- [ ] Read the full WU spec
- [ ] Understand acceptance criteria
- [ ] Claim the WU with `pnpm wu:claim`
- [ ] cd to the worktree IMMEDIATELY
- [ ] Work only in the worktree
- [ ] Stay within code_paths
- [ ] Follow TDD
- [ ] Run gates before wu:done
- [ ] ALWAYS run wu:done

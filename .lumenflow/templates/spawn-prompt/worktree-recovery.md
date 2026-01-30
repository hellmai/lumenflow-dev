---
id: worktree-recovery
name: Worktree Block Recovery
required: false
order: 300
tokens: [WORKTREE_PATH]
condition: 'worktreePath'
---

## When Blocked by Worktree Hook

If you encounter a "worktree required" or "commit blocked" error:

1. **Check existing worktrees**: `git worktree list`
2. **Navigate to the worktree**: `cd {WORKTREE_PATH}`
3. **Retry your operation** from within the worktree
4. **Use relative paths only** (never absolute paths)

### Common Causes

- Running `git commit` from main checkout instead of worktree
- Using absolute paths that bypass worktree isolation
- Forgetting to `cd` to worktree after `wu:claim`

### Quick Fix

```bash
# Check where you are
pwd
git worktree list

# Navigate to your worktree
cd {WORKTREE_PATH}

# Retry your commit
git add . && git commit -m "your message"
```

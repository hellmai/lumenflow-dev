---
id: quick-fix-commands
name: Quick Fix Commands
required: true
order: 210
tokens: []
---

## Quick Fix Commands

If gates fail, try these before investigating:

```bash
pnpm format      # Auto-fix formatting issues
pnpm lint        # Check linting (use --fix for auto-fix)
pnpm typecheck   # Check TypeScript types
```

**Use before gates** to catch simple issues early. These are faster than full `pnpm gates`.
